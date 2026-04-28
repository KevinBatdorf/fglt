import { useEffect, useMemo, useState } from "react";
import { type LibraryGame, api, steamImg } from "./lib/api";
import type { InstalledIndex, Platform } from "../shared/types";

type SortKey = "name" | "playtime" | "recent" | "year" | "rating";

interface Props {
	platformFilter: Platform | null;
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
}

export function AllGames({ platformFilter, installed, onSelect }: Props) {
	const [allGames, setAllGames] = useState<LibraryGame[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [sort, setSort] = useState<SortKey>("name");
	const [genre, setGenre] = useState<string>("");
	const [filter, setFilter] = useState("");

	useEffect(() => {
		const ctrl = new AbortController();
		setAllGames(null);
		api
			.library(
				{
					platform: platformFilter ?? undefined,
					limit: 5000,
					sort: "name",
				},
				ctrl.signal,
			)
			.then((d) => setAllGames(d.results))
			.catch((e) => {
				if (e.name !== "AbortError") setError(e.message);
			});
		return () => ctrl.abort();
	}, [platformFilter]);

	const allGenres = useMemo(() => {
		if (!allGames) return [] as string[];
		const set = new Set<string>();
		for (const g of allGames) {
			if (g.genres) for (const x of g.genres) set.add(x);
		}
		return [...set].sort();
	}, [allGames]);

	const visible = useMemo(() => {
		if (!allGames) return [] as LibraryGame[];
		const f = filter.trim().toLowerCase();
		let out = allGames.filter((g) => {
			if (genre && !(g.genres ?? []).includes(genre)) return false;
			if (f && !g.name.toLowerCase().includes(f)) return false;
			return true;
		});
		out = [...out].sort((a, b) => {
			switch (sort) {
				case "name":
					return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
				case "playtime":
					return (b.playtime_min ?? 0) - (a.playtime_min ?? 0);
				case "recent":
					return (
						new Date(b.last_played ?? 0).getTime() -
						new Date(a.last_played ?? 0).getTime()
					);
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
	}, [allGames, sort, genre, filter]);

	if (error) return <div className="text-red-400 text-sm">{error}</div>;
	if (!allGames)
		return <div className="text-zinc-500 text-sm">Loading library…</div>;

	return (
		<div>
			<header className="mb-4 flex flex-wrap items-center gap-3">
				<h1 className="text-lg font-semibold mr-3">
					{platformFilter
						? `${platformLabel(platformFilter)} library`
						: "All games"}
				</h1>
				<input
					type="text"
					value={filter}
					onChange={(e) => setFilter(e.target.value)}
					placeholder="Filter within this list…"
					className="bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-sm placeholder-zinc-500 focus:border-zinc-600 focus:outline-none w-56"
				/>
				<select
					value={genre}
					onChange={(e) => setGenre(e.target.value)}
					className="bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
				>
					<option value="">All genres</option>
					{allGenres.map((g) => (
						<option key={g} value={g}>
							{g}
						</option>
					))}
				</select>
				<select
					value={sort}
					onChange={(e) => setSort(e.target.value as SortKey)}
					className="bg-zinc-900 border border-zinc-800 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
				>
					<option value="name">Sort: A–Z</option>
					<option value="playtime">Sort: Most played</option>
					<option value="recent">Sort: Recently played</option>
					<option value="year">Sort: Newest first</option>
					<option value="rating">Sort: Highest rated</option>
				</select>
				<span className="ml-auto text-xs text-zinc-500 tabular-nums">
					{visible.length.toLocaleString()} of {allGames.length.toLocaleString()}
				</span>
			</header>

			<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
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
	return (
		<button
			type="button"
			onClick={onSelect}
			className="group text-left rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-700 bg-zinc-900 transition-all"
		>
			<div className="relative">
				<img
					src={steamImg(game.appid, "library_capsule")}
					alt={game.name}
					loading="lazy"
					onError={(e) => {
						if (game.header_image && e.currentTarget.src !== game.header_image) {
							e.currentTarget.src = game.header_image;
						}
					}}
					className="w-full aspect-[2/3] object-cover bg-zinc-800 group-hover:scale-[1.02] transition-transform"
				/>
				{isInstalledHere && (
					<span className="absolute top-2 left-2 text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-600 text-white shadow">
						Installed
					</span>
				)}
				{releaseYear && (
					<span className="absolute top-2 right-2 text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-zinc-950/80 border border-zinc-800 text-zinc-300">
						{releaseYear}
					</span>
				)}
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

function platformLabel(p: Platform): string {
	if (p === "steam") return "Steam";
	if (p === "epic") return "Epic Games";
	if (p === "gog") return "GOG";
	return p;
}
