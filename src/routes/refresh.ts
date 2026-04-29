import { Hono } from 'hono';
import type postgres from 'postgres';
import {
	buildSearchQuery,
	isYouTubeEnabled,
	searchVideos,
	YouTubeQuotaError,
} from '../lib/youtube';

/**
 * POST /games/:appid/refresh — manually re-fetch external data for one game.
 *
 * Fires every external source. No local rate-gate (manual = user-initiated,
 * if upstream returns 429/quota the user just gets the error). Returns a
 * per-source result map so a future UI can show what worked vs. what didn't.
 */
export function refreshRoutes(raw: postgres.Sql) {
	const app = new Hono();

	app.post('/games/:appid/refresh', async (c) => {
		const appid = Number.parseInt(c.req.param('appid'), 10);
		if (!Number.isFinite(appid)) return c.json({ error: 'bad appid' }, 400);

		const [game] =
			await raw`SELECT name FROM games WHERE appid = ${appid} LIMIT 1`;
		if (!game) return c.json({ error: 'not found' }, 404);
		const name = game.name as string;

		const sources: Record<string, { status: string; detail?: unknown }> = {};

		// YouTube — search videos, replace stored set
		if (isYouTubeEnabled()) {
			try {
				const query = buildSearchQuery(name);
				const videos = await searchVideos(query, 10);
				await raw`DELETE FROM game_videos WHERE appid = ${appid}`;
				if (videos.length > 0) {
					const rows = videos.map((v, i) => ({
						appid,
						video_id: v.video_id,
						title: v.title,
						channel: v.channel,
						channel_id: v.channel_id,
						description: v.description,
						thumbnail_url: v.thumbnail_url,
						published_at: v.published_at?.toISOString() ?? null,
						rank: i,
						query_used: query,
					}));
					await raw`
						INSERT INTO game_videos ${raw(rows, 'appid', 'video_id', 'title', 'channel', 'channel_id', 'description', 'thumbnail_url', 'published_at', 'rank', 'query_used')}
						ON CONFLICT (appid, video_id) DO NOTHING
					`;
				}
				await raw`UPDATE games SET youtube_fetched_at = now() WHERE appid = ${appid}`;
				sources.youtube = { status: 'ok', detail: { videos: videos.length } };
			} catch (e) {
				if (e instanceof YouTubeQuotaError) {
					sources.youtube = { status: 'rate_limited', detail: e.message };
				} else {
					sources.youtube = {
						status: 'error',
						detail: e instanceof Error ? e.message : String(e),
					};
				}
			}
		} else {
			sources.youtube = { status: 'disabled' };
		}

		// Future sources (Steam appdetails re-pull, OpenCritic, PCGamingWiki, ProtonDB,
		// IGDB) slot in here as additional `if (isXEnabled()) { ... }` blocks.

		return c.json({ appid, name, sources });
	});

	return app;
}
