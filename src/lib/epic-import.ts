/**
 * Epic library import — match a list of Epic titles against Steam
 * appids and upsert into platform_ownership. Used by both:
 *   - scripts/sync-epic.ts (CLI: legendary lives on the host that runs the script)
 *   - POST /sync/epic/import (desktop's bun shells legendary, posts the
 *     library JSON here for matching)
 *
 * The container that runs the API doesn't have legendary itself — it
 * just receives the library payload and does the storesearch + DB work.
 */

import type postgres from 'postgres';
import { matchSteamAppid } from './match-steam-appid';
import { sleep } from './sleep';

const STORESEARCH_DELAY_MS = 600;

export interface EpicGameInput {
	app_name: string;
	app_title?: string;
	metadata?: {
		title?: string;
		developer?: string;
		creationDate?: string;
	};
}

export interface EpicImportResult {
	total: number;
	matched: number;
	already_matched: number;
	unmatched: number;
}

async function ensureGameStub(
	raw: postgres.Sql,
	appid: number,
	name: string,
): Promise<void> {
	await raw`
		INSERT INTO games (appid, name)
		VALUES (${appid}, ${name})
		ON CONFLICT (appid) DO NOTHING
	`;
}

export async function importEpicLibrary(
	raw: postgres.Sql,
	games: EpicGameInput[],
	logger: (msg: string) => void = () => {},
): Promise<EpicImportResult> {
	logger(`[epic-import] ${games.length} Epic titles`);

	let matched = 0;
	let alreadyMatched = 0;
	let unmatched = 0;

	for (const game of games) {
		const title = game.metadata?.title ?? game.app_title ?? game.app_name ?? '';
		const externalId = game.app_name;
		const developer = game.metadata?.developer ?? null;
		const acquired = game.metadata?.creationDate
			? new Date(game.metadata.creationDate).toISOString()
			: null;
		if (!externalId || !title) continue;

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
			await ensureGameStub(raw, result.appid, matchedName);
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
			logger(
				`[epic-import] ${title} -> ${result.appid} (${result.confidence.toFixed(2)})`,
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
			logger(
				`[epic-import] ${title} -> NO MATCH (best: ${result.candidates[0]?.name ?? 'none'} @ ${result.confidence.toFixed(2)})`,
			);
		}
	}

	logger(
		`[epic-import] done — matched=${matched} skipped=${alreadyMatched} unmatched=${unmatched}`,
	);
	return {
		total: games.length,
		matched,
		already_matched: alreadyMatched,
		unmatched,
	};
}
