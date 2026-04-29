import { Hono } from 'hono';
import type postgres from 'postgres';
import { embedSingle, isOllamaEnabled, toVectorLiteral } from '../lib/ollama';
import { readHiddenGenres } from './settings';

/**
 * GET /library         — list/search owned games
 * GET /games/:appid    — full record + tags + similar graph + per-platform ownership
 *
 * Every row in `games` is owned (the existence of a `platform_ownership` row is
 * the authoritative ownership signal — there is no `is_owned` flag).
 */
export function libraryRoutes(raw: postgres.Sql) {
	const app = new Hono();

	app.get('/library', async (c) => {
		const q = c.req.query('q')?.trim() || '';
		const tag = c.req.query('tag')?.trim();
		const genre = c.req.query('genre')?.trim();
		const platform = c.req.query('platform')?.trim();
		const minPlaytime = num(c.req.query('min_playtime'));
		const maxPlaytime = num(c.req.query('max_playtime'));
		const unplayed = c.req.query('unplayed') === '1';
		const limit = clamp(num(c.req.query('limit')) ?? 50, 1, 5000);
		const offset = Math.max(0, num(c.req.query('offset')) ?? 0);
		const sort = c.req.query('sort') || (q ? 'relevance' : 'name');

		const useVector = q.length > 0 && isOllamaEnabled() && sort !== 'name';
		let vec: string | null = null;
		if (useVector) {
			try {
				const v = await embedSingle(q);
				vec = toVectorLiteral(v);
			} catch {
				vec = null;
			}
		}

		const conds = [raw`1=1`];
		if (unplayed) conds.push(raw`g.playtime_min = 0`);
		if (minPlaytime !== undefined)
			conds.push(raw`g.playtime_min >= ${minPlaytime}`);
		if (maxPlaytime !== undefined)
			conds.push(raw`g.playtime_min <= ${maxPlaytime}`);
		if (genre) conds.push(raw`${genre} = ANY(g.genres)`);
		if (tag)
			conds.push(
				raw`g.appid IN (SELECT appid FROM game_tags WHERE tag ILIKE ${`%${tag}%`})`,
			);
		if (platform)
			conds.push(
				raw`g.appid IN (SELECT appid FROM platform_ownership WHERE platform = ${platform})`,
			);
		if (q.length > 0 && !vec)
			conds.push(raw`g.search @@ websearch_to_tsquery('english', ${q})`);

		// `recently_added=1` shows only games added AFTER the initial setup
		// (skipping the bulk Steam/Epic/GOG sync rows) and within a recent
		// window (default 2 months, override via ?within_months=).
		if (c.req.query('recently_added') === '1') {
			const [marker] = await raw`
				SELECT value FROM meta WHERE key = 'initial_setup_until' LIMIT 1
			`;
			if (marker?.value) {
				conds.push(raw`g.created_at > ${String(marker.value)}::timestamptz`);
			}
			const monthsRaw = c.req.query('within_months');
			const months = monthsRaw
				? Math.min(Math.max(Number.parseInt(monthsRaw, 10) || 2, 1), 60)
				: 2;
			conds.push(
				raw`g.created_at > now() - (${months}::int * INTERVAL '1 month')`,
			);
		}

		const where = conds.reduce((acc, cond, i) =>
			i === 0 ? cond : raw`${acc} AND ${cond}`,
		);

		// Hybrid score (0..1-ish): 0.6 * vector-similarity + 0.4 * ts_rank.
		// FTS-only mode uses ts_rank by itself. Cast to float so postgres.js
		// returns a JS number (the literal 0.6 makes Postgres choose `numeric`,
		// which would arrive as a string).
		const scoreExpr =
			q.length === 0
				? raw`NULL::float`
				: vec
					? raw`((0.6 * (1 - (g.embedding <=> ${vec}::vector)) +
					    0.4 * COALESCE(ts_rank(g.search, websearch_to_tsquery('english', ${q})), 0))::float)`
					: raw`(COALESCE(ts_rank(g.search, websearch_to_tsquery('english', ${q})), 0)::float)`;

		const orderBy =
			q.length === 0
				? raw`ORDER BY g.name ASC`
				: raw`ORDER BY score DESC NULLS LAST`;

		const rows = await raw`
			SELECT
				g.appid, g.name, g.type,
				g.short_desc, g.header_image,
				g.release_date, g.genres, g.categories,
				g.playtime_min, g.playtime_2wk, g.last_played,
				g.positive, g.negative, g.owners_estimate,
				g.hltb_main, g.hltb_extra, g.metacritic,
				g.created_at,
				COALESCE(po.platforms, ARRAY[]::text[]) AS platforms,
				${scoreExpr} AS score
			FROM games g
			LEFT JOIN (
				SELECT appid, array_agg(platform ORDER BY platform) AS platforms
				FROM platform_ownership
				GROUP BY appid
			) po ON po.appid = g.appid
			WHERE ${where}
			${orderBy}
			LIMIT ${limit} OFFSET ${offset}
		`;

		return c.json({
			count: rows.length,
			offset,
			results: rows,
			...(q ? { q, mode: vec ? 'hybrid' : 'fts' } : {}),
		});
	});

	app.get('/random', async (c) => {
		const unplayed = c.req.query('unplayed') === '1';
		const platform = c.req.query('platform')?.trim();
		const conds = [raw`g.header_image IS NOT NULL`];
		if (unplayed) conds.push(raw`g.playtime_min = 0`);
		if (platform)
			conds.push(
				raw`g.appid IN (SELECT appid FROM platform_ownership WHERE platform = ${platform})`,
			);
		// Reuse the user-configurable hidden-genres filter from settings so we
		// don't roll a benchmark.
		const hiddenGenres = await readHiddenGenres(raw);
		if (hiddenGenres.length > 0) {
			conds.push(
				raw`(g.genres IS NULL OR NOT (g.genres && ${hiddenGenres}::text[]))`,
			);
		}
		const where = conds.reduce((acc, c2, i) =>
			i === 0 ? c2 : raw`${acc} AND ${c2}`,
		);
		const [row] = await raw`
			SELECT g.appid, g.name FROM games g
			WHERE ${where}
			ORDER BY random()
			LIMIT 1
		`;
		if (!row) return c.json({ error: 'no eligible games' }, 404);
		return c.json({ appid: row.appid as number, name: row.name as string });
	});

	app.get('/games/:appid', async (c) => {
		const appid = Number.parseInt(c.req.param('appid'), 10);
		if (!Number.isFinite(appid)) return c.json({ error: 'bad appid' }, 400);
		const [game] =
			await raw`SELECT * FROM games WHERE appid = ${appid} LIMIT 1`;
		if (!game) return c.json({ error: 'not found' }, 404);
		const tags =
			await raw`SELECT tag, votes FROM game_tags WHERE appid = ${appid} ORDER BY votes DESC`;
		const similar = await raw`
			SELECT s.similar_appid AS appid, s.rank, g.name, g.header_image
			FROM game_similar s
			LEFT JOIN games g ON g.appid = s.similar_appid
			WHERE s.appid = ${appid}
			ORDER BY s.rank ASC
		`;
		const ownership = await raw`
			SELECT platform, external_id, title_at_source, acquired_at, playtime_min, last_played
			FROM platform_ownership
			WHERE appid = ${appid}
			ORDER BY platform
		`;
		const videos = await raw`
			SELECT video_id, title, channel, channel_id, description, thumbnail_url, published_at, rank
			FROM game_videos
			WHERE appid = ${appid}
			ORDER BY rank ASC
		`;
		const lists = await raw`
			SELECT l.id, l.slug, l.name, l.emoji, l.is_system, lg.note, lg.added_at
			FROM list_games lg
			JOIN lists l ON l.id = lg.list_id
			WHERE lg.appid = ${appid}
			ORDER BY l.is_system DESC, l.created_at ASC
		`;
		const platforms = ownership.map((o) => o.platform as string);
		const {
			embedding: _emb,
			search: _s,
			...rest
		} = game as Record<string, unknown>;
		return c.json({
			...rest,
			platforms,
			ownership,
			tags,
			similar,
			videos,
			lists,
		});
	});

	return app;
}

function num(s: string | undefined): number | undefined {
	if (!s) return undefined;
	const n = Number.parseInt(s, 10);
	return Number.isFinite(n) ? n : undefined;
}

function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}
