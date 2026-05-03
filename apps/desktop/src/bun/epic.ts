/**
 * Epic Games integration via the `legendary` CLI tool.
 *
 * Epic doesn't publish a library API. legendary-gl is a community CLI
 * (`pip install --user legendary-gl`) that drives Epic's account-bound
 * GraphQL endpoints. Distribution-wise it's annoying — Python tool, not
 * something we can bundle inside the Electrobun binary — but it's the
 * least-bad available option until we either fork legendary's auth /
 * library logic into JS or Epic publishes a real API.
 *
 * Architecture: the API container can't shell out to legendary (it
 * lives in a Docker container with no Python). The Electrobun bun
 * process runs on the host, where the user installed legendary, and
 * shells to it from here. We then POST the resulting library JSON to
 * the API for title matching + upsert.
 *
 * All commands use `spawnSync` (matches `bun/launchers/steam.ts` and
 * `bun/docker.ts`). Long-running ops (sync) get generous timeouts.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

/** Public URL the user opens to get an Epic SSO auth code. */
export const EPIC_AUTH_URL = 'https://legendary.gl/epiclogin';

let legendaryBin: string | null = null;

/**
 * Find the legendary CLI on disk. Caches the result. Returns null if
 * not installed — callers should surface "install legendary first" UX
 * rather than throwing.
 */
function resolveLegendaryBin(): string | null {
	if (legendaryBin) return legendaryBin;
	if (process.env.LEGENDARY_BIN && existsSync(process.env.LEGENDARY_BIN)) {
		legendaryBin = process.env.LEGENDARY_BIN;
		return legendaryBin;
	}
	// Try PATH first.
	const probe = spawnSync(
		process.platform === 'win32' ? 'where' : 'which',
		['legendary'],
		{ encoding: 'utf8' },
	);
	if (probe.status === 0) {
		const first = probe.stdout.split(/\r?\n/).find((s) => s.trim().length > 0);
		if (first) {
			legendaryBin = first.trim();
			return legendaryBin;
		}
	}
	// Common pip --user install paths (Windows + Linux + macOS).
	const home = homedir();
	const guesses = [
		`${home}/AppData/Local/Packages/PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0/LocalCache/local-packages/Python313/Scripts/legendary.exe`,
		`${home}/AppData/Roaming/Python/Python313/Scripts/legendary.exe`,
		`${home}/AppData/Roaming/Python/Python312/Scripts/legendary.exe`,
		`${home}/AppData/Roaming/Python/Python311/Scripts/legendary.exe`,
		`${home}/.local/bin/legendary`,
		`${home}/Library/Python/3.13/bin/legendary`,
		`${home}/Library/Python/3.12/bin/legendary`,
	];
	for (const g of guesses) {
		if (existsSync(g)) {
			legendaryBin = g;
			return legendaryBin;
		}
	}
	return null;
}

function run(
	args: string[],
	timeoutMs = 60_000,
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
	const bin = resolveLegendaryBin();
	if (!bin) {
		return { ok: false, stdout: '', stderr: 'legendary not found', status: null };
	}
	const proc = spawnSync(bin, args, {
		encoding: 'utf8',
		timeout: timeoutMs,
		maxBuffer: 64 * 1024 * 1024,
	});
	return {
		ok: proc.status === 0,
		stdout: proc.stdout ?? '',
		stderr: proc.stderr ?? '',
		status: proc.status,
	};
}

export type EpicStatus =
	| { kind: 'not_installed' }
	| { kind: 'not_authed' }
	| { kind: 'authed'; account?: string };

/**
 * Inspect: is legendary present? authed? `legendary status` exits 0
 * when authed and includes the account name in stdout.
 */
export function epicStatus(): EpicStatus {
	const bin = resolveLegendaryBin();
	if (!bin) return { kind: 'not_installed' };
	// `legendary status --offline` returns auth state without hitting Epic.
	const r = run(['status', '--offline'], 10_000);
	if (!r.ok) {
		// status fails when not authed (exits non-zero with "Not logged in").
		const combined = `${r.stderr}\n${r.stdout}`.toLowerCase();
		if (combined.includes('not logged in') || combined.includes('not signed in')) {
			return { kind: 'not_authed' };
		}
		// Some versions print the account block to stderr even on success.
		// Fall through and try to parse anyway.
	}
	const text = r.stdout + r.stderr;
	const m = text.match(/account:\s*(\S+)/i);
	return { kind: 'authed', account: m?.[1] };
}

/**
 * Exchange an Epic SSO auth code for tokens. The user got the code by
 * opening EPIC_AUTH_URL, signing in, and copying the `authorizationCode`
 * value out of the JSON page they land on.
 */
export function epicAuthExchange(code: string): {
	ok: boolean;
	error?: string;
} {
	const trimmed = code.trim();
	if (!trimmed) return { ok: false, error: 'auth code is empty' };
	const r = run(['auth', '--code', trimmed], 30_000);
	if (!r.ok) {
		return {
			ok: false,
			error: (r.stderr || r.stdout || 'auth failed').trim(),
		};
	}
	return { ok: true };
}

export interface EpicLibraryItem {
	app_name: string;
	app_title: string;
	metadata: {
		title: string;
		developer?: string;
		creationDate?: string;
		categories?: Array<{ path: string }>;
	};
}

/**
 * `legendary list --json` returns every owned title. We filter to
 * actual games (categories includes 'games') — Epic free-game store
 * gives users lots of demos / DLC entries we don't want to import.
 */
export function epicLibrary(): {
	ok: boolean;
	items?: EpicLibraryItem[];
	error?: string;
} {
	const r = run(['list', '--json'], 60_000);
	if (!r.ok) {
		return {
			ok: false,
			error: (r.stderr || r.stdout || 'list failed').trim(),
		};
	}
	try {
		const all = JSON.parse(r.stdout) as EpicLibraryItem[];
		const games = all.filter((g) =>
			g.metadata.categories?.some((c) => c.path === 'games'),
		);
		return { ok: true, items: games };
	} catch (e) {
		return {
			ok: false,
			error: `parse failed: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

/**
 * `legendary auth --delete` — wipes local Epic tokens. Idempotent:
 * `legendary auth --delete` exits non-zero with "Not logged in" when
 * already disconnected, which we treat as success since the
 * end-state matches what the caller wanted.
 */
export function epicLogout(): { ok: boolean; error?: string } {
	const bin = resolveLegendaryBin();
	if (!bin) return { ok: true }; // not installed = no tokens to clear, success
	const r = run(['auth', '--delete'], 10_000);
	if (r.ok) return { ok: true };
	const combined = `${r.stderr}\n${r.stdout}`.toLowerCase();
	if (
		combined.includes('not logged in') ||
		combined.includes('not signed in') ||
		combined.includes('no session')
	) {
		return { ok: true };
	}
	return {
		ok: false,
		error: (r.stderr || r.stdout || 'logout failed').trim(),
	};
}
