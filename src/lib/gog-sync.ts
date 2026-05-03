/**
 * GOG library sync — extracted from scripts/sync-gog.ts so the API can
 * call it directly (Settings → "Sync GOG library" button) AND the cron
 * script keeps working (it just wraps this).
 *
 * Matching: each owned GOG title gets resolved to a Steam appid via
 * storesearch (~600ms apart to be polite). Confident matches land in
 * platform_ownership; misses go to unmatched_ownership for diagnostics.
 * Games not on Steam are silently skipped — Steam is the canonical key.
 */

import type postgres from 'postgres';
import { fetchAllProducts } from './gog';
import { matchSteamAppid } from './match-steam-appid';
import { sleep } from './sleep';

const STORESEARCH_DELAY_MS = 600;

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

export interface GogSyncResult {
	total: number;
	matched: number;
	already_matched: number;
	unmatched: number;
}

export async function syncGogLibrary(
	raw: postgres.Sql,
	logger: (msg: string) => void = () => {},
): Promise<GogSyncResult> {
	const products = await fetchAllProducts();
	logger(`[sync-gog] ${products.length} GOG titles`);

	let matched = 0;
	let alreadyMatched = 0;
	let unmatched = 0;

	for (const p of products) {
		const externalId = String(p.id);
		const title = p.title;

		const existing = await raw`
			SELECT appid FROM platform_ownership
			WHERE platform = 'gog' AND external_id = ${externalId}
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
					(appid, platform, external_id, title_at_source)
				VALUES
					(${result.appid}, 'gog', ${externalId}, ${title})
				ON CONFLICT (appid, platform) DO UPDATE SET
					external_id = EXCLUDED.external_id,
					title_at_source = EXCLUDED.title_at_source,
					updated_at = now()
			`;
			matched++;
			logger(
				`[sync-gog] ${title} -> ${result.appid} (${result.confidence.toFixed(2)})`,
			);
		} else {
			await raw`
				INSERT INTO unmatched_ownership
					(platform, external_id, title_at_source)
				VALUES
					('gog', ${externalId}, ${title})
				ON CONFLICT (platform, external_id) DO UPDATE SET
					title_at_source = EXCLUDED.title_at_source,
					last_seen = now()
			`;
			unmatched++;
			logger(
				`[sync-gog] ${title} -> NO MATCH (best: ${result.candidates[0]?.name ?? 'none'} @ ${result.confidence.toFixed(2)})`,
			);
		}
	}

	logger(
		`[sync-gog] done — matched=${matched} skipped=${alreadyMatched} unmatched=${unmatched}`,
	);
	return {
		total: products.length,
		matched,
		already_matched: alreadyMatched,
		unmatched,
	};
}
