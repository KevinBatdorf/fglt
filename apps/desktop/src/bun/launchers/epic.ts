/**
 * Epic Games Store integration via two parallel sources:
 *
 *   1. Legendary's `installed.json` (when present) — keyed by Epic
 *      `app_name`, which matches our `platform_ownership.external_id`.
 *   2. Epic Games Launcher's per-install manifest dir at
 *      `C:/ProgramData/Epic/EpicGamesLauncher/Data/Manifests/*.item`. Each
 *      file is a JSON manifest with `AppName` set to the same Epic catalog
 *      id. Most users install via EGL, not legendary, so this is usually
 *      where the data actually lives.
 *
 * The two sets are unioned. Missing files / parse errors fail soft to an
 * empty contribution.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";

const LEGENDARY_PATHS = [`${homedir()}/.config/legendary/installed.json`];
const EGL_MANIFEST_DIRS = [
	"C:/ProgramData/Epic/EpicGamesLauncher/Data/Manifests",
];

function readLegendary(): Set<string> {
	for (const path of LEGENDARY_PATHS) {
		if (!existsSync(path)) continue;
		try {
			const json = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
			return new Set(Object.keys(json));
		} catch (e) {
			console.error(`[epic-launcher] failed to read ${path}:`, e);
		}
	}
	return new Set();
}

function readEgl(): Set<string> {
	const result = new Set<string>();
	for (const dir of EGL_MANIFEST_DIRS) {
		if (!existsSync(dir)) continue;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch (e) {
			console.error(`[epic-launcher] failed to list ${dir}:`, e);
			continue;
		}
		for (const name of entries) {
			if (!name.endsWith(".item")) continue;
			try {
				const raw = readFileSync(`${dir}/${name}`, "utf8");
				const data = JSON.parse(raw) as { AppName?: string };
				if (data.AppName) result.add(data.AppName);
			} catch {
				/* skip unreadable manifests */
			}
		}
	}
	return result;
}

export function getEpicInstalled(): Set<string> {
	const out = new Set<string>();
	for (const id of readLegendary()) out.add(id);
	for (const id of readEgl()) out.add(id);
	return out;
}

export function epicLaunchUri(externalId: string): string {
	return `com.epicgames.launcher://apps/${externalId}?action=launch&silent=true`;
}
