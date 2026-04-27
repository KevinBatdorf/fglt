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
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
	const res = await fetch(`${API_BASE}${path}`, { signal });
	if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
	return (await res.json()) as T;
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
};
