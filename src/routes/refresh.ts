import { Hono } from 'hono';
import type postgres from 'postgres';
import {
	isOpenCriticEnabled,
	openCriticDisabledReason,
	OpenCriticRateLimitError,
} from '../lib/opencritic';
import {
	buildSearchQuery,
	isYouTubeEnabled,
	searchVideos,
	YouTubeQuotaError,
} from '../lib/youtube';
import {
	enrichOne,
	refreshAppdetailsOnly,
	refreshOpenCriticOne,
	refreshSteamReviewsOne,
} from './enrich';

const VALID_SOURCES = [
	'all',
	'steam_appdetails',
	'steam_reviews',
	'opencritic',
	'youtube',
] as const;
type Source = (typeof VALID_SOURCES)[number];

function parseSource(raw: string | undefined): Source {
	if (!raw) return 'all';
	return (VALID_SOURCES as readonly string[]).includes(raw)
		? (raw as Source)
		: 'all';
}

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

		const source = parseSource(c.req.query('source'));

		const [game] =
			await raw`SELECT name FROM games WHERE appid = ${appid} LIMIT 1`;
		if (!game) return c.json({ error: 'not found' }, 404);
		const name = game.name as string;

		const sources: Record<string, { status: string; detail?: unknown }> = {};
		const wants = (s: Exclude<Source, 'all'>) => source === 'all' || source === s;

		// Steam appdetails — re-pull description, header_image, screenshots,
		// metacritic, tags, similar graph, HLTB. Does NOT include reviews or
		// OpenCritic (those have their own per-source paths below).
		if (wants('steam_appdetails')) {
			try {
				const status =
					source === 'all'
						? await enrichOne(raw, appid)
						: await refreshAppdetailsOnly(raw, appid);
				sources.steam_appdetails = { status };
			} catch (e) {
				sources.steam_appdetails = {
					status: 'error',
					detail: e instanceof Error ? e.message : String(e),
				};
			}
		}

		// Steam user reviews — public endpoint, no key. Skipped when
		// source='all' because enrichOne above already covers it.
		if (source !== 'all' && wants('steam_reviews')) {
			try {
				const r = await refreshSteamReviewsOne(raw, appid);
				sources.steam_reviews = { status: 'ok', detail: r };
			} catch (e) {
				sources.steam_reviews = {
					status: 'error',
					detail: e instanceof Error ? e.message : String(e),
				};
			}
		}

		// OpenCritic critic score. Same skip-on-all reasoning as reviews.
		if (source !== 'all' && wants('opencritic')) {
			if (await isOpenCriticEnabled()) {
				try {
					const r = await refreshOpenCriticOne(raw, appid);
					sources.opencritic = r
						? { status: 'ok', detail: r }
						: { status: 'not_listed' };
				} catch (e) {
					if (e instanceof OpenCriticRateLimitError) {
						sources.opencritic = { status: 'rate_limited', detail: e.message };
					} else {
						sources.opencritic = {
							status: 'error',
							detail: e instanceof Error ? e.message : String(e),
						};
					}
				}
			} else {
				sources.opencritic = {
					status: 'disabled',
					detail: openCriticDisabledReason(),
				};
			}
		}

		// YouTube — search videos, replace stored set
		if (wants('youtube')) {
			if (await isYouTubeEnabled()) {
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
					sources.youtube = {
						status: 'ok',
						detail: { videos: videos.length },
					};
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
		}

		return c.json({ appid, name, source, sources });
	});

	return app;
}
