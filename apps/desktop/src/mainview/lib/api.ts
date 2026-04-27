/**
 * Typed wrappers around the SEG API at http://localhost:3110.
 *
 * Kept thin — every function returns the unwrapped JSON. Errors throw with
 * the API's status code so the caller can decide UX.
 */
import type { Platform } from "../../shared/types";

export const API_BASE =
	import.meta.env?.VITE_API_BASE ?? "http://localhost:3110";

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
}

export interface LibraryResponse {
	count: number;
	offset: number;
	results: LibraryGame[];
	q?: string;
	mode?: "hybrid" | "fts";
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

export interface ListEntry {
	id: number;
	slug: string;
	name: string;
	emoji: string | null;
	is_system: boolean;
	note: string | null;
	added_at: string;
}

export interface GameDetail extends LibraryGame {
	about: string | null;
	detailed_desc: string | null;
	developers: string[] | null;
	publishers: string[] | null;
	hltb_complete: number | null;
	avg_playtime: number | null;
	median_playtime: number | null;
	tags: Tag[];
	similar: SimilarRow[];
	ownership: OwnershipRow[];
	videos: Video[];
	lists: ListEntry[];
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
	method: "POST" | "DELETE",
	body?: unknown,
): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, {
		method,
		headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
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

export const api = {
	stats: (signal?: AbortSignal) => get<Stats>("/stats", signal),
	library: (
		params: Record<string, string | number | undefined>,
		signal?: AbortSignal,
	) => {
		const url = new URL(`${API_BASE}/library`);
		for (const [k, v] of Object.entries(params)) {
			if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
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
			if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
		}
		return get<SimilarResponse>(url.pathname + url.search, signal);
	},
	curate: (signal?: AbortSignal) =>
		get<CurateResponse>("/curate", signal),
	lists: (signal?: AbortSignal) =>
		get<{ lists: ListSummary[] }>("/lists", signal),
	listGames: (slug: string, signal?: AbortSignal) =>
		get<ListSummary & { games: LibraryGame[] }>(`/lists/${slug}`, signal),
	createList: (name: string, emoji?: string) =>
		jsonCall<ListSummary>("/lists", "POST", { name, emoji }),
	addToList: (listRef: string | number, appid: number, note?: string) =>
		jsonCall<unknown>(`/lists/${listRef}/games/${appid}`, "POST", { note }),
	removeFromList: (listRef: string | number, appid: number) =>
		jsonCall<unknown>(`/lists/${listRef}/games/${appid}`, "DELETE"),
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
	| "header"
	| "library_hero"
	| "library_capsule"
	| "library_logo"
	| "page_bg";

export function steamImg(appid: number, variant: SteamImageVariant): string {
	const base = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";
	switch (variant) {
		case "header":
			return `${base}/${appid}/header.jpg`;
		case "library_hero":
			return `${base}/${appid}/library_hero.jpg`;
		case "library_capsule":
			return `${base}/${appid}/library_600x900.jpg`;
		case "library_logo":
			return `${base}/${appid}/logo.png`;
		case "page_bg":
			return `${base}/${appid}/page.bg.jpg`;
	}
}
