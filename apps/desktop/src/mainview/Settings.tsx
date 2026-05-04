import { useEffect, useMemo, useRef, useState } from 'react';
import type { DockerStatus, UpdaterStatus } from '../shared/types';

type EpicStatus =
	| { kind: 'not_installed' }
	| { kind: 'not_authed' }
	| { kind: 'authed'; account?: string };

import { GameImage } from './GameImage';
import {
	type ActivityResponse,
	api,
	type ConfigKey,
	type HealthStatus,
	notifyConfigChanged,
	type Stats,
} from './lib/api';
import {
	CARD_WIDTH_MAX,
	CARD_WIDTH_MIN,
	getAlwaysShowRefreshIcons,
	getCardMinWidth,
	getRecentlyAddedMonths,
	getSidebarVisibility,
	getVibesCount,
	getVibesEnabled,
	SIDEBAR_DEFAULT,
	SIDEBAR_LABELS,
	type SidebarKey,
	type SidebarVisibility,
	setAlwaysShowRefreshIcons,
	setCardMinWidth,
	setRecentlyAddedMonths,
	setSidebarVisibility,
	setVibesCount,
	setVibesEnabled,
	VIBES_COUNT_MAX,
	VIBES_COUNT_MIN,
} from './lib/prefs';
import { rpc } from './lib/rpc';
import { Select } from './Select';

interface Props {
	stats: Stats | null;
	onStatsRefresh: () => void;
	onSelect: (appid: number) => void;
	/**
	 * When true, the app is locked into Settings because required config
	 * (STEAM_API_KEY / STEAM_ID) is missing. Surfaces an amber callout at
	 * the top of ConfigurationSection. The lock auto-releases as soon as
	 * the next /health poll sees the values set.
	 */
	requiredMissing?: string[];
	/**
	 * Latest Docker stack snapshot. Used by BackendSection to render the
	 * status line + enable/disable Start/Stop/Pull buttons.
	 */
	docker?: DockerStatus | null;
}

