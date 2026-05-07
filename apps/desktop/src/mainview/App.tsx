import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DockerStatus, InstalledIndex } from '../shared/types';
import { AllGames } from './AllGames';
import { Discover } from './Discover';
import { GameDetail } from './GameDetail';
import { GameGrid } from './GameGrid';
import { HealthBanner } from './HealthBanner';
import { Home } from './Home';
import { LoadingState } from './LoadingState';
import {
	api,
	type HealthStatus,
	type LibraryGame,
	type ListSummary,
	notifyListsChanged,
	type SavedSearchSummary,
	type Stats,
} from './lib/api';
import {
	clearRecentlyViewed,
	getRecentlyViewed,
	getVibesCount,
	getVibesEnabled,
	type RecentlyViewedEntry,
	removeFromRecentlyViewed,
} from './lib/prefs';
import { rpc } from './lib/rpc';
import { VIBES } from './lib/vibes';
import { ResizeEdges } from './ResizeEdges';
import { Select } from './Select';
import { Settings } from './Settings';
import { SetupGuide } from './SetupGuide';
import { Sidebar, type View } from './Sidebar';
import { TitleBar } from './TitleBar';

const RECENT_KEY = 'fglt.recentSearches.v1';
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
		localStorage.setItem(
			RECENT_KEY,
			JSON.stringify(items.slice(0, RECENT_MAX)),
		);
	} catch {
		/* ignore */
	}
}

