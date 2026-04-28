import { useCallback, useEffect, useState } from "react";
import { AllGames } from "./AllGames";
import { GameDetail } from "./GameDetail";
import { Home } from "./Home";
import {
	type LibraryGame,
	type ListSummary,
	type Stats,
	api,
	steamImg,
} from "./lib/api";
import { rpc } from "./lib/rpc";
import { type View, Sidebar } from "./Sidebar";
import type { InstalledIndex, Platform } from "../shared/types";

const RECENT_KEY = "seg.recentSearches.v1";
const RECENT_MAX = 8;

function readRecent(): string[] {
	try {
		const raw = localStorage.getItem(RECENT_KEY);
		if (!raw) return [];
		return (JSON.parse(raw) as string[]).slice(0, RECENT_MAX);
	} catch {
		return [];
	}
}
function writeRecent(items: string[]) {
	try {
		localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, RECENT_MAX)));
	} catch {
		/* ignore */
	}
}

function App() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [installed, setInstalled] = useState<InstalledIndex | null>(null);
	const [view, setView] = useState<View>({ kind: "home" });
	const [history, setHistory] = useState<View[]>([]);
	const [query, setQuery] = useState("");
	const [recent, setRecent] = useState<string[]>(readRecent);

	useEffect(() => {
		api.stats().then(setStats).catch(console.error);
		rpc.request.getInstalledIndex({}).then(setInstalled).catch(console.error);
	}, []);

	const navigate = useCallback(
		(next: View) => {
			setHistory((h) => [...h, view]);
			setView(next);
			if (next.kind === "search") setQuery(next.query);
			else if (next.kind !== "search") setQuery("");
		},
		[view],
	);

	const back = useCallback(() => {
		setHistory((h) => {
			if (h.length === 0) return h;
			const prev = h[h.length - 1];
			setView(prev);
			if (prev.kind === "search") setQuery(prev.query);
			else setQuery("");
			return h.slice(0, -1);
		});
	}, []);

	const home = useCallback(() => {
		setHistory([]);
		setView({ kind: "home" });
		setQuery("");
	}, []);

	const open = useCallback((appid: number) => {
		navigate({ kind: "detail", appid });
	}, [navigate]);

	// Search box typing → switch view to search (without polluting history each
	// keystroke). Empty query → home.
	useEffect(() => {
		const q = query.trim();
		if (q.length === 0) {
			if (view.kind === "search") setView({ kind: "home" });
			return;
		}
		if (view.kind !== "search" || view.query !== q) {
			// Replace, don't push, while typing
			setView({ kind: "search", query: q });
		}
	}, [query, view]);

	// Settle search into recents
	useEffect(() => {
		if (view.kind !== "search") return;
		const q = view.query;
		const t = setTimeout(() => {
			setRecent((cur) => {
				const filtered = cur.filter((s) => s !== q);
				const next = [q, ...filtered].slice(0, RECENT_MAX);
				writeRecent(next);
				return next;
			});
		}, 1500);
		return () => clearTimeout(t);
	}, [view]);

	// Keyboard: Alt+Left or Backspace = back; Escape = home (when not editing).
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			const editing =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target?.isContentEditable;
			if (e.altKey && e.key === "ArrowLeft") {
				e.preventDefault();
				back();
				return;
			}
			if (e.key === "Backspace" && !editing) {
				e.preventDefault();
				back();
				return;
			}
			if (e.key === "Escape" && !editing) {
				home();
				return;
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [back, home]);

	const platformCounts = stats?.platforms ?? {};

	return (
		<div className="min-h-screen bg-zinc-950 text-zinc-100 flex">
			<Sidebar
				view={view}
				onNavigate={(v) => {
					if (v.kind === view.kind && JSON.stringify(v) === JSON.stringify(view)) {
						return;
					}
					navigate(v);
				}}
				recentSearches={recent}
				onClearRecent={() => {
					setRecent([]);
					writeRecent([]);
				}}
				platformCounts={platformCounts}
			/>

			<div className="flex-1 min-w-0 flex flex-col">
				<header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
					<div className="px-6 py-3.5 flex items-center gap-4">
						<input
							type="text"
							placeholder="Search your library — vibe queries work too"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							className="flex-1 max-w-2xl bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-sm placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
						/>
					</div>
					{stats && <StatsBar stats={stats} installed={installed} />}
				</header>

				<main className="flex-1 px-6 py-6">
					<MainView
						view={view}
						installed={installed}
						onSelectGame={open}
						onPickVibe={(q) => {
							setQuery(q);
							navigate({ kind: "search", query: q });
						}}
						onBack={back}
						onHome={home}
						canBack={history.length > 0}
					/>
				</main>
			</div>
		</div>
	);
}

function MainView({
	view,
	installed,
	onSelectGame,
	onPickVibe,
	onBack,
	onHome,
	canBack,
}: {
	view: View;
	installed: InstalledIndex | null;
	onSelectGame: (appid: number) => void;
	onPickVibe: (q: string) => void;
	onBack: () => void;
	onHome: () => void;
	canBack: boolean;
}) {
	if (view.kind === "home")
		return (
			<Home installed={installed} onSelectGame={onSelectGame} onPickVibe={onPickVibe} />
		);
	if (view.kind === "detail")
		return (
			<GameDetail
				appid={view.appid}
				installed={installed}
				canBack={canBack}
				onBack={onBack}
				onHome={onHome}
				onNavigate={onSelectGame}
			/>
		);
	if (view.kind === "search")
		return (
			<SearchResults
				query={view.query}
				installed={installed}
				onSelect={onSelectGame}
			/>
		);
	if (view.kind === "filter") {
		if (view.what === "all")
			return (
				<AllGames
					platformFilter={null}
					installed={installed}
					onSelect={onSelectGame}
				/>
			);
		return (
			<FilterView
				what={view.what}
				installed={installed}
				onSelect={onSelectGame}
			/>
		);
	}
	if (view.kind === "platform")
		return (
			<AllGames
				platformFilter={view.platform}
				installed={installed}
				onSelect={onSelectGame}
			/>
		);
	if (view.kind === "list")
		return (
			<ListView slug={view.slug} installed={installed} onSelect={onSelectGame} />
		);
	return null;
}

