/**
 * Sync owned GOG library into the platform_ownership table.
 *
 * Pre-req: `bun run auth:gog` once, see scripts/auth-gog.ts.
 *
 * Resolves each GOG title to a Steam appid via storesearch. Confident matches
 * land in `platform_ownership(platform='gog')`; misses go to
 * `unmatched_ownership` for diagnostics. Games not on Steam are ignored.
 */
import { raw } from '../src/db';
import { fetchAllProducts } from '../src/lib/gog';
import { matchSteamAppid } from '../src/lib/match-steam-appid';
import { sleep } from '../src/lib/sleep';

const STORESEARCH_DELAY_MS = 600;

async function ensureGameStub(appid: number, name: string): Promise<void> {
	await raw`
		INSERT INTO games (appid, name)
		VALUES (${appid}, ${name})
		ON CONFLICT (appid) DO NOTHING
	`;
}

async function main() {
	console.log(`[sync-gog] starting at ${new Date().toISOString()}`);
	const products = await fetchAllProducts();
	console.log(`[sync-gog] ${products.length} GOG titles`);

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
			await ensureGameStub(result.appid, matchedName);
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
			console.log(
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
			console.log(
				`[sync-gog] ${title} -> NO MATCH (best: ${result.candidates[0]?.name ?? 'none'} @ ${result.confidence.toFixed(2)})`,
			);
		}
	}

	console.log(
		`[sync-gog] done — matched=${matched} skipped=${alreadyMatched} unmatched=${unmatched}`,
	);
	await raw.end();
}

main().catch(async (e) => {
	console.error('[sync-gog] fatal:', e);
	await raw.end().catch(() => {});
	process.exit(1);
});
