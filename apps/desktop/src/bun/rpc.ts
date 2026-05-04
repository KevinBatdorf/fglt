/**
 * Bun-side RPC handlers exposed to the React webview.
 *
 * Three responsibilities:
 *   1. launch — open a storefront URI via Utils.openExternal
 *   2. getInstalledIndex — aggregate per-storefront installed sets, cached
 *      in-process for the session (refreshes on every call to keep things
 *      simple — disks are fast and the user can re-trigger from the UI)
 *   3. refreshGame — proxy through to the API's /games/:appid/refresh
 */
import {
	BrowserView,
	type BrowserWindow,
	Updater,
	Utils,
} from 'electrobun/bun';
import type {
	DockerStatus,
	FgltRPC,
	InstalledIndex,
	LaunchResult,
	RefreshResult,
	UpdaterStatus,
} from '../shared/types';
import {
	dockerStatus as readDockerStatus,
	rebuildBackend,
	startBackend,
	stopBackend,
} from './docker';
import { epicLaunchUri, getEpicInstalled } from './launchers/epic';
import { getGogInstalled, gogLaunchUri } from './launchers/gog';
import {
	getSteamInstalled,
	steamInstallUri,
	steamLaunchUri,
} from './launchers/steam';

function mainWindow() {
	// We only ever create one window. BrowserWindowMap isn't exported,
	// so we cache the first instance we see.
	return (globalThis as unknown as { __fgltMainWindow?: BrowserWindow })
		.__fgltMainWindow;
}

export function registerMainWindow(win: BrowserWindow): void {
	(
		globalThis as unknown as { __fgltMainWindow?: BrowserWindow }
	).__fgltMainWindow = win;
}

// ----- Auto-updater state ------------------------------------------------
//
// Manual updates only: download the latest installer from GitHub releases.
// Electrobun's `Updater.checkForUpdate()` FFI fast-fails the bun process
// (Windows exit 0xC0000409) when the manifest URL 404s, which happens for
// anyone not on the latest tag. Until upstream is hardened we only read
// the local version for the Settings → Updates panel.

const updaterState: UpdaterStatus = {
	currentVersion: null,
	updateAvailable: false,
	updateReady: false,
	latestVersion: null,
	lastChecked: null,
	lastError: null,
	checking: false,
};

async function refreshLocalVersion() {
	try {
		updaterState.currentVersion = await Updater.localInfo.version();
	} catch (e) {
		console.warn('[updater] localInfo failed:', e);
	}
}

export function startUpdaterPolling(): void {
	void refreshLocalVersion();
}

// Path to the window-frame prefs file. Wired from index.ts at startup.
let prefsPath: string | null = null;
let prefsTimer: ReturnType<typeof setTimeout> | null = null;

export function setPrefsPath(path: string): void {
	prefsPath = path;
}

// Debounce frame writes — drag/resize fires per-RAF, no need to hammer disk.
function schedulePersistFrame() {
	if (!prefsPath) return;
	if (prefsTimer !== null) clearTimeout(prefsTimer);
	prefsTimer = setTimeout(() => {
		const w = mainWindow();
		if (!w || !prefsPath) return;
		try {
			const f = w.getFrame();
			void Bun.write(prefsPath, JSON.stringify(f));
		} catch (e) {
			console.warn('window prefs write failed:', e);
		}
	}, 250);
}

const API_BASE = process.env.FGLT_API_BASE ?? 'http://localhost:3110';

function readInstalledIndex(): InstalledIndex {
	return {
		steam: [...getSteamInstalled()],
		epic: [...getEpicInstalled()],
		gog: [...getGogInstalled()],
	};
}

