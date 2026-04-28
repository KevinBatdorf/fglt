import { useEffect, useState } from "react";
import { GameImage } from "./GameImage";
import { type CurateResponse, type LibraryGame, api } from "./lib/api";
import type { InstalledIndex } from "../shared/types";

interface Props {
	what: "trending" | "random" | "recommended";
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
}

const COPY: Record<Props["what"], { title: string; subtitle: string }> = {
	trending: {
		title: "Trending in your library",
		subtitle: "Sorted by peak concurrent users — what the world is playing now",
	},
	random: {
		title: "Random picks",
		subtitle: "A fresh draw from your unplayed pile",
	},
	recommended: {
		title: "Recommended for you",
		subtitle: "Vector-similar to your most-played games",
	},
};

export function Discover({ what, installed, onSelect }: Props) {
	const [data, setData] = useState<CurateResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reroll, setReroll] = useState(0);

	useEffect(() => {
		const ctrl = new AbortController();
		setData(null);
		api
			.curate(ctrl.signal)
			.then(setData)
			.catch((e) => {
				if (e.name !== "AbortError") setError(e.message);
			});
		return () => ctrl.abort();
	}, [reroll, what]);

	const games = pick(data, what);

	return (
		<div>
			<header className="mb-4 flex items-end justify-between gap-3 flex-wrap">
				<div>
					<h1 className="text-lg font-semibold">{COPY[what].title}</h1>
					<p className="text-xs text-zinc-500 mt-0.5">{COPY[what].subtitle}</p>
				</div>
				{what === "random" && data && (
					<button
						type="button"
						onClick={() => setReroll((n) => n + 1)}
						className="text-xs px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300"
					>
						Re-roll →
					</button>
				)}
			</header>

			{error && <div className="text-red-400 text-sm">{error}</div>}
			{!data && !error && (
				<div className="text-zinc-500 text-sm">Loading…</div>
			)}
			{data && games.length === 0 && (
				<div className="text-zinc-500 text-sm">Nothing to show yet.</div>
			)}
			{data && games.length > 0 && (
				<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
					{games.map((g) => (
						<Card
							key={g.appid}
							game={g}
							installed={installed}
							onSelect={() => onSelect(g.appid)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function pick(data: CurateResponse | null, what: Props["what"]): LibraryGame[] {
	if (!data) return [];
	if (what === "trending") return data.trending;
	if (what === "random") return data.picks_tonight;
	// recommended — blend obsession + recently + hidden_gems, dedup by appid
	const merged = [
		...(data.because_obsession?.recs ?? []),
		...(data.because_recently?.recs ?? []),
		...data.hidden_gems,
	];
	const seen = new Set<number>();
	const out: LibraryGame[] = [];
	for (const g of merged) {
		if (seen.has(g.appid)) continue;
		seen.add(g.appid);
		out.push(g);
	}
	return out;
}

function Card({
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
	const positivePct =
		game.positive && game.negative !== null
			? Math.round((game.positive / (game.positive + (game.negative ?? 0))) * 100)
			: null;
	const releaseYear =
		game.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
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
