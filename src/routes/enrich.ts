import { Hono } from 'hono';
import type postgres from 'postgres';
import { fetchHLTB } from '../lib/hltb';
import { embedSingle, isOllamaEnabled, toVectorLiteral } from '../lib/ollama';
import { sleep } from '../lib/sleep';
import { type AppDetails, fetchAppDetails, stripHtml } from '../lib/steam';
import { fetchSteamSpy } from '../lib/steamspy';
import { fetchSimilarAppids } from '../lib/store-page';

/**
 * POST /enrich           — enrich a batch of games whose enriched_at is NULL
 * POST /enrich/:appid    — force-enrich a single game now
 * POST /embed            — embed a batch of games whose embedded_at is NULL
 */
export function enrichRoutes(raw: postgres.Sql) {
	const app = new Hono();

	app.post('/enrich', async (c) => {
		const limit = clamp(
			Number.parseInt(c.req.query('limit') ?? '25', 10) || 25,
			1,
			200,
		);
		const rows = await raw`
			SELECT appid FROM games
			WHERE enriched_at IS NULL
			ORDER BY appid ASC
			LIMIT ${limit}
		`;
		const result = { ok: 0, skipped: 0, failed: 0, total: rows.length };
		for (const r of rows) {
			try {
				const out = await enrichOne(raw, r.appid as number);
				if (out === 'ok') result.ok++;
				else result.skipped++;
			} catch {
				result.failed++;
			}
			await sleep(1500); // Steam appdetails rate limit
		}
		return c.json(result);
	});

	app.post('/enrich/:appid', async (c) => {
		const appid = Number.parseInt(c.req.param('appid'), 10);
		if (!Number.isFinite(appid)) return c.json({ error: 'bad appid' }, 400);
		try {
			const status = await enrichOne(raw, appid);
			return c.json({ appid, status });
		} catch (e) {
			console.error(`[enrich/${appid}]`, e);
			const msg = e instanceof Error ? e.message : 'unknown';
			const stack = e instanceof Error ? e.stack : undefined;
			return c.json({ error: msg, stack, appid }, 502);
		}
	});

	app.post('/embed', async (c) => {
		if (!isOllamaEnabled())
			return c.json({ error: 'OLLAMA_URL not set' }, 503);
		const limit = clamp(
			Number.parseInt(c.req.query('limit') ?? '50', 10) || 50,
			1,
			500,
		);
		const rows = await raw`
			SELECT appid FROM games
			WHERE enriched_at IS NOT NULL AND embedded_at IS NULL
			ORDER BY appid ASC
			LIMIT ${limit}
		`;
		let ok = 0;
		let failed = 0;
		for (const r of rows) {
			try {
				await embedOne(raw, r.appid as number);
				ok++;
			} catch {
				failed++;
			}
		}
		return c.json({ ok, failed, total: rows.length });
	});

	return app;
}

