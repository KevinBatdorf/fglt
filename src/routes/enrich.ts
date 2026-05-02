import { Hono } from 'hono';
import type postgres from 'postgres';
import { fetchHLTB, HLTBRateLimitError } from '../lib/hltb';
import { embedSingle, isOllamaEnabled, toVectorLiteral } from '../lib/ollama';
import {
	fetchOpenCriticScore,
	isOpenCriticEnabled,
	OpenCriticRateLimitError,
} from '../lib/opencritic';
import { sleep } from '../lib/sleep';
import { type AppDetails, fetchAppDetails, stripHtml } from '../lib/steam';
import { fetchSteamReviews } from '../lib/steam-reviews';
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
		if (!(await isOllamaEnabled()))
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

/**
 * Full per-game enrichment: appdetails + steamspy + similar + HLTB +
 * Steam user reviews + OpenCritic. Used by the cron and by the
 * `?source=all` (default) path of /games/:appid/refresh.
 *
 * Per-source helpers below (`refreshAppdetailsOnly`, `refreshSteamReviewsOne`,
 * `refreshOpenCriticOne`) are exported and used by the per-source refresh
 * path so the user can fetch only one source without burning rate budgets
 * for the others.
 */
export async function enrichOne(
	raw: postgres.Sql,
	appid: number,
): Promise<'ok' | 'skipped'> {
	const status = await refreshAppdetailsOnly(raw, appid);
	if (status === 'skipped') return 'skipped';

	// Steam user reviews — public endpoint, no key
	try {
		await refreshSteamReviewsOne(raw, appid);
	} catch (e) {
		console.warn(
			`[enrich/${appid}] steam reviews failed:`,
			e instanceof Error ? e.message : e,
		);
	}

	// OpenCritic critic score — strict free-tier rate limit. The lib sets a
	// process-wide rate-limit flag on 429 so subsequent calls short-circuit
	// without burning more requests against the wall.
	if (await isOpenCriticEnabled()) {
		try {
			await refreshOpenCriticOne(raw, appid);
		} catch (e) {
			if (!(e instanceof OpenCriticRateLimitError)) {
				console.warn(
					`[enrich/${appid}] opencritic failed:`,
					e instanceof Error ? e.message : e,
				);
			}
		}
	}

	return 'ok';
}

/**
 * Steam-only enrichment: appdetails (description, screenshots, metacritic,
 * platforms, etc.) + steamspy (tags, ownership, playtime, ccu) + the "more
 * like this" graph + HowLongToBeat completion times.
 *
 * Does NOT call Steam user reviews or OpenCritic — those have their own
 * helpers and rate budgets. Used both by `enrichOne` and by the
 * `?source=steam_appdetails` path of /games/:appid/refresh.
 */
