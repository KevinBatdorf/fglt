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
import { existsSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Public URL the user opens to get an Epic SSO auth code. */
export const EPIC_AUTH_URL = 'https://legendary.gl/epiclogin';

let legendaryBin: string | null = null;

/**
 * Candidate locations for legendary's tokens file. Used as the
 * authoritative "is authed" signal because `legendary status` is slow
 * (spawns a Python interpreter) and `legendary auth --delete` doesn't
 * reliably clear state across all versions — when in doubt, the file's
 * existence is what actually matters.
 */
function tokensFileCandidates(): string[] {
	const home = homedir();
	return [
		// Linux + macOS XDG style.
		join(home, '.config', 'legendary', 'user.json'),
		// Windows.
		join(home, 'AppData', 'Local', 'legendary', 'user.json'),
		join(home, 'AppData', 'Roaming', 'legendary', 'user.json'),
	];
}

function findTokensFile(): string | null {
	for (const p of tokensFileCandidates()) {
		if (existsSync(p)) return p;
	}
	return null;
}

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
	// File presence is the authoritative auth signal. Cheap (no process
	// spawn), reliable across legendary versions, and flips immediately
	// when we delete the file in epicLogout — vs. `legendary status`
	// which has been observed to lag / cache / report inconsistently.
	if (!findTokensFile()) return { kind: 'not_authed' };
	// We're authed. Best-effort account name extraction from
	// `legendary status --offline`. If parsing fails, return authed
	// without a label rather than corrupting the UI with "<not".
	const r = run(['status', '--offline'], 10_000);
	const text = `${r.stdout}\n${r.stderr}`;
	const m = text.match(/account:\s+([^\s<]+)/i);
	const account =
		m?.[1] && !m[1].startsWith('<') && m[1].length > 0 ? m[1] : undefined;
	return { kind: 'authed', account };
}

/**
 * Exchange an Epic SSO auth code for tokens. The user got the code by
 * opening EPIC_AUTH_URL, signing in, and copying the `authorizationCode`
 * value out of the JSON page they land on.
 *
 * Common failure modes:
 *   - Code expired (Epic auth codes are valid for ~5 minutes)
 *   - Code already used (one-shot)
 *   - User pasted the wrong field from the JSON
 * We surface the legendary stderr verbatim so the user sees the
 * underlying error, plus a hint when stderr was suspiciously empty.
 */
export function epicAuthExchange(code: string): {
	ok: boolean;
	error?: string;
} {
	const trimmed = code.trim();
	if (!trimmed) return { ok: false, error: 'auth code is empty' };
	// Generous timeout — legendary spawns Python which can take a few
	// seconds on Windows the first time, then the actual Epic API call
	// can be slow.
	const r = run(['auth', '--code', trimmed], 60_000);
	if (r.ok) return { ok: true };
	// Surface as much diagnostic info as we have. Most legendary errors
	// land in stderr ("Failed to login: <reason>"); some go to stdout.
	const detail = (r.stderr || r.stdout || '').trim();
	if (detail) {
		// Trim long Python tracebacks to just the last line — usually
		// the actionable bit.
		const lines = detail.split(/\r?\n/).filter((l) => l.trim().length > 0);
		const tail = lines[lines.length - 1] ?? detail;
		return {
			ok: false,
			error: `${tail} (exit ${r.status ?? 'null'}). Codes expire fast — click "Open Epic sign-in" again to get a fresh one.`,
		};
	}
	return {
		ok: false,
		error: `legendary exited ${r.status ?? 'null'} with no output. Check that legendary works on the command line, then try again.`,
	};
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
 * Wipe local Epic tokens. We delete the user.json file directly rather
 * than relying on `legendary auth --delete` — that command silently
 * does nothing in some legendary versions (e.g. older builds where the
 * flag was unrecognised, or builds that prompt for confirmation we
 * can't satisfy non-interactively). Removing the file is what `--delete`
 * does internally anyway, so this is just cutting out the unreliable
 * middleman. Idempotent: returns ok even if no tokens existed.
 */
export function epicLogout(): { ok: boolean; error?: string } {
	const path = findTokensFile();
	if (!path) return { ok: true };
	try {
		unlinkSync(path);
		return { ok: true };
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : String(e),
		};
	}
}
