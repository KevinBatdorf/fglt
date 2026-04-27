import { Hono } from 'hono';
import type postgres from 'postgres';
import { embedSingle, isOllamaEnabled, toVectorLiteral } from '../lib/ollama';

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
		const limit = clamp(num(c.req.query('limit')) ?? 50, 1, 200);
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

		const where = conds.reduce((acc, cond, i) =>
			i === 0 ? cond : raw`${acc} AND ${cond}`,
		);

		const orderBy =
			q.length === 0
				? raw`ORDER BY g.name ASC`
				: vec
					? raw`ORDER BY (0.6 * (1 - (g.embedding <=> ${vec}::vector)) +
				    0.4 * COALESCE(ts_rank(g.search, websearch_to_tsquery('english', ${q})), 0)) DESC NULLS LAST`
					: raw`ORDER BY ts_rank(g.search, websearch_to_tsquery('english', ${q})) DESC`;

		const rows = await raw`
			SELECT
				g.appid, g.name, g.type,
				g.short_desc, g.header_image,
				g.release_date, g.genres, g.categories,
				g.playtime_min, g.playtime_2wk, g.last_played,
				g.positive, g.negative, g.owners_estimate,
				g.hltb_main, g.hltb_extra, g.metacritic,
				COALESCE(po.platforms, ARRAY[]::text[]) AS platforms
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
		const { embedding: _emb, search: _s, ...rest } = game as Record<
			string,
			unknown
		>;
		return c.json({ ...rest, platforms, ownership, tags, similar, videos, lists });
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
