import { Hono } from 'hono';
import type postgres from 'postgres';

/**
 * GET /tags — top SteamSpy user tags across the library, sorted by total
 * vote count. Used by the desktop search/all-games filter dropdowns.
 *
 * `?limit=` clamped to 500 (default 200).
 */
export function tagsRoutes(raw: postgres.Sql) {
	const app = new Hono();

	app.get('/tags', async (c) => {
		const limit = Math.min(
			Math.max(Number.parseInt(c.req.query('limit') ?? '200', 10) || 200, 1),
			500,
		);
		const rows = await raw`
			SELECT tag,
			       SUM(votes)::bigint AS total_votes,
			       COUNT(*)::int AS games
			FROM game_tags
			GROUP BY tag
			ORDER BY total_votes DESC, games DESC
			LIMIT ${limit}
		`;
		return c.json({
			tags: rows.map((r) => ({
				tag: r.tag,
				total_votes: Number(r.total_votes),
				games: r.games,
			})),
		});
	});

	return app;
}