function App() {
	const [stats, setStats] = useState<Stats | null>(null);
	const [installed, setInstalled] = useState<InstalledIndex | null>(null);
	const [view, setView] = useState<View>({ kind: 'home' });
	const [history, setHistory] = useState<View[]>([]);
	const [query, setQuery] = useState('');
	const [recent, setRecent] = useState<string[]>(readRecent);
	const [lists, setLists] = useState<ListSummary[]>([]);
	const [detailGameName, setDetailGameName] = useState<string | null>(null);
	const [vibesRefreshing, setVibesRefreshing] = useState(false);
	// Lockout state — lifted out of HealthBanner so the Sidebar + Settings
	// can both react to it. `locked` collapses three cases into one prop:
	//   1. required keys (STEAM_API_KEY, STEAM_ID) aren't set
	//   2. the API itself is unreachable
	//   3. the Docker stack isn't fully `running` (covers: not_installed,
	//      daemon_down, containers_missing/stopped, starting)
	// In any of those, the user can't usefully click anything except
	// Settings and Setup Guide, so the rest of the sidebar is dimmed.
	const [health, setHealth] = useState<HealthStatus | null>(null);
	const [apiReachable, setApiReachable] = useState(true);
	const [docker, setDocker] = useState<DockerStatus | null>(null);
	const requiredMissing = health?.required_missing ?? [];
	const dockerLocked = docker !== null && docker.kind !== 'running';
	const locked = !apiReachable || requiredMissing.length > 0 || dockerLocked;
	const mainRef = useRef<HTMLElement>(null);

	// Reset scroll on every view change so search results / list switches
	// don't leave the user mid-page.
	useEffect(() => {
		mainRef.current?.scrollTo({ top: 0, behavior: 'auto' });
	}, [view]);

	const refreshStats = useCallback(() => {
		api.stats().then(setStats).catch(console.error);
	}, []);

	useEffect(() => {
		refreshStats();
		rpc.request.getInstalledIndex({}).then(setInstalled).catch(console.error);
		api
			.lists()
			.then((d) => setLists(d.lists))
			.catch(console.error);
	}, [refreshStats]);

	// Poll /health every 30s + on every `fglt:config:changed` event so a Save
	// in Settings releases the lockout instantly instead of after the next
	// scheduled poll. We also reach for it on mount so the very first paint
	// already knows whether to lock.
	useEffect(() => {
		let cancelled = false;
		const poll = async () => {
			try {
				const h = await api.health();
				if (cancelled) return;
				setHealth(h);
				setApiReachable(true);
				// API is up — we don't need to keep polling docker for state.
				// HealthBanner relies on /health for db_down / missing-keys
				// from here on; setting docker to a synthetic running state
				// keeps the lockout derivation simple.
				setDocker({ kind: 'running' });
			} catch {
				if (cancelled) return;
				setApiReachable(false);
				setHealth(null);
			}
		};
		void poll();
		const t = setInterval(() => void poll(), 30_000);
		const onConfigChanged = () => void poll();
		window.addEventListener('fglt:config:changed', onConfigChanged);
		return () => {
			cancelled = true;
			clearInterval(t);
			window.removeEventListener('fglt:config:changed', onConfigChanged);
		};
	}, []);

	// Poll the bun side for Docker state on a faster cadence (3s) whenever
	// the API isn't reachable. Stops as soon as the API responds — once
	// the stack is up, /health is the source of truth and dockerStatus is
	// expensive (each call shells out to `docker ps`). The startup
	// auto-start fires from the bun side, so this poll is mostly a UX
	// progress signal: spinner during `starting`, install/start prompts
	// during the other states.
	useEffect(() => {
		if (apiReachable) return;
		let cancelled = false;
		const tick = async () => {
			try {
				const s = await rpc.request.dockerStatus({});
				if (!cancelled) setDocker(s);
			} catch {
				/* RPC unavailable in browser stub; leave docker as-is */
			}
		};
		void tick();
		const t = setInterval(() => void tick(), 3_000);
		return () => {
			cancelled = true;
			clearInterval(t);
		};
	}, [apiReachable]);

	// While locked, force the user onto Settings (or let them stay on
	// SetupGuide if that's where they navigated to). Detail / search /
	// list views all get dropped — the sidebar nav is dimmed too so this
	// shouldn't surprise the user mid-flow.
	useEffect(() => {
		if (!locked) return;
		if (view.kind === 'settings' || view.kind === 'setup_guide') return;
		setView({ kind: 'settings' });
		setHistory([]);
		setQuery('');
	}, [locked, view]);

	// Reset the resolved detail-page game name whenever we leave detail.
	useEffect(() => {
		if (view.kind !== 'detail') setDetailGameName(null);
	}, [view]);

	const navigate = useCallback(
		(next: View) => {
			setHistory((h) => [...h, view]);
			setView(next);
			if (next.kind === 'search') setQuery(next.query);
			else setQuery('');
		},
		[view],
	);

	// Random in the sidebar opens ONE random game's detail. Re-clicking
	// Random re-rolls. We bypass the Discover view entirely.
	const handleSidebarNavigate = useCallback(
		async (next: View) => {
			if (next.kind === 'discover' && next.what === 'random') {
				try {
					const game = await api.random({ unplayed: '1' });
					navigate({ kind: 'detail', appid: game.appid });
				} catch (e) {
					console.error('random fetch failed', e);
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
			if (prev.kind === 'search') setQuery(prev.query);
			else setQuery('');
			return h.slice(0, -1);
		});
	}, []);

	const home = useCallback(() => {
		setHistory([]);
		setView({ kind: 'home' });
		setQuery('');
	}, []);

	const open = useCallback(
		(appid: number) => {
			navigate({ kind: 'detail', appid });
		},
		[navigate],
	);

	useEffect(() => {
		const q = query.trim();
		if (q.length === 0) {
			if (view.kind === 'search') setView({ kind: 'home' });
			return;
		}
		if (view.kind !== 'search' || view.query !== q) {
			setView({ kind: 'search', query: q });
		}
	}, [query, view]);

	useEffect(() => {
		if (view.kind !== 'search') return;
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
			if (e.altKey && e.key === 'ArrowLeft') {
				e.preventDefault();
				back();
				return;
			}
			if (e.key === 'Backspace' && !editing) {
				e.preventDefault();
				back();
				return;
			}
			if (e.key === 'Escape' && !editing) {
				home();
				return;
			}
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [back, home]);

	// Mouse XButton1 (back) navigates history. XButton2 (forward) is intentionally
	// unwired — we don't keep a forward stack.
	useEffect(() => {
		const handler = (e: MouseEvent) => {
			if (e.button === 3) {
				e.preventDefault();
				back();
			}
		};
		window.addEventListener('mousedown', handler);
		// Some browsers/OSes only expose side buttons via auxclick.
		window.addEventListener('auxclick', handler);
		return () => {
			window.removeEventListener('mousedown', handler);
			window.removeEventListener('auxclick', handler);
		};
	}, [back]);

	// Suppress the default browser context menu app-wide. Components that
	// want a custom right-click menu (e.g. Sidebar list items) opt in by
	// stopping propagation on their own contextmenu handler.
	useEffect(() => {
		const handler = (e: MouseEvent) => e.preventDefault();
		window.addEventListener('contextmenu', handler);
		return () => window.removeEventListener('contextmenu', handler);
	}, []);

	const showHeader =
		view.kind !== 'detail' &&
		view.kind !== 'settings' &&
		view.kind !== 'setup_guide';

	return (
		<div className="relative h-screen bg-zinc-950 text-zinc-100 flex flex-col border border-zinc-700">
			<ResizeEdges />
			<TitleBar onOpenSettings={() => navigate({ kind: 'settings' })} />
			<HealthBanner
				docker={docker}
				onOpenSetupGuide={() => navigate({ kind: 'setup_guide' })}
			/>
			<div className="flex-1 flex min-h-0">
				<Sidebar
					view={view}
					onNavigate={handleSidebarNavigate}
					recentSearches={recent}
					onClearRecent={() => {
						setRecent([]);
						writeRecent([]);
					}}
					platformCounts={stats?.platforms ?? {}}
					locked={locked}
				/>

				<div className="flex-1 min-w-0 flex flex-col">
					{showHeader && (
						<header className="sticky top-0 z-30 bg-zinc-950/90 backdrop-blur border-b border-zinc-800/80 px-6 pt-3 pb-3">
							<SearchBar
								query={query}
								setQuery={setQuery}
								refreshing={vibesRefreshing}
								setRefreshing={setVibesRefreshing}
							/>
							<VibeRow
								refreshing={vibesRefreshing}
								onPick={(q) => {
									setQuery(q);
									navigate({ kind: 'search', query: q });
								}}
							/>
						</header>
					)}

					<main ref={mainRef} className="flex-1 px-6 pt-2 pb-8 overflow-y-auto">
						<MainView
							view={view}
							stats={stats}
							installed={installed}
							onSelectGame={open}
							onOpenList={(slug) => navigate({ kind: 'list', slug })}
							onPickVibe={(q) => {
								setQuery(q);
								navigate({ kind: 'search', query: q });
							}}
							onBack={back}
							canBack={history.length > 0}
							refreshStats={refreshStats}
							onDetailLoaded={setDetailGameName}
							requiredMissing={requiredMissing}
							docker={docker}
							onOpenSettings={() => navigate({ kind: 'settings' })}
							onInstalledRefresh={(idx) => setInstalled(idx)}
						/>
					</main>
				</div>
			</div>
		</div>
	);
}

const PRESET_LABEL: Record<string, string> = {
	all: 'All games',
	unplayed: 'Unplayed',
	recently_played: 'Recently played',
	recently_added: 'Recently added',
	weekend: 'Weekend games',
	vr: 'VR Games',
};

const DISCOVER_LABEL: Record<string, string> = {
	trending: 'Trending',
	random: 'Random',
	recommended: 'Recommended',
};

const PLATFORM_LABEL: Record<string, string> = {
	steam: 'Steam',
	epic: 'Epic Games',
	gog: 'GOG',
};

function SearchBar({
	query,
	setQuery,
	refreshing,
	setRefreshing,
}: {
	query: string;
	setQuery: (q: string) => void;
	refreshing: boolean;
	setRefreshing: (r: boolean) => void;
}) {
	const [vibesAi, setVibesAi] = useState({ enabled: false });
	const [, forceVibesUpdate] = useState(0);
	const [vibesShown, setVibesShown] = useState(getVibesEnabled());

	useEffect(() => {
		api
			.vibes()
			.then((d) => setVibesAi({ enabled: d.ai_enabled }))
			.catch(() => {
				/* leave disabled */
			});
		const handler = () => setVibesShown(getVibesEnabled());
		window.addEventListener('fglt:prefs:vibes-toggled', handler);
		return () =>
			window.removeEventListener('fglt:prefs:vibes-toggled', handler);
	}, []);

	async function handleRegenerate() {
		setRefreshing(true);
		try {
			await api.regenerateVibes();
			// Bump VibeRow so it refetches; cheap signal via window event.
			window.dispatchEvent(new CustomEvent('fglt:vibes:regenerated'));
			forceVibesUpdate((n) => n + 1);
		} catch (e) {
			console.error('vibes regenerate failed:', e);
		} finally {
			setRefreshing(false);
		}
	}

	return (
		<div className="flex items-center gap-3">
			<div className="relative flex-1">
				<svg
					viewBox="0 0 16 16"
					aria-hidden
					className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none"
				>
					<title>Search</title>
					<circle
						cx="7"
						cy="7"
						r="4.5"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
					/>
					<path
						d="M10.5 10.5l3 3"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
				</svg>
				<input
					type="text"
					placeholder="Search your library — try a vibe like 'cozy puzzle'"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					className="w-full h-9 bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-10 text-sm placeholder-zinc-500 focus:border-zinc-600 focus:outline-none"
				/>
				{query && (
					<button
						type="button"
						onClick={() => setQuery('')}
						aria-label="Clear search"
						title="Clear (Esc)"
						className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 flex items-center justify-center text-sm leading-none"
					>
						✕
					</button>
				)}
			</div>
			{vibesAi.enabled && vibesShown && (
				<button
					type="button"
					onClick={handleRegenerate}
					disabled={refreshing}
					title="Regenerate vibe chips via your AI provider, grounded in your library's tags"
					className="shrink-0 h-9 px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 transition-colors flex items-center gap-1.5 enabled:hover:bg-zinc-800 enabled:hover:border-zinc-700 enabled:hover:text-zinc-100 disabled:cursor-default disabled:text-zinc-500"
				>
					<span
						aria-hidden
						className={refreshing ? 'animate-spin inline-block' : ''}
					>
						↻
					</span>
					<span>{refreshing ? 'Generating…' : 'New vibes'}</span>
				</button>
			)}
		</div>
	);
}

function VibeRow({
	onPick,
	refreshing,
}: {
	onPick: (query: string) => void;
	refreshing: boolean;
}) {
	const [vibes, setVibes] =
		useState<{ label: string; query: string; emoji: string }[]>(VIBES);
	const [shown, setShown] = useState(getVibesEnabled());
	const [count, setCount] = useState(getVibesCount());

	const reload = useCallback(() => {
		api
			.vibes()
			.then((d) => {
				if (d.vibes && d.vibes.length > 0) setVibes(d.vibes);
			})
			.catch(() => {
				/* keep current chips */
			});
	}, []);

	useEffect(() => {
		reload();
		const onRegen = () => reload();
		const onToggle = () => {
			setShown(getVibesEnabled());
			setCount(getVibesCount());
		};
		window.addEventListener('fglt:vibes:regenerated', onRegen);
		window.addEventListener('fglt:prefs:vibes-toggled', onToggle);
		return () => {
			window.removeEventListener('fglt:vibes:regenerated', onRegen);
			window.removeEventListener('fglt:prefs:vibes-toggled', onToggle);
		};
	}, [reload]);

	if (!shown || count === 0) return null;

	return (
		<div
			className={`mt-3 flex flex-wrap gap-1.5 transition-opacity duration-200 ${
				refreshing ? 'opacity-40 pointer-events-none' : 'opacity-100'
			}`}
		>
			{vibes.slice(0, count).map((v) => (
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
	onOpenList,
	onPickVibe,
	onBack,
	canBack,
	refreshStats,
	onDetailLoaded,
	requiredMissing,
	docker,
	onOpenSettings,
	onInstalledRefresh,
}: {
	view: View;
	stats: Stats | null;
	installed: InstalledIndex | null;
	onSelectGame: (appid: number) => void;
	onOpenList: (slug: string) => void;
	onPickVibe: (q: string) => void;
	onBack: () => void;
	canBack: boolean;
	refreshStats: () => void;
	onDetailLoaded: (name: string | null) => void;
	requiredMissing: string[];
	docker: DockerStatus | null;
	onOpenSettings: () => void;
	onInstalledRefresh: (idx: InstalledIndex) => void;
}) {
	if (view.kind === 'home')
		return (
			<Home
				installed={installed}
				onSelectGame={onSelectGame}
				onPickVibe={onPickVibe}
			/>
		);
	if (view.kind === 'detail')
		return (
			<GameDetail
				appid={view.appid}
				installed={installed}
				canBack={canBack}
				onBack={onBack}
				onNavigate={onSelectGame}
				onLoaded={onDetailLoaded}
				onSearch={(q) => onPickVibe(q)}
				onOpenList={onOpenList}
				onInstalledRefresh={onInstalledRefresh}
			/>
		);
	if (view.kind === 'search')
		return (
			<SearchResults
				query={view.query}
				installed={installed}
				onSelect={onSelectGame}
			/>
		);
	if (view.kind === 'filter') {
		return (
			<AllGames
				platformFilter={null}
				preset={view.what}
				installed={installed}
				onSelect={onSelectGame}
			/>
		);
	}
	if (view.kind === 'discover')
		return (
			<Discover
				what={view.what}
				installed={installed}
				onSelect={onSelectGame}
			/>
		);
	if (view.kind === 'platform')
		return (
			<AllGames
				platformFilter={view.platform}
				installed={installed}
				onSelect={onSelectGame}
			/>
		);
	if (view.kind === 'list')
		return (
			<ListView
				slug={view.slug}
				installed={installed}
				onSelect={onSelectGame}
			/>
		);
	if (view.kind === 'saved_search')
		return (
			<SavedSearchView
				slug={view.slug}
				installed={installed}
				onSelect={onSelectGame}
			/>
		);
	if (view.kind === 'recently_viewed')
		return <RecentlyViewedView installed={installed} onSelect={onSelectGame} />;
	if (view.kind === 'settings')
		return (
			<Settings
				stats={stats}
				onStatsRefresh={refreshStats}
				onSelect={onSelectGame}
				requiredMissing={requiredMissing}
				docker={docker}
			/>
		);
	if (view.kind === 'setup_guide')
		return <SetupGuide onOpenSettings={onOpenSettings} />;
	return null;
}

type SearchSort =
	| 'match'
	| 'rating'
	| 'popularity'
	| 'playtime'
	| 'year'
	| 'name'
	| 'metacritic'
	| 'reviews'
	| 'controversial'
	| 'hltb_short'
	| 'hidden_gems';

function SearchResults({
	query,
	installed,
	onSelect,
	initialSort,
	initialTag,
	title,
}: {
	query: string;
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
	/** Override the default starting sort (used by saved searches). */
	initialSort?: SearchSort;
	/** Override the default starting tag filter (used by saved searches). */
	initialTag?: string;
	/** Override the auto-generated header title (e.g. "Curated: Quick puzzles"). */
	title?: string;
}) {
	const [results, setResults] = useState<LibraryGame[]>([]);
	// `loading` starts true and remains true until a fetch ACTUALLY
	// completes (not aborted). This prevents the "No matches" empty-state
	// from flashing when an effect cleanup runs (Strict Mode double-mount,
	// or rapid navigation) and the .finally fires from the aborted call.
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [sort, setSort] = useState<SearchSort>(initialSort ?? 'match');
	const [tag, setTag] = useState<string>(initialTag ?? '');
	const [allTags, setAllTags] = useState<{ tag: string; games: number }[]>([]);

	useEffect(() => {
		api
			.tags()
			.then((d) => setAllTags(d.tags))
			.catch(console.warn);
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
			.then((d) => {
				if (ctrl.signal.aborted) return;
				setResults(d.results);
				setLoading(false);
			})
			.catch((e) => {
				if (ctrl.signal.aborted || e.name === 'AbortError') return;
				setError(e.message);
				setLoading(false);
			});
		return () => ctrl.abort();
	}, [query, tag]);

	const visible = useMemo(() => {
		const out = results;
		if (sort === 'match') return out;
		const sorted = [...out];
		sorted.sort((a, b) => {
			switch (sort) {
				case 'rating': {
					const ra = ratingPct(a) ?? -1;
					const rb = ratingPct(b) ?? -1;
					return rb - ra;
				}
				case 'popularity':
					return (b.positive ?? 0) - (a.positive ?? 0);
				case 'playtime':
					return (b.playtime_min ?? 0) - (a.playtime_min ?? 0);
				case 'year': {
					const ya = Number(
						a.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? 0,
					);
					const yb = Number(
						b.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? 0,
					);
					return yb - ya;
				}
				case 'name':
					return a.name.localeCompare(b.name, undefined, {
						sensitivity: 'base',
					});
				case 'metacritic':
					// nulls sink so unrated games don't dominate the top
					return (b.metacritic ?? -1) - (a.metacritic ?? -1);
				case 'reviews': {
					const ta = (a.positive ?? 0) + (a.negative ?? 0);
					const tb = (b.positive ?? 0) + (b.negative ?? 0);
					return tb - ta;
				}
				case 'controversial':
					return controversialScore(b) - controversialScore(a);
				case 'hltb_short': {
					// nulls sink — we want known short-mains at the top
					const ha = a.hltb_main ?? Number.POSITIVE_INFINITY;
					const hb = b.hltb_main ?? Number.POSITIVE_INFINITY;
					return ha - hb;
				}
				case 'hidden_gems':
					return hiddenGemScore(b) - hiddenGemScore(a);
				default:
					return 0;
			}
		});
		return sorted;
	}, [results, sort]);

	if (error) return <div className="text-red-400 text-sm">{error}</div>;
	if (loading && results.length === 0)
		return <LoadingState message="Searching…" />;
	if (results.length === 0 && !loading)
		return <div className="text-zinc-500 text-sm">No matches.</div>;

	return (
		<div>
			<header className="mb-3">
				<h1 className="text-lg font-semibold">
					{title ? (
						<>
							<span className="text-zinc-400 font-normal text-base mr-2">
								Saved:
							</span>
							{title}
							<span className="ml-2 text-sm text-zinc-500 font-normal">
								({visible.length} {visible.length === 1 ? 'result' : 'results'})
							</span>
						</>
					) : (
						<>
							{visible.length} {visible.length === 1 ? 'result' : 'results'} for{' '}
							<span className="text-zinc-300">"{query}"</span>
						</>
					)}
				</h1>
				<p className="text-xs text-zinc-500 mt-0.5">
					{title
						? `Live query: "${query}"${tag ? ` · tag: ${tag}` : ''}`
						: sort === 'match'
							? 'Ranked by hybrid keyword + semantic relevance'
							: `Showing ${visible.length} of ${results.length} sorted by ${sort}`}
				</p>
			</header>
			<div className="mb-4 flex flex-wrap items-center gap-2">
				<Select value={tag} onChange={setTag}>
					<option value="">All tags</option>
					{allTags.map((t) => (
						<option key={t.tag} value={t.tag}>
							{t.tag} ({t.games})
						</option>
					))}
				</Select>
				<Select value={sort} onChange={(v) => setSort(v as SearchSort)}>
					<option value="match">Sort: Match</option>
					<option value="rating">Sort: Highest rated (% positive)</option>
					<option value="popularity">Sort: Most positive reviews</option>
					<option value="reviews">Sort: Most total reviews</option>
					<option value="metacritic">Sort: Metacritic</option>
					<option value="controversial">Sort: Most controversial</option>
					<option value="hidden_gems">Sort: Hidden gems</option>
					<option value="hltb_short">Sort: Shortest main story</option>
					<option value="playtime">Sort: Most played by you</option>
					<option value="year">Sort: Newest first</option>
					<option value="name">Sort: A–Z</option>
				</Select>
			</div>
			<GameGrid games={visible} installed={installed} onSelect={onSelect} />
		</div>
	);
}

function ratingPct(g: {
	positive: number | null;
	negative: number | null;
}): number | null {
	if (g.positive === null) return null;
	const total = g.positive + (g.negative ?? 0);
	if (total === 0) return null;
	return Math.round((g.positive / total) * 100);
}

/**
 * Controversial: weights total review volume by how close the positive
 * ratio is to 50%. A 50/50 split with 50k reviews scores way higher than
 * a 50/50 split with 10 reviews. Games with <100 reviews are floored to
 * keep noise out of the top ranks.
 */
function controversialScore(g: LibraryGame): number {
	const pos = g.positive ?? 0;
	const neg = g.negative ?? 0;
	const total = pos + neg;
	if (total < 100) return -1;
	const ratio = pos / total;
	const distFrom50 = Math.abs(0.5 - ratio); // 0..0.5
	const closeness = 1 - distFrom50 * 2; // 1 at 50/50, 0 at 100/0
	return total * closeness;
}

/**
 * Hidden gems: high % positive, modest review count. We compute
 * `pct * (1 - sigmoid(reviews))` so a 95%-rated game with 500 reviews
 * outranks a 95%-rated game with 500k. Games with <30 reviews are
 * filtered (too noisy to call a gem).
 */
function hiddenGemScore(g: LibraryGame): number {
	const pos = g.positive ?? 0;
	const neg = g.negative ?? 0;
	const total = pos + neg;
	if (total < 30) return -1;
	const pct = pos / total;
	if (pct < 0.8) return -1;
	// Damping: roughly halves the score by ~5k reviews, near-zero at 100k+.
	const damp = 1 / (1 + Math.log10(total / 100));
	return pct * 100 * damp;
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
	const [list, setList] = useState<
		(ListSummary & { games: LibraryGame[] }) | null
	>(null);
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
				if (e.name !== 'AbortError') setError(e.message);
			})
			.finally(() => setLoading(false));
		return () => ctrl.abort();
	}, [slug]);

	async function removeFromList(appid: number) {
		if (!list) return;
		try {
			await api.removeFromList(list.slug, appid);
			// Optimistic local update so the card disappears immediately.
			setList({ ...list, games: list.games.filter((g) => g.appid !== appid) });
			notifyListsChanged();
		} catch (e) {
			console.error('remove from list failed:', e);
		}
	}

	// Don't render stale-list data when navigating list-to-list — the
	// previous list's games would briefly flash. Only render once loaded
	// data matches the requested slug.
	if (loading || !list || list.slug !== slug) return <LoadingState />;
	if (error) return <div className="text-red-400 text-sm">{error}</div>;
	if (!list) return null;

	return (
		<div>
			<header className="mb-4">
				<h1 className="text-lg font-semibold">{list.name}</h1>
				<p className="text-xs text-zinc-500">
					{list.games.length} {list.games.length === 1 ? 'game' : 'games'}
				</p>
			</header>
			{list.games.length === 0 ? (
				<div className="text-zinc-500 text-sm">
					Nothing here yet. Open a game and add it from the detail panel.
				</div>
			) : (
				<GameGrid
					games={list.games}
					installed={installed}
					onSelect={onSelect}
					cardContextMenu={(g) => [
						{
							label: `Remove "${g.name}" from "${list.name}"`,
							onClick: () => removeFromList(g.appid),
							danger: true,
						},
					]}
				/>
			)}
		</div>
	);
}

