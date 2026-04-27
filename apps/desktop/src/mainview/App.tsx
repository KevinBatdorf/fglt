import { useEffect, useState } from "react";
import { GameDetail } from "./GameDetail";
import { Home } from "./Home";
import { type LibraryGame, type Stats, api, steamImg } from "./lib/api";
import { rpc } from "./lib/rpc";
import type { InstalledIndex, Platform } from "../shared/types";

function App() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [installed, setInstalled] = useState<InstalledIndex | null>(null);
	const [query, setQuery] = useState("");
	const [platformFilter, setPlatformFilter] = useState<Platform | "">("");
	const [unplayedOnly, setUnplayedOnly] = useState(false);
	const [results, setResults] = useState<LibraryGame[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [selectedAppid, setSelectedAppid] = useState<number | null>(null);

	useEffect(() => {
		api.stats().then(setStats).catch((e) => setError(`Stats failed: ${e.message}`));
		rpc.request
			.getInstalledIndex({})
			.then(setInstalled)
			.catch((e) => console.error("getInstalledIndex failed:", e));
	}, []);

	useEffect(() => {
		const ctrl = new AbortController();
		const q = query.trim();
		if (q.length === 0 && !platformFilter && !unplayedOnly) {
			setResults([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		api
			.library(
				{
					q,
					platform: platformFilter || undefined,
					unplayed: unplayedOnly ? "1" : undefined,
					limit: 60,
				},
				ctrl.signal,
			)
			.then((d) => setResults(d.results))
			.catch((e) => {
				if (e.name !== "AbortError") setError(`Search failed: ${e.message}`);
			})
			.finally(() => setLoading(false));
		return () => ctrl.abort();
	}, [query, platformFilter, unplayedOnly]);

	const browsing = query.trim().length > 0 || platformFilter || unplayedOnly;

	return (
		<div className="min-h-screen bg-zinc-950 text-zinc-100">
			<header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
				<div className="px-6 py-4 flex items-center gap-4 flex-wrap">
					<button
						type="button"
						onClick={() => {
							setQuery("");
							setPlatformFilter("");
							setUnplayedOnly(false);
						}}
						className="text-xl font-bold tracking-tight hover:text-emerald-400 transition-colors"
					>
						SEG
					</button>
					<input
						type="text"
						placeholder="Search your library — vibe queries work too"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="flex-1 min-w-[260px] max-w-2xl bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-sm placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
					/>
					<FilterChips
						platform={platformFilter}
						setPlatform={setPlatformFilter}
						unplayed={unplayedOnly}
						setUnplayed={setUnplayedOnly}
						stats={stats}
					/>
				</div>
				{stats && <StatsBar stats={stats} installed={installed} />}
			</header>

			<main className="px-6 py-6">
				{error && (
					<div className="mb-4 p-3 rounded-lg border border-red-900 bg-red-950/40 text-red-300 text-sm">
						{error}
					</div>
				)}

				{!browsing ? (
					<Home
						installed={installed}
						onSelectGame={setSelectedAppid}
						onPickVibe={(q) => setQuery(q)}
					/>
				) : loading && results.length === 0 ? (
					<div className="text-zinc-500 text-sm">Searching…</div>
				) : results.length === 0 ? (
					<div className="text-zinc-500 text-sm">No matches.</div>
				) : (
					<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
						{results.map((g) => (
							<GameCard
								key={g.appid}
								game={g}
								installed={installed}
								onSelect={() => setSelectedAppid(g.appid)}
							/>
						))}
					</div>
				)}
			</main>

			{selectedAppid !== null && (
				<GameDetail
					appid={selectedAppid}
					installed={installed}
					onClose={() => setSelectedAppid(null)}
				/>
			)}
		</div>
	);
}

function FilterChips({
	platform,
	setPlatform,
	unplayed,
	setUnplayed,
	stats,
}: {
	platform: Platform | "";
	setPlatform: (p: Platform | "") => void;
	unplayed: boolean;
	setUnplayed: (v: boolean) => void;
	stats: Stats | null;
}) {
	const platforms: Platform[] = ["steam", "epic", "gog"];
	return (
		<div className="flex items-center gap-1.5 flex-wrap">
			{platforms.map((p) => {
				const active = platform === p;
				const count = stats?.platforms[p];
				return (
					<button
						type="button"
						key={p}
						onClick={() => setPlatform(active ? "" : p)}
						className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
							active
								? "bg-emerald-600 text-white"
								: "bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
						}`}
					>
						{p}
						{count !== undefined && (
							<span className="ml-1 text-[10px] opacity-70 tabular-nums">
								{count}
							</span>
						)}
					</button>
				);
			})}
			<button
				type="button"
				onClick={() => setUnplayed(!unplayed)}
				className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
					unplayed
						? "bg-emerald-600 text-white"
						: "bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
				}`}
			>
				unplayed
			</button>
		</div>
	);
}

function StatsBar({
	stats,
	installed,
}: {
	stats: Stats;
	installed: InstalledIndex | null;
}) {
	const installedTotal = installed
		? installed.steam.length + installed.epic.length + installed.gog.length
		: 0;
	return (
		<div className="px-6 pb-3 text-[11px] text-zinc-500 tabular-nums flex items-center gap-4 flex-wrap">
			<span>{stats.total.toLocaleString()} games</span>
			<span className="opacity-50">·</span>
			<span>{stats.unplayed.toLocaleString()} unplayed</span>
			<span className="opacity-50">·</span>
			<span>{stats.multi_platform} multi-platform</span>
			{installed && (
				<>
					<span className="opacity-50">·</span>
					<span>
						{installedTotal} installed (steam {installed.steam.length} · epic{" "}
						{installed.epic.length} · gog {installed.gog.length})
					</span>
				</>
			)}
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
		installed !== null &&
		game.platforms.some((p) => p === "steam" && installed.steam.includes(game.appid));
	const positivePct =
		game.positive && game.negative !== null
			? Math.round((game.positive / (game.positive + (game.negative ?? 0))) * 100)
			: null;
	return (
		<button
			type="button"
			onClick={onSelect}
			className="text-left rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-700 bg-zinc-900 transition-colors"
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
					className="w-full aspect-[2/3] object-cover bg-zinc-800"
				/>
				{isInstalledHere && (
					<span className="absolute top-2 left-2 text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-600 text-white shadow">
						Installed
					</span>
				)}
			</div>
			<div className="p-3">
				<div className="font-medium text-sm leading-tight mb-2 line-clamp-2 min-h-[2.5rem]">
					{game.name}
				</div>
				<div className="flex flex-wrap gap-1 mb-2">
					{game.platforms.map((p) => (
						<span
							key={p}
							className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300"
						>
							{p}
						</span>
					))}
				</div>
				<div className="flex items-center gap-3 text-[11px] text-zinc-500 tabular-nums">
					{game.hltb_main !== null && <span>{game.hltb_main}h main</span>}
					{positivePct !== null && <span>{positivePct}% pos</span>}
					{game.playtime_min > 0 && (
						<span>played {Math.round(game.playtime_min / 60)}h</span>
					)}
				</div>
			</div>
		</button>
	);
}

export default App;