export function Settings({
	stats,
	onStatsRefresh,
	onSelect,
	requiredMissing = [],
	docker = null,
}: Props) {
	const [activity, setActivity] = useState<ActivityResponse | null>(null);
	const [activityErr, setActivityErr] = useState<string | null>(null);
	const [syncing, setSyncing] = useState(false);
	const [syncMsg, setSyncMsg] = useState<string | null>(null);
	const [recentMonths, setRecentMonths] = useState(getRecentlyAddedMonths());
	const [vibesShown, setVibesShown] = useState(getVibesEnabled());
	const [vibesCount, setVibesCountState] = useState(getVibesCount());
	const [cardWidth, setCardWidthState] = useState(getCardMinWidth());
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

			<BackendSection docker={docker} />

			<ConfigurationSection
				requiredMissing={requiredMissing}
				extraLibrarySources={
					<>
						<GogConnect onSyncComplete={onStatsRefresh} />
						<EpicConnect onSyncComplete={onStatsRefresh} />
					</>
				}
			/>

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
						<span className="flex-1">Max card size</span>
						<input
							type="range"
							min={CARD_WIDTH_MIN}
							max={CARD_WIDTH_MAX}
							step={10}
							value={cardWidth}
							onChange={(e) => {
								const n = Number.parseInt(e.target.value, 10);
								if (!Number.isFinite(n)) return;
								setCardWidthState(n);
								setCardMinWidth(n);
							}}
							className="w-48 accent-emerald-600"
						/>
						<span className="w-16 text-sm tabular-nums text-right text-zinc-400">
							{cardWidth} px
						</span>
					</label>
				</div>
				<p className="text-xs text-zinc-500 mt-2">
					Bigger value = bigger cards (fewer per row). Columns adjust
					automatically as the window resizes — narrow windows drop columns
					instead of squishing cards.
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
					External data (description, reviews, scores, videos, HowLongToBeat
					times) auto-refreshes on a background schedule — every 15 min for
					Steam metadata, daily for OpenCritic / YouTube / SteamSpy. The ↻ icons
					here let you force a refresh on a specific game without waiting.
					Hidden by default; the icon still always appears for games released in
					the last 14 days since their data churns right after launch.
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
						<Select
							value=""
							onChange={(v) => {
								if (v && !hidden.includes(v)) saveHidden([...hidden, v].sort());
							}}
							disabled={hiddenSaving}
						>
							<option value="">Add a genre to hide…</option>
							{allGenres
								.filter((g) => !hidden.includes(g.name))
								.map((g) => (
									<option key={g.name} value={g.name}>
										{g.name} ({g.games.toLocaleString()})
									</option>
								))}
						</Select>
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

/**
 * Format the System status "Last sync" cell — combines the last
 * timestamp with how soon the next sync will fire (computed by
 * /health from the cron expression).
 */
function lastSyncLabel(lastIso: string | null, nextIso: string | null): string {
	const last = lastIso ? new Date(lastIso).toLocaleString() : 'Never';
	if (!nextIso) return last;
	const ms = new Date(nextIso).getTime() - Date.now();
	if (!Number.isFinite(ms) || ms < 0) return `${last} · next sync soon`;
	const minutes = Math.round(ms / 60_000);
	if (minutes < 60) return `${last} · next sync in ${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 36) return `${last} · next sync in ${hours}h`;
	const days = Math.round(hours / 24);
	return `${last} · next sync in ${days}d`;
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

	type Row = { label: string; value: string; ok: boolean };
	type Group = { label: string; rows: Row[] };

	const groups: Group[] = !reachable
		? [
				{
					label: 'Core',
					rows: [{ label: 'API', value: 'Unreachable', ok: false }],
				},
			]
		: !health
			? []
			: [
					{
						label: 'Core',
						rows: [
							{ label: 'API', value: 'Reachable', ok: true },
							{
								label: 'Database',
								value: health.db === 'ok' ? 'Connected' : 'Down',
								ok: health.db === 'ok',
							},
							{
								label: 'Games in library',
								value: health.total_games.toLocaleString(),
								ok: health.total_games > 0,
							},
							{
								label: 'Last sync',
								value: lastSyncLabel(health.last_sync, health.next_sync),
								ok: !!health.last_sync,
							},
						],
					},
					{
						label: 'Library sources',
						rows: [
							{
								label: 'Steam API key',
								value: health.steam_key === 'present' ? 'Set' : 'Missing',
								ok: health.steam_key === 'present',
							},
							{
								label: 'Steam ID',
								value: health.steam_id === 'present' ? 'Set' : 'Missing',
								ok: health.steam_id === 'present',
							},
							{
								label: 'GOG',
								value:
									health.gog === 'connected'
										? 'Connected'
										: 'Not connected (optional)',
								ok: health.gog === 'connected',
							},
							{
								label: 'Epic',
								value:
									health.epic === 'connected'
										? 'Connected'
										: 'Not connected (optional)',
								ok: health.epic === 'connected',
							},
						],
					},
					{
						label: 'AI + enrichment',
						rows: [
							{
								label: 'AI provider',
								value: health.ai === 'ok' ? 'Configured' : 'Disabled',
								ok: health.ai === 'ok',
							},
							{
								label: 'YouTube API key',
								value:
									health.youtube_key === 'present'
										? 'Set'
										: 'Not set (optional)',
								ok: health.youtube_key === 'present',
							},
							{
								label: 'OpenCritic key',
								value:
									health.opencritic_key === 'present'
										? 'Set'
										: 'Not set (optional)',
								ok: health.opencritic_key === 'present',
							},
						],
					},
				];

	return (
		<section className="space-y-4">
			<div>
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
						{busy ? 'Checking…' : 'Check now'}
					</button>
				</div>
				<div className="bg-zinc-900 border border-zinc-800 rounded-md divide-y divide-zinc-800">
					{groups.map((g) => (
						<div key={g.label} className="py-2 px-3">
							<div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">
								{g.label}
							</div>
							<dl className="text-xs space-y-1.5">
								{g.rows.map((r) => (
									<div
										key={r.label}
										className="grid grid-cols-[140px_1fr] gap-2"
									>
										<dt className="text-zinc-500">{r.label}</dt>
										<dd
											className={r.ok ? 'text-emerald-300' : 'text-amber-300'}
										>
											<span aria-hidden className="mr-1.5">
												{r.ok ? '✓' : '✗'}
											</span>
											{r.value}
										</dd>
									</div>
								))}
							</dl>
						</div>
					))}
				</div>
			</div>
			<UpdatesSubsection />
		</section>
	);
}

/**
 * Settings → Backend — manual control over the Docker stack the desktop
 * app manages on the user's behalf. The auto-start path (in
 * `bun/index.ts`) covers the boot case; this section is for anyone who
 * wants to free resources, force a re-pull, or restart after a crash.
 *
 * Status comes in as a prop from App.tsx (which already polls every 3s
 * while API is unreachable, then once on each /health success). The
 * three buttons fan out to dockerStart / dockerStop / dockerRebuild
 * RPCs.
 */
/**
 * GOG connect/sync flow. Three states:
 *   1. Not connected      → "Open GOG sign-in" + paste-code field + Connect button
 *   2. Connected          → user_id + "Sync now" / "Disconnect" buttons
 *   3. Syncing            → busy spinner with progress message
 *
 * The OAuth flow doesn't have a redirect handler — GOG redirects to
 * a `embed.gog.com/on_login_success?code=...` URL that the user copies
 * out manually. Annoying but unavoidable without registering our own
 * redirect URI with GOG (which requires their approval as a partner).
 */
function GogConnect({ onSyncComplete }: { onSyncComplete: () => void }) {
	type Status = { authed: false } | { authed: true; user_id: string };
	const [status, setStatus] = useState<Status | null>(null);
	const [code, setCode] = useState('');
	const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect'>(
		null,
	);
	const [msg, setMsg] = useState<string | null>(null);
	const [showCodeForm, setShowCodeForm] = useState(false);

	async function refresh() {
		try {
			const s = await api.gogStatus();
			setStatus(s);
		} catch {
			setStatus({ authed: false });
		}
	}

	useEffect(() => {
		void refresh();
	}, []);

	async function openSignIn() {
		try {
			const r = await api.gogAuthUrl();
			await rpc.request.openUrl({ url: r.url });
			setShowCodeForm(true);
			setMsg(
				'Sign in to GOG in the browser, then look at the URL bar — copy the code= value and paste it below.',
			);
		} catch (e) {
			setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	async function connect() {
		// Accept either a bare code OR a full pasted redirect URL — extract
		// the code= param if it looks like a URL.
		let trimmed = code.trim();
		try {
			if (trimmed.startsWith('http')) {
				const u = new URL(trimmed);
				const c2 = u.searchParams.get('code');
				if (c2) trimmed = c2;
			}
		} catch {
			/* not a url, use as-is */
		}
		if (!trimmed) {
			setMsg('Paste the code first.');
			return;
		}
		setBusy('connect');
		setMsg(null);
		try {
			const r = await api.gogAuthExchange(trimmed);
			setCode('');
			setShowCodeForm(false);
			setMsg(`Connected as GOG user ${r.user_id}. Click "Sync now" to import.`);
			await refresh();
		} catch (e) {
			setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy(null);
		}
	}

	async function sync() {
		setBusy('sync');
		setMsg('Syncing GOG library — can take a few minutes for big libraries…');
		try {
			const r = await api.gogSync();
			setMsg(
				`Sync done — ${r.matched} new matches, ${r.already_matched} already in library, ${r.unmatched} couldn't match a Steam game.`,
			);
			onSyncComplete();
		} catch (e) {
			setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy(null);
		}
	}

	async function disconnect() {
		if (
			!confirm(
				'Disconnect GOG? Your imported games stay; only the auth tokens are forgotten. You can reconnect any time.',
			)
		)
			return;
		setBusy('disconnect');
		try {
			await api.gogDisconnect();
			setMsg('Disconnected.');
			await refresh();
		} catch (e) {
			setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy(null);
		}
	}

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
			<div className="flex items-baseline justify-between gap-3 flex-wrap">
				<div>
					<div className="text-sm font-medium">GOG</div>
					<p className="text-xs text-zinc-500 mt-1">
						Imports your owned GOG games and matches them to Steam appids so a
						single game can show ownership across stores. GOG-only titles are
						skipped.
					</p>
				</div>
				<div className="text-xs tabular-nums">
					{status === null ? (
						<span className="text-zinc-500">Checking…</span>
					) : status.authed ? (
						<span className="text-emerald-300">
							Connected as {status.user_id}
						</span>
					) : (
						<span className="text-zinc-500">Not connected</span>
					)}
				</div>
			</div>
			{status?.authed ? (
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						onClick={() => void sync()}
						disabled={busy !== null}
						className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-40"
					>
						{busy === 'sync' ? 'Syncing…' : 'Sync GOG library now'}
					</button>
					<button
						type="button"
						onClick={() => void disconnect()}
						disabled={busy !== null}
						className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium disabled:opacity-40"
					>
						{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
					</button>
				</div>
			) : (
				<div className="space-y-2">
					{!showCodeForm && (
						<button
							type="button"
							onClick={() => void openSignIn()}
							className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
						>
							Open GOG sign-in
						</button>
					)}
					{showCodeForm && (
						<div className="flex gap-2">
							<input
								type="text"
								value={code}
								onChange={(e) => setCode(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') void connect();
								}}
								placeholder="Paste code or full redirect URL"
								className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-zinc-600"
							/>
							<button
								type="button"
								onClick={() => void connect()}
								disabled={busy !== null || !code.trim()}
								className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-40"
							>
								{busy === 'connect' ? 'Connecting…' : 'Connect'}
							</button>
						</div>
					)}
				</div>
			)}
			{msg && <div className="text-xs text-zinc-400 break-words">{msg}</div>}
		</div>
	);
}