export function defineFgltRpc() {
	return BrowserView.defineRPC<FgltRPC>({
		handlers: {
			requests: {
				launch: ({ platform, externalId, appid }): LaunchResult => {
					let uri: string;
					switch (platform) {
						case 'steam':
							uri = steamLaunchUri(appid);
							break;
						case 'epic':
							uri = epicLaunchUri(externalId);
							break;
						case 'gog':
							uri = gogLaunchUri(externalId);
							break;
						default:
							return { ok: false, error: `unknown platform: ${platform}` };
					}
					try {
						const ok = Utils.openExternal(uri);
						return {
							ok,
							...(ok
								? {}
								: { error: `openExternal returned false for ${uri}` }),
						};
					} catch (e) {
						return {
							ok: false,
							error: e instanceof Error ? e.message : String(e),
						};
					}
				},

				getInstalledIndex: (): InstalledIndex => readInstalledIndex(),

				refreshGame: async ({ appid, source }): Promise<RefreshResult> => {
					const qs = source && source !== 'all' ? `?source=${source}` : '';
					const res = await fetch(`${API_BASE}/games/${appid}/refresh${qs}`, {
						method: 'POST',
					});
					if (!res.ok) {
						throw new Error(`API ${res.status}: ${await res.text()}`);
					}
					return (await res.json()) as RefreshResult;
				},

				openUrl: ({ url }): { ok: boolean } => {
					try {
						return { ok: Utils.openExternal(url) };
					} catch {
						return { ok: false };
					}
				},

				windowAction: ({ action }) => {
					const w = mainWindow();
					if (!w) return { isMaximized: false };
					try {
						if (action === 'minimize') w.minimize();
						else if (action === 'maximize') w.maximize();
						else if (action === 'unmaximize') w.unmaximize();
						else if (action === 'close') w.close();
						else if (action === 'toggleMax') {
							if (w.isMaximized()) w.unmaximize();
							else w.maximize();
						}
						// Don't persist on maximize/restore — keep the
						// "natural" un-maximized frame as the saved one.
						return { isMaximized: w.isMaximized() };
					} catch (e) {
						console.warn('windowAction failed', action, e);
						return { isMaximized: false };
					}
				},

				windowGetFrame: () => {
					const w = mainWindow();
					if (!w) return { x: 0, y: 0, width: 0, height: 0 };
					return w.getFrame();
				},

				windowSetPosition: ({ x, y }) => {
					const w = mainWindow();
					if (!w) return { ok: false };
					w.setPosition(Math.round(x), Math.round(y));
					schedulePersistFrame();
					return { ok: true };
				},

				windowSetFrame: ({ x, y, width, height }) => {
					const w = mainWindow();
					if (!w) return { ok: false };
					w.setFrame(
						Math.round(x),
						Math.round(y),
						Math.round(width),
						Math.round(height),
					);
					schedulePersistFrame();
					return { ok: true };
				},

				windowSetTitle: ({ title }) => {
					const w = mainWindow();
					if (!w) return { ok: false };
					try {
						w.setTitle(title);
						return { ok: true };
					} catch {
						return { ok: false };
					}
				},

				updaterStatus: async (): Promise<UpdaterStatus> => {
					// Snapshot of the polling-loop state. The React side reads this
					// and shows a banner when updateReady is true.
					return { ...updaterState };
				},

				updaterCheckNow: async (): Promise<UpdaterStatus> => {
					// Auto-update is disabled (see startUpdaterPolling); the UI
					// surfaces the current version and a "Download latest from
					// GitHub" link instead of an in-app check.
					await refreshLocalVersion();
					return { ...updaterState };
				},

				updaterApply: (): Promise<{ ok: boolean; error?: string }> => {
					return Promise.resolve({ ok: false, error: 'auto-update-disabled' });
				},

				// ----- Docker stack control --------------------------------
				// All four are thin wrappers around `bun/docker.ts`. The
				// React side calls `dockerStatus` on a poll while the API
				// is unreachable; the start/stop/pull handlers are wired
				// to buttons in HealthBanner + Settings → Backend.
				dockerStatus: (): DockerStatus => readDockerStatus(),
				dockerStart: () => startBackend(),
				dockerStop: () => stopBackend(),
				// Renamed from `dockerPull` — we build locally now, no
				// registry pulls. The webview still calls this to get the
				// "Update backend" button's behaviour.
				dockerRebuild: () => rebuildBackend(),

				// Epic Games is now driven entirely by API endpoints —
				// legendary lives inside the backend container (see
				// Dockerfile). No bun-side handlers needed.
			},
			messages: {},
		},
	});
}

export { steamInstallUri };
