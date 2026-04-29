import { useEffect, useMemo, useState } from "react";
import { GameImage } from "./GameImage";
import { Select } from "./Select";
import { type LibraryGame, api } from "./lib/api";
import { getRecentlyAddedMonths } from "./lib/prefs";
import type { InstalledIndex, Platform } from "../shared/types";

type Preset = "all" | "unplayed" | "recently_played" | "recently_added";
type SortKey =
	| "name"
	| "playtime"
	| "recently_played"
	| "recently_added"
	| "year"
	| "rating";

interface Props {
	platformFilter: Platform | null;
	preset?: Preset;
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
}

const DEFAULT_SORT: Record<Preset, SortKey> = {
	all: "name",
	unplayed: "rating",
	recently_played: "recently_played",
	recently_added: "recently_added",
};

// Sort options each preset actually supports. "Most played" / "Recently
// played" are no-ops when every row has playtime=0, so they don't show up
// in the Unplayed view.
// "recently_added" sort only makes sense on its own preset (where the data
// is already filtered to post-setup additions). On the other views every row
// has its own arbitrary created_at and the sort isn't useful.
const SORT_OPTIONS: Record<Preset, SortKey[]> = {
	all: ["name", "playtime", "recently_played", "year", "rating"],
	unplayed: ["rating", "name", "year"],
	recently_played: ["recently_played", "playtime", "rating", "name", "year"],
	recently_added: ["recently_added", "name", "year", "rating"],
};

const SORT_LABELS: Record<SortKey, string> = {
	name: "Sort: A–Z",
	playtime: "Sort: Most played",
	recently_played: "Sort: Recently played",
	recently_added: "Sort: Recently added",
	year: "Sort: Newest first",
	rating: "Sort: Highest rated",
};

const PRESET_TITLE: Record<Preset, string | null> = {
	all: null,
	unplayed: "Unplayed",
	recently_played: "Recently played",
	recently_added: "Recently added",
};