/**
 * Epic — currently NOT a one-click flow. Epic doesn't expose a public
 * library API; the third-party tool we use (`legendary-gl`) is a
 * Python CLI that needs to be installed on the host. Until we either
 * bundle legendary or build our own scraper, this section is just
 * honest copy explaining the situation.
 */
/**
 * Epic Games connect/sync flow. Three states tracked from
 * `rpc.request.epicStatus()`:
 *   1. not_installed — show install instructions for legendary-gl
 *   2. not_authed    — "Open Epic sign-in" + paste-code field
 *   3. authed        — "Sync library" / "Disconnect" buttons
 *
 * The auth flow is similar to GOG's: open a URL in the browser, user
 * signs in, copies the `authorizationCode` value out of the JSON
 * landing page, pastes it back here. We then shell out to
 * `legendary auth --code <CODE>` via the bun-side RPC.
 *
 * Library import: bun side runs `legendary list --json`, POSTs the
 * library to /sync/epic/import (the API container does the storesearch
 * + DB upsert — same matching pipeline as GOG).
 */
function EpicConnect({ onSyncComplete }: { onSyncComplete: () => void }) {
	const [status, setStatus] = useState<EpicStatus | null>(null);
	const [code, setCode] = useState('');
	const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect'>(
		null,
	);
	const [msg, setMsg] = useState<string | null>(null);
	const [showCodeForm, setShowCodeForm] = useState(false);

	async function refresh() {
		try {
			const s = await api.epicStatus();
			setStatus(s);
		} catch {
			setStatus({ kind: 'not_installed' });
		}
	}

	useEffect(() => {
		void refresh();
	}, []);

	async function openSignIn() {
		const r = await api.epicAuthUrl();
		await rpc.request.openUrl({ url: r.url });
		setShowCodeForm(true);
		setMsg(
			'Sign in to Epic in the browser. After login you\'ll see a JSON page — copy the long "authorizationCode" value and paste it below within a few minutes (codes expire fast).',
		);
	}

	async function connect() {
		const trimmed = code.trim();
		if (!trimmed) {
			setMsg('Paste the authorization code first.');
			return;
		}
		setBusy('connect');
		setMsg('Connecting…');
		try {
			const r = await api.epicAuthExchange(trimmed);
			if (!r.ok) {
				setMsg(`Failed: ${r.error ?? 'unknown'}`);
				return;
			}
			setCode('');
			setShowCodeForm(false);
			setMsg('Connected. Click "Sync Epic library now" to import.');
			await refresh();
		} catch (e) {
			setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy(null);
		}
	}

	async function sync() {
		setBusy('sync');
		setMsg('Syncing Epic library — this can take a few minutes…');
		try {
			const r = await api.epicSync();
			setMsg(
				`Sync done — ${r.matched} new matches, ${r.already_matched} already in library, ${r.unmatched} couldn't match a Steam game.`,
			);
			onSyncComplete();
		} catch (e) {
			setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy(null);
		}
	}

	async function disconnect() {
		if (
			!confirm(
				'Disconnect Epic? Your imported games stay; only the auth tokens are forgotten.',
			)
		)
			return;
		setBusy('disconnect');
		try {
			await api.epicDisconnect();
			setMsg('Disconnected.');
			await refresh();
		} catch (e) {
			setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy(null);
		}
	}

	const kind = status?.kind ?? 'loading';

	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
			<div className="flex items-baseline justify-between gap-3 flex-wrap">
				<div>
					<div className="text-sm font-medium">Epic Games</div>
					<p className="text-xs text-zinc-500 mt-1">
						Epic has no public library API — we drive the third-party{' '}
						<code>legendary-gl</code> CLI installed on your machine. One-time
						install, then everything happens in-app.
					</p>
				</div>
				<div className="text-xs tabular-nums">
					{kind === 'loading' && (
						<span className="text-zinc-500">Checking…</span>
					)}
					{kind === 'not_installed' && (
						<span className="text-amber-300">legendary not installed</span>
					)}
					{kind === 'not_authed' && (
						<span className="text-zinc-500">Not connected</span>
					)}
					{kind === 'authed' && (
						<span className="text-emerald-300">
							Connected
							{status?.kind === 'authed' && status.account
								? ` as ${status.account}`
								: ''}
						</span>
					)}
				</div>
			</div>

			{kind === 'not_installed' && (
				<div className="space-y-2 text-xs text-amber-300">
					<p>
						The legendary CLI isn't reachable from inside the backend container
						— this shouldn't happen on a normal install. Try "Update backend" in
						Settings → Backend to rebuild the image, then come back here.
					</p>
					<button
						type="button"
						onClick={() => void refresh()}
						className="mt-2 px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium"
					>
						Re-check
					</button>
				</div>
			)}

			{kind === 'not_authed' && (
				<div className="space-y-2">
					{!showCodeForm && (
						<button
							type="button"
							onClick={() => void openSignIn()}
							className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
						>
							Open Epic sign-in
						</button>
					)}
					{showCodeForm && (
						<div className="flex gap-2">
							<input
								type="text"
								value={code}
								onChange={(e) => setCode(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === 'Enter') void connect();
								}}
								placeholder="Paste authorization code or full JSON snippet"
								className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm font-mono focus:outline-none focus:border-zinc-600"
							/>
							<button
								type="button"
								onClick={() => void connect()}
								disabled={busy !== null || !code.trim()}
								className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-40"
							>
								{busy === 'connect' ? 'Connecting…' : 'Connect'}
							</button>
						</div>
					)}
				</div>
			)}

			{kind === 'authed' && (
				<div className="flex flex-wrap gap-2">
					<button
						type="button"
						onClick={() => void sync()}
						disabled={busy !== null}
						className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-40"
					>
						{busy === 'sync' ? 'Syncing…' : 'Sync Epic library now'}
					</button>
					<button
						type="button"
						onClick={() => void disconnect()}
						disabled={busy !== null}
						className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium disabled:opacity-40"
					>
						{busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
					</button>
				</div>
			)}

			{msg && <div className="text-xs text-zinc-400 break-words">{msg}</div>}
		</div>
	);
}

