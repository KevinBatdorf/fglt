/**
 * CLI sync of the owned Epic Games Store library. Thin wrapper around
 * `src/lib/epic-import.ts` so the API endpoint can use the same matcher.
 *
 * Requires legendary-gl installed + authed locally:
 *   pip install --user legendary-gl
 *   legendary auth        # browser flow
 *   bun run sync:epic
 *
 * The desktop app does this same thing without you needing to touch a
 * terminal — Settings → Library sources → Epic Games. This script
 * remains for headless dev / one-off sync from the project repo.
 */
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { raw } from '../src/db';
import { type EpicGameInput, importEpicLibrary } from '../src/lib/epic-import';

interface EpicGameRaw extends EpicGameInput {
	metadata?: EpicGameInput['metadata'] & {
		categories?: Array<{ path: string }>;
	};
}

function resolveLegendaryBin(): string {
	if (process.env.LEGENDARY_BIN) return process.env.LEGENDARY_BIN;
	const candidates = [
		'legendary',
		`${homedir()}/AppData/Local/Packages/PythonSoftwareFoundation.Python.3.13_qbz5n2kfra8p0/LocalCache/local-packages/Python313/Scripts/legendary.exe`,
		`${homedir()}/AppData/Roaming/Python/Python313/Scripts/legendary.exe`,
		`${homedir()}/.local/bin/legendary`,
	];
	for (const c of candidates) {
		if (c === 'legendary') {
			const r = spawnSync(c, ['--version']);
			if (r.status === 0) return c;
		} else if (existsSync(c)) {
			return c;
		}
	}
	throw new Error(
		'legendary CLI not found. Install with `pip install --user legendary-gl` and `legendary auth`, or set LEGENDARY_BIN.',
	);
}

function fetchEpicLibrary(): EpicGameRaw[] {
	const bin = resolveLegendaryBin();
	const result: SpawnSyncReturns<Buffer> = spawnSync(bin, ['list', '--json'], {
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.status !== 0) {
		throw new Error(
			`legendary list failed (${result.status}): ${result.stderr.toString()}`,
		);
	}
	const all = JSON.parse(result.stdout.toString()) as EpicGameRaw[];
	return all.filter((g) =>
		g.metadata?.categories?.some((c) => c.path === 'games'),
	);
}

console.log(`[sync-epic] starting at ${new Date().toISOString()}`);

try {
	const library = fetchEpicLibrary();
	await importEpicLibrary(raw, library, console.log);
	await raw.end();
} catch (e) {
	console.error('[sync-epic] fatal:', e);
	await raw.end().catch(() => {});
	process.exit(1);
}
