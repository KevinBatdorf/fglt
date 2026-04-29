/**
 * Resolve a non-Steam game title to a Steam appid via the storesearch endpoint.
 *
 * Strategy: hit Steam's storefront search, normalize candidate names, return
 * the highest-confidence match. Returns null if nothing crosses the threshold.
 */

const STORESEARCH_URL = 'https://store.steampowered.com/api/storesearch';

export interface MatchCandidate {
	appid: number;
	name: string;
	score: number;
}

export interface MatchResult {
	appid: number | null;
	confidence: number;
	candidates: MatchCandidate[];
}

interface StoreSearchItem {
	id: number;
	name: string;
	tiny_image?: string;
	metascore?: string;
	platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
	streamingvideo?: boolean;
	price?: { currency: string; initial: number; final: number };
}

const ACCEPT_THRESHOLD = 0.85;

export function normalize(s: string): string {
	return s
		.toLowerCase()
		.replace(/[™®©]/g, '')
		.replace(/\s*[:\-–—]\s*/g, ' ')
		.replace(/\b(the|a|an)\b/g, '')
		.replace(/[^\p{L}\p{N}\s]/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function tokenJaccard(a: string, b: string): number {
	const ta = new Set(a.split(' ').filter(Boolean));
	const tb = new Set(b.split(' ').filter(Boolean));
	if (ta.size === 0 || tb.size === 0) return 0;
	let overlap = 0;
	for (const t of ta) if (tb.has(t)) overlap++;
	return overlap / (ta.size + tb.size - overlap);
}

function similarity(query: string, candidate: string): number {
	const q = normalize(query);
	const c = normalize(candidate);
	if (!q || !c) return 0;
	if (q === c) return 1;
	if (c.startsWith(q) || q.startsWith(c)) {
		const ratio = Math.min(q.length, c.length) / Math.max(q.length, c.length);
		return 0.7 + 0.3 * ratio;
	}
	return tokenJaccard(q, c);
}

export async function searchSteamStore(
	term: string,
): Promise<StoreSearchItem[]> {
	const url = new URL(STORESEARCH_URL);
	url.searchParams.set('term', term);
	url.searchParams.set('l', 'english');
	url.searchParams.set('cc', 'us');
	const res = await fetch(url, {
		headers: { 'User-Agent': 'steam-library-tool/0.1' },
		signal: AbortSignal.timeout(15_000),
	});
	if (!res.ok) throw new Error(`storesearch failed: ${res.status}`);
	const data: { total?: number; items?: StoreSearchItem[] } = await res.json();
	return data.items ?? [];
}

export async function matchSteamAppid(title: string): Promise<MatchResult> {
	const items = await searchSteamStore(title);
	const candidates: MatchCandidate[] = items.map((it) => ({
		appid: it.id,
		name: it.name,
		score: similarity(title, it.name),
	}));
	candidates.sort((a, b) => b.score - a.score);
	const top = candidates[0];
	if (!top || top.score < ACCEPT_THRESHOLD) {
		return {
			appid: null,
			confidence: top?.score ?? 0,
			candidates: candidates.slice(0, 5),
		};
	}
	return {
		appid: top.appid,
		confidence: top.score,
		candidates: candidates.slice(0, 5),
	};
}
