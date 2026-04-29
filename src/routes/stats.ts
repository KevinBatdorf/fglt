import { Hono } from 'hono';
import type postgres from 'postgres';

export function statsRoutes(raw: postgres.Sql) {
	const app = new Hono();

	app.get('/stats', async (c) => {
		const [counts] = await raw`
			SELECT
				COUNT(*)::int AS total,
				COUNT(*) FILTER (WHERE enriched_at IS NOT NULL)::int AS enriched,
				COUNT(*) FILTER (WHERE embedded_at IS NOT NULL)::int AS embedded,
				COUNT(*) FILTER (WHERE playtime_min > 0)::int AS played,
				COUNT(*) FILTER (WHERE playtime_min = 0)::int AS unplayed,
				SUM(playtime_min)::bigint AS total_playtime_min
			FROM games
		`;

		const platformRows = await raw`
			SELECT platform, COUNT(*)::int AS count
			FROM platform_ownership
			GROUP BY platform
			ORDER BY count DESC
		`;
		const platforms: Record<string, number> = {};
		for (const r of platformRows)
			platforms[r.platform as string] = r.count as number;

		const [{ multi_platform }] = await raw`
			SELECT COUNT(*)::int AS multi_platform FROM (
				SELECT appid FROM platform_ownership GROUP BY appid HAVING COUNT(*) > 1
			) t
		`;

		const meta = await raw`SELECT key, value, updated FROM meta ORDER BY key`;
		return c.json({ ...counts, platforms, multi_platform, meta });
	});

	return app;
}