function BackendSection({ docker }: { docker: DockerStatus | null }) {
	const [busy, setBusy] = useState<null | 'start' | 'stop' | 'rebuild'>(null);
	const [msg, setMsg] = useState<string | null>(null);

	async function call(
		op: 'start' | 'stop' | 'rebuild',
		fn: () => Promise<{ ok: boolean; error?: string }>,
		successMsg: string,
	) {
		setBusy(op);
		setMsg(null);
		try {
			const r = await fn();
			setMsg(r.ok ? successMsg : `Failed: ${r.error ?? 'unknown'}`);
		} catch (e) {
			setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setBusy(null);
		}
	}

	const status = docker?.kind ?? 'unknown';
	const statusLabel = labelForDocker(status);
	const isRunning = status === 'running';
	const isStopped =
		status === 'containers_stopped' || status === 'containers_missing';
	const dockerUsable = status !== 'not_installed' && status !== 'daemon_down';

	return (
		<section>
			<h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
				Backend
			</h2>
			<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-3">
				<div className="flex items-baseline justify-between gap-3 flex-wrap">
					<div>
						<div className="text-sm font-medium">Local Docker stack</div>
						<p className="text-xs text-zinc-500 mt-1">
							The desktop app manages Postgres + the API + the cron workers via
							Docker. Leaving the backend running is fine — idle cost is
							~150&nbsp;MB RAM and the daily syncs keep firing in the
							background.
						</p>
					</div>
					<div className="text-xs tabular-nums">
						Status:{' '}
						<span
							className={
								isRunning
									? 'text-emerald-300'
									: isStopped
										? 'text-amber-300'
										: 'text-red-300'
							}
						>
							{statusLabel}
						</span>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<button
						type="button"
						disabled={!dockerUsable || isRunning || busy !== null}
						onClick={() =>
							call(
								'start',
								() => rpc.request.dockerStart({}),
								'Backend started.',
							)
						}
						className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{busy === 'start' ? 'Starting…' : 'Start backend'}
					</button>
					<button
						type="button"
						disabled={!dockerUsable || !isRunning || busy !== null}
						onClick={() => {
							if (
								!confirm(
									'Stop the backend? Background syncs and the API will be unavailable until you start it again.',
								)
							)
								return;
							void call(
								'stop',
								() => rpc.request.dockerStop({}),
								'Backend stopped.',
							);
						}}
						className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{busy === 'stop' ? 'Stopping…' : 'Stop backend'}
					</button>
					<button
						type="button"
						disabled={!dockerUsable || busy !== null}
						title="docker compose build && up -d --force-recreate — rebuild the API image from the bundled source and recreate containers. Normally fires automatically after the desktop app updates; click here to force a manual rebuild."
						onClick={() =>
							call(
								'rebuild',
								() => rpc.request.dockerRebuild({}),
								'Rebuilt and restarted backend.',
							)
						}
						className="px-3 py-1.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{busy === 'rebuild' ? 'Rebuilding…' : 'Update backend'}
					</button>
				</div>
				{msg && (
					<div className="text-xs text-zinc-400 font-mono break-words">
						{msg}
					</div>
				)}
				{!dockerUsable && (
					<div className="text-xs text-amber-300">
						{status === 'not_installed'
							? "Docker isn't installed — see the Setup guide."
							: "Docker Desktop isn't running — start it from your OS, then come back."}
					</div>
				)}
			</div>
		</section>
	);
}

function labelForDocker(kind: string): string {
	switch (kind) {
		case 'running':
			return 'Running';
		case 'containers_stopped':
			return 'Stopped';
		case 'containers_missing':
			return 'Not yet started';
		case 'starting':
			return 'Starting…';
		case 'daemon_down':
			return 'Docker not running';
		case 'not_installed':
			return 'Docker not installed';
		default:
			return 'Checking…';
	}
}

/**
 * Configuration form — every key lives in the `app_settings` table and is
 * read by `getConfig()` on the server. Loaded values come back masked for
 * sensitive keys (••••<last4>); click-to-reveal refetches with reveal=1.
 *
 * UX rules:
 * - Empty input means "delete the row" (treat unset and empty the same).
 * - We diff against the last-loaded values so Save only POSTs what changed.
 * - When `requiredMissing` is non-empty, an amber callout pins to the top
 *   and the matching field labels glow amber. Saving the missing keys
 *   triggers `fglt:config:changed`, which the App listens for to recompute
 *   /health immediately instead of waiting on the 30s poll.
 */
