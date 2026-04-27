import { useEffect, useState } from "react";

const API_BASE = "http://localhost:3110";

interface Stats {
	total: number;
	enriched: number;
	embedded: number;
	played: number;
	unplayed: number;
	platforms: Record<string, number>;
	multi_platform: number;
}

interface Game {
	appid: number;
	name: string;
	header_image: string | null;
	short_desc: string | null;
	playtime_min: number;
	hltb_main: number | null;
	metacritic: number | null;
	positive: number | null;
	negative: number | null;
	platforms: string[];
}

function App() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<Game[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		fetch(`${API_BASE}/stats`)
			.then((r) => r.json())
			.then(setStats)
			.catch((e) => setError(`Stats failed: ${e.message}`));
	}, []);

	useEffect(() => {
		const ctrl = new AbortController();
		const q = query.trim();
		if (q.length === 0) {
			setResults([]);
			return;
		}
		setLoading(true);
		const url = new URL(`${API_BASE}/library`);
		url.searchParams.set("q", q);
		url.searchParams.set("limit", "30");
		fetch(url, { signal: ctrl.signal })
			.then((r) => r.json())
			.then((d) => setResults(d.results ?? []))
			.catch((e) => {
				if (e.name !== "AbortError") setError(`Search failed: ${e.message}`);
			})
			.finally(() => setLoading(false));
		return () => ctrl.abort();
	}, [query]);

	return (
		<div className="min-h-screen bg-zinc-950 text-zinc-100">
			<header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
				<div className="px-6 py-4 flex items-center gap-4">
					<div className="text-xl font-bold tracking-tight">SEG</div>
					<input
						type="text"
						placeholder="Search your library — vibe queries work too"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="flex-1 max-w-2xl bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-sm placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
					/>
					{stats && (
						<div className="text-xs text-zinc-400 tabular-nums">
							{stats.total.toLocaleString()} games
							{stats.platforms && (
								<span className="ml-3">
									{Object.entries(stats.platforms)
										.map(([k, v]) => `${k}:${v}`)
										.join(" · ")}
								</span>
							)}
						</div>
					)}
				</div>
			</header>

			<main className="px-6 py-6">
				{error && (
					<div className="mb-4 p-3 rounded-lg border border-red-900 bg-red-950/40 text-red-300 text-sm">
						{error}
					</div>
				)}

				{query.trim().length === 0 ? (
					<EmptyHero stats={stats} />
				) : loading ? (
					<div className="text-zinc-500 text-sm">Searching…</div>
				) : results.length === 0 ? (
					<div className="text-zinc-500 text-sm">No matches.</div>
				) : (
					<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
						{results.map((g) => (
							<GameCard key={g.appid} game={g} />
						))}
					</div>
				)}
			</main>
		</div>
	);
}

function EmptyHero({ stats }: { stats: Stats | null }) {
	if (!stats) {
		return <div className="text-zinc-500 text-sm">Connecting to API…</div>;
	}
	return (
		<div className="max-w-3xl mx-auto pt-12">
			<h1 className="text-3xl font-bold mb-2">Your library</h1>
			<p className="text-zinc-400 mb-8">
				{stats.total.toLocaleString()} games across{" "}
				{Object.keys(stats.platforms).length} storefronts ·{" "}
				{stats.unplayed.toLocaleString()} unplayed ·{" "}
				{stats.multi_platform} owned on multiple stores
			</p>
			<p className="text-sm text-zinc-500">
				Try searching: <span className="font-mono text-zinc-300">indie first person horror</span>{" "}
				· <span className="font-mono text-zinc-300">cozy puzzle with story</span>{" "}
				· <span className="font-mono text-zinc-300">cyberpunk dystopia</span>
			</p>
		</div>
	);
}

function GameCard({ game }: { game: Game }) {
	const positivePct =
		game.positive && game.negative !== null
			? Math.round((game.positive / (game.positive + (game.negative ?? 0))) * 100)
			: null;
	return (
		<div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900 hover:border-zinc-700 transition-colors">
			{game.header_image ? (
				<img
					src={game.header_image}
					alt={game.name}
					className="w-full aspect-[460/215] object-cover"
				/>
			) : (
				<div className="w-full aspect-[460/215] bg-zinc-800" />
			)}
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
		</div>
	);
}

export default App;
