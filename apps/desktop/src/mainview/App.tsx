import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AllGames } from "./AllGames";
import { Discover } from "./Discover";
import { GameDetail } from "./GameDetail";
import { GameImage } from "./GameImage";
import { Home } from "./Home";
import { Settings } from "./Settings";
import {
	type LibraryGame,
	type ListSummary,
	type Stats,
	api,
} from "./lib/api";
import { rpc } from "./lib/rpc";
import { type View, Sidebar } from "./Sidebar";
import { VIBES } from "./lib/vibes";
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
	const mainRef = useRef<HTMLElement>(null);

	// Reset scroll on every view change so search results / list switches
	// don't leave the user mid-page.
	useEffect(() => {
		mainRef.current?.scrollTo({ top: 0, behavior: "auto" });
	}, [view]);

	const refreshStats = useCallback(() => {
		api.stats().then(setStats).catch(console.error);
	}, []);

	useEffect(() => {
		refreshStats();
		rpc.request.getInstalledIndex({}).then(setInstalled).catch(console.error);
	}, [refreshStats]);

	const navigate = useCallback(
		(next: View) => {
			setHistory((h) => [...h, view]);
			setView(next);
			if (next.kind === "search") setQuery(next.query);
			else setQuery("");
		},
		[view],
	);

	// Random in the sidebar opens ONE random game's detail. Re-clicking
	// Random re-rolls. We bypass the Discover view entirely.
	const handleSidebarNavigate = useCallback(
		async (next: View) => {
			if (next.kind === "discover" && next.what === "random") {
				try {
					const game = await api.random({ unplayed: "1" });
					navigate({ kind: "detail", appid: game.appid });
				} catch (e) {
					console.error("random fetch failed", e);
				}
				return;
			}
			if (
				next.kind === view.kind &&
				JSON.stringify(next) === JSON.stringify(view)
			) {
				return;
			}
			navigate(next);
		},
		[navigate, view],
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

	const open = useCallback(
		(appid: number) => {
			navigate({ kind: "detail", appid });
		},
		[navigate],
	);

	useEffect(() => {
		const q = query.trim();
		if (q.length === 0) {
			if (view.kind === "search") setView({ kind: "home" });
			return;
		}
		if (view.kind !== "search" || view.query !== q) {
			setView({ kind: "search", query: q });
		}
	}, [query, view]);

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

	return (
		<div className="min-h-screen bg-zinc-950 text-zinc-100 flex">
			<Sidebar
				view={view}
				onNavigate={handleSidebarNavigate}
				recentSearches={recent}
				onClearRecent={() => {
					setRecent([]);
					writeRecent([]);
				}}
				platformCounts={stats?.platforms ?? {}}
			/>

			<div className="flex-1 min-w-0 flex flex-col">
				<header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
					<div className="px-6 py-3.5">
						<input
							type="text"
							placeholder="Search your library — vibe queries work too"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							className="w-full max-w-3xl bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-sm placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
						/>
					</div>
					<VibeRow
						onPick={(q) => {
							setQuery(q);
							navigate({ kind: "search", query: q });
						}}
					/>
				</header>

				<main ref={mainRef} className="flex-1 px-6 py-6 overflow-y-auto">
					<MainView
						view={view}
						stats={stats}
						installed={installed}
						onSelectGame={open}
						onPickVibe={(q) => {
							setQuery(q);
							navigate({ kind: "search", query: q });
						}}
						onBack={back}
						onHome={home}
						canBack={history.length > 0}
						refreshStats={refreshStats}
					/>
				</main>
			</div>
		</div>
	);
}

function VibeRow({ onPick }: { onPick: (query: string) => void }) {
	return (
		<div className="px-6 pb-3 flex flex-wrap gap-1.5">
			{VIBES.map((v) => (
				<button
					type="button"
					key={v.label}
					onClick={() => onPick(v.query)}
					className="text-[11px] px-2.5 py-1 rounded-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
				>
					<span className="mr-1">{v.emoji}</span>
					{v.label}
				</button>
			))}
		</div>
	);
}

function MainView({
	view,
	stats,
	installed,
	onSelectGame,
	onPickVibe,
	onBack,
	onHome,
	canBack,
	refreshStats,
}: {
	view: View;
	stats: Stats | null;
	installed: InstalledIndex | null;
	onSelectGame: (appid: number) => void;
	onPickVibe: (q: string) => void;
	onBack: () => void;
	onHome: () => void;
	canBack: boolean;
	refreshStats: () => void;
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
		return (
			<AllGames
				platformFilter={null}
				preset={view.what}
				installed={installed}
				onSelect={onSelectGame}
			/>
		);
	}
	if (view.kind === "discover")
		return (
			<Discover what={view.what} installed={installed} onSelect={onSelectGame} />
		);
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
	if (view.kind === "settings")
		return <Settings stats={stats} onStatsRefresh={refreshStats} />;
	return null;
}

