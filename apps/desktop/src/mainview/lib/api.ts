/**
 * Typed wrappers around the SEG API at http://localhost:3110.
 *
 * Kept thin — every function returns the unwrapped JSON. Errors throw with
 * the API's status code so the caller can decide UX.
 */
import type {
	Platform,
	RefreshResult,
	RefreshSource,
} from '../../shared/types';

export const API_BASE =
	import.meta.env?.VITE_API_BASE ?? 'http://localhost:3110';

/**
 * Cross-component event bus for "lists changed" — anyone who mutates list
 * membership (add/remove/create/delete from any view) calls this so the
 * Sidebar (and anything else interested) refetches counts.
 */
export function notifyListsChanged(): void {
	window.dispatchEvent(new CustomEvent('seg:lists:changed'));
}

export interface Stats {
	total: number;
	enriched: number;
	embedded: number;
	played: number;
	unplayed: number;
	platforms: Record<Platform, number>;
	multi_platform: number;
	total_playtime_min: string;
	meta: { key: string; value: string; updated: string }[];
}

export interface LibraryGame {
	appid: number;
	name: string;
	type: string | null;
	short_desc: string | null;
	header_image: string | null;
	release_date: string | null;
	genres: string[] | null;
	categories: string[] | null;
	playtime_min: number;
	playtime_2wk: number;
	last_played: string | null;
	positive: number | null;
	negative: number | null;
	owners_estimate: string | null;
	hltb_main: number | null;
	hltb_extra: number | null;
	metacritic: number | null;
	platforms: Platform[];
	created_at: string | null;
	/** Hybrid keyword+vector relevance, 0..1. Only present on /library?q= results. */
	score?: number | null;
}

export interface LibraryResponse {
	count: number;
	offset: number;
	results: LibraryGame[];
	q?: string;
	mode?: 'hybrid' | 'fts';
}

export interface Tag {
	tag: string;
	votes: number;
}

export interface SimilarRow {
	appid: number;
	rank: number;
	name: string | null;
	header_image: string | null;
	platforms: Platform[];
}

export interface OwnershipRow {
	platform: Platform;
	external_id: string;
	title_at_source: string | null;
	acquired_at: string | null;
	playtime_min: number;
	last_played: string | null;
}

export interface Video {
	video_id: string;
	title: string;
	channel: string | null;
	channel_id: string | null;
	description: string | null;
	thumbnail_url: string | null;
	published_at: string | null;
	rank: number;
}

export interface ListSummary {
	id: number;
	slug: string;
	name: string;
	emoji: string | null;
	is_system: boolean;
	count?: number;
	created_at?: string;
}

export interface SavedSearchSummary {
	id: number;
	slug: string;
	name: string;
	emoji: string | null;
	query: string;
	tag_filter: string | null;
	sort_order: string | null;
	count?: number;
	created_at?: string;
}

export function notifySavedSearchesChanged(): void {
	window.dispatchEvent(new CustomEvent('seg:saved-searches:changed'));
}

export interface ListEntry {
	id: number;
	slug: string;
	name: string;
	emoji: string | null;
	is_system: boolean;
	note: string | null;
	added_at: string;
}

export interface Screenshot {
	id: number;
	path_thumbnail: string;
	path_full: string;
}

export interface SteamUserReview {
	recommendation_id: number;
	voted_up: boolean;
	votes_up: number;
	votes_funny: number;
	weighted_vote_score: number | null;
	playtime_at_review_min: number | null;
	language: string | null;
	review_text: string | null;
	timestamp_created: string | null;
	timestamp_updated: string | null;
}

export interface ExternalScore {
	source: string;
	score: number | null;
	max_score: number;
	tier: string | null;
	url: string | null;
	percent_recommended: number | null;
	num_reviews: number | null;
	fetched_at: string;
}

export interface GameDetail extends LibraryGame {
	about: string | null;
	detailed_desc: string | null;
	developers: string[] | null;
	publishers: string[] | null;
	hltb_complete: number | null;
	avg_playtime: number | null;
	median_playtime: number | null;
	metacritic_url: string | null;
	controller: 'full' | 'partial' | null;
	website: string | null;
	price_cents: number | null;
	currency: string | null;
	os_support: { windows: boolean; mac: boolean; linux: boolean } | null;
	screenshots: Screenshot[];
	tags: Tag[];
	similar: SimilarRow[];
	ownership: OwnershipRow[];
	videos: Video[];
	lists: ListEntry[];
	reviews: SteamUserReview[];
	external_scores: ExternalScore[];
	enriched_at: string | null;
	screenshots_fetched_at: string | null;
	steam_reviews_fetched_at: string | null;
	opencritic_fetched_at: string | null;
	youtube_fetched_at: string | null;
}

export interface CurateSeed {
	appid: number;
	name: string;
	header_image: string | null;
	playtime_min: number;
	playtime_2wk: number;
}

export interface VibeChip {
	label: string;
	query: string;
	emoji: string;
}

