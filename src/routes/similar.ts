import { Hono } from 'hono';
import type postgres from 'postgres';
import { embedSingle, isOllamaEnabled, toVectorLiteral } from '../lib/ollama';

/**
 * GET /similar?appid=X     — recommend by vector similarity to game X
 * GET /similar?q=...        — recommend by free-text query (embedding)
 *
 * Optional filters: platform=epic|gog|steam, max_playtime=600 (mins),
 *                   min_positive_pct=80
 */
export function similarRoutes(raw: postgres.Sql) {
	const app = new Hono();

	app.get('/similar', async (c) => {
		const appid = parseIntOpt(c.req.query('appid'));
		const q = c.req.query('q')?.trim() || '';
		const limit = clamp(parseIntOpt(c.req.query('limit')) ?? 20, 1, 100);
		const platform = c.req.query('platform')?.trim();
		const maxPlaytime = parseIntOpt(c.req.query('max_playtime'));
		const minPosPct = parseFloatOpt(c.req.query('min_positive_pct'));

		if (!appid && !q) {
			return c.json({ error: 'pass ?appid= or ?q=' }, 400);
		}
		if (!isOllamaEnabled()) {
			return c.json({ error: 'OLLAMA_URL not configured' }, 503);
		}

		let vec: string;
		let sourceGame: { appid: number; name: string } | null = null;
		if (appid) {
			const [g] = await raw`
				SELECT appid, name, embedding
				FROM games WHERE appid = ${appid} LIMIT 1`;
			if (!g) return c.json({ error: 'game not found' }, 404);
			if (!g.embedding) {
				return c.json({ error: 'game has no embedding yet' }, 409);
			}
			sourceGame = { appid: g.appid as number, name: g.name as string };
			vec = String(g.embedding);
		} else {
			const v = await embedSingle(q);
			vec = toVectorLiteral(v);
		}

		const conds = [raw`g.embedding IS NOT NULL`];
		if (appid) conds.push(raw`g.appid <> ${appid}`);
		if (platform)
			conds.push(
				raw`g.appid IN (SELECT appid FROM platform_ownership WHERE platform = ${platform})`,
			);
		if (maxPlaytime !== undefined)
			conds.push(raw`g.playtime_min <= ${maxPlaytime}`);
		if (minPosPct !== undefined)
			conds.push(
				raw`(g.positive::float / NULLIF(g.positive + g.negative, 0)) >= ${minPosPct / 100}`,
			);
		const where = conds.reduce((acc, cond, i) =>
			i === 0 ? cond : raw`${acc} AND ${cond}`,
		);

		const rows = await raw`
			SELECT
				g.appid, g.name, g.short_desc, g.header_image,
				g.genres, g.playtime_min,
				g.positive, g.negative, g.hltb_main, g.metacritic,
				COALESCE(po.platforms, ARRAY[]::text[]) AS platforms,
				1 - (g.embedding <=> ${vec}::vector) AS similarity
			FROM games g
			LEFT JOIN (
				SELECT appid, array_agg(platform ORDER BY platform) AS platforms
				FROM platform_ownership
				GROUP BY appid
			) po ON po.appid = g.appid
			WHERE ${where}
			ORDER BY g.embedding <=> ${vec}::vector ASC
			LIMIT ${limit}
		`;

		return c.json({
			source: sourceGame ?? { query: q },
			count: rows.length,
			results: rows,
		});
	});

	return app;
}

function parseIntOpt(s: string | undefined): number | undefined {
	if (!s) return undefined;
	const n = Number.parseInt(s, 10);
	return Number.isFinite(n) ? n : undefined;
}
function parseFloatOpt(s: string | undefined): number | undefined {
	if (!s) return undefined;
	const n = Number.parseFloat(s);
	return Number.isFinite(n) ? n : undefined;
}
function clamp(n: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, n));
}