function ConfigurationSection({
	requiredMissing,
	extraLibrarySources,
}: {
	requiredMissing: string[];
	/**
	 * Slot rendered inside the "Library sources" block, right after the
	 * Steam-keys card. Used by the parent to drop in the GogConnect /
	 * EpicConnect components — they have their own internal save flows
	 * (OAuth, CLI handoff) so they're not part of the form-state diff
	 * the bottom Save button drives.
	 */
	extraLibrarySources?: React.ReactNode;
}) {
	// Loaded snapshot — what the server most recently returned. Sensitive
	// values arrive masked unless the user clicked Reveal on that field.
	const [loaded, setLoaded] = useState<Partial<
		Record<ConfigKey, string>
	> | null>(null);
	// What the user has typed. Only fields the user touched live here.
	const [draft, setDraft] = useState<Partial<Record<ConfigKey, string>>>({});
	const [revealed, setRevealed] = useState<Set<ConfigKey>>(new Set());
	const [saving, setSaving] = useState(false);
	const [savedAt, setSavedAt] = useState<Date | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function load(reveal = false) {
		try {
			const r = await api.config(reveal);
			// REPLACE, don't merge. The API returns the full config snapshot
			// (every CONFIG_KEY → either a value or undefined). Merging with
			// the previous loaded state means deletes get silently kept —
			// the bug was: user clears all AI fields → save POSTs deletes →
			// server removes those rows → next /settings/config response
			// omits them → merge keeps the OLD values from prev → UI thinks
			// the config is still there and the AI mode toggle snaps back.
			setLoaded(r.config);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	useEffect(() => {
		void load(false);
	}, []);

	// One-shot: on the FIRST loaded-snapshot we get from the server,
	// pre-fill the budget fields with their defaults if the user hasn't
	// set them yet. This must NOT re-fire on subsequent loaded changes
	// (i.e. after a Save) — otherwise the page perpetually looks dirty
	// because we keep re-injecting "80" / "20" into draft.
	const budgetsPrefilled = useRef(false);
	useEffect(() => {
		if (!loaded) return;
		if (budgetsPrefilled.current) return;
		budgetsPrefilled.current = true;
		const defaults: Partial<Record<ConfigKey, string>> = {
			HLTB_DAILY_BUDGET: '80',
			OPENCRITIC_DAILY_BUDGET: '20',
		};
		setDraft((prev) => {
			const next = { ...prev };
			for (const [k, v] of Object.entries(defaults) as [ConfigKey, string][]) {
				if (k in next) continue;
				if ((loaded[k] ?? '').trim().length === 0) next[k] = v;
			}
			return next;
		});
	}, [loaded]);

	async function reveal(key: ConfigKey) {
		// Pull JUST the revealed value via a single targeted refetch with
		// reveal=1. We then strip every other sensitive value back to its
		// masked form so revealing one key doesn't accidentally expose all.
		try {
			const r = await api.config(true);
			setLoaded((prev) => {
				const next: Partial<Record<ConfigKey, string>> = { ...(prev ?? {}) };
				next[key] = r.config[key];
				return next;
			});
			setRevealed((prev) => new Set(prev).add(key));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	}

	async function save() {
		if (!loaded) return;
		setSaving(true);
		setError(null);
		try {
			// Build the diff: any draft entry whose value differs from the
			// loaded snapshot. For sensitive keys we only include the change
			// if the user explicitly typed something (ignore re-saves of the
			// "••••6122" placeholder).
			const updates: Partial<Record<ConfigKey, string>> = {};
			for (const [k, v] of Object.entries(draft) as [ConfigKey, string][]) {
				const cur = loaded[k] ?? '';
				if (v === cur) continue;
				if (SENSITIVE.has(k) && isMaskedValue(v)) continue;
				updates[k] = v;
			}
			if (Object.keys(updates).length === 0) {
				setSavedAt(new Date());
				setSaving(false);
				return;
			}
			await api.saveConfig(updates);
			notifyConfigChanged();
			setDraft({});
			setRevealed(new Set());
			await load(false);
			setSavedAt(new Date());
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	}

	const dirty = useMemo(() => {
		if (!loaded) return false;
		for (const [k, v] of Object.entries(draft) as [ConfigKey, string][]) {
			const cur = loaded[k] ?? '';
			if (v !== cur && !(SENSITIVE.has(k) && isMaskedValue(v))) return true;
		}
		return false;
	}, [draft, loaded]);

	function valueFor(key: ConfigKey): string {
		if (key in draft) return draft[key] ?? '';
		return loaded?.[key] ?? '';
	}

	function setValueFor(key: ConfigKey, v: string) {
		setDraft((prev) => ({ ...prev, [key]: v }));
	}

	const fieldProps = {
		valueFor,
		setValueFor,
		revealed,
		onReveal: reveal,
		requiredMissing,
	};

	return (
		<section className="space-y-4">
			<div>
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-2">
					Configuration
				</h2>
				{requiredMissing.length > 0 && (
					<div className="mb-3 rounded-md border border-amber-700 bg-amber-950/60 px-3 py-2 text-xs text-amber-100">
						<strong>Set these to continue:</strong> {requiredMissing.join(', ')}
						. The rest of the app stays locked until both are filled in.
					</div>
				)}
				{/* Library sources — Steam keys + GOG OAuth + Epic */}
				<div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mt-3 mb-2">
					Library sources
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800">
					<FieldGroup
						title="Steam"
						subtitle="Library sync needs both. Click the link next to each field to get yours."
					>
						<ConfigField
							{...fieldProps}
							keyName="STEAM_API_KEY"
							label="Steam API key"
							sensitive
							helpText="A 32-char hex string from the Steam dev portal."
							helpUrl="https://steamcommunity.com/dev/apikey"
							helpUrlLabel="Get one"
						/>
						<ConfigField
							{...fieldProps}
							keyName="STEAM_ID"
							label="Steam ID (64-bit)"
							helpText="A 17-digit number starting with 76561. Paste your Steam profile URL into steamid.io to find it."
							helpUrl="https://steamid.io/"
							helpUrlLabel="Find yours"
						/>
					</FieldGroup>
				</div>
				{extraLibrarySources && (
					<div className="mt-3 space-y-3">{extraLibrarySources}</div>
				)}

				{/* AI + enrichment — optional, separate visual block */}
				<div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mt-6 mb-2">
					AI + enrichment
				</div>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800">
					<AIProviderSection {...fieldProps} loadedSnapshot={loaded ?? {}} />

					<FieldGroup
						title="Enrichment (optional)"
						subtitle="External metadata sources. Each is opt-in — the library is fully usable without any of them."
					>
						<ConfigField
							{...fieldProps}
							keyName="YOUTUBE_API_KEY"
							label="YouTube API key"
							sensitive
							helpText="Adds gameplay videos to each game's detail page. Free 10k-units/day quota from Google. Without this, the videos panel stays empty."
							helpUrl="https://console.cloud.google.com/apis/credentials"
							helpUrlLabel="Create"
						/>
						<ConfigField
							{...fieldProps}
							keyName="OPENCRITIC_API_KEY"
							label="OpenCritic (RapidAPI) key"
							sensitive
							helpText="Adds aggregated critic scores alongside Metacritic. Free RapidAPI tier is ~25 lookups/day."
							helpUrl="https://rapidapi.com/opencritic-opencritic-default/api/opencritic-api"
							helpUrlLabel="Sign up"
						/>
						<ConfigField
							{...fieldProps}
							keyName="HLTB_DAILY_BUDGET"
							label="HowLongToBeat daily budget"
							helpText="Max HLTB lookups per day. They don't publish a rate limit but get cranky above ~100/day."
						/>
						<ConfigField
							{...fieldProps}
							keyName="OPENCRITIC_DAILY_BUDGET"
							label="OpenCritic daily budget"
							helpText="Max OpenCritic lookups per day. Stay under your RapidAPI plan's quota."
						/>
					</FieldGroup>
				</div>

				<div className="mt-3 flex items-center gap-3">
					<button
						type="button"
						onClick={() => void save()}
						disabled={saving || !dirty}
						className="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{saving ? 'Saving…' : 'Save'}
					</button>
					{!dirty && savedAt && !error && (
						<span className="text-xs text-zinc-500">
							Saved {savedAt.toLocaleTimeString()}
						</span>
					)}
					{error && <span className="text-xs text-red-400">{error}</span>}
					{dirty && !error && (
						<span className="text-xs text-zinc-500">Unsaved changes</span>
					)}
				</div>
			</div>
		</section>
	);
}

const SENSITIVE: ReadonlySet<ConfigKey> = new Set([
	'STEAM_API_KEY',
	'OPENCRITIC_API_KEY',
	'YOUTUBE_API_KEY',
	'AI_API_KEY',
]);

function isMaskedValue(v: string): boolean {
	// Server returns "••••" or "••••<last4>" for sensitive masked values.
	return v.startsWith('••••');
}

function FieldGroup({
	title,
	subtitle,
	children,
}: {
	title: string;
	subtitle?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="p-4 space-y-3">
			<div>
				<div className="text-sm font-medium text-zinc-200">{title}</div>
				{subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
			</div>
			<div className="space-y-2">{children}</div>
		</div>
	);
}

/**
 * AI provider section — radio-driven. The user picks ONE of:
 *   - None   (no AI, search is keyword-only)
 *   - Local Ollama  (one URL + optional model overrides)
 *   - Cloud (OpenAI/Groq/etc.)  (URL + key + model names)
 *
 * The model fields render with mode-aware hints — Ollama mode shows the
 * default model names (which actually work); cloud mode shows examples
 * (no default works generically since "qwen3:14b" isn't an OpenAI model).
 *
 * Switching modes clears the fields the OTHER mode uses, so a Save
 * doesn't leave both options set (which the backend would resolve in
 * cloud's favor and silently ignore the Ollama URL).
 */
type AIMode = 'none' | 'ollama' | 'cloud';

function AIProviderSection(props: {
	valueFor: (k: ConfigKey) => string;
	setValueFor: (k: ConfigKey, v: string) => void;
	revealed: Set<ConfigKey>;
	onReveal: (k: ConfigKey) => Promise<void>;
	requiredMissing: string[];
	loadedSnapshot: Partial<Record<ConfigKey, string>>;
}) {
	const { valueFor, setValueFor, loadedSnapshot } = props;
	const ollamaUrl = valueFor('OLLAMA_URL').trim();
	const aiBaseUrl = valueFor('AI_BASE_URL').trim();
	const aiApiKey = valueFor('AI_API_KEY').trim();

	// The user's "intent" is derived from which fields actually have
	// values. AI_BASE_URL wins over OLLAMA_URL (matches resolve() in
	// src/lib/ai.ts), so cloud takes precedence when both are filled.
	const detectedMode: AIMode = aiBaseUrl
		? 'cloud'
		: ollamaUrl
			? 'ollama'
			: 'none';

	// Local mode toggle. Initialised once from the loaded snapshot via
	// `detectedMode`; after that, the user's explicit clicks are
	// authoritative. We deliberately do NOT re-sync to detectedMode on
	// every render — doing so created a flicker where Save would clear
	// the draft, briefly read stale loaded values, and snap the toggle
	// back to the previous mode before settling on the right one.
	const [mode, setMode] = useState<AIMode>(detectedMode);
	// Re-init only when an external change makes loaded look meaningfully
	// different from the user's chosen mode (e.g. an outside save). We
	// gate on `loadedSnapshot` reference so it only fires when the parent
	// actually swaps loaded, not on every render.
	useEffect(() => {
		setMode(detectedMode);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loadedSnapshot]);

	function changeMode(next: AIMode) {
		setMode(next);
		// Clear fields belonging to the OTHER mode so a Save commits a
		// clean intent. Empty string deletes the row server-side.
		if (next === 'none') {
			setValueFor('OLLAMA_URL', '');
			setValueFor('AI_BASE_URL', '');
			setValueFor('AI_API_KEY', '');
			setValueFor('AI_CHAT_MODEL', '');
			setValueFor('AI_EMBED_MODEL', '');
		} else if (next === 'ollama') {
			setValueFor('AI_BASE_URL', '');
			setValueFor('AI_API_KEY', '');
			// Pre-fill the Ollama defaults so the user sees real values in
			// the inputs they can edit or just save. Only fill empty
			// fields — preserve anything already set.
			if (!valueFor('OLLAMA_URL').trim())
				setValueFor('OLLAMA_URL', 'http://host.docker.internal:11434');
			if (!valueFor('AI_CHAT_MODEL').trim())
				setValueFor('AI_CHAT_MODEL', 'qwen3:14b');
			if (!valueFor('AI_EMBED_MODEL').trim())
				setValueFor('AI_EMBED_MODEL', 'nomic-embed-text');
		} else if (next === 'cloud') {
			setValueFor('OLLAMA_URL', '');
			// Don't pre-fill cloud fields — there's no default that works
			// generically (different providers use different model names).
			// User must type their own.
		}
	}

	return (
		<div className="p-4 space-y-3">
			<div>
				<div className="text-sm font-medium text-zinc-200">
					AI provider (optional)
				</div>
				<p className="text-xs text-zinc-500 mt-0.5">
					Powers semantic search and vibe-chip generation. Without it, search
					falls back to keyword-only and vibe chips become a static list.
				</p>
			</div>
			<div className="flex flex-wrap gap-2">
				<ModeButton
					active={mode === 'none'}
					onClick={() => changeMode('none')}
					label="None"
					hint="Keyword search only"
				/>
				<ModeButton
					active={mode === 'ollama'}
					onClick={() => changeMode('ollama')}
					label="Local Ollama"
					hint="Free, private, runs on your machine"
				/>
				<ModeButton
					active={mode === 'cloud'}
					onClick={() => changeMode('cloud')}
					label="Cloud provider"
					hint="OpenAI, Groq, Together, …"
				/>
			</div>

			<AIPreview
				mode={mode}
				ollamaUrl={ollamaUrl}
				aiBaseUrl={aiBaseUrl}
				aiApiKey={aiApiKey}
				loadedSnapshot={loadedSnapshot}
			/>

			{mode === 'none' && (
				<p className="text-xs text-zinc-500">
					No AI configured. You can come back here any time.
				</p>
			)}

			{mode === 'ollama' && (
				<div className="space-y-2 pt-2 border-t border-zinc-800/60">
					<ConfigField
						{...props}
						keyName="OLLAMA_URL"
						label="Ollama URL"
						helpUrl="https://ollama.com/download"
						helpUrlLabel="Get Ollama"
					/>
					<ConfigField {...props} keyName="AI_CHAT_MODEL" label="Chat model" />
					<ConfigField
						{...props}
						keyName="AI_EMBED_MODEL"
						label="Embed model"
					/>
					<p className="text-[11px] text-zinc-500">
						Defaults shown above. Make sure you've pulled both models in Ollama
						(<code className="text-zinc-400">ollama pull &lt;name&gt;</code>)
						before hitting Save.
					</p>
				</div>
			)}

			{mode === 'cloud' && (
				<div className="space-y-2 pt-2 border-t border-zinc-800/60">
					<ConfigField
						{...props}
						keyName="AI_BASE_URL"
						label="API base URL"
						helpText="Required. Your provider's OpenAI-compatible URL. For OpenAI: https://api.openai.com/v1"
					/>
					<ConfigField
						{...props}
						keyName="AI_API_KEY"
						label="API key"
						sensitive
						helpText="Required. From your provider's dashboard."
					/>
					<ConfigField
						{...props}
						keyName="AI_CHAT_MODEL"
						label="Chat model"
						helpText="Required. A model name your provider serves. For OpenAI: gpt-4o-mini works well."
					/>
					<ConfigField
						{...props}
						keyName="AI_EMBED_MODEL"
						label="Embed model"
						helpText="Required. An embedding model. For OpenAI: text-embedding-3-small works well."
					/>
				</div>
			)}
		</div>
	);
}

/**
 * Live "what's about to be saved" line under the mode buttons. Tells
 * the user EXACTLY what AI provider is about to be configured (or what
 * the form is missing), AND whether that matches the currently-saved
 * state. Without this the user picks 'Local Ollama', sees the fields
 * fill in, and is confused that the page header still says "AI: Disabled"
 * — that header reads /health which only updates after Save.
 */
function AIPreview({
	mode,
	ollamaUrl,
	aiBaseUrl,
	aiApiKey,
	loadedSnapshot,
}: {
	mode: AIMode;
	ollamaUrl: string;
	aiBaseUrl: string;
	aiApiKey: string;
	loadedSnapshot: Partial<Record<ConfigKey, string>>;
}) {
	let kind: 'ok' | 'warn' | 'missing' = 'ok';
	let preview = '';

	if (mode === 'none') {
		preview = 'AI off — semantic search disabled, vibe chips static.';
	} else if (mode === 'ollama') {
		if (!ollamaUrl) {
			kind = 'missing';
			preview = 'Ollama URL is empty — fill it in to enable AI.';
		} else {
			preview = `Will use local Ollama at ${ollamaUrl}.`;
		}
	} else {
		// cloud
		if (!aiBaseUrl) {
			kind = 'missing';
			preview = 'API base URL is empty — fill it in to enable AI.';
		} else if (!aiApiKey) {
			kind = 'missing';
			preview = `API base URL set (${aiBaseUrl}) but key is empty — fill it in.`;
		} else {
			preview = `Will use cloud provider at ${aiBaseUrl}.`;
		}
	}

	// Compare the form's effective intent against the loaded (saved) state
	// so we can tell the user "this matches what's already saved" vs.
	// "click Save to apply."
	const savedOllama = (loadedSnapshot.OLLAMA_URL ?? '').trim();
	const savedBase = (loadedSnapshot.AI_BASE_URL ?? '').trim();
	// Note: saved API key arrives masked (••••<last4>) — we only check
	// presence, not equality. Good enough for the active/unsaved check.
	const savedKeyPresent = (loadedSnapshot.AI_API_KEY ?? '').trim().length > 0;
	const savedMode: AIMode = savedBase
		? 'cloud'
		: savedOllama
			? 'ollama'
			: 'none';
	const matchesSaved =
		mode === savedMode &&
		(mode === 'none' ||
			(mode === 'ollama' && ollamaUrl === savedOllama) ||
			(mode === 'cloud' &&
				aiBaseUrl === savedBase &&
				// If the user typed a new key, it's an unsaved change. If
				// they kept the masked placeholder, it matches saved.
				(isMaskedValue(aiApiKey)
					? savedKeyPresent
					: !aiApiKey && !savedKeyPresent)));

	const status =
		kind === 'missing'
			? "Won't save (incomplete)"
			: matchesSaved
				? 'Active'
				: 'Click Save to apply';

	const style =
		kind === 'missing'
			? 'border-red-700 bg-red-950/40 text-red-100'
			: matchesSaved
				? 'border-emerald-700 bg-emerald-950/40 text-emerald-200'
				: 'border-sky-700 bg-sky-950/40 text-sky-100';

	return (
		<div
			className={`rounded-md border px-3 py-1.5 text-xs flex items-baseline justify-between gap-3 ${style}`}
		>
			<span>{preview}</span>
			<span className="text-[10px] uppercase tracking-wider opacity-80 whitespace-nowrap">
				{status}
			</span>
		</div>
	);
}

function ModeButton({
	active,
	onClick,
	label,
	hint,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
	hint: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`flex-1 min-w-[140px] text-left px-3 py-2 rounded-md border transition-colors ${
				active
					? 'border-emerald-600 bg-emerald-950/40 text-emerald-100'
					: 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
			}`}
		>
			<div className="text-xs font-semibold flex items-center gap-1.5">
				<span aria-hidden>{active ? '●' : '○'}</span>
				{label}
			</div>
			<div className="text-[10px] text-zinc-500 mt-0.5">{hint}</div>
		</button>
	);
}

function ConfigField({
	keyName,
	label,
	sensitive = false,
	helpUrl,
	helpUrlLabel,
	helpText,
	valueFor,
	setValueFor,
	revealed,
	onReveal,
	requiredMissing,
}: {
	keyName: ConfigKey;
	label: string;
	sensitive?: boolean;
	helpUrl?: string;
	helpUrlLabel?: string;
	/**
	 * Always-visible description below the field. Use for "what is this
	 * field, where do you get it" copy. Defaults are pre-filled into
	 * the input value at the parent level (see ConfigurationSection's
	 * mount effect + AIProviderSection's mode switch) — never as
	 * placeholder text.
	 */
	helpText?: string;
	valueFor: (k: ConfigKey) => string;
	setValueFor: (k: ConfigKey, v: string) => void;
	revealed: Set<ConfigKey>;
	onReveal: (k: ConfigKey) => Promise<void>;
	requiredMissing: string[];
}) {
	const value = valueFor(keyName);
	const isMissing = requiredMissing.includes(keyName);
	const isSensitiveMasked =
		sensitive && isMaskedValue(value) && !revealed.has(keyName);
	return (
		<div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:items-center">
			<label
				htmlFor={`cfg-${keyName}`}
				className={`text-xs ${isMissing ? 'text-amber-300' : 'text-zinc-400'}`}
				title={keyName}
			>
				{label}
			</label>
			<div className="flex items-center gap-1.5">
				<input
					id={`cfg-${keyName}`}
					type={isSensitiveMasked ? 'password' : 'text'}
					value={value}
					onChange={(e) => setValueFor(keyName, e.target.value)}
					onFocus={(e) => {
						// Clicking into a masked field clears the placeholder
						// dots so the user types into an empty box, not into
						// "••••6122". They can still cancel by blurring without
						// typing.
						if (isSensitiveMasked) {
							setValueFor(keyName, '');
							e.target.type = 'text';
						}
					}}
					className={`flex-1 min-w-0 bg-zinc-950 border rounded px-2 py-1 text-sm font-mono focus:outline-none ${
						isMissing
							? 'border-amber-700 focus:border-amber-500'
							: 'border-zinc-800 focus:border-zinc-600'
					}`}
				/>
				{sensitive && value && isMaskedValue(value) && (
					<button
						type="button"
						onClick={() => void onReveal(keyName)}
						title="Reveal current value"
						className="text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200 px-1.5"
					>
						Reveal
					</button>
				)}
				{helpUrl && (
					<button
						type="button"
						onClick={() => void rpc.request.openUrl({ url: helpUrl })}
						title={helpUrl}
						className="text-[10px] uppercase tracking-wider text-zinc-500 hover:text-zinc-200 px-1.5"
					>
						{helpUrlLabel ?? 'Help'} ↗
					</button>
				)}
			</div>
			{helpText && (
				<>
					<div /> {/* spacer to align with the label column */}
					<p className="text-[11px] text-zinc-500 -mt-1">{helpText}</p>
				</>
			)}
		</div>
	);
}

/**
 * Settings → Updates: shows current version, last check, and lets the
 * user force an immediate check. The actual update polling is driven by
 * the bun side (see startUpdaterPolling in src/bun/rpc.ts).
 */
function UpdatesSubsection() {
	const [u, setU] = useState<UpdaterStatus | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		void rpc.request
			.updaterStatus({})
			.then(setU)
			.catch(() => setU(null));
	}, []);

	async function checkNow() {
		setBusy(true);
		try {
			const next = await rpc.request.updaterCheckNow({});
			setU(next);
		} catch (e) {
			console.warn('updater check failed', e);
		} finally {
			setBusy(false);
		}
	}

	const rows: { label: string; value: string }[] = [
		{ label: 'Current version', value: u?.currentVersion ?? '—' },
		{
			label: 'Last check',
			value: u?.lastChecked
				? new Date(u.lastChecked).toLocaleString()
				: 'Never',
		},
		{
			label: 'Status',
			value: u?.updateAvailable
				? `Update v${u.latestVersion ?? '?'} available`
				: u?.lastError
					? `Error: ${u.lastError}`
					: 'Up to date',
		},
	];

	const RELEASES_URL = 'https://github.com/KevinBatdorf/fglt/releases/latest';

	return (
		<div>
			<div className="flex items-baseline justify-between mb-2">
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 font-semibold">
					Updates
				</h2>
				<div className="flex items-center gap-3">
					{u?.updateAvailable && (
						<button
							type="button"
							onClick={() =>
								void rpc.request.openUrl({ url: RELEASES_URL }).catch(() => {})
							}
							className="text-xs text-emerald-400 hover:text-emerald-300"
						>
							Download from GitHub
						</button>
					)}
					<button
						type="button"
						onClick={() => void checkNow()}
						disabled={busy}
						className="text-xs text-zinc-500 hover:text-zinc-200 disabled:opacity-50"
					>
						{busy ? 'Checking…' : 'Check now'}
					</button>
				</div>
			</div>
			<dl className="bg-zinc-900 border border-zinc-800 rounded-md py-2 px-3 text-xs space-y-1.5">
				{rows.map((r) => (
					<div key={r.label} className="grid grid-cols-[140px_1fr] gap-2">
						<dt className="text-zinc-500">{r.label}</dt>
						<dd className="text-zinc-200 break-words">{r.value}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}
