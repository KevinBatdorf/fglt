/**
 * Steam launcher integration.
 *
 * Discovery:
 *   1. Locate Steam install via Windows registry (HKCU\Software\Valve\Steam),
 *      falling back to common default paths on each OS.
 *   2. Parse `<steam>/steamapps/libraryfolders.vdf` to enumerate library
 *      folders (Steam supports multiple library locations across drives) and
 *      their installed appid sets.
 *
 * The "apps" block inside each library folder lists every installed appid
 * keyed by app id, value = bytes-on-disk. We don't need bytes-on-disk here,
 * just the keys.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";

const WIN_DEFAULTS = [
	"C:/Program Files (x86)/Steam",
	"C:/Program Files/Steam",
];

function findSteamRoot(): string | null {
	const os = platform();

	if (os === "win32") {
		try {
			const proc = spawnSync("reg", [
				"query",
				"HKCU\\Software\\Valve\\Steam",
				"/v",
				"SteamPath",
			]);
			if (proc.status === 0) {
				const out = proc.stdout.toString();
				const match = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
				if (match) {
					const p = match[1].trim().replace(/\\/g, "/");
					if (existsSync(p)) return p;
				}
			}
		} catch {
			/* fall through to defaults */
		}
		for (const p of WIN_DEFAULTS) if (existsSync(p)) return p;
		return null;
	}

	if (os === "darwin") {
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
 * Parse the "apps" blocks from libraryfolders.vdf and return all appids
 * across every library. Resilient to whitespace/quoting variations.
 */
function parseInstalledAppids(vdf: string): Set<number> {
	const appids = new Set<number>();
	const appsBlockRegex = /"apps"\s*\{([\s\S]*?)\}/g;
	let appsMatch: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iter idiom
	while ((appsMatch = appsBlockRegex.exec(vdf)) !== null) {
		const body = appsMatch[1];
		const pairRegex = /"(\d+)"\s+"\d+"/g;
		let pair: RegExpExecArray | null;
		// biome-ignore lint/suspicious/noAssignInExpressions: standard regex iter idiom
		while ((pair = pairRegex.exec(body)) !== null) {
			appids.add(Number(pair[1]));
		}
	}
	return appids;
}

export function getSteamInstalled(): Set<number> {
	const root = findSteamRoot();
	if (!root) {
		console.log("[steam-launcher] Steam install not found");
		return new Set();
	}
	const vdfPath = `${root}/steamapps/libraryfolders.vdf`;
	if (!existsSync(vdfPath)) {
		console.log(`[steam-launcher] libraryfolders.vdf not found at ${vdfPath}`);
		return new Set();
	}
	try {
		const vdf = readFileSync(vdfPath, "utf8");
		const ids = parseInstalledAppids(vdf);
		return ids;
	} catch (e) {
		console.error("[steam-launcher] failed to read libraryfolders.vdf:", e);
		return new Set();
	}
}

export function steamLaunchUri(appid: number): string {
	return `steam://run/${appid}`;
}

export function steamInstallUri(appid: number): string {
	return `steam://install/${appid}`;
}
