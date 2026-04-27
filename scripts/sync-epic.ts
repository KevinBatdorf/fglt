/**
 * Sync owned Epic Games Store titles into the library.
 *
 * Requires: legendary CLI (https://github.com/derrod/legendary) authed locally.
 *   pip install --user legendary-gl
 *   legendary auth                # browser flow
 *   bun run sync:epic
 *
 * Resolves each Epic title to a Steam appid via storesearch. Confident matches
 * land in `platform_ownership`; misses go to `unmatched_ownership` for review.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { raw } from '../src/db';
import { matchSteamAppid } from '../src/lib/match-steam-appid';
import { sleep } from '../src/lib/sleep';

const STORESEARCH_DELAY_MS = 600;

interface EpicGame {
	app_name: string;
	app_title: string;
	metadata: {
		title: string;
		developer?: string;
		creationDate?: string;
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

function fetchEpicLibrary(): EpicGame[] {
	const bin = resolveLegendaryBin();
	const result: SpawnSyncReturns<Buffer> = spawnSync(bin, ['list', '--json'], {
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.status !== 0) {
		throw new Error(`legendary list failed (${result.status}): ${result.stderr.toString()}`);
	}
	const all = JSON.parse(result.stdout.toString()) as EpicGame[];
	return all.filter((g) =>
		g.metadata.categories?.some((c) => c.path === 'games'),
	);
}

/**
 * Ensure a row exists in `games` so platform_ownership FK is satisfied.
 * Leaves enriched_at NULL — the enricher cron will fill metadata on its
 * next tick, same path as freshly-purchased Steam titles.
 */
async function ensureGameStub(appid: number, name: string): Promise<void> {
	await raw`
		INSERT INTO games (appid, name)
		VALUES (${appid}, ${name})
		ON CONFLICT (appid) DO NOTHING
	`;
}

async function main() {
	console.log(`[sync-epic] starting at ${new Date().toISOString()}`);
	const library = fetchEpicLibrary();
	console.log(`[sync-epic] ${library.length} Epic titles`);

	let matched = 0;
	let alreadyMatched = 0;
	let unmatched = 0;

	for (const game of library) {
		const title = game.metadata.title;
		const externalId = game.app_name;
		const developer = game.metadata.developer ?? null;
		const acquired = game.metadata.creationDate
			? new Date(game.metadata.creationDate).toISOString()
			: null;

		const existing = await raw`
			SELECT appid FROM platform_ownership
			WHERE platform = 'epic' AND external_id = ${externalId}
			LIMIT 1
		`;
		if (existing.length > 0) {
			alreadyMatched++;
			continue;
		}

		const result = await matchSteamAppid(title);
		await sleep(STORESEARCH_DELAY_MS);

		if (result.appid !== null) {
			const matchedName = result.candidates[0]?.name ?? title;
			await ensureGameStub(result.appid, matchedName);
			await raw`
				INSERT INTO platform_ownership
					(appid, platform, external_id, title_at_source, acquired_at)
				VALUES
					(${result.appid}, 'epic', ${externalId}, ${title}, ${acquired})
				ON CONFLICT (appid, platform) DO UPDATE SET
					external_id = EXCLUDED.external_id,
					title_at_source = EXCLUDED.title_at_source,
					updated_at = now()
			`;
			matched++;
			console.log(
				`[sync-epic] ${title} -> ${result.appid} (${result.confidence.toFixed(2)})`,
			);
		} else {
			await raw`
				INSERT INTO unmatched_ownership
					(platform, external_id, title_at_source, developer)
				VALUES
					('epic', ${externalId}, ${title}, ${developer})
				ON CONFLICT (platform, external_id) DO UPDATE SET
					title_at_source = EXCLUDED.title_at_source,
					developer = EXCLUDED.developer,
					last_seen = now()
			`;
			unmatched++;
			console.log(
				`[sync-epic] ${title} -> NO MATCH (best: ${result.candidates[0]?.name ?? 'none'} @ ${result.confidence.toFixed(2)})`,
			);
		}
	}

	console.log(
		`[sync-epic] done — matched=${matched} skipped=${alreadyMatched} unmatched=${unmatched}`,
	);
	await raw.end();
}

main().catch(async (e) => {
	console.error('[sync-epic] fatal:', e);
	await raw.end().catch(() => {});
	process.exit(1);
});
