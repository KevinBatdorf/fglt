/**
 * Epic Games auth + library helpers, run from inside the API
 * container where `legendary-gl` is pre-installed (see Dockerfile).
 *
 * Why server-side rather than the desktop's bun process: the user's
 * machine often has a busted Python install (Microsoft Store Python's
 * AppX sandbox blocks subprocess execution from non-Explorer apps).
 * Running legendary inside our own controlled container sidesteps all
 * of that — same Python every time, no install step for the user.
 *
 * Tokens persist at $XDG_CONFIG_HOME/legendary/user.json which the
 * consumer compose points at the /app/data volume.
 */

import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const LEGENDARY_BIN = process.env.LEGENDARY_BIN || 'legendary';
const TOKENS_DIR = join(process.env.XDG_CONFIG_HOME || '/app/data', 'legendary');
const TOKENS_PATH = join(TOKENS_DIR, 'user.json');

/** Public URL the user opens to get an Epic SSO auth code. */
export const EPIC_AUTH_URL = 'https://legendary.gl/epiclogin';

export type EpicStatus =
	| { kind: 'not_installed' }
	| { kind: 'not_authed' }
	| { kind: 'authed'; account?: string };

interface RunResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	status: number | null;
	spawnError?: string;
}

function run(args: string[], timeoutMs = 60_000): RunResult {
	let proc: SpawnSyncReturns<string>;
	try {
		proc = spawnSync(LEGENDARY_BIN, args, {
			encoding: 'utf8',
			timeout: timeoutMs,
			maxBuffer: 64 * 1024 * 1024,
		});
	} catch (e) {
		return {
			ok: false,
			stdout: '',
			stderr: '',
			status: null,
			spawnError: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
		};
	}
	return {
		ok: proc.status === 0,
		stdout: proc.stdout ?? '',
		stderr: proc.stderr ?? '',
		status: proc.status,
		spawnError: proc.error
			? `${proc.error.name}: ${proc.error.message}`
			: undefined,
	};
}

/**
 * File presence is the truth signal. `legendary status` is slow
 * (Python startup) and not always reliable across versions. The
 * tokens file existing means we have something usable.
 */
export function epicStatus(): EpicStatus {
	// Verify legendary is callable. Cheap version check.
	const v = run(['--version'], 5_000);
	if (!v.ok && v.spawnError?.includes('ENOENT')) {
		return { kind: 'not_installed' };
	}
	if (!existsSync(TOKENS_PATH)) return { kind: 'not_authed' };
	// We have tokens; best-effort account-name lookup.
	const r = run(['status', '--offline'], 10_000);
	const text = `${r.stdout}\n${r.stderr}`;
	const m = text.match(/account:\s+([^\s<]+)/i);
	const account =
		m?.[1] && !m[1].startsWith('<') && m[1].length > 0 ? m[1] : undefined;
	return { kind: 'authed', account };
}

export function epicAuthExchange(code: string): {
	ok: boolean;
	error?: string;
} {
	const trimmed = code.trim();
	if (!trimmed) return { ok: false, error: 'auth code is empty' };
	// `--disable-webview` forces non-interactive; safe even on
	// versions that don't recognise the flag (legendary ignores
	// unknown flags in newer builds; older ones error in a way we'd
	// surface anyway).
	const r = run(['auth', '--disable-webview', '--code', trimmed], 60_000);
	if (r.ok) return { ok: true };
	const detail = (r.stderr || r.stdout || '').trim();
	if (detail) {
		const lines = detail.split(/\r?\n/).filter((l) => l.trim().length > 0);
		const tail = lines[lines.length - 1] ?? detail;
		return {
			ok: false,
			error: `${tail} [exit ${r.status ?? 'null'}]. Codes expire fast — get a fresh one if needed.`,
		};
	}
	if (r.spawnError) {
		return { ok: false, error: `legendary spawn failed: ${r.spawnError}` };
	}
	return {
		ok: false,
		error: `legendary exited ${r.status ?? 'null'} silently.`,
	};
}

export interface EpicLibraryItem {
	app_name: string;
	app_title?: string;
	metadata?: {
		title?: string;
		developer?: string;
		creationDate?: string;
		categories?: Array<{ path: string }>;
	};
}

export function epicLibrary(): {
	ok: boolean;
	items?: EpicLibraryItem[];
	error?: string;
} {
	const r = run(['list', '--json'], 120_000);
	if (!r.ok) {
		return {
			ok: false,
			error: (r.stderr || r.stdout || r.spawnError || 'list failed').trim(),
		};
	}
	try {
		const all = JSON.parse(r.stdout) as EpicLibraryItem[];
		const games = all.filter((g) =>
			g.metadata?.categories?.some((c) => c.path === 'games'),
		);
		return { ok: true, items: games };
	} catch (e) {
		return {
			ok: false,
			error: `parse failed: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
}

/** Wipe local tokens. Idempotent. */
export function epicLogout(): { ok: boolean; error?: string } {
	if (!existsSync(TOKENS_PATH)) return { ok: true };
	try {
		unlinkSync(TOKENS_PATH);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: e instanceof Error ? e.message : String(e) };
	}
}
