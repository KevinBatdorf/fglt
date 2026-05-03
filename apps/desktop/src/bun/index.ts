import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, Updater } from 'electrobun/bun';
import { dockerStatus, rebuildBackend, startBackend } from './docker';
import {
	defineSegRpc,
	registerMainWindow,
	setPrefsPath,
	startUpdaterPolling,
} from './rpc';

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

interface WindowPrefs {
	x: number;
	y: number;
	width: number;
	height: number;
}

const PREFS_PATH = join(homedir(), '.seg-window.json');
// Tracks the app version we last booted with. When the binary updates
// and relaunches, we compare against this to decide whether to fire
// `docker compose pull` (so backend images stay roughly in sync with
// the desktop binary).
const VERSION_STATE_PATH = join(homedir(), '.fglt-last-version.json');

// Mirror the JS-side resize-edge minimums so a malformed/old prefs file
// can't restore the window at a too-small size.
const MIN_W = 900;
const MIN_H = 600;

async function readWindowPrefs(): Promise<WindowPrefs | null> {
	try {
		const file = Bun.file(PREFS_PATH);
		if (!(await file.exists())) return null;
		const data = (await file.json()) as Partial<WindowPrefs>;
		if (
			typeof data.x !== 'number' ||
			typeof data.y !== 'number' ||
			typeof data.width !== 'number' ||
			typeof data.height !== 'number'
		)
			return null;
		return {
			x: data.x,
			y: data.y,
			width: Math.max(MIN_W, data.width),
			height: Math.max(MIN_H, data.height),
		};
	} catch (e) {
		console.warn('window prefs read failed:', e);
		return null;
	}
}

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === 'dev') {
		try {
			await fetch(DEV_SERVER_URL, { method: 'HEAD' });
			console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log(
				"Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
			);
		}
	}
	return 'views://mainview/index.html';
}

const url = await getMainViewUrl();
const rpc = defineSegRpc();
const savedFrame = await readWindowPrefs();

const mainWindow = new BrowserWindow({
	title: 'Find a Game Like That',
	url,
	rpc,
	titleBarStyle: 'hidden',
	// Custom titlebar via React; ensure the OS window keeps its resize edges
	// (WS_THICKFRAME on Windows / NSResizableWindowMask on macOS) — without
	// this the chromeless frame can come up unresizable on Windows.
	styleMask: {
		Resizable: true,
		Closable: true,
		Miniaturizable: true,
	},
	frame: savedFrame ?? {
		width: 1280,
		height: 820,
		x: 160,
		y: 120,
	},
});

registerMainWindow(mainWindow);
setPrefsPath(PREFS_PATH);

// Kick off the auto-update polling loop. Skips on the dev channel.
startUpdaterPolling();

// Boot-time Docker bootstrap. Fire-and-forget so the window appears
// instantly; the React side polls dockerStatus while the API is
// unreachable and re-renders as the stack comes up.
void bootstrapDocker();

console.log('FGLT desktop started');

/**
 * On first launch (or after a binary update), make sure the consumer
 * stack is running so the user never has to touch a terminal.
 *
 *   - Docker missing / daemon down → leave it alone, the React banner
 *     surfaces the right next-step (install Docker / start Docker
 *     Desktop).
 *   - Containers exist but stopped, or never created → fire
 *     `docker compose up -d` ourselves.
 *   - Already running → still consider whether the app version changed
 *     since the last boot, and if so kick off a `docker compose pull
 *     && up -d` so the API image roughly tracks the desktop binary.
 *
 * Both spawns block the bun process for a few seconds. That's fine —
 * the window opens before this runs.
 */
async function bootstrapDocker(): Promise<void> {
	let channel: string | null = null;
	try {
		channel = await Updater.localInfo.channel();
	} catch {
		/* ignore */
	}
	// Skip in dev. The dev workflow is `docker compose up -d` from the
	// repo root with the *dev* compose file (steam-* containers); we
	// don't want the desktop launcher to spin up the consumer stack
	// (fglt-* containers) alongside.
	if (channel === 'dev') {
		console.log('[docker] dev channel — skipping auto-start');
		return;
	}

	const status = dockerStatus();
	if (status.kind === 'not_installed' || status.kind === 'daemon_down') {
		console.log(`[docker] ${status.kind} — banner will guide the user`);
		return;
	}
	if (
		status.kind === 'containers_missing' ||
		status.kind === 'containers_stopped'
	) {
		console.log(`[docker] auto-starting backend (was ${status.kind})`);
		const r = startBackend();
		if (!r.ok) console.warn('[docker] start failed:', r.error);
	}

	// Version-bump detection — rebuilds the API image after the desktop
	// binary updates. The bundled backend source under `assets/backend/`
	// changed too (it shipped inside the new binary), so the existing
	// container is running stale code until we rebuild. Done after the
	// start step so fresh-install users don't pay the cost twice (the
	// initial `up -d` already built the image).
	try {
		const current = await Updater.localInfo.version();
		const previous = await readLastVersion();
		if (previous && current && previous !== current) {
			console.log(
				`[docker] version changed ${previous} → ${current}, rebuilding API image`,
			);
			const r = rebuildBackend();
			if (!r.ok) console.warn('[docker] rebuild failed:', r.error);
		}
		if (current) await writeLastVersion(current);
	} catch (e) {
		console.warn('[docker] version-bump check failed:', e);
	}
}

async function readLastVersion(): Promise<string | null> {
	try {
		const f = Bun.file(VERSION_STATE_PATH);
		if (!(await f.exists())) return null;
		const data = (await f.json()) as { version?: string };
		return data.version ?? null;
	} catch {
		return null;
	}
}

async function writeLastVersion(v: string): Promise<void> {
	try {
		await Bun.write(VERSION_STATE_PATH, JSON.stringify({ version: v }));
	} catch (e) {
		console.warn('[docker] persist last-version failed:', e);
	}
}
