import { useEffect, useState } from "react";
import { GameImage } from "./GameImage";
import { type ActivityResponse, type Stats, api } from "./lib/api";

interface Props {
	stats: Stats | null;
	onStatsRefresh: () => void;
}

export function Settings({ stats, onStatsRefresh }: Props) {
	const [activity, setActivity] = useState<ActivityResponse | null>(null);
	const [activityErr, setActivityErr] = useState<string | null>(null);
	const [syncing, setSyncing] = useState(false);
	const [syncMsg, setSyncMsg] = useState<string | null>(null);

	useEffect(() => {
		api.activity().then(setActivity).catch((e) => setActivityErr(e.message));
	}, []);

	async function handleSync() {
		setSyncing(true);
		setSyncMsg(null);
		try {
			const r = await api.syncOwned();
			setSyncMsg(`Steam sync ok — ${r.total} games owned${r.removed ? ` (${r.removed} removed)` : ""}`);
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

			<section>
				<h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-semibold">
					Library status
				</h2>
				<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
					<StatTile label="Total games" value={stats?.total ?? "—"} />
					<StatTile label="Multi-platform" value={stats?.multi_platform ?? "—"} />
					<StatTile label="Played" value={stats?.played ?? "—"} />
					<StatTile label="Unplayed" value={stats?.unplayed ?? "—"} />
					<StatTile label="Steam" value={stats?.platforms.steam ?? "—"} />
					<StatTile label="Epic" value={stats?.platforms.epic ?? "—"} />
					<StatTile label="GOG" value={stats?.platforms.gog ?? "—"} />
					<StatTile
						label="Total playtime"
						value={
							stats?.total_playtime_min
								? `${Math.round(Number(stats.total_playtime_min) / 60).toLocaleString()}h`
								: "—"
						}
					/>
					<StatTile label="Enriched" value={stats?.enriched ?? "—"} />
					<StatTile label="Embedded" value={stats?.embedded ?? "—"} />
				</div>
				<div className="mt-3 text-xs text-zinc-500">
					{stats?.meta?.find((m) => m.key === "last_sync") && (
						<>
							Last Steam sync:{" "}
							{new Date(
								stats.meta.find((m) => m.key === "last_sync")?.value ?? Date.now(),
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
						{syncing ? "Syncing…" : "Sync Steam now"}
					</button>
					{syncMsg && (
						<div className="text-xs text-zinc-500 font-mono">{syncMsg}</div>
					)}
				</div>
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
					Filters
				</h2>
				<div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 space-y-2 text-sm text-zinc-300">
					<div className="font-medium">Hide non-game genres (always on)</div>
					<p className="text-xs text-zinc-500">
						Curated views (home, trending, recommended, etc.) hide Steam apps
						with these genres so benchmarks and creator tools don't anchor
						recommendations:
					</p>
					<div className="flex flex-wrap gap-1.5 mt-1">
						{[
							"Utilities",
							"Software Training",
							"Web Publishing",
							"Audio Production",
							"Video Production",
							"Animation & Modeling",
							"Game Development",
							"Photo Editing",
							"Education",
							"Design & Illustration",
							"Documentary",
						].map((g) => (
							<span
								key={g}
								className="text-xs px-2 py-0.5 rounded bg-zinc-800 text-zinc-300"
							>
								{g}
							</span>
						))}
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
							<StatTile label="Added (24h)" value={activity.counts.games_added_24h} />
							<StatTile label="Enriched (24h)" value={activity.counts.enriched_24h} />
							<StatTile label="Embedded (24h)" value={activity.counts.embedded_24h} />
							<StatTile label="Videos (24h)" value={activity.counts.videos_fetched_24h} />
							<StatTile label="Added (7d)" value={activity.counts.games_added_7d} />
							<StatTile label="Enriched (7d)" value={activity.counts.enriched_7d} />
							<StatTile label="Videos (7d)" value={activity.counts.videos_fetched_7d} />
						</div>

						<ActivityRow
							title="Recently added games"
							items={activity.recent_added.map((g) => ({
								appid: g.appid,
								name: g.name,
								header_image: g.header_image,
								secondary: new Date(g.created_at).toLocaleString(),
							}))}
						/>
						<ActivityRow
							title="Recently enriched"
							items={activity.recent_enriched.map((g) => ({
								appid: g.appid,
								name: g.name,
								header_image: g.header_image,
								secondary: new Date(g.enriched_at).toLocaleString(),
							}))}
						/>
						<ActivityRow
							title="Recently fetched videos"
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
				{typeof value === "number" ? value.toLocaleString() : value}
			</div>
		</div>
	);
}

function ActivityRow({
	title,
	items,
}: {
	title: string;
	items: { appid: number; name: string; header_image: string | null; secondary: string }[];
}) {
	if (items.length === 0) return null;
	return (
		<div className="mb-4">
			<h3 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">
				{title}
			</h3>
			<ul className="space-y-1">
				{items.map((it) => (
					<li
						key={it.appid}
						className="flex items-center gap-3 px-2 py-1.5 rounded hover:bg-zinc-900 text-sm"
					>
						<GameImage
							appid={it.appid}
							name={it.name}
							variant="header"
							fallback={it.header_image}
							className="w-16 h-7 object-cover rounded bg-zinc-900"
						/>
						<span className="flex-1 text-zinc-200 truncate">{it.name}</span>
						<span className="text-xs text-zinc-500 tabular-nums">
							{it.secondary}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}
