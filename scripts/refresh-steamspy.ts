/**
 * Cron entry: refresh the SteamSpy fields (CCU, positive/negative reviews,
 * tag votes) for games whose steamspy_refreshed_at is stale. Without this,
 * Trending and other CCU-driven views show enrichment-time snapshots that
 * are weeks/months old.
 *
 * Picks games with NULL or older-than-REFRESH_DAYS timestamps, oldest first.
 * SteamSpy tolerates ~1 req/sec; we sleep 1100ms between to be safe.
 */
import { raw } from '../src/db';
import { sleep } from '../src/lib/sleep';
import { refreshSteamSpyOne } from '../src/routes/enrich';

const BATCH = Number.parseInt(process.env.STEAMSPY_BATCH ?? '500', 10);
const DELAY_MS = Number.parseInt(process.env.STEAMSPY_DELAY_MS ?? '1100', 10);
const REFRESH_DAYS = Number.parseInt(
	process.env.STEAMSPY_REFRESH_DAYS ?? '7',
	10,
);

async function main() {
	console.log(
		`[steamspy] starting at ${new Date().toISOString()} (batch=${BATCH}, refresh_days=${REFRESH_DAYS})`,
	);
	const rows = await raw`
		SELECT appid, name FROM games
		WHERE enriched_at IS NOT NULL
		  AND (
		    steamspy_refreshed_at IS NULL
		    OR steamspy_refreshed_at < now() - (${REFRESH_DAYS}::int * INTERVAL '1 day')
		  )
		ORDER BY steamspy_refreshed_at ASC NULLS FIRST, appid ASC
		LIMIT ${BATCH}
	`;
	console.log(`[steamspy] picked ${rows.length} games`);
	let ok = 0;
	let nodata = 0;
	let failed = 0;
	for (const r of rows) {
		const appid = r.appid as number;
		try {
			const status = await refreshSteamSpyOne(raw, appid);
			if (status === 'ok') ok++;
			else nodata++;
		} catch (e) {
			failed++;
			console.error(
				`[steamspy] ${appid} ${r.name} FAILED:`,
				e instanceof Error ? e.message : e,
			);
		}
		await sleep(DELAY_MS);
	}
	console.log(`[steamspy] done — ok=${ok} no_data=${nodata} failed=${failed}`);
	await raw.end();
}

main().catch(async (e) => {
	console.error('[steamspy] fatal:', e);
	await raw.end().catch(() => {});
	process.exit(1);
});
