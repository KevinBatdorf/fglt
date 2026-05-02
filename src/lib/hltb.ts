/**
 * HowLongToBeat unofficial search.
 *
 * As of late 2025 HLTB moved off `/api/seek/<token>` (token-in-URL) and
 * onto a two-step flow:
 *   1. GET  /api/find/init?t=<ms>  → returns { token, hpKey, hpVal }
 *   2. POST /api/find              with x-auth-token / x-hp-key / x-hp-val
 *      headers, AND the same hpKey/hpVal pair embedded in the body as a
 *      dynamically-named field — that's the honeypot.
 *
 * Rate-limit handling mirrors OpenCritic: a process-wide success counter
 * caps cron usage so the long-lived API container keeps headroom for
 * user-initiated /refresh calls. Cron containers are short-lived (one
 * batch per 15 min) so the counter naturally resets each tick.
 *
 * Returns hours for: main story, main+extras, completionist.
 */

interface HLTBAuth {
	token: string;
	hpKey: string;
	hpVal: string;
}

let cachedAuth: { value: HLTBAuth; ts: number } | null = null;
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

const DAILY_BUDGET = Number.parseInt(
	process.env.HLTB_DAILY_BUDGET ?? '80',
	10,
);

export function isHLTBRateLimited(): boolean {
	return rateLimitedUntilProcessExit;
}

// HLTB's anti-bot keys on the literal Origin string their JS sends — and
// the JS uses the trailing slash form. The browser would normally strip it
// before sending, but we send what they expect verbatim. Without this,
// /api/find returns 404 even with a valid token + headers.
const HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
		'(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
	Origin: 'https://howlongtobeat.com/',
	Referer: 'https://howlongtobeat.com/',
};

async function getAuth(): Promise<HLTBAuth> {
	if (rateLimitedUntilProcessExit) throw new HLTBRateLimitError();
	if (cachedAuth && Date.now() - cachedAuth.ts < AUTH_TTL_MS) {
		return cachedAuth.value;
	}
	const res = await fetch(
		`https://howlongtobeat.com/api/find/init?t=${Date.now()}`,
		{ headers: HEADERS, signal: AbortSignal.timeout(20_000) },
	);
	if (res.status === 429 || res.status === 403) {
		rateLimitedUntilProcessExit = true;
		throw new HLTBRateLimitError(
			`HLTB init blocked (HTTP ${res.status}) — likely rate-limit / IP block`,
		);
	}
	if (!res.ok) throw new Error(`hltb init: HTTP ${res.status}`);
	const data = (await res.json()) as Partial<HLTBAuth>;
	if (!data.token || !data.hpKey || !data.hpVal) {
		throw new Error('hltb init: missing auth fields');
	}
	const auth = {
		token: data.token,
		hpKey: data.hpKey,
		hpVal: data.hpVal,
	};
	cachedAuth = { value: auth, ts: Date.now() };
	return auth;
}

export interface HLTBResult {
	main?: number;
	extras?: number;
	completionist?: number;
}

export async function fetchHLTB(name: string): Promise<HLTBResult | null> {
	if (rateLimitedUntilProcessExit) throw new HLTBRateLimitError();
	if (successesThisProcess >= DAILY_BUDGET) {
		rateLimitedUntilProcessExit = true;
		throw new HLTBRateLimitError(
			`HLTB daily budget reached (${DAILY_BUDGET}); leaving headroom for manual /refresh`,
		);
	}
	const auth = await getAuth();
	// The hpKey/hpVal pair has to ALSO appear in the request body as a
	// dynamically-named field — it's their honeypot proving you parsed
	// the init response. Without it the request 404s.
	const body: Record<string, unknown> = {
		searchType: 'games',
		searchTerms: name.split(/\s+/).filter(Boolean),
		searchPage: 1,
		size: 5,
		useCache: true,
		[auth.hpKey]: auth.hpVal,
		searchOptions: {
			games: {
				userId: 0,
				platform: '',
				sortCategory: 'popular',
				rangeCategory: 'main',
				rangeTime: { min: null, max: null },
				gameplay: {
					perspective: '',
					flow: '',
					genre: '',
					difficulty: '',
				},
				rangeYear: { min: '', max: '' },
				modifier: '',
			},
			users: { sortCategory: 'postcount' },
			lists: { sortCategory: 'follows' },
			filter: '',
			sort: 0,
			randomizer: 0,
		},
	};

	const res = await fetch('https://howlongtobeat.com/api/find', {
		method: 'POST',
		headers: {
			...HEADERS,
			'Content-Type': 'application/json',
			'x-auth-token': auth.token,
			'x-hp-key': auth.hpKey,
			'x-hp-val': auth.hpVal,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(30_000),
	});
	if (res.status === 429 || res.status === 403) {
		rateLimitedUntilProcessExit = true;
		throw new HLTBRateLimitError(
			`HLTB find blocked (HTTP ${res.status}) — backing off`,
		);
	}
	if (!res.ok) {
		// auth may have rotated; clear cache so next call refetches
		cachedAuth = null;
		throw new Error(`hltb find failed: ${res.status}`);
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
