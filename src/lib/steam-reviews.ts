/**
 * Fetch Steam user reviews for a game via the public `appreviews` endpoint.
 * No API key required. Endpoint: store.steampowered.com/appreviews/{appid}.
 *
 * We pull the top-N "most helpful" English reviews. Steam paginates with a
 * cursor; we only need the first page (default 20 results) since the UI
 * shows the top 3 expandable to all.
 *
 * Rate-limited via the same 1.5s sleep enricher uses for appdetails — Steam
 * shares the same per-IP throttle across these endpoints.
 */

const REVIEWS_URL = (appid: number, cursor: string) =>
	`https://store.steampowered.com/appreviews/${appid}` +
	`?json=1&filter=all&language=english&review_type=all&purchase_type=all` +
	`&num_per_page=20&cursor=${encodeURIComponent(cursor)}`;

export interface SteamReview {
	recommendation_id: number;
	author_steamid: string | null;
	voted_up: boolean;
	votes_up: number;
	votes_funny: number;
	weighted_vote_score: number | null;
	playtime_at_review_min: number | null;
	language: string | null;
	review_text: string | null;
	timestamp_created: Date | null;
	timestamp_updated: Date | null;
}

export interface SteamReviewSummary {
	num_reviews_total: number;
	num_reviews_positive: number;
	review_score_desc: string | null; // e.g. "Very Positive"
}

export interface SteamReviewsResult {
	summary: SteamReviewSummary | null;
	reviews: SteamReview[];
}

interface RawResponse {
	success?: number;
	query_summary?: {
		total_reviews?: number;
		total_positive?: number;
		review_score_desc?: string;
	};
	reviews?: Array<{
		recommendationid?: string | number;
		author?: { steamid?: string; playtime_at_review?: number };
		language?: string;
		review?: string;
		timestamp_created?: number;
		timestamp_updated?: number;
		voted_up?: boolean;
		votes_up?: number;
		votes_funny?: number;
		weighted_vote_score?: string | number;
	}>;
}

function toDate(ts: number | undefined): Date | null {
	return typeof ts === 'number' && ts > 0 ? new Date(ts * 1000) : null;
}

export async function fetchSteamReviews(
	appid: number,
): Promise<SteamReviewsResult> {
	const res = await fetch(REVIEWS_URL(appid, '*'), {
		headers: { Accept: 'application/json' },
	});
	if (!res.ok) {
		throw new Error(`appreviews ${appid}: HTTP ${res.status}`);
	}
	const data = (await res.json()) as RawResponse;
	if (data.success !== 1) {
		// Some games (delisted, region-locked) return success=2 with no data.
		return { summary: null, reviews: [] };
	}
	const summary: SteamReviewSummary | null = data.query_summary
		? {
				num_reviews_total: data.query_summary.total_reviews ?? 0,
				num_reviews_positive: data.query_summary.total_positive ?? 0,
				review_score_desc: data.query_summary.review_score_desc ?? null,
			}
		: null;
	const reviews: SteamReview[] = (data.reviews ?? [])
		.map((r): SteamReview | null => {
			const id =
				typeof r.recommendationid === 'string'
					? Number.parseInt(r.recommendationid, 10)
					: r.recommendationid;
			if (typeof id !== 'number' || !Number.isFinite(id)) return null;
			const wvs =
				typeof r.weighted_vote_score === 'string'
					? Number.parseFloat(r.weighted_vote_score)
					: (r.weighted_vote_score ?? null);
			return {
				recommendation_id: id,
				author_steamid: r.author?.steamid ?? null,
				voted_up: r.voted_up ?? false,
				votes_up: r.votes_up ?? 0,
				votes_funny: r.votes_funny ?? 0,
				weighted_vote_score: typeof wvs === 'number' ? wvs : null,
				playtime_at_review_min: r.author?.playtime_at_review ?? null,
				language: r.language ?? null,
				review_text: r.review ?? null,
				timestamp_created: toDate(r.timestamp_created),
				timestamp_updated: toDate(r.timestamp_updated),
			};
		})
		.filter((r): r is SteamReview => r !== null);
	return { summary, reviews };
}
