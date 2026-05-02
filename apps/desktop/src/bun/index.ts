import { homedir } from 'node:os';
import { join } from 'node:path';
import { BrowserWindow, Updater } from 'electrobun/bun';
import { defineSegRpc, registerMainWindow, setPrefsPath } from './rpc';

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

interface WindowPrefs {
	x: number;
	y: number;
	width: number;
	height: number;
}

const PREFS_PATH = join(homedir(), '.seg-window.json');

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
	title: 'SEG',
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

console.log('SEG desktop started');