export interface ActivityResponse {
	counts: {
		games_added_24h: number;
		enriched_24h: number;
		embedded_24h: number;
		videos_fetched_24h: number;
		games_added_7d: number;
		enriched_7d: number;
		videos_fetched_7d: number;
	};
	recent_added: {
		appid: number;
		name: string;
		header_image: string | null;
		created_at: string;
	}[];
	recent_enriched: {
		appid: number;
		name: string;
		header_image: string | null;
		enriched_at: string;
	}[];
	recent_videos: {
		appid: number;
		name: string;
		header_image: string | null;
		youtube_fetched_at: string;
		video_count: number;
	}[];
	lists_created: {
		slug: string;
		name: string;
		emoji: string | null;
		is_system: boolean;
		created_at: string;
	}[];
	meta: { key: string; value: string; updated: string }[];
}

export interface VibesResponse {
	vibes: VibeChip[];
	generated_at: string;
	source: 'static' | 'llm';
	ai_enabled: boolean;
	stale?: boolean;
}

export interface CurateResponse {
	continue_playing: LibraryGame[];
	because_recently: { seed: CurateSeed; recs: LibraryGame[] } | null;
	because_obsession: { seed: CurateSeed; recs: LibraryGame[] } | null;
	game_of_the_day: LibraryGame | null;
	picks_tonight: LibraryGame[];
	quick_wins: LibraryGame[];
	hidden_gems: LibraryGame[];
	trending: LibraryGame[];
	by_vibe: VibeChip[];
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, { signal });
	if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
	return (await res.json()) as T;
}

async function jsonCall<T>(
	path: string,
	method: 'POST' | 'DELETE' | 'PATCH',
	body?: unknown,
): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		method,
		headers:
			body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
	return (await res.json()) as T;
}

export interface SimilarResponse {
	source: { appid: number; name: string } | { query: string };
	count: number;
	results: (LibraryGame & { similarity: number })[];
}

export interface HealthStatus {
	db: 'ok' | 'down';
	ai: 'ok' | 'disabled';
	steam_key: 'present' | 'missing';
	steam_id: 'present' | 'missing';
	total_games: number;
	last_sync: string | null;
	/**
	 * Keys that are REQUIRED for the app to do anything useful but aren't
	 * set yet. Empty array = good to go. Currently always a subset of
	 * ['STEAM_API_KEY', 'STEAM_ID']. The desktop UI uses this to lock the
	 * user into the Settings page until they're filled in.
	 */
	required_missing: string[];
}

/**
 * Mirrors `AppConfig` on the server. All keys optional — undefined means
 * "not set anywhere". When `reveal=false` (default), sensitive keys come
 * back masked as "••••<last4>".
 */
export interface ConfigResponse {
	config: Partial<Record<ConfigKey, string>>;
}

export type ConfigKey =
	| 'STEAM_API_KEY'
	| 'STEAM_ID'
	| 'YOUTUBE_API_KEY'
	| 'OPENCRITIC_API_KEY'
	| 'AI_BASE_URL'
	| 'AI_API_KEY'
	| 'AI_PROVIDER_NAME'
	| 'AI_CHAT_MODEL'
	| 'AI_EMBED_MODEL'
	| 'OLLAMA_URL'
	| 'OLLAMA_CHAT_MODEL'
	| 'OLLAMA_EMBED_MODEL'
	| 'HLTB_DAILY_BUDGET'
	| 'OPENCRITIC_DAILY_BUDGET';

/** Cross-component event: emitted right after a successful POST /settings/config. */
export function notifyConfigChanged(): void {
	window.dispatchEvent(new CustomEvent('seg:config:changed'));
}

