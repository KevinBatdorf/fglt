import { execSync, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { BrowserWindow, Updater } from 'electrobun/bun';
import { dockerStatus, rebuildBackend, startBackend } from './docker';
import {
	defineFgltRpc,
	registerMainWindow,
	setPrefsPath,
	startUpdaterPolling,
} from './rpc';

// Stable AppUserModelID — must match the AUMID stamped on the Start
// Menu shortcut by the NSIS installer. Tells Windows "this app's
// identity is X" so taskbar pinning groups by AUMID instead of by the
// bun runtime's exe path.
const APP_AUMID = 'KevinBatdorf.FindAGameLikeThat';

if (process.platform === 'win32') {
	try {
		const { dlopen, FFIType, ptr } = await import('bun:ffi');
		const shell32 = dlopen('shell32.dll', {
			SetCurrentProcessExplicitAppUserModelID: {
				args: [FFIType.ptr],
				returns: FFIType.i32,
			},
		});
		// UTF-16LE wide string with null terminator.
		const wide = Buffer.from(`${APP_AUMID}\0`, 'utf16le');
		const hr =
			shell32.symbols.SetCurrentProcessExplicitAppUserModelID(ptr(wide));
		if (hr !== 0) {
			console.warn(
				`[fglt] SetCurrentProcessExplicitAppUserModelID HRESULT 0x${hr.toString(16)}`,
			);
		}
	} catch (e) {
		console.warn('[fglt] AUMID setup failed:', e);
	}
}

// If our runtime binary is launched without launcher.exe as the
// parent (most commonly when Windows pins the visible window's
// owning process — that's our runtime, not launcher), the FFI
// bridge to the native window host is never set up and
// `BrowserWindow` init crashes with `bridge.requestHost is null`.
// Detect this and re-launch via launcher.exe.
if (process.platform === 'win32') {
	try {
		const ppidStr = String(process.ppid);
		const csv = execSync(`tasklist /FI "PID eq ${ppidStr}" /FO CSV /NH`, {
			encoding: 'utf8',
			timeout: 2000,
		});
		const parentName = (csv.split(',')[0] || '')
			.replace(/"/g, '')
			.toLowerCase();
		const ourBin = process.argv0 || '';
		const ourBase = basename(ourBin).toLowerCase();
		// Match either "fgl.exe" (after rename) or "bun.exe" (older
		// installs / dev mode).
		const looksLikeRuntime = ourBase === 'fgl.exe' || ourBase === 'bun.exe';
		if (looksLikeRuntime && parentName !== 'launcher.exe') {
			const launcherPath = join(dirname(ourBin), 'launcher.exe');
			console.warn(
				`[fglt] runtime launched without launcher (parent=${parentName}); relaunching via ${launcherPath}`,
			);
			const child = spawn(launcherPath, [], {
				detached: true,
				stdio: 'ignore',
			});
			child.unref();
			process.exit(0);
		}
	} catch (e) {
		// Best effort. If the check itself errors we fall through and
		// let Electrobun proceed normally — worst case is the original
		// crash; we haven't made anything worse.
		console.warn('[fglt] parent-process check failed:', e);
	}
}

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

interface WindowPrefs {
	x: number;
	y: number;
	width: number;
	height: number;
}

const PREFS_PATH = join(homedir(), '.fglt-window.json');
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
	let channel: string | null = null;
	try {
		channel = await Updater.localInfo.channel();
	} catch (e) {
		// Updater state can be missing or malformed on a fresh install —
		// don't let that bring the whole window startup down.
		console.warn('[startup] Updater.localInfo.channel failed:', e);
	}
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

try {
	const url = await getMainViewUrl();
	const rpc = defineFgltRpc();
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

	// Auto-update polling — skips on dev channel internally. Wrapped so
	// a failure here doesn't take the window down.
	try {
		startUpdaterPolling();
	} catch (e) {
		console.error('[startup] startUpdaterPolling failed:', e);
	}

	// Boot-time Docker bootstrap. Fire-and-forget so the window appears
	// instantly; the React side polls dockerStatus while the API is
	// unreachable and re-renders as the stack comes up.
	void bootstrapDocker();

	console.log('FGLT desktop started');
} catch (e) {
	// Last-resort log so a packaged-build crash leaves SOME breadcrumb
	// in the launcher's stdout/stderr instead of a silent process exit.
	console.error('[startup] FATAL — bun process exiting:', e);
	if (e instanceof Error && e.stack) console.error(e.stack);
	throw e;
}

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
