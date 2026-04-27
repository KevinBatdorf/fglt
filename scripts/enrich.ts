/**
 * Cron entry: enrich a batch of games whose enriched_at is NULL.
 * Owned games are processed first.
 */
import { raw } from '../src/db';
import { sleep } from '../src/lib/sleep';
import { enrichOne } from '../src/routes/enrich';

const BATCH = Number.parseInt(process.env.ENRICH_BATCH ?? '50', 10);
const DELAY_MS = Number.parseInt(process.env.ENRICH_DELAY_MS ?? '1500', 10);

async function main() {
	console.log(
		`[enrich] starting at ${new Date().toISOString()} (batch=${BATCH}, delay=${DELAY_MS}ms)`,
	);
	const rows = await raw`
		SELECT appid, name FROM games
		WHERE enriched_at IS NULL
		ORDER BY appid ASC
		LIMIT ${BATCH}
	`;
	console.log(`[enrich] picked ${rows.length} games`);
	let ok = 0;
	let skipped = 0;
	let failed = 0;
	for (const r of rows) {
		const appid = r.appid as number;
		try {
			const status = await enrichOne(raw, appid);
			if (status === 'ok') ok++;
			else skipped++;
			console.log(`[enrich] ${appid} ${r.name} -> ${status}`);
		} catch (e) {
			failed++;
			console.error(
				`[enrich] ${appid} ${r.name} FAILED:`,
				e instanceof Error ? e.message : e,
			);
		}
		await sleep(DELAY_MS);
	}
	console.log(`[enrich] done — ok=${ok} skipped=${skipped} failed=${failed}`);
	await raw.end();
}

main().catch(async (e) => {
	console.error('[enrich] fatal:', e);
	await raw.end().catch(() => {});
	process.exit(1);
});
