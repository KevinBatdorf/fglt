import { Hono } from 'hono';
import type postgres from 'postgres';

/**
 * GET /activity — recent scraping/enrichment activity for the settings page.
 *
 * No new tables — derived purely from existing timestamps:
 *   - games.created_at        (added by syncer)
 *   - games.enriched_at       (filled by enricher cron)
 *   - games.embedded_at       (Ollama embedding pass)
 *   - games.youtube_fetched_at (youtube-syncer)
 *   - lists.created_at        (user list activity)
 *   - meta.last_sync          (Steam Web API run)
 */
export function activityRoutes(raw: postgres.Sql) {
	const app = new Hono();

	app.get('/activity', async (c) => {
		const [counts] = await raw`
			SELECT
				COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '24 hours')::int        AS games_added_24h,
				COUNT(*) FILTER (WHERE enriched_at > now() - INTERVAL '24 hours')::int       AS enriched_24h,
				COUNT(*) FILTER (WHERE embedded_at > now() - INTERVAL '24 hours')::int       AS embedded_24h,
				COUNT(*) FILTER (WHERE youtube_fetched_at > now() - INTERVAL '24 hours')::int AS videos_fetched_24h,
				COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '7 days')::int         AS games_added_7d,
				COUNT(*) FILTER (WHERE enriched_at > now() - INTERVAL '7 days')::int        AS enriched_7d,
				COUNT(*) FILTER (WHERE youtube_fetched_at > now() - INTERVAL '7 days')::int  AS videos_fetched_7d
			FROM games
		`;

		const recent_added = await raw`
			SELECT appid, name, header_image, created_at
			FROM games
			WHERE created_at > now() - INTERVAL '30 days'
			ORDER BY created_at DESC
			LIMIT 10
		`;

		const recent_enriched = await raw`
			SELECT appid, name, header_image, enriched_at
			FROM games
			WHERE enriched_at IS NOT NULL
			ORDER BY enriched_at DESC
			LIMIT 10
		`;

		const recent_videos = await raw`
			SELECT g.appid, g.name, g.header_image, g.youtube_fetched_at,
			       (SELECT COUNT(*)::int FROM game_videos gv WHERE gv.appid = g.appid) AS video_count
			FROM games g
			WHERE g.youtube_fetched_at IS NOT NULL
			ORDER BY g.youtube_fetched_at DESC
			LIMIT 10
		`;

		const lists_created = await raw`
			SELECT slug, name, emoji, is_system, created_at
			FROM lists
			ORDER BY created_at DESC
			LIMIT 5
		`;

		const meta = await raw`SELECT key, value, updated FROM meta ORDER BY key`;

		return c.json({
			counts,
			recent_added,
			recent_enriched,
			recent_videos,
			lists_created,
			meta,
		});
	});

	return app;
}
