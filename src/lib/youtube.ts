/**
 * YouTube Data API v3 helpers.
 *
 * Free quota is 10,000 units/day; search.list = 100 units/call (regardless of
 * maxResults), so we get ~100 game-searches per day before being rate-limited.
 *
 * We catch the 403 quotaExceeded error and surface it as a typed error so
 * cron loops can stop cleanly without failing the job.
 */

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

export class YouTubeQuotaError extends Error {
	constructor(message = 'YouTube API daily quota exceeded') {
		super(message);
		this.name = 'YouTubeQuotaError';
	}
}

export interface YouTubeVideo {
	video_id: string;
	title: string;
	channel: string | null;
	channel_id: string | null;
	description: string | null;
	thumbnail_url: string | null;
	published_at: Date | null;
}

interface SearchItem {
	id: { videoId?: string; kind?: string };
	snippet: {
		publishedAt?: string;
		channelId?: string;
		channelTitle?: string;
		title?: string;
		description?: string;
		thumbnails?: {
			default?: { url: string };
			medium?: { url: string };
			high?: { url: string };
			standard?: { url: string };
			maxres?: { url: string };
		};
	};
}

interface SearchResponse {
	items?: SearchItem[];
	error?: {
		code: number;
		message: string;
		errors?: Array<{ reason?: string }>;
	};
}

export function isYouTubeEnabled(): boolean {
	return !!process.env.YOUTUBE_API_KEY;
}

/**
 * Search YouTube for videos matching `query`. Returns up to `limit` results
 * from the Gaming category, English-relevance, ordered by relevance.
 *
 * Throws `YouTubeQuotaError` on quota exhaustion. Other 4xx/5xx errors throw
 * a regular Error so the caller can decide how to handle.
 */
export async function searchVideos(
	query: string,
	limit = 10,
): Promise<YouTubeVideo[]> {
	const key = process.env.YOUTUBE_API_KEY;
	if (!key) throw new Error('YOUTUBE_API_KEY not set');

	const url = new URL(SEARCH_URL);
	url.searchParams.set('key', key);
	url.searchParams.set('q', query);
	url.searchParams.set('part', 'snippet');
	url.searchParams.set('type', 'video');
	url.searchParams.set('videoCategoryId', '20'); // Gaming
	url.searchParams.set('order', 'relevance');
	url.searchParams.set('relevanceLanguage', 'en');
	url.searchParams.set('maxResults', String(Math.min(Math.max(limit, 1), 50)));
	url.searchParams.set('safeSearch', 'none');

	const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
	const data = (await res.json()) as SearchResponse;

	if (!res.ok) {
		const reason = data.error?.errors?.[0]?.reason ?? '';
		if (
			res.status === 403 &&
			(reason === 'quotaExceeded' || reason === 'rateLimitExceeded')
		) {
			throw new YouTubeQuotaError(data.error?.message);
		}
		throw new Error(
			`YouTube search failed: ${res.status} ${data.error?.message ?? ''}`,
		);
	}

	const items = data.items ?? [];
	return items
		.filter((it) => it.id.videoId)
		.map((it) => {
			const thumbs = it.snippet.thumbnails ?? {};
			const thumb =
				thumbs.maxres?.url ??
				thumbs.standard?.url ??
				thumbs.high?.url ??
				thumbs.medium?.url ??
				thumbs.default?.url ??
				null;
			return {
				video_id: it.id.videoId as string,
				title: it.snippet.title ?? '',
				channel: it.snippet.channelTitle ?? null,
				channel_id: it.snippet.channelId ?? null,
				description: it.snippet.description ?? null,
				thumbnail_url: thumb,
				published_at: it.snippet.publishedAt
					? new Date(it.snippet.publishedAt)
					: null,
			};
		});
}

export function buildSearchQuery(name: string): string {
	// Strip trademark/registered marks; keep punctuation Steam users would use.
	const cleaned = name.replace(/[™®©]/g, '').trim();
	return `${cleaned} gameplay`;
}