function SearchResults({
	query,
	installed,
	onSelect,
}: {
	query: string;
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
}) {
	const [results, setResults] = useState<LibraryGame[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const ctrl = new AbortController();
		setLoading(true);
		setError(null);
		api
			.library({ q: query, limit: 90 }, ctrl.signal)
			.then((d) => setResults(d.results))
			.catch((e) => {
				if (e.name !== "AbortError") setError(e.message);
			})
			.finally(() => setLoading(false));
		return () => ctrl.abort();
	}, [query]);

	if (error) return <div className="text-red-400 text-sm">{error}</div>;
	if (loading && results.length === 0)
		return <div className="text-zinc-500 text-sm">Searching…</div>;
	if (results.length === 0)
		return <div className="text-zinc-500 text-sm">No matches.</div>;

	return (
		<div>
			<h1 className="text-lg font-semibold mb-4">
				{results.length} {results.length === 1 ? "result" : "results"} for{" "}
				<span className="text-zinc-300">"{query}"</span>
			</h1>
			<GameGrid games={results} installed={installed} onSelect={onSelect} />
		</div>
	);
}

function FilterView({
	what,
	installed,
	onSelect,
}: {
	what: "unplayed" | "recent";
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
}) {
	const [results, setResults] = useState<LibraryGame[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		const ctrl = new AbortController();
		setLoading(true);
		const params: Record<string, string | number | undefined> = { limit: 200 };
		if (what === "unplayed") params.unplayed = "1";
		if (what === "recent") params.min_playtime = 1;
		api
			.library(params, ctrl.signal)
			.then((d) => {
				let rows = d.results;
				if (what === "recent") {
					rows = [...rows].sort(
						(a, b) => (b.playtime_2wk ?? 0) - (a.playtime_2wk ?? 0),
					);
				}
				setResults(rows);
			})
			.catch(console.error)
			.finally(() => setLoading(false));
		return () => ctrl.abort();
	}, [what]);

	const title = what === "unplayed" ? "Unplayed" : "Recently played";
	const subtitle =
		what === "unplayed"
			? "Games you have never started"
			: "Sorted by 2-week playtime";

	if (loading && results.length === 0)
		return <div className="text-zinc-500 text-sm">Loading…</div>;

	return (
		<div>
			<header className="mb-4">
				<h1 className="text-lg font-semibold">{title}</h1>
				<p className="text-xs text-zinc-500">
					{subtitle} · {results.length} games
				</p>
			</header>
			<GameGrid games={results} installed={installed} onSelect={onSelect} />
		</div>
	);
}

function ListView({
	slug,
	installed,
	onSelect,
}: {
	slug: string;
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
}) {
	const [list, setList] = useState<(ListSummary & { games: LibraryGame[] }) | null>(
		null,
	);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const ctrl = new AbortController();
		setLoading(true);
		setError(null);
		api
			.listGames(slug, ctrl.signal)
			.then(setList)
			.catch((e) => {
				if (e.name !== "AbortError") setError(e.message);
			})
			.finally(() => setLoading(false));
		return () => ctrl.abort();
	}, [slug]);

	if (loading && !list)
		return <div className="text-zinc-500 text-sm">Loading…</div>;
	if (error) return <div className="text-red-400 text-sm">{error}</div>;
	if (!list) return null;

	return (
		<div>
			<header className="mb-4">
				<h1 className="text-lg font-semibold flex items-center gap-2">
					{list.emoji && <span>{list.emoji}</span>}
					{list.name}
				</h1>
				<p className="text-xs text-zinc-500">
					{list.games.length} {list.games.length === 1 ? "game" : "games"}
				</p>
			</header>
			{list.games.length === 0 ? (
				<div className="text-zinc-500 text-sm">
					Nothing here yet. Open a game and add it from the detail panel.
				</div>
			) : (
				<GameGrid games={list.games} installed={installed} onSelect={onSelect} />
			)}
		</div>
	);
}

function GameGrid({
	games,
	installed,
	onSelect,
}: {
	games: LibraryGame[];
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
}) {
	return (
		<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
			{games.map((g) => (
				<GameCard
					key={g.appid}
					game={g}
					installed={installed}
					onSelect={() => onSelect(g.appid)}
				/>
			))}
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
		<div className="px-6 pb-2.5 text-[11px] text-zinc-500 tabular-nums flex items-center gap-3 flex-wrap">
			<span>{stats.total.toLocaleString()} games</span>
			<span className="opacity-50">·</span>
			<span>{stats.unplayed.toLocaleString()} unplayed</span>
			<span className="opacity-50">·</span>
			<span>{stats.multi_platform} multi-platform</span>
			{installed && (
				<>
					<span className="opacity-50">·</span>
					<span>{installedTotal} installed</span>
				</>
			)}
		</div>
	);
}

export default App;