export async function refreshAppdetailsOnly(
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
			screenshots    = ${JSON.stringify(details.screenshots ?? [])}::jsonb,
			screenshots_fetched_at = now(),
			enriched_at    = now(),
			updated_at     = now()
		WHERE appid = ${appid}
	`;

	// SteamSpy (tags + ownership/playtime/reviews)
	try {
		await refreshSteamSpyOne(raw, appid);
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

	// HLTB (use the freshly-updated name). Same self-throttle pattern as
	// OpenCritic — once the lib trips its process-wide rate-limit flag,
	// subsequent calls short-circuit so we don't burn upstream goodwill.
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
	} catch (e) {
		if (!(e instanceof HLTBRateLimitError)) {
			console.warn(
				`[enrich/${appid}] hltb failed:`,
				e instanceof Error ? e.message : e,
			);
		}
	}

	return 'ok';
}

/**
 * Re-fetch Steam user reviews for one game and replace the stored set.
 * Top 20 most-helpful English reviews; the UI surfaces the top 3.
 */
export async function refreshSteamReviewsOne(
	raw: postgres.Sql,
	appid: number,
): Promise<{ count: number }> {
	const { reviews } = await fetchSteamReviews(appid);
	await raw`DELETE FROM game_reviews WHERE appid = ${appid}`;
	if (reviews.length > 0) {
		const rows = reviews.map((r) => ({
			appid,
			recommendation_id: r.recommendation_id,
			author_steamid: r.author_steamid,
			voted_up: r.voted_up,
			votes_up: r.votes_up,
			votes_funny: r.votes_funny,
			weighted_vote_score: r.weighted_vote_score,
			playtime_at_review_min: r.playtime_at_review_min,
			language: r.language,
			review_text: r.review_text,
			timestamp_created: r.timestamp_created?.toISOString() ?? null,
			timestamp_updated: r.timestamp_updated?.toISOString() ?? null,
		}));
		await raw`
			INSERT INTO game_reviews ${raw(
				rows,
				'appid',
				'recommendation_id',
				'author_steamid',
				'voted_up',
				'votes_up',
				'votes_funny',
				'weighted_vote_score',
				'playtime_at_review_min',
				'language',
				'review_text',
				'timestamp_created',
				'timestamp_updated',
			)}
			ON CONFLICT (appid, recommendation_id) DO NOTHING
		`;
	}
	await raw`UPDATE games SET steam_reviews_fetched_at = now() WHERE appid = ${appid}`;
	return { count: reviews.length };
}

/**
 * Fetch and upsert OpenCritic score. Returns null if the game isn't on
 * OpenCritic (most indie/older titles aren't). Always bumps fetched_at so
 * the cron doesn't keep retrying misses.
 */
export async function refreshOpenCriticOne(
	raw: postgres.Sql,
	appid: number,
): Promise<{ score: number | null } | null> {
	// OpenCritic is searched by name (RapidAPI dropped the steam-id endpoint).
	const [game] = await raw`SELECT name FROM games WHERE appid = ${appid}`;
	const name = (game?.name as string | undefined) ?? null;
	if (!name) return null;
	const result = await fetchOpenCriticScore(appid, name);
	await raw`UPDATE games SET opencritic_fetched_at = now() WHERE appid = ${appid}`;
	if (!result) return null;
	await raw`
		INSERT INTO game_external_scores (
			appid, source, score, max_score, tier, url,
			percent_recommended, num_reviews, raw, fetched_at
		) VALUES (
			${appid}, 'opencritic',
			${result.score}, 100,
			${result.tier}, ${result.url},
			${result.percent_recommended}, ${result.num_reviews},
			${JSON.stringify(result.raw)}::jsonb, now()
		)
		ON CONFLICT (appid, source) DO UPDATE SET
			score               = EXCLUDED.score,
			tier                = EXCLUDED.tier,
			url                 = EXCLUDED.url,
			percent_recommended = EXCLUDED.percent_recommended,
			num_reviews         = EXCLUDED.num_reviews,
			raw                 = EXCLUDED.raw,
			fetched_at          = EXCLUDED.fetched_at
	`;
	return { score: result.score };
}

/**
 * Re-fetch the SteamSpy fields for one appid. Used by both initial
 * enrichment and the periodic refresher cron. Updates owners_estimate,
 * positive/negative, avg/median playtime, ccu, replaces game_tags rows,
 * and bumps steamspy_refreshed_at.
 */
export async function refreshSteamSpyOne(
	raw: postgres.Sql,
	appid: number,
): Promise<'ok' | 'no_data'> {
	const spy = await fetchSteamSpy(appid);
	if (!spy) {
		await raw`UPDATE games SET steamspy_refreshed_at = now() WHERE appid = ${appid}`;
		return 'no_data';
	}
	await raw`
		UPDATE games SET
			owners_estimate       = ${spy.owners ?? null},
			positive              = ${spy.positive ?? null},
			negative              = ${spy.negative ?? null},
			avg_playtime          = ${spy.average_forever ?? null},
			median_playtime       = ${spy.median_forever ?? null},
			ccu                   = ${spy.ccu ?? null},
			steamspy_refreshed_at = now(),
			updated_at            = now()
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
