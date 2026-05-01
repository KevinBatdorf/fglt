/**
 * Cron entry: discover YouTube videos for games whose youtube_fetched_at is NULL,
 * working from newest games (highest appid) backwards. Stops gracefully when
 * the daily quota is hit.
 *
 * Free YouTube quota = 10,000 units/day, search.list = 100 units = ~100 games/day.
 * We cap the cron at 90 to leave 1,000 units (~10 games) for ad-hoc manual
 * /refresh calls — otherwise the cron would burn the quota before the user
 * has a chance to refresh anything by hand. Full library seed therefore
 * takes ~26 days at the floor.
 */
import { raw } from '../src/db';
import { sleep } from '../src/lib/sleep';
import {
	buildSearchQuery,
	isYouTubeEnabled,
	searchVideos,
	YouTubeQuotaError,
} from '../src/lib/youtube';

const BATCH = Number.parseInt(process.env.YOUTUBE_BATCH ?? '90', 10);
const PER_GAME = Number.parseInt(process.env.YOUTUBE_PER_GAME ?? '10', 10);
const DELAY_MS = Number.parseInt(process.env.YOUTUBE_DELAY_MS ?? '300', 10);

async function fetchOneGame(appid: number, name: string): Promise<number> {
	const query = buildSearchQuery(name);
	const videos = await searchVideos(query, PER_GAME);

	// Replace previous results for this appid (older searches go stale).
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
	return videos.length;
}

async function main() {
	if (!isYouTubeEnabled()) {
		console.log('[youtube] YOUTUBE_API_KEY not set — skipping');
		await raw.end();
		return;
	}
	console.log(
		`[youtube] starting at ${new Date().toISOString()} (batch=${BATCH})`,
	);

	const rows = await raw`
		SELECT appid, name FROM games
		WHERE youtube_fetched_at IS NULL
		ORDER BY appid DESC
		LIMIT ${BATCH}
	`;
	console.log(`[youtube] picked ${rows.length} games (newest first)`);

	let ok = 0;
	let failed = 0;
	let totalVideos = 0;

	for (const r of rows) {
		const appid = r.appid as number;
		const name = r.name as string;
		try {
			const count = await fetchOneGame(appid, name);
			ok++;
			totalVideos += count;
			console.log(`[youtube] ${appid} ${name} -> ${count} videos`);
		} catch (e) {
			if (e instanceof YouTubeQuotaError) {
				console.log(
					`[youtube] quota exceeded at game ${appid} (${name}) — stopping cleanly`,
				);
				break;
			}
			failed++;
			console.error(
				`[youtube] ${appid} ${name} FAILED:`,
				e instanceof Error ? e.message : e,
			);
		}
		if (DELAY_MS > 0) await sleep(DELAY_MS);
	}

	console.log(
		`[youtube] done — ok=${ok} failed=${failed} videos=${totalVideos}`,
	);
	await raw.end();
}

main().catch(async (e) => {
	console.error('[youtube] fatal:', e);
	await raw.end().catch(() => {});
	process.exit(1);
});
