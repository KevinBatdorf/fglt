import { useEffect, useState } from 'react';
import { GameImage } from './GameImage';
import {
	type ActivityResponse,
	api,
	type HealthStatus,
	type Stats,
} from './lib/api';
import {
	CARDS_PER_ROW_MAX,
	CARDS_PER_ROW_MIN,
	getAlwaysShowRefreshIcons,
	getCardsPerRow,
	getRecentlyAddedMonths,
	getSidebarVisibility,
	getVibesCount,
	getVibesEnabled,
	SIDEBAR_DEFAULT,
	SIDEBAR_LABELS,
	type SidebarKey,
	type SidebarVisibility,
	setAlwaysShowRefreshIcons,
	setCardsPerRow,
	setRecentlyAddedMonths,
	setSidebarVisibility,
	setVibesCount,
	setVibesEnabled,
	VIBES_COUNT_MAX,
	VIBES_COUNT_MIN,
} from './lib/prefs';

interface Props {
	stats: Stats | null;
	onStatsRefresh: () => void;
	onSelect: (appid: number) => void;
}

export function Settings({ stats, onStatsRefresh, onSelect }: Props) {
	const [activity, setActivity] = useState<ActivityResponse | null>(null);
	const [activityErr, setActivityErr] = useState<string | null>(null);
	const [syncing, setSyncing] = useState(false);
	const [syncMsg, setSyncMsg] = useState<string | null>(null);
	const [recentMonths, setRecentMonths] = useState(getRecentlyAddedMonths());
	const [vibesShown, setVibesShown] = useState(getVibesEnabled());
	const [vibesCount, setVibesCountState] = useState(getVibesCount());
	const [cardsPerRow, setCardsPerRowState] = useState(getCardsPerRow());
	const [alwaysShowRefresh, setAlwaysShowRefreshState] = useState(
		getAlwaysShowRefreshIcons(),
	);
	const [sidebar, setSidebar] =
		useState<SidebarVisibility>(getSidebarVisibility);
	const [hidden, setHidden] = useState<string[]>([]);
	const [allGenres, setAllGenres] = useState<{ name: string; games: number }[]>(
		[],
	);
	const [hiddenSaving, setHiddenSaving] = useState(false);

	useEffect(() => {
		api
			.activity()
			.then(setActivity)
			.catch((e) => setActivityErr(e.message));
		api
			.hiddenGenres()
			.then((r) => setHidden(r.hidden_genres))
			.catch(() => {});
		api
			.genres()
			.then((r) => setAllGenres(r.genres))
			.catch(() => {});
	}, []);

	async function saveHidden(next: string[]) {
		setHiddenSaving(true);
		const prev = hidden;
		setHidden(next);
		try {
			const r = await api.setHiddenGenres(next);
			setHidden(r.hidden_genres);
		} catch {
			setHidden(prev);
		} finally {
			setHiddenSaving(false);
		}
	}

	async function handleSync() {
		setSyncing(true);
		setSyncMsg(null);
		try {
			const r = await api.syncOwned();
			setSyncMsg(
				`Steam sync ok — ${r.total} games owned${r.removed ? ` (${r.removed} removed)` : ''}`,
			);
			onStatsRefresh();
			const a = await api.activity();
			setActivity(a);
		} catch (e) {
			setSyncMsg(`Failed: ${e instanceof Error ? e.message : e}`);
		} finally {
			setSyncing(false);
		}
	}

	return (
		<div className="max-w-4xl space-y-8">
			<header>
				<h1 className="text-xl font-semibold">Settings</h1>
				<p className="text-sm text-zinc-500 mt-1">
					Status, sync controls, and library bookkeeping.
				</p>
			</header>

			<SystemStatusSection />

			<section>
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
					Library status
				</h2>
				<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
					<StatTile label="Total games" value={stats?.total ?? '—'} />
					<StatTile
						label="Multi-platform"
						value={stats?.multi_platform ?? '—'}
					/>
					<StatTile label="Played" value={stats?.played ?? '—'} />
					<StatTile label="Unplayed" value={stats?.unplayed ?? '—'} />
					<StatTile label="Steam" value={stats?.platforms.steam ?? '—'} />
					<StatTile label="Epic" value={stats?.platforms.epic ?? '—'} />
					<StatTile label="GOG" value={stats?.platforms.gog ?? '—'} />
					<StatTile
						label="Total playtime"
						value={
							stats?.total_playtime_min
								? `${Math.round(Number(stats.total_playtime_min) / 60).toLocaleString()}h`
								: '—'
						}
					/>
					<StatTile label="Enriched" value={stats?.enriched ?? '—'} />
					<StatTile label="Embedded" value={stats?.embedded ?? '—'} />
				</div>
				<div className="mt-3 text-xs text-zinc-500">
					{stats?.meta?.find((m) => m.key === 'last_sync') && (
						<>
							Last Steam sync:{' '}
							{new Date(
								stats.meta.find((m) => m.key === 'last_sync')?.value ??
									Date.now(),
							).toLocaleString()}
						</>
					)}
				</div>
			</section>

			<section>
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
					Sync
				</h2>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
					<div>
						<div className="text-sm font-medium">Steam — owned games</div>
						<p className="text-xs text-zinc-500 mt-1">
							Pulls your Steam library via the Web API. Runs automatically at
							06:00 UTC; trigger manually after a recent purchase.
						</p>
					</div>
					<button
						type="button"
						onClick={handleSync}
						disabled={syncing}
						className="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
					>
						{syncing ? 'Syncing…' : 'Sync Steam now'}
					</button>
					{syncMsg && (
						<div className="text-xs text-zinc-500 font-mono">{syncMsg}</div>
					)}
				</div>
			</section>

			<section>
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
					Vibe chips
				</h2>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
					<label className="flex items-center gap-3 text-sm text-zinc-300 cursor-pointer">
						<input
							type="checkbox"
							checked={vibesShown}
							onChange={(e) => {
								setVibesShown(e.target.checked);
								setVibesEnabled(e.target.checked);
							}}
							className="w-4 h-4 accent-emerald-600"
						/>
						<span className="flex-1">
							Show the vibe chip row under the search bar
						</span>
					</label>
					<label className="flex items-center gap-3 text-sm text-zinc-300">
						<span className="flex-1">Show at most this many chips</span>
						<input
							type="number"
							min={VIBES_COUNT_MIN}
							max={VIBES_COUNT_MAX}
							value={vibesCount}
							disabled={!vibesShown}
							onChange={(e) => {
								const n = Number.parseInt(e.target.value, 10);
								if (!Number.isFinite(n)) return;
								const clamped = Math.min(
									Math.max(n, VIBES_COUNT_MIN),
									VIBES_COUNT_MAX,
								);
								setVibesCountState(clamped);
								setVibesCount(clamped);
							}}
							className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:border-zinc-600 disabled:opacity-50"
						/>
					</label>
				</div>
				<p className="text-xs text-zinc-500 mt-2">
					Default 12. Generated chips are still cached server-side; this only
					controls how many appear in the header.
				</p>
			</section>

			<section>
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
					Grid layout
				</h2>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
					<label className="flex items-center gap-3 text-sm text-zinc-300">
						<span className="flex-1">Cards per row</span>
						<input
							type="range"
							min={CARDS_PER_ROW_MIN}
							max={CARDS_PER_ROW_MAX}
							value={cardsPerRow}
							onChange={(e) => {
								const n = Number.parseInt(e.target.value, 10);
								if (!Number.isFinite(n)) return;
								setCardsPerRowState(n);
								setCardsPerRow(n);
							}}
							className="w-48 accent-emerald-600"
						/>
						<input
							type="number"
							min={CARDS_PER_ROW_MIN}
							max={CARDS_PER_ROW_MAX}
							value={cardsPerRow}
							onChange={(e) => {
								const n = Number.parseInt(e.target.value, 10);
								if (!Number.isFinite(n)) return;
								const clamped = Math.min(
									Math.max(n, CARDS_PER_ROW_MIN),
									CARDS_PER_ROW_MAX,
								);
								setCardsPerRowState(clamped);
								setCardsPerRow(clamped);
							}}
							className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:border-zinc-600"
						/>
					</label>
				</div>
				<p className="text-xs text-zinc-500 mt-2">
					Default 7. Lower = larger images, higher = denser grid. Cards stretch
					to fill the available width.
				</p>
			</section>

			<section>
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
					Manual refresh
				</h2>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
					<label className="flex items-center gap-3 text-sm text-zinc-300 cursor-pointer">
						<input
							type="checkbox"
							checked={alwaysShowRefresh}
							onChange={(e) => {
								setAlwaysShowRefreshState(e.target.checked);
								setAlwaysShowRefreshIcons(e.target.checked);
							}}
							className="w-4 h-4 accent-emerald-600"
						/>
						<span className="flex-1">
							Always show ↻ refresh icons next to each section title on game
							detail pages
						</span>
					</label>
				</div>
				<p className="text-xs text-zinc-500 mt-2">
					Disabled by default. The ↻ icon still always appears for games
					released in the last 14 days, since their data tends to change
					frequently right after launch.
				</p>
			</section>

			<section>
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
					Recently added window
				</h2>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 flex items-center gap-3 text-sm text-zinc-300">
					<span>Show games added within the last</span>
					<input
						type="number"
						min={1}
						max={60}
						value={recentMonths}
						onChange={(e) => {
							const n = Number.parseInt(e.target.value, 10);
							if (Number.isFinite(n)) {
								const clamped = Math.min(Math.max(n, 1), 60);
								setRecentMonths(clamped);
								setRecentlyAddedMonths(clamped);
							}
						}}
						className="w-16 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:border-zinc-600"
					/>
					<span>{recentMonths === 1 ? 'month' : 'months'}.</span>
				</div>
				<p className="text-xs text-zinc-500 mt-2">
					Applies to the "Recently added" sidebar entry. Default 2 months.
				</p>
			</section>

			<section>
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
					Re-auth
				</h2>
				<div className="space-y-2 text-sm text-zinc-300">
					<p className="text-xs text-zinc-500">
						Epic + GOG ownership comes from third-party auth flows that need a
						browser. Run these in a terminal on the host machine:
					</p>
					<pre className="bg-zinc-950 border border-zinc-800 rounded-md p-3 text-[11px] text-zinc-300 overflow-x-auto">
						{`# Epic
legendary auth          # browser SSO; paste the auth code back
bun run sync:epic       # rematch and upsert ownership

# GOG
bun run auth:gog                       # prints the OAuth URL
bun run auth:gog <code-from-redirect>  # exchanges + saves tokens
bun run sync:gog                       # rematch and upsert ownership`}
					</pre>
				</div>
			</section>

			<section>
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
					Sidebar
				</h2>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3 text-sm text-zinc-300">
					<p className="text-xs text-zinc-500">
						Home, All games, and Settings are always visible. Toggle the rest to
						hide them from the sidebar.
					</p>
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
						{(Object.keys(SIDEBAR_DEFAULT) as SidebarKey[]).map((k) => (
							<label
								key={k}
								className="flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-800/60 cursor-pointer"
							>
								<input
									type="checkbox"
									checked={sidebar[k]}
									onChange={(e) => {
										const next = { ...sidebar, [k]: e.target.checked };
										setSidebar(next);
										setSidebarVisibility(next);
									}}
									className="w-4 h-4 accent-emerald-600"
								/>
								<span className="text-sm text-zinc-200">
									{SIDEBAR_LABELS[k]}
								</span>
							</label>
						))}
					</div>
					<button
						type="button"
						onClick={() => {
							setSidebar({ ...SIDEBAR_DEFAULT });
							setSidebarVisibility({ ...SIDEBAR_DEFAULT });
						}}
						className="text-xs text-zinc-500 hover:text-zinc-200"
					>
						Reset to defaults
					</button>
				</div>
			</section>

			<section>
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
					Hidden genres
				</h2>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3 text-sm text-zinc-300">
					<p className="text-xs text-zinc-500">
						Games tagged with any of these genres are excluded from curated
						views (home, trending, recommended, random). Click × to remove, pick
						from the dropdown to add.
					</p>
					<div className="flex flex-wrap gap-1.5">
						{hidden.length === 0 && (
							<span className="text-xs text-zinc-500 italic">
								No genres hidden — every owned app shows up everywhere.
							</span>
						)}
						{hidden.map((g) => (
							<button
								type="button"
								key={g}
								onClick={() => saveHidden(hidden.filter((x) => x !== g))}
								disabled={hiddenSaving}
								className="group inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-50"
								title="Remove"
							>
								<span>{g}</span>
								<span className="text-zinc-500 group-hover:text-zinc-200">
									×
								</span>
							</button>
						))}
					</div>
					<div className="flex items-center gap-2">
						<select
							value=""
							onChange={(e) => {
								const v = e.target.value;
								if (v && !hidden.includes(v)) saveHidden([...hidden, v].sort());
							}}
							disabled={hiddenSaving}
							className="bg-zinc-950 border border-zinc-800 rounded h-9 px-2 text-sm text-zinc-200 disabled:opacity-50 focus:outline-none focus:border-zinc-600"
						>
							<option value="">Add a genre to hide…</option>
							{allGenres
								.filter((g) => !hidden.includes(g.name))
								.map((g) => (
									<option key={g.name} value={g.name}>
										{g.name} ({g.games.toLocaleString()})
									</option>
								))}
						</select>
						{hidden.length > 0 && (
							<button
								type="button"
								onClick={() => saveHidden([])}
								disabled={hiddenSaving}
								className="text-xs text-zinc-500 hover:text-zinc-200 disabled:opacity-50"
							>
								Clear all
							</button>
						)}
					</div>
				</div>
			</section>

			<section>
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
					Recent activity
				</h2>
				{activityErr && (
					<div className="text-red-400 text-sm">{activityErr}</div>
				)}
				{!activity && !activityErr && (
					<div className="text-zinc-500 text-sm">Loading activity…</div>
				)}
				{activity && (
					<>
						<div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
							<StatTile
								label="Added (24h)"
								value={activity.counts.games_added_24h}
							/>
							<StatTile
								label="Enriched (24h)"
								value={activity.counts.enriched_24h}
							/>
							<StatTile
								label="Embedded (24h)"
								value={activity.counts.embedded_24h}
							/>
							<StatTile
								label="Videos (24h)"
								value={activity.counts.videos_fetched_24h}
							/>
							<StatTile
								label="Added (7d)"
								value={activity.counts.games_added_7d}
							/>
							<StatTile
								label="Enriched (7d)"
								value={activity.counts.enriched_7d}
							/>
							<StatTile
								label="Videos (7d)"
								value={activity.counts.videos_fetched_7d}
							/>
						</div>

						<ActivityRow
							title="Recently added games"
							onSelect={onSelect}
							items={activity.recent_added.map((g) => ({
								appid: g.appid,
								name: g.name,
								header_image: g.header_image,
								secondary: new Date(g.created_at).toLocaleString(),
							}))}
						/>
						<ActivityRow
							title="Recently enriched"
							onSelect={onSelect}
							items={activity.recent_enriched.map((g) => ({
								appid: g.appid,
								name: g.name,
								header_image: g.header_image,
								secondary: new Date(g.enriched_at).toLocaleString(),
							}))}
						/>
						<ActivityRow
							title="Recently fetched videos"
							onSelect={onSelect}
							items={activity.recent_videos.map((g) => ({
								appid: g.appid,
								name: g.name,
								header_image: g.header_image,
								secondary: `${g.video_count} videos · ${new Date(g.youtube_fetched_at).toLocaleString()}`,
							}))}
						/>
					</>
				)}
			</section>
		</div>
	);
}