export async function enrichOne(
	raw: postgres.Sql,
	appid: number,
): Promise<'ok' | 'skipped'> {
	const details: AppDetails | null = await fetchAppDetails(appid).catch(
		() => null,
	);

	if (!details) {
		// Mark enriched_at so we don't keep retrying delisted apps every cycle.
		await raw`UPDATE games SET enriched_at = now(), updated_at = now() WHERE appid = ${appid}`;
		return 'skipped';
	}

	const platforms = details.platforms ?? {};
	const price = details.price_overview;

	await raw`
		UPDATE games SET
			name           = COALESCE(${details.name ?? null}, name),
			type           = ${details.type ?? null},
			is_free        = ${details.is_free ?? null},
			required_age   = ${details.required_age ?? null},
			short_desc     = ${stripHtml(details.short_description) ?? null},
			about          = ${stripHtml(details.about_the_game) ?? null},
			detailed_desc  = ${stripHtml(details.detailed_description) ?? null},
			release_date   = ${details.release_date?.date ?? null},
			developers     = ${details.developers ?? null},
			publishers     = ${details.publishers ?? null},
			genres         = ${details.genres?.map((g) => g.description) ?? null},
			categories     = ${details.categories?.map((g) => g.description) ?? null},
			platforms      = ${JSON.stringify({
				windows: !!platforms.windows,
				mac: !!platforms.mac,
				linux: !!platforms.linux,
			})}::jsonb,
			controller     = ${details.controller_support ?? null},
			metacritic     = ${details.metacritic?.score ?? null},
			metacritic_url = ${details.metacritic?.url ?? null},
			header_image   = ${details.header_image ?? null},
			capsule_image  = ${details.capsule_image ?? null},
			website        = ${details.website ?? null},
			price_cents    = ${price?.final ?? null},
			currency       = ${price?.currency ?? null},
			enriched_at    = now(),
			updated_at     = now()
		WHERE appid = ${appid}
	`;

	// SteamSpy (tags + ownership/playtime/reviews)
	try {
		const spy = await fetchSteamSpy(appid);
		if (spy) {
			await raw`
				UPDATE games SET
					owners_estimate = ${spy.owners ?? null},
					positive        = ${spy.positive ?? null},
					negative        = ${spy.negative ?? null},
					avg_playtime    = ${spy.average_forever ?? null},
					median_playtime = ${spy.median_forever ?? null},
					ccu             = ${spy.ccu ?? null},
					updated_at      = now()
				WHERE appid = ${appid}
			`;
			if (spy.tags && Object.keys(spy.tags).length > 0) {
				await raw`DELETE FROM game_tags WHERE appid = ${appid}`;
				const rows = Object.entries(spy.tags).map(([tag, votes]) => ({
					appid,
					tag,
					votes,
				}));
				await raw`INSERT INTO game_tags ${raw(rows, 'appid', 'tag', 'votes')}`;
			}
		}
	} catch {
		/* SteamSpy is best-effort */
	}

	// "More like this"
	try {
		const similar = await fetchSimilarAppids(appid);
		if (similar.length > 0) {
			await raw`DELETE FROM game_similar WHERE appid = ${appid}`;
			const rows = similar.slice(0, 30).map((s, i) => ({
				appid,
				similar_appid: s,
				rank: i,
			}));
			await raw`INSERT INTO game_similar ${raw(rows, 'appid', 'similar_appid', 'rank')} ON CONFLICT DO NOTHING`;
		}
	} catch {
		/* best-effort */
	}

	// HLTB (use the freshly-updated name)
	try {
		const [g] = await raw`SELECT name FROM games WHERE appid = ${appid}`;
		const name = g?.name as string | undefined;
		if (name) {
			const hl = await fetchHLTB(name);
			if (hl) {
				await raw`
					UPDATE games SET
						hltb_main      = ${hl.main ?? null},
						hltb_extra     = ${hl.extras ?? null},
						hltb_complete  = ${hl.completionist ?? null},
						updated_at     = now()
					WHERE appid = ${appid}
				`;
			}
		}
	} catch {
		/* best-effort */
	}

	return 'ok';
}

export async function embedOne(
	raw: postgres.Sql,
	appid: number,
): Promise<void> {
	const [game] = await raw`
		SELECT name, short_desc, about, genres FROM games WHERE appid = ${appid}
	`;
	if (!game) throw new Error(`game ${appid} not found`);

	const tagRows = await raw`
		SELECT tag FROM game_tags WHERE appid = ${appid}
		ORDER BY votes DESC LIMIT 15
	`;
	const tags = tagRows.map((r) => r.tag).join(', ');
	const genres = (game.genres as string[] | null)?.join(', ') ?? '';
	const doc = [
		game.name,
		[genres, tags].filter(Boolean).join(' | '),
		game.short_desc,
	]
		.filter(Boolean)
		.join('\n');

	const v = await embedSingle(doc);
	const lit = toVectorLiteral(v);
	await raw`
		UPDATE games SET embedding = ${lit}::vector, embedded_at = now(), updated_at = now()
		WHERE appid = ${appid}
	`;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}