export const api = {
	stats: (signal?: AbortSignal) => get<Stats>('/stats', signal),
	health: (signal?: AbortSignal) => get<HealthStatus>('/health', signal),
	library: (
		params: Record<string, string | number | undefined>,
		signal?: AbortSignal,
	) => {
		const url = new URL(`${API_BASE}/library`);
		for (const [k, v] of Object.entries(params)) {
			if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
		}
		return get<LibraryResponse>(url.pathname + url.search, signal);
	},
	game: (appid: number, signal?: AbortSignal) =>
		get<GameDetail>(`/games/${appid}`, signal),
	similar: (
		params: Record<string, string | number | undefined>,
		signal?: AbortSignal,
	) => {
		const url = new URL(`${API_BASE}/similar`);
		for (const [k, v] of Object.entries(params)) {
			if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
		}
		return get<SimilarResponse>(url.pathname + url.search, signal);
	},
	curate: (signal?: AbortSignal) => get<CurateResponse>('/curate', signal),
	tags: (signal?: AbortSignal) =>
		get<{ tags: { tag: string; total_votes: number; games: number }[] }>(
			'/tags',
			signal,
		),
	vibes: (signal?: AbortSignal) => get<VibesResponse>('/vibes', signal),
	regenerateVibes: () => jsonCall<VibesResponse>('/vibes/regenerate', 'POST'),
	activity: (signal?: AbortSignal) =>
		get<ActivityResponse>('/activity', signal),
	syncOwned: () =>
		jsonCall<{ ok: boolean; total: number; removed?: number }>('/sync', 'POST'),
	lists: (signal?: AbortSignal) =>
		get<{ lists: ListSummary[] }>('/lists', signal),
	listGames: (slug: string, signal?: AbortSignal) =>
		get<ListSummary & { games: LibraryGame[] }>(`/lists/${slug}`, signal),
	createList: (name: string, emoji?: string) =>
		jsonCall<ListSummary>('/lists', 'POST', { name, emoji }),
	createListFromSearch: (name: string, q: string, tag?: string) =>
		jsonCall<ListSummary & { games_added: number }>('/lists', 'POST', {
			name,
			from_search: { q, tag },
		}),
	createListFromAppids: (name: string, appids: number[]) =>
		jsonCall<ListSummary & { games_added: number }>('/lists', 'POST', {
			name,
			appids,
		}),
	deleteList: (listRef: string | number) =>
		jsonCall<{ ok: boolean }>(`/lists/${listRef}`, 'DELETE'),
	renameList: (
		listRef: string | number,
		patch: { name?: string; emoji?: string | null },
	) => jsonCall<ListSummary>(`/lists/${listRef}`, 'PATCH', patch),
	savedSearches: (signal?: AbortSignal) =>
		get<{ saved_searches: SavedSearchSummary[] }>('/saved_searches', signal),
	getSavedSearch: (ref: string | number, signal?: AbortSignal) =>
		get<SavedSearchSummary>(`/saved_searches/${ref}`, signal),
	createSavedSearch: (input: {
		name: string;
		query: string;
		tag_filter?: string;
		sort_order?: string;
		emoji?: string;
	}) => jsonCall<SavedSearchSummary>('/saved_searches', 'POST', input),
	deleteSavedSearch: (ref: string | number) =>
		jsonCall<{ ok: boolean }>(`/saved_searches/${ref}`, 'DELETE'),
	/**
	 * Direct call to /games/:appid/refresh — used by the per-section
	 * "Fetch now" buttons. Bypasses Electrobun RPC because that adds a
	 * timeout we can't easily extend, and the webview can reach the API
	 * server directly via the existing CORS config.
	 */
	refreshGame: (appid: number, source: RefreshSource = 'all') => {
		const qs = source !== 'all' ? `?source=${source}` : '';
		return jsonCall<RefreshResult>(`/games/${appid}/refresh${qs}`, 'POST');
	},
	addToList: (listRef: string | number, appid: number, note?: string) =>
		jsonCall<unknown>(`/lists/${listRef}/games/${appid}`, 'POST', { note }),
	removeFromList: (listRef: string | number, appid: number) =>
		jsonCall<unknown>(`/lists/${listRef}/games/${appid}`, 'DELETE'),
	random: (
		params: Record<string, string | number | undefined>,
		signal?: AbortSignal,
	) => {
		const url = new URL(`${API_BASE}/random`);
		for (const [k, v] of Object.entries(params)) {
			if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
		}
		return get<{ appid: number; name: string }>(
			url.pathname + url.search,
			signal,
		);
	},
	hiddenGenres: (signal?: AbortSignal) =>
		get<{ hidden_genres: string[] }>('/settings/hidden-genres', signal),
	setHiddenGenres: (list: string[]) =>
		jsonCall<{ hidden_genres: string[] }>('/settings/hidden-genres', 'POST', {
			hidden_genres: list,
		}),
	genres: (signal?: AbortSignal) =>
		get<{ genres: { name: string; games: number }[] }>('/genres', signal),
	/**
	 * Read the runtime config. Sensitive keys (API keys) are masked unless
	 * `reveal=true`, which the UI uses for click-to-reveal — never bake
	 * `reveal=true` into a default fetch.
	 */
	config: (reveal = false, signal?: AbortSignal) =>
		get<ConfigResponse>(`/settings/config${reveal ? '?reveal=1' : ''}`, signal),
	/**
	 * Upsert one or more config keys. Empty string deletes the row. The
	 * server invalidates its in-process cache so the next /health poll
	 * reflects the change immediately.
	 */
	saveConfig: (updates: Partial<Record<ConfigKey, string>>) =>
		jsonCall<{ ok: boolean; updated: number; deleted: number }>(
			'/settings/config',
			'POST',
			updates,
		),
};

/**
 * Build a Steam CDN image URL from an appid. These work for ~all apps on
 * Steam without an API call. Variants:
 *   header        — 460x215 store header
 *   library_hero  — 1920x620 library hero (the big one)
 *   library_capsule — 600x900 vertical poster
 *   library_logo  — transparent overlay logo
 *   page_bg       — page background photo
 */
export type SteamImageVariant =
	| 'header'
	| 'library_hero'
	| 'library_capsule'
	| 'library_logo'
	| 'page_bg';

export function steamImg(appid: number, variant: SteamImageVariant): string {
	const base =
		'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps';
	switch (variant) {
		case 'header':
			return `${base}/${appid}/header.jpg`;
		case 'library_hero':
			return `${base}/${appid}/library_hero.jpg`;
		case 'library_capsule':
			return `${base}/${appid}/library_600x900.jpg`;
		case 'library_logo':
			return `${base}/${appid}/logo.png`;
		case 'page_bg':
			return `${base}/${appid}/page.bg.jpg`;
	}
}
