import { useEffect, useState } from 'react';
import type { DockerStatus, UpdaterStatus } from '../shared/types';
import { api, type HealthStatus } from './lib/api';
import { rpc } from './lib/rpc';

/**
 * Top-of-window banner that surfaces setup gaps so a user sees what's
 * wrong instead of a silent empty UI. Polls /health every 30s and
 * receives `docker` snapshots from App.tsx (which polls the bun side
 * on a 3s cadence whenever the API is unreachable).
 *
 * Priority (first match wins):
 *
 *   1. Docker not installed     — red, link to setup guide
 *   2. Docker daemon down       — amber, "start Docker Desktop"
 *   3. Backend starting         — sky, spinner
 *   4. Backend stopped          — amber, [Start backend] button
 *   5. API unreachable (other)  — red, retry / setup guide
 *   6. DB down                  — red
 *   7. Missing STEAM_API_KEY    — amber, link to Settings
 *   8. Missing STEAM_ID         — amber
 *   9. Empty library            — sky
 *  10. Update ready             — emerald
 *  11. All healthy              — no banner
 *
 * Dismiss is per-session (sessionStorage); a new app launch shows it
 * again if the underlying problem is still there.
 */

const POLL_MS = 30_000;
const DISMISS_KEY = 'fglt.health.dismissedKey';

type BannerState =
	| { kind: 'ok' }
	| { kind: 'docker_not_installed' }
	| { kind: 'docker_daemon_down' }
	| { kind: 'backend_starting' }
	| { kind: 'backend_stopped' }
	| { kind: 'unreachable' }
	| { kind: 'db_down'; health: HealthStatus }
	| { kind: 'missing_steam_key'; health: HealthStatus }
	| { kind: 'missing_steam_id'; health: HealthStatus }
	| { kind: 'empty_library'; health: HealthStatus }
	| { kind: 'update_ready'; updater: UpdaterStatus };

function deriveState(
	health: HealthStatus | null,
	reachable: boolean,
	docker: DockerStatus | null,
	updater: UpdaterStatus | null,
): BannerState {
	// Docker-related states always win over plain "unreachable" — they
	// give the user something concrete to do, vs. a generic "API is
	// down." Once docker reports `running` we fall through to the API/
	// health checks.
	if (docker) {
		if (docker.kind === 'not_installed')
			return { kind: 'docker_not_installed' };
		if (docker.kind === 'daemon_down') return { kind: 'docker_daemon_down' };
		if (docker.kind === 'starting') return { kind: 'backend_starting' };
		if (
			docker.kind === 'containers_missing' ||
			docker.kind === 'containers_stopped'
		)
			return { kind: 'backend_stopped' };
	}
	if (!reachable) return { kind: 'unreachable' };
	if (!health) return { kind: 'unreachable' };
	if (health.db === 'down') return { kind: 'db_down', health };
	if (health.steam_key === 'missing')
		return { kind: 'missing_steam_key', health };
	if (health.steam_id === 'missing')
		return { kind: 'missing_steam_id', health };
	if (health.total_games === 0) return { kind: 'empty_library', health };
	if (updater?.updateReady) return { kind: 'update_ready', updater };
	return { kind: 'ok' };
}

/** Stable key so dismissing one issue doesn't suppress a later, different one. */
function dismissKeyFor(state: BannerState): string {
	return state.kind;
}

interface BannerProps {
	/**
	 * Called when the user clicks "Open setup guide" from the unreachable
	 * banner. The page works without an API connection, so it's safe to
	 * navigate to even when nothing else is reachable.
	 */
	onOpenSetupGuide?: () => void;
	/**
	 * Latest Docker stack snapshot from App.tsx. Lets the banner show
	 * actionable Docker-aware messages ("Docker isn't installed",
	 * "Backend stopped — Start backend") instead of a generic
	 * "API unreachable."
	 */
	docker?: DockerStatus | null;
}

