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
	InstalledIndex,
	LaunchResult,
	RefreshResult,
	SegRPC,
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
	return (globalThis as unknown as { __segMainWindow?: BrowserWindow })
		.__segMainWindow;
}

export function registerMainWindow(win: BrowserWindow): void {
	(
		globalThis as unknown as { __segMainWindow?: BrowserWindow }
	).__segMainWindow = win;
}

// ----- Auto-updater state ------------------------------------------------
//
// We poll Electrobun's Updater on a 6h schedule (and once at startup), then
// expose the latest snapshot to the React side via the `updaterStatus` RPC.
// Long-lived in-process state is fine — only one window/process per user.

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
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

async function pollOnce() {
	if (updaterState.checking) return;
	updaterState.checking = true;
	try {
		const channel = await Updater.localInfo.channel();
		if (channel === 'dev') {
			updaterState.lastError = null;
			updaterState.lastChecked = new Date().toISOString();
			return;
		}
		const result = await Updater.checkForUpdate();
		updaterState.updateAvailable = !!result.updateAvailable;
		updaterState.latestVersion = result.version ?? null;
		updaterState.lastError = result.error || null;
		updaterState.lastChecked = new Date().toISOString();
		if (result.updateAvailable) {
			// Pull the tarball / patches so applyUpdate() is fast when the
			// user clicks Restart. downloadUpdate sets updateReady on success.
			await Updater.downloadUpdate();
			const after = Updater.updateInfo();
			updaterState.updateReady = !!after?.updateReady;
		} else {
			updaterState.updateReady = false;
		}
	} catch (e) {
		updaterState.lastError = e instanceof Error ? e.message : String(e);
	} finally {
		updaterState.checking = false;
	}
}

export function startUpdaterPolling(): void {
	void refreshLocalVersion().then(() => pollOnce());
	setInterval(pollOnce, UPDATE_CHECK_INTERVAL_MS);
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

const API_BASE = process.env.SEG_API_BASE ?? 'http://localhost:3110';

function readInstalledIndex(): InstalledIndex {
	return {
		steam: [...getSteamInstalled()],
		epic: [...getEpicInstalled()],
		gog: [...getGogInstalled()],
	};
}

export function defineSegRpc() {
	return BrowserView.defineRPC<SegRPC>({
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
					await pollOnce();
					return { ...updaterState };
				},

				updaterApply: async (): Promise<{ ok: boolean; error?: string }> => {
					if (!updaterState.updateReady) {
						return { ok: false, error: 'no-update-staged' };
					}
					try {
						// Triggers the swap + relaunch. Process exits inside this call
						// on success, so the response only matters on failure paths.
						await Updater.applyUpdate();
						return { ok: true };
					} catch (e) {
						return {
							ok: false,
							error: e instanceof Error ? e.message : String(e),
						};
					}
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
			},
			messages: {},
		},
	});
}

export { steamInstallUri };