function StatTile({ label, value }: { label: string; value: number | string }) {
	return (
		<div className="bg-zinc-900 border border-zinc-800 rounded-md py-2.5 px-3">
			<div className="text-[10px] uppercase tracking-wider text-zinc-500">
				{label}
			</div>
			<div className="text-base font-medium tabular-nums text-zinc-100 mt-0.5">
				{typeof value === 'number' ? value.toLocaleString() : value}
			</div>
		</div>
	);
}

function ActivityRow({
	title,
	items,
	onSelect,
}: {
	title: string;
	items: {
		appid: number;
		name: string;
		header_image: string | null;
		secondary: string;
	}[];
	onSelect: (appid: number) => void;
}) {
	if (items.length === 0) return null;
	return (
		<div className="mb-4">
			<h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
				{title}
			</h3>
			<ul className="space-y-1">
				{items.map((it) => (
					<li key={it.appid}>
						<button
							type="button"
							onClick={() => onSelect(it.appid)}
							className="w-full flex items-center gap-3 px-2 py-1.5 rounded hover:bg-zinc-900 text-sm text-left transition-colors"
						>
							<GameImage
								appid={it.appid}
								name={it.name}
								variant="header"
								fallback={it.header_image}
								showFallbackText={false}
								className="w-16 h-7 object-cover rounded bg-zinc-900"
							/>
							<span className="flex-1 text-zinc-200 truncate">{it.name}</span>
							<span className="text-xs text-zinc-500 tabular-nums">
								{it.secondary}
							</span>
						</button>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * Settings-page mirror of the top-of-window HealthBanner. Shows the same
 * /health snapshot but always visible (no dismiss) and broken into a list
 * the user can scan for what's set up vs what isn't.
 */
function SystemStatusSection() {
	const [health, setHealth] = useState<HealthStatus | null>(null);
	const [reachable, setReachable] = useState(true);
	const [busy, setBusy] = useState(false);

	async function recheck() {
		setBusy(true);
		try {
			const h = await api.health();
			setHealth(h);
			setReachable(true);
		} catch {
			setReachable(false);
			setHealth(null);
		} finally {
			setBusy(false);
		}
	}

	useEffect(() => {
		void recheck();
	}, []);

	const rows: { label: string; value: string; ok: boolean }[] = !reachable
		? [{ label: 'API', value: 'Unreachable', ok: false }]
		: !health
			? []
			: [
					{
						label: 'API',
						value: 'Reachable',
						ok: true,
					},
					{
						label: 'Database',
						value: health.db === 'ok' ? 'Connected' : 'Down',
						ok: health.db === 'ok',
					},
					{
						label: 'AI provider',
						value: health.ai === 'ok' ? 'Configured' : 'Disabled',
						ok: health.ai === 'ok',
					},
					{
						label: 'STEAM_API_KEY',
						value: health.steam_key === 'present' ? 'Set' : 'Missing',
						ok: health.steam_key === 'present',
					},
					{
						label: 'STEAM_ID',
						value: health.steam_id === 'present' ? 'Set' : 'Missing',
						ok: health.steam_id === 'present',
					},
					{
						label: 'Games in library',
						value: health.total_games.toLocaleString(),
						ok: health.total_games > 0,
					},
					{
						label: 'Last sync',
						value: health.last_sync
							? new Date(health.last_sync).toLocaleString()
							: 'Never',
						ok: !!health.last_sync,
					},
				];

	return (
		<section>
			<div className="flex items-baseline justify-between mb-2">
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">
					System status
				</h2>
				<button
					type="button"
					onClick={() => void recheck()}
					disabled={busy}
					className="text-xs text-zinc-500 hover:text-zinc-200 disabled:opacity-50"
				>
					{busy ? 'Checking…' : 'Re-check'}
				</button>
			</div>
			<dl className="bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3 text-xs space-y-1.5">
				{rows.map((r) => (
					<div key={r.label} className="grid grid-cols-[140px_1fr] gap-2">
						<dt className="text-zinc-500">{r.label}</dt>
						<dd
							className={
								r.ok ? 'text-emerald-300' : 'text-amber-300'
							}
						>
							<span aria-hidden className="mr-1.5">
								{r.ok ? '✓' : '✗'}
							</span>
							{r.value}
						</dd>
					</div>
				))}
			</dl>
		</section>
	);
}