export function AllGames({
	platformFilter,
	preset = "all",
	installed,
	onSelect,
}: Props) {
	const [allGames, setAllGames] = useState<LibraryGame[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [sort, setSort] = useState<SortKey>(DEFAULT_SORT[preset]);
	const [tag, setTag] = useState<string>("");
	const [filter, setFilter] = useState("");
	const [searchOrder, setSearchOrder] = useState<number[] | null>(null);
	const [searching, setSearching] = useState(false);
	const [allTags, setAllTags] = useState<{ tag: string; games: number }[]>([]);

	useEffect(() => {
		setSort(DEFAULT_SORT[preset]);
		setTag("");
		setFilter("");
	}, [preset]);

	// Pull all games for the current view (preset + platform). Tag filter is
	// also pushed to the server because it's a JOIN query.
	useEffect(() => {
		const ctrl = new AbortController();
		setAllGames(null);
		const params: Record<string, string | number | undefined> = {
			platform: platformFilter ?? undefined,
			limit: 5000,
			sort: "name",
		};
		if (preset === "unplayed") params.unplayed = "1";
		if (preset === "recently_played") params.min_playtime = 1;
		if (preset === "recently_added") {
			params.recently_added = "1";
			params.within_months = getRecentlyAddedMonths();
		}
		if (tag) params.tag = tag;
		api
			.library(params, ctrl.signal)
			.then((d) => setAllGames(d.results))
			.catch((e) => {
				if (e.name !== "AbortError") setError(e.message);
			});
		return () => ctrl.abort();
	}, [platformFilter, preset, tag]);

	// Fetch top tags once
	useEffect(() => {
		api.tags().then((d) => setAllTags(d.tags));
	}, []);

	// Hybrid search within the current view
	useEffect(() => {
		const ctrl = new AbortController();
		const q = filter.trim();
		if (q.length === 0) {
			setSearchOrder(null);
			setSearching(false);
			return;
		}
		setSearching(true);
		const t = setTimeout(() => {
			const params: Record<string, string | number | undefined> = {
				q,
				platform: platformFilter ?? undefined,
				limit: 200,
			};
			if (preset === "unplayed") params.unplayed = "1";
			if (preset === "recently_played") params.min_playtime = 1;
			if (preset === "recently_added") {
			params.recently_added = "1";
			params.within_months = getRecentlyAddedMonths();
		}
			if (tag) params.tag = tag;
			api
				.library(params, ctrl.signal)
				.then((d) => setSearchOrder(d.results.map((g) => g.appid)))
				.catch((e) => {
					if (e.name !== "AbortError") console.warn("filter search failed", e);
				})
				.finally(() => setSearching(false));
		}, 200);
		return () => {
			clearTimeout(t);
			ctrl.abort();
		};
	}, [filter, platformFilter, preset, tag]);

	const visible = useMemo(() => {
		if (!allGames) return [] as LibraryGame[];

		const byId = new Map<number, LibraryGame>();
		for (const g of allGames) byId.set(g.appid, g);

		if (searchOrder !== null) {
			const out: LibraryGame[] = [];
			for (const id of searchOrder) {
				const g = byId.get(id);
				if (g) out.push(g);
			}
			return out;
		}

		const out = [...byId.values()];
		out.sort((a, b) => {
			switch (sort) {
				case "name":
					return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
				case "playtime":
					return (b.playtime_min ?? 0) - (a.playtime_min ?? 0);
				case "recently_played": {
					const ta = new Date(a.last_played ?? 0).getTime();
					const tb = new Date(b.last_played ?? 0).getTime();
					if (ta !== tb) return tb - ta;
					return (b.playtime_2wk ?? 0) - (a.playtime_2wk ?? 0);
				}
				case "recently_added": {
					// `created_at` is when our DB first saw this row — usually within
					// 24h of the user buying it (next syncer cron). Falls back to
					// appid desc if missing for some reason.
					const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
					const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
					if (tb !== ta) return tb - ta;
					return b.appid - a.appid;
				}
				case "year": {
					const ya = Number(a.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? 0);
					const yb = Number(b.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? 0);
					return yb - ya;
				}
				case "rating": {
					const ra = ratingPct(a) ?? -1;
					const rb = ratingPct(b) ?? -1;
					return rb - ra;
				}
			}
		});
		return out;
	}, [allGames, sort, searchOrder]);

	if (error) return <div className="text-red-400 text-sm">{error}</div>;
	if (!allGames)
		return <div className="text-zinc-500 text-sm">Loading…</div>;

	const sortDisabled = searchOrder !== null;
	const presetTitle = PRESET_TITLE[preset];

	return (
		<div>
			{presetTitle && (
				<header className="mb-3">
					<h1 className="text-lg font-semibold">{presetTitle}</h1>
					<p className="text-xs text-zinc-500">
						{searching
							? "searching…"
							: `${visible.length.toLocaleString()} of ${allGames.length.toLocaleString()} games`}
						{searchOrder !== null && (
							<span className="ml-1 text-zinc-600">· ranked by relevance</span>
						)}
					</p>
				</header>
			)}
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<input
					type="text"
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					placeholder="Search this view…"
					title="Hybrid keyword + semantic vector search, scoped to the current view."
					className="bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-xs placeholder-zinc-500 focus:border-zinc-600 focus:outline-none w-64"
				/>
				<Select value={tag} onChange={setTag}>
					<option value="">All tags</option>
					{allTags.map((t) => (
						<option key={t.tag} value={t.tag}>
							{t.tag} ({t.games})
						</option>
					))}
				</Select>
				<Select
					value={sort}
					onChange={(v) => setSort(v as SortKey)}
					disabled={sortDisabled}
					title={sortDisabled ? "Search results are ranked by relevance" : undefined}
				>
					{SORT_OPTIONS[preset].map((k) => (
						<option key={k} value={k}>
							{SORT_LABELS[k]}
						</option>
					))}
				</Select>
				{!presetTitle && (
					<span className="ml-auto text-xs text-zinc-500 tabular-nums">
						{searching ? "searching…" : null}
						{!searching && (
							<>
								{visible.length.toLocaleString()} of{" "}
								{allGames.length.toLocaleString()}
								{searchOrder !== null && (
									<span className="ml-1 text-zinc-600">· ranked by relevance</span>
								)}
							</>
						)}
					</span>
				)}
			</div>

			<div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
				{visible.map((g) => (
					<GameCard
						key={g.appid}
						game={g}
						installed={installed}
						onSelect={() => onSelect(g.appid)}
					/>
				))}
			</div>
		</div>
	);
}

function GameCard({
	game,
	installed,
	onSelect,
}: {
	game: LibraryGame;
	installed: InstalledIndex | null;
	onSelect: () => void;
}) {
	const isInstalledHere =
		installed !== null && installed.steam.includes(game.appid);
	const positivePct = ratingPct(game);
	const releaseYear =
		game.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
	const matchPct =
		game.score !== undefined && game.score !== null
			? Math.round(game.score * 100)
			: null;
	return (
		<button
			type="button"
			onClick={onSelect}
			className="group text-left rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-700 bg-zinc-900 transition-all"
		>
			<div className="relative">
				<GameImage
					appid={game.appid}
					name={game.name}
					variant="library_capsule"
					fallback={game.header_image}
					className="w-full aspect-[2/3] object-cover bg-zinc-900 group-hover:scale-[1.02] transition-transform"
				/>
				{isInstalledHere && (
					<span className="absolute top-2 left-2 text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-600 text-white shadow">
						Installed
					</span>
				)}
				{matchPct !== null ? (
					<span
						className="absolute top-2 right-2 text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-emerald-700/90 border border-emerald-600 text-white font-medium"
						title="Hybrid keyword + semantic-vector relevance score"
					>
						{matchPct}% match
					</span>
				) : releaseYear ? (
					<span className="absolute top-2 right-2 text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-zinc-950/80 border border-zinc-800 text-zinc-300">
						{releaseYear}
					</span>
				) : null}
			</div>
			<div className="p-2.5">
				<div className="text-xs font-medium text-zinc-100 line-clamp-2 leading-tight min-h-[2.25rem]">
					{game.name}
				</div>
				<div className="mt-1.5 flex items-center gap-2 text-[10px] text-zinc-500 tabular-nums flex-wrap">
					{game.hltb_main !== null && <span>{game.hltb_main}h main</span>}
					{positivePct !== null && <span>{positivePct}% positive</span>}
					{game.playtime_min > 0 && (
						<span>{Math.round(game.playtime_min / 60)}h played</span>
					)}
				</div>
			</div>
		</button>
	);
}

function ratingPct(game: {
	positive: number | null;
	negative: number | null;
}): number | null {
	if (game.positive === null) return null;
	const total = game.positive + (game.negative ?? 0);
	if (total === 0) return null;
	return Math.round((game.positive / total) * 100);
}