export function HealthBanner({ onOpenSetupGuide, docker }: BannerProps = {}) {
	const [health, setHealth] = useState<HealthStatus | null>(null);
	const [reachable, setReachable] = useState(true);
	const [updater, setUpdater] = useState<UpdaterStatus | null>(null);
	const [busy, setBusy] = useState(false);
	// Hold the banner until we've actually polled at least once. Without
	// this we show "API unreachable" for ~500ms on every cold start
	// because the initial state defaults to `health=null` which derives
	// to "unreachable", before the first fetch even completes.
	const [hasPolledHealth, setHasPolledHealth] = useState(false);
	const [dismissed, setDismissed] = useState<string | null>(() => {
		try {
			return sessionStorage.getItem(DISMISS_KEY);
		} catch {
			return null;
		}
	});

	async function pollHealth() {
		try {
			const h = await api.health();
			setHealth(h);
			setReachable(true);
		} catch {
			setReachable(false);
			setHealth(null);
		} finally {
			setHasPolledHealth(true);
		}
	}

	async function pollUpdater() {
		try {
			const u = await rpc.request.updaterStatus({});
			setUpdater(u);
		} catch {
			/* updater unavailable in browser stub */
		}
	}

	useEffect(() => {
		void pollHealth();
		void pollUpdater();
		const t = setInterval(() => {
			void pollHealth();
			void pollUpdater();
		}, POLL_MS);
		return () => clearInterval(t);
	}, []);

	// Suppress the banner during the initial-data window. We need both:
	//   (a) at least one health poll to complete (success or fail), and
	//   (b) docker status from App.tsx, which arrives a tick after mount.
	// Without (b), a cold start where docker IS running flashes the red
	// "API unreachable" banner before the first docker tick swaps it for
	// "Backend starting".
	if (!hasPolledHealth || docker === null || docker === undefined) return null;

	const state = deriveState(health, reachable, docker ?? null, updater);
	if (state.kind === 'ok') return null;
	if (dismissed === dismissKeyFor(state)) return null;

	const variant: Record<BannerState['kind'], string> = {
		ok: '',
		docker_not_installed: 'bg-red-950/80 border-red-800 text-red-100',
		docker_daemon_down: 'bg-amber-950/80 border-amber-800 text-amber-100',
		backend_starting: 'bg-sky-950/80 border-sky-800 text-sky-100',
		backend_stopped: 'bg-amber-950/80 border-amber-800 text-amber-100',
		unreachable: 'bg-red-950/80 border-red-800 text-red-100',
		db_down: 'bg-red-950/80 border-red-800 text-red-100',
		missing_steam_key: 'bg-amber-950/80 border-amber-800 text-amber-100',
		missing_steam_id: 'bg-amber-950/80 border-amber-800 text-amber-100',
		empty_library: 'bg-sky-950/80 border-sky-800 text-sky-100',
		update_ready: 'bg-emerald-950/80 border-emerald-800 text-emerald-100',
	};

	const isUpdateReady = state.kind === 'update_ready';
	const isStarting = state.kind === 'backend_starting';
	const isStopped = state.kind === 'backend_stopped';

	async function handleStartBackend() {
		setBusy(true);
		try {
			const r = await rpc.request.dockerStart({});
			if (!r.ok) console.warn('docker start failed', r.error);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div
			className={`flex items-start gap-3 px-4 py-2 border-b text-sm ${variant[state.kind]}`}
		>
			<div className="flex-1 leading-relaxed">
				<HealthMessage state={state} />
			</div>
			{(state.kind === 'unreachable' ||
				state.kind === 'docker_not_installed') &&
				onOpenSetupGuide && (
					<button
						type="button"
						onClick={onOpenSetupGuide}
						className="text-xs px-2 py-1 rounded bg-black/20 hover:bg-black/30 transition-colors whitespace-nowrap"
					>
						Open setup guide ↗
					</button>
				)}
			{isStopped && (
				<button
					type="button"
					onClick={() => void handleStartBackend()}
					disabled={busy}
					className="text-xs px-2 py-1 rounded bg-black/20 hover:bg-black/30 transition-colors whitespace-nowrap disabled:opacity-50"
				>
					{busy ? 'Starting…' : 'Start backend'}
				</button>
			)}
			{isUpdateReady ? (
				<button
					type="button"
					onClick={async () => {
						const r = await rpc.request.updaterApply({});
						if (!r.ok) {
							console.warn('updater apply failed', r.error);
						}
					}}
					className="text-xs px-2 py-1 rounded bg-black/20 hover:bg-black/30 transition-colors whitespace-nowrap"
				>
					Restart now
				</button>
			) : isStarting ? // No retry/dismiss while we're actively starting — the
			// docker-status poll will flip the banner to whatever comes
			// next (running → banner disappears, stopped → "Start backend").
			null : (
				<button
					type="button"
					onClick={() => void pollHealth()}
					className="text-xs px-2 py-1 rounded bg-black/20 hover:bg-black/30 transition-colors whitespace-nowrap"
				>
					Retry
				</button>
			)}
			{!isStarting && (
				<button
					type="button"
					onClick={() => {
						const k = dismissKeyFor(state);
						try {
							sessionStorage.setItem(DISMISS_KEY, k);
						} catch {
							/* ignore */
						}
						setDismissed(k);
					}}
					className="text-xs px-2 py-1 rounded bg-black/20 hover:bg-black/30 transition-colors whitespace-nowrap"
					title="Hide for this session"
				>
					{isUpdateReady ? 'Later' : 'Dismiss'}
				</button>
			)}
		</div>
	);
}

function HealthMessage({ state }: { state: BannerState }) {
	switch (state.kind) {
		case 'docker_not_installed':
			return (
				<>
					<strong>Docker isn't installed.</strong> The app needs Docker Desktop
					to run its local database — the setup guide has links per OS.
				</>
			);
		case 'docker_daemon_down':
			return (
				<>
					<strong>Docker isn't running.</strong> Start Docker Desktop — the app
					will connect automatically.
				</>
			);
		case 'backend_starting':
			return (
				<>
					<span className="inline-block animate-spin mr-2" aria-hidden>
						⟳
					</span>
					<strong>Starting backend…</strong> First launch builds the API image
					locally — this is a one-time ~3 min setup. Every launch after this is
					instant.
				</>
			);
		case 'backend_stopped':
			return (
				<>
					<strong>Backend is stopped.</strong> Click "Start backend" to bring it
					back up. (Background syncs don't run while it's down.)
				</>
			);
		case 'unreachable':
			return (
				<>
					<strong>Can't reach the local backend.</strong> The setup guide walks
					through getting Docker running so the app has a database to talk to.
				</>
			);
		case 'db_down':
			return (
				<>
					<strong>Database isn't ready.</strong> The API is up but Postgres
					isn't responding — usually a container restart fixes it. Check{' '}
					<code className="font-mono">docker compose logs postgres</code>.
				</>
			);
		case 'missing_steam_key':
			return (
				<>
					<strong>Steam API key isn't set.</strong> Library sync won't work
					without it. Set it in <strong>Settings → Configuration</strong>.
				</>
			);
		case 'missing_steam_id':
			return (
				<>
					<strong>Steam ID isn't set.</strong> Set it in{' '}
					<strong>Settings → Configuration</strong>.
				</>
			);
		case 'empty_library':
			return (
				<>
					<strong>No games yet.</strong> Open <strong>Settings → Sync</strong>{' '}
					and click "Sync Steam now" to pull your library, or wait for the daily
					syncer cron.
				</>
			);
		case 'update_ready':
			return (
				<>
					<strong>Update v{state.updater.latestVersion} ready.</strong> Restart
					the app to apply.
				</>
			);
		default:
			return null;
	}
}
