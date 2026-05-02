/**
 * Fetch aggregated critic score from OpenCritic.
 *
 * As of 2025+ OpenCritic moved their public API behind RapidAPI — the old
 * `api.opencritic.com/api/game/steam/{appid}` endpoint now returns 400 to
 * unauthenticated callers. Two paths supported:
 *
 *  - **RapidAPI** (preferred): set `OPENCRITIC_API_KEY` (your RapidAPI key)
 *    and we hit `opencritic-api.p.rapidapi.com` with the right headers.
 *    RapidAPI free tier is ~25 req/day.
 *  - **No key** → the lib is "disabled" and `fetchOpenCriticScore` is a
 *    no-op. UI surfaces a clear "needs RapidAPI key" placeholder so the
 *    user knows the gap is config, not data.
 */
import { getConfig } from './config';

const RAPIDAPI_HOST = 'opencritic-api.p.rapidapi.com';

function rapidUrl(path: string): string {
	return `https://${RAPIDAPI_HOST}${path}`;
}

// RapidAPI's OpenCritic mirror dropped the steam→game lookup that the
// public api.opencritic.com used to expose. We have to search by name
// and pick the closest match (dist=0 means exact, library-side).
const SEARCH_PATH = (name: string) =>
	`/game/search?criteria=${encodeURIComponent(name)}`;
const GAME_PATH = (id: number) => `/game/${id}`;
const NAME_MATCH_DIST_THRESHOLD = 0.1;

export class OpenCriticRateLimitError extends Error {
	constructor(message = 'OpenCritic rate limit exceeded') {
		super(message);
		this.name = 'OpenCriticRateLimitError';
	}
}

export interface OpenCriticScore {
	opencritic_id: number;
	score: number | null; // medianScore, 0..100
	percent_recommended: number | null;
	num_reviews: number | null;
	tier: string | null; // 'Mighty' | 'Strong' | 'Fair' | 'Weak' | null
	url: string | null;
	raw: unknown;
}

interface SearchHit {
	id: number;
	name: string;
	dist: number;
}

interface GameResp {
	id?: number;
	name?: string;
	medianScore?: number;
	topCriticScore?: number;
	percentRecommended?: number;
	numReviews?: number;
	tier?: string;
	tierData?: { name?: string };
	url?: string;
}

async function apiKey(): Promise<string | undefined> {
	const cfg = await getConfig();
	return cfg.OPENCRITIC_API_KEY?.trim() || undefined;
}

export async function isOpenCriticEnabled(): Promise<boolean> {
	if (process.env.OPENCRITIC_ENABLED === 'false') return false;
	return (await apiKey()) !== undefined;
}

/** Reason why OpenCritic isn't enabled — surfaced via /refresh when source='opencritic'. */
export function openCriticDisabledReason(): string {
	if (process.env.OPENCRITIC_ENABLED === 'false') {
		return 'OpenCritic explicitly disabled via OPENCRITIC_ENABLED=false';
	}
	return 'OpenCritic requires a RapidAPI key (set it in Settings → Configuration)';
}

// Module-level rate-limit handling. Resets per process so the cron's
// short-lived containers naturally reset budgets each tick.
let rateLimitedUntilProcessExit = false;
let successesThisProcess = 0;

async function dailyBudget(): Promise<number> {
	const cfg = await getConfig();
	return Number.parseInt(cfg.OPENCRITIC_DAILY_BUDGET ?? '20', 10);
}

export function isOpenCriticRateLimited(): boolean {
	return rateLimitedUntilProcessExit;
}

/** Test-only: reset module state between tests. */
export function __resetOpenCriticStateForTests(): void {
	rateLimitedUntilProcessExit = false;
	successesThisProcess = 0;
}

async function get<T>(path: string): Promise<T | null> {
	const key = await apiKey();
	if (!key) throw new Error(openCriticDisabledReason());
	if (rateLimitedUntilProcessExit) throw new OpenCriticRateLimitError();
	const budget = await dailyBudget();
	if (successesThisProcess >= budget) {
		rateLimitedUntilProcessExit = true;
		throw new OpenCriticRateLimitError(
			`OpenCritic daily budget reached (${budget}); leaving headroom for manual /refresh`,
		);
	}
	const res = await fetch(rapidUrl(path), {
		headers: {
			Accept: 'application/json',
			'x-rapidapi-key': key,
			'x-rapidapi-host': RAPIDAPI_HOST,
		},
	});
	if (res.status === 404) {
		successesThisProcess++;
		return null;
	}
	if (res.status === 429) {
		rateLimitedUntilProcessExit = true;
		throw new OpenCriticRateLimitError();
	}
	if (res.status === 401 || res.status === 403) {
		throw new Error(
			`OpenCritic auth failed (HTTP ${res.status}) — check OPENCRITIC_API_KEY`,
		);
	}
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(
			`opencritic ${path}: HTTP ${res.status}${body ? ` — ${body.slice(0, 120)}` : ''}`,
		);
	}
	successesThisProcess++;
	return (await res.json()) as T;
}

export async function fetchOpenCriticScore(
	_appid: number,
	name: string,
): Promise<OpenCriticScore | null> {
	const hits = await get<SearchHit[]>(SEARCH_PATH(name));
	if (!hits || hits.length === 0) return null;
	// Take the best match if it's close enough. Search returns sorted by
	// dist (0 = identical). Anything > threshold is probably a different
	// game with similar words.
	const best = hits[0];
	if (best.dist > NAME_MATCH_DIST_THRESHOLD) return null;
	const game = await get<GameResp>(GAME_PATH(best.id));
	if (!game) return null;
	const tier = game.tierData?.name ?? game.tier ?? null;
	// Prefer medianScore (all critics) but fall back to topCriticScore if
	// median is missing — some new releases only have top-critic data.
	const score =
		typeof game.medianScore === 'number'
			? game.medianScore
			: typeof game.topCriticScore === 'number'
				? game.topCriticScore
				: null;
	return {
		opencritic_id: best.id,
		score,
		percent_recommended:
			typeof game.percentRecommended === 'number'
				? game.percentRecommended
				: null,
		num_reviews: typeof game.numReviews === 'number' ? game.numReviews : null,
		tier,
		url: game.url ?? `https://opencritic.com/game/${best.id}`,
		raw: game,
	};
}