function RecentlyViewedView({
	installed,
	onSelect,
}: {
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
}) {
	const [entries, setEntries] =
		useState<RecentlyViewedEntry[]>(getRecentlyViewed);
	const [games, setGames] = useState<LibraryGame[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState('');

	useEffect(() => {
		const onChange = () => setEntries(getRecentlyViewed());
		window.addEventListener('fglt:recently-viewed:changed', onChange);
		return () =>
			window.removeEventListener('fglt:recently-viewed:changed', onChange);
	}, []);

	useEffect(() => {
		if (entries.length === 0) {
			setGames([]);
			return;
		}
		const ctrl = new AbortController();
		const ids = entries.map((e) => e.appid).join(',');
		api
			.library({ appids: ids, limit: entries.length }, ctrl.signal)
			.then((d) => {
				// Preserve recency order — server returns alpha by default.
				const byId = new Map(d.results.map((g) => [g.appid, g]));
				setGames(
					entries
						.map((e) => byId.get(e.appid))
						.filter((g): g is LibraryGame => g !== undefined),
				);
			})
			.catch((e) => {
				if (e.name !== 'AbortError') setError(e.message);
			});
		return () => ctrl.abort();
	}, [entries]);

	const visible = useMemo(() => {
		if (!games) return null;
		const q = filter.trim().toLowerCase();
		if (!q) return games;
		return games.filter((g) => g.name.toLowerCase().includes(q));
	}, [games, filter]);

	if (error) return <div className="text-red-400 text-sm">{error}</div>;

	return (
		<div>
			<header className="mb-4 flex items-baseline justify-between gap-3 flex-wrap">
				<div>
					<h1 className="text-lg font-semibold flex items-center gap-2">
						<span>👁</span> Recently viewed
					</h1>
					<p className="text-xs text-zinc-500">
						{entries.length} {entries.length === 1 ? 'game' : 'games'} you've
						opened (most recent first)
					</p>
				</div>
				{entries.length > 0 && (
					<button
						type="button"
						onClick={() => clearRecentlyViewed()}
						className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
					>
						Clear history
					</button>
				)}
			</header>
			{entries.length > 0 && (
				<div className="mb-4">
					<input
						type="text"
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder="Filter recently viewed by name…"
						className="bg-zinc-900 border border-zinc-800 rounded-md px-3 py-1.5 text-xs placeholder-zinc-500 focus:border-zinc-600 focus:outline-none w-64"
					/>
					{filter && visible && games && (
						<span className="ml-3 text-xs text-zinc-500 tabular-nums">
							{visible.length} of {games.length}
						</span>
					)}
				</div>
			)}
			{!visible ? (
				<LoadingState />
			) : visible.length === 0 ? (
				<div className="text-zinc-500 text-sm">
					{filter
						? `No matches for "${filter}".`
						: "Nothing here yet. Open any game's detail page and it'll show up."}
				</div>
			) : (
				<GameGrid
					games={visible}
					installed={installed}
					onSelect={onSelect}
					cardContextMenu={(g) => [
						{
							label: `Remove "${g.name}" from history`,
							onClick: () => removeFromRecentlyViewed(g.appid),
							danger: true,
						},
					]}
				/>
			)}
		</div>
	);
}

function SavedSearchView({
	slug,
	installed,
	onSelect,
}: {
	slug: string;
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
}) {
	const [saved, setSaved] = useState<SavedSearchSummary | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const ctrl = new AbortController();
		setSaved(null);
		setError(null);
		api
			.getSavedSearch(slug, ctrl.signal)
			.then(setSaved)
			.catch((e) => {
				if (e.name !== 'AbortError') setError(e.message);
			});
		return () => ctrl.abort();
	}, [slug]);

	if (error) return <div className="text-red-400 text-sm">{error}</div>;
	// Wait until the LATEST saved row arrives before rendering — otherwise
	// SearchResults briefly renders with the previous saved-search's query
	// (or empty) and flashes "No matches"/"Searching" out of order.
	if (!saved || saved.slug !== slug)
		return <LoadingState message="Searching…" />;

	return (
		// `key={slug}` forces SearchResults to remount cleanly when
		// navigating between saved searches.
		<SearchResults
			key={slug}
			query={saved.query}
			installed={installed}
			onSelect={onSelect}
			initialTag={saved.tag_filter ?? undefined}
			initialSort={(saved.sort_order as SearchSort | null) ?? undefined}
			title={saved.name}
		/>
	);
}

export default App;
