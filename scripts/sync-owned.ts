/**
 * Cron entry: refresh the owned-games list.
 * Container: `steam-syncer` (default daily at 06:00 local).
 */
import { raw } from '../src/db';
import { fetchOwnedGames } from '../src/lib/steam';
import { upsertOwnedGames } from '../src/routes/sync';

async function main() {
	console.log(`[sync] starting at ${new Date().toISOString()}`);
	const games = await fetchOwnedGames();
	console.log(`[sync] fetched ${games.length} owned games`);
	const result = await upsertOwnedGames(raw, games);
	console.log(`[sync] result:`, result);
	await raw`
		INSERT INTO meta (key, value, updated)
		VALUES ('last_sync', ${new Date().toISOString()}, now())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated = now()
	`;
	await raw.end();
}

main().catch(async (e) => {
	console.error('[sync] fatal:', e);
	await raw.end().catch(() => {});
	process.exit(1);
});
