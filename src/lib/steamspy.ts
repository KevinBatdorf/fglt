/**
 * SteamSpy API helpers.
 * Docs: https://steamspy.com/api.php
 *
 * Free, no key. Polite throttling: ~1 req/sec.
 */

export interface SteamSpyDetails {
	appid: number;
	name: string;
	developer?: string;
	publisher?: string;
	score_rank?: string;
	positive?: number;
	negative?: number;
	owners?: string;
	average_forever?: number;
	average_2weeks?: number;
	median_forever?: number;
	median_2weeks?: number;
	ccu?: number;
	tags?: Record<string, number>;
	languages?: string;
	genre?: string;
}

export async function fetchSteamSpy(
	appid: number,
): Promise<SteamSpyDetails | null> {
	const url = new URL('https://steamspy.com/api.php');
	url.searchParams.set('request', 'appdetails');
	url.searchParams.set('appid', String(appid));

	const res = await fetch(url, {
		headers: { 'User-Agent': 'steam-library-tool/0.1' },
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) {
		throw new Error(`steamspy failed: ${res.status}`);
	}
	const data: SteamSpyDetails = await res.json();
	if (!data || !data.appid) return null;
	// SteamSpy returns {} or empty fields for unknown apps
	if (typeof data.tags !== 'object' && !data.name) return null;
	return data;
}