type SearchSort = "match" | "rating" | "popularity" | "playtime" | "year" | "name";

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
	const [sort, setSort] = useState<SearchSort>("match");
	const [genre, setGenre] = useState<string>("");
	const [tag, setTag] = useState<string>("");
	const [allTags, setAllTags] = useState<{ tag: string; games: number }[]>([]);

	useEffect(() => {
		api.tags().then((d) => setAllTags(d.tags)).catch(console.warn);
	}, []);

	useEffect(() => {
		const ctrl = new AbortController();
		setLoading(true);
		setError(null);
		const params: Record<string, string | number | undefined> = {
			q: query,
			limit: 500,
		};
		if (tag) params.tag = tag;
		api
			.library(params, ctrl.signal)
			.then((d) => setResults(d.results))
			.catch((e) => {
				if (e.name !== "AbortError") setError(e.message);
			})
			.finally(() => setLoading(false));
		return () => ctrl.abort();
	}, [query, tag]);

	const allGenres = useMemo(() => {
		const set = new Set<string>();
		for (const g of results) {
			if (g.genres) for (const x of g.genres) set.add(x);
		}
		return [...set].sort();
	}, [results]);

	const visible = useMemo(() => {
		let out = results;
		if (genre) out = out.filter((g) => (g.genres ?? []).includes(genre));
		if (sort === "match") return out;
		const sorted = [...out];
		sorted.sort((a, b) => {
			switch (sort) {
				case "rating": {
					const ra = ratingPct(a) ?? -1;
					const rb = ratingPct(b) ?? -1;
					return rb - ra;
				}
				case "popularity":
					return (b.positive ?? 0) - (a.positive ?? 0);
				case "playtime":
					return (b.playtime_min ?? 0) - (a.playtime_min ?? 0);
				case "year": {
					const ya = Number(a.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? 0);
					const yb = Number(b.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? 0);
					return yb - ya;
				}
				case "name":
					return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
				default:
					return 0;
			}
		});
		return sorted;
	}, [results, sort, genre]);

	if (error) return <div className="text-red-400 text-sm">{error}</div>;
	if (loading && results.length === 0)
		return <div className="text-zinc-500 text-sm">Searching…</div>;
	if (results.length === 0 && !loading)
		return <div className="text-zinc-500 text-sm">No matches.</div>;

	return (
		<div>
			<header className="mb-3">
				<h1 className="text-lg font-semibold">
					{visible.length} {visible.length === 1 ? "result" : "results"} for{" "}
					<span className="text-zinc-300">"{query}"</span>
				</h1>
				<p className="text-xs text-zinc-500 mt-0.5">
					{sort === "match"
						? "Ranked by hybrid keyword + semantic relevance"
						: `Showing ${visible.length} of ${results.length} sorted by ${sort}`}
				</p>
			</header>
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<select
					value={genre}
					onChange={(e) => setGenre(e.target.value)}
					className="bg-zinc-900 border border-zinc-800 rounded-md pl-2 pr-7 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
				>
					<option value="">All genres</option>
					{allGenres.map((g) => (
						<option key={g} value={g}>
							{g}
						</option>
					))}
				</select>
				<select
					value={tag}
					onChange={(e) => setTag(e.target.value)}
					className="bg-zinc-900 border border-zinc-800 rounded-md pl-2 pr-7 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
				>
					<option value="">All tags</option>
					{allTags.map((t) => (
						<option key={t.tag} value={t.tag}>
							{t.tag} ({t.games})
						</option>
					))}
				</select>
				<select
					value={sort}
					onChange={(e) => setSort(e.target.value as SearchSort)}
					className="bg-zinc-900 border border-zinc-800 rounded-md pl-2 pr-7 py-1.5 text-sm focus:outline-none focus:border-zinc-600"
				>
					<option value="match">Sort: Match</option>
					<option value="rating">Sort: Highest rated</option>
					<option value="popularity">Sort: Most popular</option>
					<option value="playtime">Sort: Most played</option>
					<option value="year">Sort: Newest first</option>
					<option value="name">Sort: A–Z</option>
				</select>
			</div>
			<GameGrid games={visible} installed={installed} onSelect={onSelect} />
		</div>
	);
}

function ratingPct(g: { positive: number | null; negative: number | null }): number | null {
	if (g.positive === null) return null;
	const total = g.positive + (g.negative ?? 0);
	if (total === 0) return null;
	return Math.round((g.positive / total) * 100);
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

export default App;
