/**
 * Steam Web API helpers (owned games + appdetails).
 * Docs:
 *   - GetOwnedGames: https://partner.steamgames.com/doc/webapi/IPlayerService
 *   - appdetails:    https://wiki.teamfortress.com/wiki/User:RJackson/StorefrontAPI#appdetails
 */
import { getConfig } from './config';

export interface OwnedGame {
	appid: number;
	name: string;
	playtime_minutes: number;
	playtime_2weeks: number;
	last_played?: Date;
	icon_url?: string;
}

export async function fetchOwnedGames(): Promise<OwnedGame[]> {
	const cfg = await getConfig();
	if (!cfg.STEAM_API_KEY) throw new Error('STEAM_API_KEY not set');
	if (!cfg.STEAM_ID) throw new Error('STEAM_ID not set');
	const url = new URL(
		'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/',
	);
	url.searchParams.set('key', cfg.STEAM_API_KEY);
	url.searchParams.set('steamid', cfg.STEAM_ID);
	url.searchParams.set('include_appinfo', '1');
	url.searchParams.set('include_played_free_games', '1');
	url.searchParams.set('format', 'json');

	const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
	if (!res.ok) {
		throw new Error(`GetOwnedGames failed: ${res.status} ${await res.text()}`);
	}
	const data: {
		response?: {
			game_count?: number;
			games?: Array<{
				appid: number;
				name: string;
				playtime_forever?: number;
				playtime_2weeks?: number;
				rtime_last_played?: number;
				img_icon_url?: string;
			}>;
		};
	} = await res.json();

	const games = data.response?.games ?? [];
	return games.map((g) => ({
		appid: g.appid,
		name: g.name,
		playtime_minutes: g.playtime_forever ?? 0,
		playtime_2weeks: g.playtime_2weeks ?? 0,
		last_played: g.rtime_last_played
			? new Date(g.rtime_last_played * 1000)
			: undefined,
		icon_url: g.img_icon_url,
	}));
}

export interface AppDetails {
	type?: string;
	name?: string;
	is_free?: boolean;
	required_age?: number;
	short_description?: string;
	detailed_description?: string;
	about_the_game?: string;
	header_image?: string;
	capsule_image?: string;
	website?: string | null;
	developers?: string[];
	publishers?: string[];
	platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
	categories?: Array<{ id: number; description: string }>;
	genres?: Array<{ id: string; description: string }>;
	release_date?: { coming_soon?: boolean; date?: string };
	metacritic?: { score?: number; url?: string };
	controller_support?: string;
	price_overview?: { final?: number; currency?: string };
	screenshots?: Array<{
		id: number;
		path_thumbnail: string;
		path_full: string;
	}>;
}

/** Strip HTML tags from Steam description fields. */
export function stripHtml(s: string | undefined): string | undefined {
	if (!s) return s;
	return s
		.replace(/<br\s*\/?>(\r?\n)?/gi, '\n')
		.replace(/<\/?[^>]+>/g, '')
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/[\t ]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

/**
 * Fetch app details for a single appid. Returns null if Steam reports
 * `success: false` (typical for delisted/region-locked apps).
 *
 * Steam rate-limits this endpoint at ~200 requests / 5 minutes.
 */
export async function fetchAppDetails(
	appid: number,
	cc = 'us',
	lang = 'english',
): Promise<AppDetails | null> {
	const url = new URL('https://store.steampowered.com/api/appdetails');
	url.searchParams.set('appids', String(appid));
	url.searchParams.set('cc', cc);
	url.searchParams.set('l', lang);

	const res = await fetch(url, {
		headers: { 'User-Agent': 'steam-library-tool/0.1' },
		signal: AbortSignal.timeout(30_000),
	});
	if (res.status === 429) {
		throw new Error('appdetails rate-limited (429)');
	}
	if (!res.ok) {
		throw new Error(`appdetails failed: ${res.status}`);
	}
	const data: Record<string, { success: boolean; data?: AppDetails }> =
		await res.json();
	const entry = data[String(appid)];
	if (!entry?.success || !entry.data) return null;
	return entry.data;
}
