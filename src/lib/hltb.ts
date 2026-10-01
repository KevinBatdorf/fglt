/**
 * HowLongToBeat unofficial search.
 *
 * As of Sept 2026 HLTB moved `/api/find` to `/api/search/site` and
 * dropped the hpKey/hpVal honeypot. Current two-step flow:
 *   1. GET  /api/search/site/init?t=<ms>  → returns { token }
 *   2. POST /api/search/site              with an x-auth-token header
 *
 * The token is bound to the caller's IP + User-Agent, so the UA must be
 * identical on both calls. A 403 from search means the token expired —
 * their own frontend re-inits and retries once, and so do we.
 *
 * Rate-limit handling mirrors OpenCritic: a process-wide success counter
 * caps cron usage so the long-lived API container keeps headroom for
 * user-initiated /refresh calls. Cron containers are short-lived (one
 * batch per 15 min) so the counter naturally resets each tick.
 *
 * Returns hours for: main story, main+extras, completionist.
 */
import { getConfig } from './config';

let cachedToken: { value: string; ts: number } | null = null;
const AUTH_TTL_MS = 30 * 60 * 1000; // 30m — init is cheap so re-fetch often

export class HLTBRateLimitError extends Error {
	constructor(message = 'HLTB rate limit reached') {
		super(message);
		this.name = 'HLTBRateLimitError';
	}
}

// Module-level rate-limit handling. Once tripped (real 429/403 OR our
// self-imposed daily budget), every subsequent call short-circuits for
// the rest of this process's lifetime. Cron containers re-spawn each tick
// so the budget effectively resets every 15 min.
let rateLimitedUntilProcessExit = false;
let successesThisProcess = 0;

async function dailyBudget(): Promise<number> {
	const cfg = await getConfig();
	return Number.parseInt(cfg.HLTB_DAILY_BUDGET ?? '80', 10);
}

export function isHLTBRateLimited(): boolean {
	return rateLimitedUntilProcessExit;
}

/** Test-only: reset cached auth + rate-limit flag between tests. */
export function __resetHLTBStateForTests(): void {
	cachedToken = null;
	rateLimitedUntilProcessExit = false;
	successesThisProcess = 0;
}

// The auth token encodes the User-Agent, so init and search must send the
// same one.
const HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
		'(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
	Origin: 'https://howlongtobeat.com',
	Referer: 'https://howlongtobeat.com/',
};

async function getToken(forceRefresh = false): Promise<string> {
	if (rateLimitedUntilProcessExit) throw new HLTBRateLimitError();
	if (
		!forceRefresh &&
		cachedToken &&
		Date.now() - cachedToken.ts < AUTH_TTL_MS
	) {
		return cachedToken.value;
	}
	const res = await fetch(
		`https://howlongtobeat.com/api/search/site/init?t=${Date.now()}`,
		{ headers: HEADERS, signal: AbortSignal.timeout(20_000) },
	);
	if (res.status === 429 || res.status === 403) {
		rateLimitedUntilProcessExit = true;
		throw new HLTBRateLimitError(
			`HLTB init blocked (HTTP ${res.status}) — likely rate-limit / IP block`,
		);
	}
	if (!res.ok) throw new Error(`hltb init: HTTP ${res.status}`);
	const data = (await res.json()) as { token?: string };
	if (!data.token) throw new Error('hltb init: missing token');
	cachedToken = { value: data.token, ts: Date.now() };
	return data.token;
}

export interface HLTBResult {
	main?: number;
	extras?: number;
	completionist?: number;
}

function searchBody(name: string) {
	const anyOf = { mode: 'include', values: [] };
	return {
		searchType: 'games',
		searchTerms: name.split(/\s+/).filter(Boolean),
		searchPage: 1,
		size: 5,
		useCache: true,
		searchOptions: {
			games: {
				userId: 0,
				platform: '',
				sortCategory: 'popular',
				rangeCategory: 'main',
				rangeTime: { min: null, max: null },
				gameplay: { perspective: anyOf, flow: anyOf, genre: anyOf },
				year: anyOf,
				modifier: '',
			},
			users: { sortCategory: 'postcount' },
			lists: { sortCategory: 'follows' },
			filter: '',
			sort: 0,
			randomizer: 0,
		},
	};
}

export async function fetchHLTB(name: string): Promise<HLTBResult | null> {
	if (rateLimitedUntilProcessExit) throw new HLTBRateLimitError();
	const budget = await dailyBudget();
	if (successesThisProcess >= budget) {
		rateLimitedUntilProcessExit = true;
		throw new HLTBRateLimitError(
			`HLTB daily budget reached (${budget}); leaving headroom for manual /refresh`,
		);
	}
	const body = JSON.stringify(searchBody(name));
	const search = async (token: string) =>
		fetch('https://howlongtobeat.com/api/search/site', {
			method: 'POST',
			headers: {
				...HEADERS,
				'Content-Type': 'application/json',
				'x-auth-token': token,
			},
			body,
			signal: AbortSignal.timeout(30_000),
		});

	let res = await search(await getToken());
	// 403 = expired token; re-init once before treating it as a block.
	if (res.status === 403) res = await search(await getToken(true));
	if (res.status === 429 || res.status === 403) {
		rateLimitedUntilProcessExit = true;
		throw new HLTBRateLimitError(
			`HLTB search blocked (HTTP ${res.status}) — backing off`,
		);
	}
	if (!res.ok) {
		// auth may have rotated; clear cache so next call refetches
		cachedToken = null;
		throw new Error(`hltb search failed: ${res.status}`);
	}
	successesThisProcess++;
	const data: {
		data?: Array<{
			game_name?: string;
			comp_main?: number;
			comp_plus?: number;
			comp_100?: number;
		}>;
	} = await res.json();
	const first = data.data?.[0];
	if (!first) return null;

	// Fields are in seconds.
	const toHours = (s?: number) =>
		typeof s === 'number' && s > 0
			? Math.round((s / 3600) * 10) / 10
			: undefined;

	return {
		main: toHours(first.comp_main),
		extras: toHours(first.comp_plus),
		completionist: toHours(first.comp_100),
	};
}
