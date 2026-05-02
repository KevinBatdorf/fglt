import { useEffect, useState } from 'react';
import type { UpdaterStatus } from '../shared/types';
import { api, type HealthStatus } from './lib/api';
import { rpc } from './lib/rpc';

/**
 * Top-of-window banner that surfaces setup gaps so a user with Docker
 * down (or a missing Steam key) sees what's wrong instead of a silent
 * empty UI. Polls /health every 30s. The first reachable state wins,
 * shown in this priority order:
 *
 *   1. API unreachable        — red, "Is Docker running?"
 *   2. DB down                — red, "API up but Postgres isn't"
 *   3. Missing STEAM_API_KEY  — amber, link to dev page
 *   4. Missing STEAM_ID       — amber
 *   5. Empty library          — blue, suggest manual sync
 *   6. All healthy            — no banner
 *
 * Dismiss is per-session (sessionStorage); a new app launch shows it
 * again if the underlying problem is still there.
 */

const POLL_MS = 30_000;
const DISMISS_KEY = 'seg.health.dismissedKey';

type BannerState =
	| { kind: 'ok' }
	| { kind: 'unreachable' }
	| { kind: 'db_down'; health: HealthStatus }
	| { kind: 'missing_steam_key'; health: HealthStatus }
	| { kind: 'missing_steam_id'; health: HealthStatus }
	| { kind: 'empty_library'; health: HealthStatus }
	| { kind: 'update_ready'; updater: UpdaterStatus };

function deriveState(
	health: HealthStatus | null,
	reachable: boolean,
	updater: UpdaterStatus | null,
): BannerState {
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
}

export function HealthBanner({ onOpenSetupGuide }: BannerProps = {}) {
	const [health, setHealth] = useState<HealthStatus | null>(null);
	const [reachable, setReachable] = useState(true);
	const [updater, setUpdater] = useState<UpdaterStatus | null>(null);
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

	const state = deriveState(health, reachable, updater);
	if (state.kind === 'ok') return null;
	if (dismissed === dismissKeyFor(state)) return null;

	const variant: Record<BannerState['kind'], string> = {
		ok: '',
		unreachable: 'bg-red-950/80 border-red-800 text-red-100',
		db_down: 'bg-red-950/80 border-red-800 text-red-100',
		missing_steam_key: 'bg-amber-950/80 border-amber-800 text-amber-100',
		missing_steam_id: 'bg-amber-950/80 border-amber-800 text-amber-100',
		empty_library: 'bg-sky-950/80 border-sky-800 text-sky-100',
		update_ready: 'bg-emerald-950/80 border-emerald-800 text-emerald-100',
	};

	const isUpdateReady = state.kind === 'update_ready';

	return (
		<div
			className={`flex items-start gap-3 px-4 py-2 border-b text-sm ${variant[state.kind]}`}
		>
			<div className="flex-1 leading-relaxed">
				<HealthMessage state={state} />
			</div>
			{state.kind === 'unreachable' && onOpenSetupGuide && (
				<button
					type="button"
					onClick={onOpenSetupGuide}
					className="text-xs px-2 py-1 rounded bg-black/20 hover:bg-black/30 transition-colors whitespace-nowrap"
				>
					Open setup guide ↗
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
			) : (
				<button
					type="button"
					onClick={() => void pollHealth()}
					className="text-xs px-2 py-1 rounded bg-black/20 hover:bg-black/30 transition-colors whitespace-nowrap"
				>
					Retry
				</button>
			)}
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
		</div>
	);
}

function HealthMessage({ state }: { state: BannerState }) {
	switch (state.kind) {
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
