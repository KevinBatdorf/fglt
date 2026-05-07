/**
 * Steam launcher integration.
 *
 * Discovery:
 *   1. Locate Steam install via Windows registry (HKCU\Software\Valve\Steam),
 *      falling back to common default paths on each OS.
 *   2. Parse `<steam>/steamapps/libraryfolders.vdf` to enumerate library
 *      folder paths (Steam supports multiple library locations across drives).
 *   3. For each library, scan `steamapps/appmanifest_<appid>.acf` files —
 *      these are the authoritative "is this currently installed?" markers.
 *      Steam writes one when an install completes and removes it on
 *      uninstall. The "apps" block inside libraryfolders.vdf can be stale
 *      (e.g. doesn't always update immediately after a fresh install), so
 *      we don't rely on it for detection — just for library paths.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { platform } from 'node:os';

const WIN_DEFAULTS = ['C:/Program Files (x86)/Steam', 'C:/Program Files/Steam'];

function findSteamRoot(): string | null {
	const os = platform();

	if (os === 'win32') {
		try {
			const proc = spawnSync('reg', [
				'query',
				'HKCU\\Software\\Valve\\Steam',
				'/v',
				'SteamPath',
			]);
			if (proc.status === 0) {
				const out = proc.stdout.toString();
				const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
				if (match) {
					const p = match[1].trim().replace(/\\/g, '/');
					if (existsSync(p)) return p;
				}
			}
		} catch {
			/* fall through to defaults */
		}
		for (const p of WIN_DEFAULTS) if (existsSync(p)) return p;
		return null;
	}

	if (os === 'darwin') {
		const home = process.env.HOME;
		if (!home) return null;
		const p = `${home}/Library/Application Support/Steam`;
		return existsSync(p) ? p : null;
	}

	// Linux
	const home = process.env.HOME;
	if (!home) return null;
	for (const p of [`${home}/.steam/steam`, `${home}/.local/share/Steam`]) {
		if (existsSync(p)) return p;
	}
	return null;
}

/**
 * Pull the "path" value from each numbered library-folder block in
 * libraryfolders.vdf. VDF strings escape backslashes (`"C:\\Games"` →
 * `C:\Games` after unescape), so we normalize to forward slashes.
 */
function parseLibraryPaths(vdf: string): string[] {
	const paths: string[] = [];
	const pathRegex = /"path"\s+"([^"]+)"/g;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iter idiom
	while ((m = pathRegex.exec(vdf)) !== null) {
		const raw = m[1];
		// Unescape doubled backslashes ("C:\\Games" → "C:\Games"), then
		// normalize to forward slashes for cross-platform path joins.
		const normalized = raw.replace(/\\\\/g, '\\').replace(/\\/g, '/');
		paths.push(normalized);
	}
	return paths;
}

/** Read installed appids from `steamapps/appmanifest_<appid>.acf` files. */
function appidsFromManifests(libraryRoot: string): number[] {
	const dir = `${libraryRoot}/steamapps`;
	if (!existsSync(dir)) return [];
	try {
		const ids: number[] = [];
		for (const f of readdirSync(dir)) {
			const m = f.match(/^appmanifest_(\d+)\.acf$/);
			if (m) ids.push(Number(m[1]));
		}
		return ids;
	} catch (e) {
		console.error(`[steam-launcher] failed to read ${dir}:`, e);
		return [];
	}
}

export function getSteamInstalled(): Set<number> {
	const root = findSteamRoot();
	if (!root) {
		console.log('[steam-launcher] Steam install not found');
		return new Set();
	}
	const vdfPath = `${root}/steamapps/libraryfolders.vdf`;
	const libraries: string[] = [];
	if (existsSync(vdfPath)) {
		try {
			const vdf = readFileSync(vdfPath, 'utf8');
			libraries.push(...parseLibraryPaths(vdf));
		} catch (e) {
			console.error('[steam-launcher] failed to read libraryfolders.vdf:', e);
		}
	} else {
		console.log(`[steam-launcher] libraryfolders.vdf not found at ${vdfPath}`);
	}
	// Always include the root install as a library, even if the VDF didn't
	// enumerate it (older Steam versions sometimes leave the primary library
	// implicit). Dedupe case-insensitively for Windows.
	if (!libraries.some((l) => l.toLowerCase() === root.toLowerCase())) {
		libraries.unshift(root);
	}
	const appids = new Set<number>();
	for (const lib of libraries) {
		for (const id of appidsFromManifests(lib)) appids.add(id);
	}
	console.log(
		`[steam-launcher] detected ${appids.size} installed games across ${libraries.length} libraries`,
	);
	return appids;
}

export function steamLaunchUri(appid: number): string {
	return `steam://run/${appid}`;
}

export function steamInstallUri(appid: number): string {
	return `steam://install/${appid}`;
}
