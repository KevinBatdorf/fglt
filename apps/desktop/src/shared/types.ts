/**
 * Types shared between the Bun main process and the React webview.
 * Imported on both sides for typed RPC.
 */
import type { RPCSchema } from 'electrobun/bun';

export type Platform = 'steam' | 'epic' | 'gog';

export interface InstalledIndex {
	steam: number[]; // Steam appids
	epic: string[]; // Epic app_name values (Legendary catalog ids)
	gog: string[]; // GOG product ids as strings
}

export interface LaunchResult {
	ok: boolean;
	error?: string;
}

export type RefreshSource =
	| 'all'
	| 'steam_appdetails'
	| 'steam_reviews'
	| 'opencritic'
	| 'youtube';

export interface RefreshResult {
	appid: number;
	name: string;
	source: RefreshSource;
	sources: Record<string, { status: string; detail?: unknown }>;
}

/**
 * Snapshot of the bundled Docker stack from the desktop's perspective.
 * The desktop app shells out to `docker` on the user's behalf so they
 * never need a terminal — this union is what those helpers return.
 *
 *   not_installed       — docker CLI isn't on PATH (and not at the
 *                         Docker Desktop default install path on Win).
 *   daemon_down         — CLI present, daemon not responding (Docker
 *                         Desktop is closed).
 *   containers_missing  — daemon up, fglt-* containers were never
 *                         created (fresh-install case).
 *   containers_stopped  — containers exist but aren't running (user
 *                         clicked "Stop backend" in Settings, or they
 *                         crashed).
 *   starting            — we just kicked off `up -d`; the timestamp
 *                         (epoch ms) is included so the UI can time
 *                         out the spinner.
 *   running             — fglt-api container is up; the API will
 *                         respond shortly if it isn't already.
 */
export type DockerStatus =
	| { kind: 'not_installed' }
	| { kind: 'daemon_down' }
	| { kind: 'containers_missing' }
	| { kind: 'containers_stopped' }
	| { kind: 'starting'; since: number }
	| { kind: 'running' };

/** Snapshot of the auto-updater's polling state. */
export interface UpdaterStatus {
	currentVersion: string | null;
	updateAvailable: boolean;
	updateReady: boolean;
	latestVersion: string | null;
	lastChecked: string | null; // ISO timestamp of the most recent check
	lastError: string | null;
	checking: boolean;
}

export type FgltRPC = {
	bun: RPCSchema<{
		requests: {
			launch: {
				params: { platform: Platform; externalId: string; appid: number };
				response: LaunchResult;
			};
			getInstalledIndex: {
				params: Record<string, never>;
				response: InstalledIndex;
			};
			refreshGame: {
				params: { appid: number; source?: RefreshSource };
				response: RefreshResult;
			};
			openUrl: { params: { url: string }; response: { ok: boolean } };
			windowAction: {
				params: {
					action:
						| 'minimize'
						| 'maximize'
						| 'unmaximize'
						| 'close'
						| 'toggleMax';
				};
				response: { isMaximized: boolean };
			};
			windowGetFrame: {
				params: Record<string, never>;
				response: { x: number; y: number; width: number; height: number };
			};
			windowSetPosition: {
				params: { x: number; y: number };
				response: { ok: boolean };
			};
			windowSetFrame: {
				params: { x: number; y: number; width: number; height: number };
				response: { ok: boolean };
			};
			windowSetTitle: {
				params: { title: string };
				response: { ok: boolean };
			};
			updaterStatus: {
				params: Record<string, never>;
				response: UpdaterStatus;
			};
			updaterCheckNow: {
				params: Record<string, never>;
				response: UpdaterStatus;
			};
			updaterApply: {
				params: Record<string, never>;
				response: { ok: boolean; error?: string };
			};
			dockerStatus: {
				params: Record<string, never>;
				response: DockerStatus;
			};
			dockerStart: {
				params: Record<string, never>;
				response: { ok: boolean; error?: string };
			};
			dockerStop: {
				params: Record<string, never>;
				response: { ok: boolean; error?: string };
			};
			/**
			 * Force-rebuild the API image from the bundled source and
			 * recreate containers. Replaces the old `dockerPull` (we
			 * build locally now — no registry).
			 */
			dockerRebuild: {
				params: Record<string, never>;
				response: { ok: boolean; error?: string };
			};
		};
		messages: Record<string, never>;
	}>;
	webview: RPCSchema<{
		requests: Record<string, never>;
		messages: Record<string, never>;
	}>;
};
