/**
 * Live current-player counts via Steam's public ISteamUserStats endpoint.
 * No API key required. Cached in-memory for 5 minutes per appid so the
 * trending route doesn't hammer Steam on every page load.
 */

const TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
	count: number;
	expiresAt: number;
}

const cache = new Map<number, CacheEntry>();

async function fetchOne(appid: number): Promise<number> {
	const url = new URL(
		'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/',
	);
	url.searchParams.set('appid', String(appid));
	const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
	if (!res.ok) throw new Error(`steam ${res.status}`);
	const data = (await res.json()) as {
		response?: { player_count?: number; result?: number };
	};
	if (data.response?.result !== 1 || data.response.player_count === undefined) {
		throw new Error('steam returned no player count');
	}
	return data.response.player_count;
}

/**
 * Get live player counts for many appids. Returns a Map; missing entries
 * mean the lookup failed (game delisted / not on Steam / Steam down).
 * Misses are NOT cached so they retry next call.
 */
export async function getCurrentPlayers(
	appids: number[],
): Promise<Map<number, number>> {
	const out = new Map<number, number>();
	const toFetch: number[] = [];
	const now = Date.now();
	for (const id of appids) {
		const hit = cache.get(id);
		if (hit && hit.expiresAt > now) {
			out.set(id, hit.count);
		} else {
			toFetch.push(id);
		}
	}
	if (toFetch.length === 0) return out;

	const results = await Promise.allSettled(toFetch.map((id) => fetchOne(id)));
	results.forEach((r, i) => {
		const id = toFetch[i];
		if (r.status === 'fulfilled') {
			cache.set(id, { count: r.value, expiresAt: now + TTL_MS });
			out.set(id, r.value);
		}
	});
	return out;
}
