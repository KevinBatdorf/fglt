/**
 * Cron entry: enrich a batch of games per tick.
 *
 * Two passes:
 *   1. Brand-new games (enriched_at IS NULL) — first-time enrichment.
 *   2. Already-enriched games missing newer-source data (no screenshots,
 *      no Steam reviews fetch, no OpenCritic fetch) — backfill so detail
 *      views fill in over time as columns / sources get added.
 *
 * Both passes share the same `enrichOne` codepath; rate-limit-sensitive
 * sources (OpenCritic) self-throttle internally.
 */
import { raw } from '../src/db';
import { sleep } from '../src/lib/sleep';
import { enrichOne } from '../src/routes/enrich';

// Steam appdetails rate-limits at ~200 req / 5 min per IP. Each enriched
// game makes ~4 Steam-side calls (appdetails, steamspy, similar, reviews),
// so 40 + 15 games per 15-min tick at 1.5s spacing keeps us comfortably
// under the limit while leaving headroom for manual /refresh from the UI.
const BATCH = Number.parseInt(process.env.ENRICH_BATCH ?? '40', 10);
const BACKFILL_BATCH = Number.parseInt(
	process.env.ENRICH_BACKFILL_BATCH ?? '15',
	10,
);
const DELAY_MS = Number.parseInt(process.env.ENRICH_DELAY_MS ?? '1500', 10);

async function runBatch(
	label: string,
	rows: { appid: number; name: string }[],
) {
	console.log(`[enrich/${label}] picked ${rows.length} games`);
	let ok = 0;
	let skipped = 0;
	let failed = 0;
	for (const r of rows) {
		const appid = r.appid;
		try {
			const status = await enrichOne(raw, appid);
			if (status === 'ok') ok++;
			else skipped++;
			console.log(`[enrich/${label}] ${appid} ${r.name} -> ${status}`);
		} catch (e) {
			failed++;
			console.error(
				`[enrich/${label}] ${appid} ${r.name} FAILED:`,
				e instanceof Error ? e.message : e,
			);
		}
		await sleep(DELAY_MS);
	}
	console.log(
		`[enrich/${label}] done — ok=${ok} skipped=${skipped} failed=${failed}`,
	);
}

// Recently-released games' metadata (reviews, scores, screenshots) shifts
// quickly in the days after launch — re-pull anything older than this.
const FRESH_WINDOW_DAYS = 14;
const FRESH_REFRESH_INTERVAL_HOURS = 24;
const FRESH_BATCH = Number.parseInt(process.env.ENRICH_FRESH_BATCH ?? '5', 10);

async function main() {
	console.log(
		`[enrich] starting at ${new Date().toISOString()} (batch=${BATCH}, backfill=${BACKFILL_BATCH}, fresh=${FRESH_BATCH}, delay=${DELAY_MS}ms)`,
	);

	// Pass 1: brand-new games
	const newRows = (await raw`
		SELECT appid, name FROM games
		WHERE enriched_at IS NULL
		ORDER BY appid ASC
		LIMIT ${BATCH}
	`) as unknown as { appid: number; name: string }[];
	await runBatch('new', newRows);

	// Pass 2: backfill — already enriched, but missing newer-source markers.
	// We use *_fetched_at columns rather than the data's emptiness so games
	// where Steam genuinely returned nothing aren't retried every tick.
	// Oldest first so the library evens out over time.
	const backfillRows = (await raw`
		SELECT appid, name FROM games
		WHERE enriched_at IS NOT NULL
		  AND (
		    screenshots_fetched_at   IS NULL
		    OR steam_reviews_fetched_at IS NULL
		    OR opencritic_fetched_at    IS NULL
		  )
		ORDER BY
		  COALESCE(steam_reviews_fetched_at, '1970-01-01') ASC,
		  appid ASC
		LIMIT ${BACKFILL_BATCH}
	`) as unknown as { appid: number; name: string }[];
	await runBatch('backfill', backfillRows);

	// Pass 3: fresh-release re-pull. A game released in the last 14 days
	// gets re-enriched once per day so review counts, screenshots, etc.
	// stay current. release_date is a free-form Steam string ("Apr 15,
	// 2026" / "Coming soon" / "Q3 2026"), so we parse with timestamptz
	// cast and ignore parse errors.
	const freshRows = (await raw`
		SELECT appid, name FROM games
		WHERE enriched_at IS NOT NULL
		  AND release_date IS NOT NULL
		  AND release_date ~ '^[A-Z][a-z]{2} [0-9]{1,2}, [0-9]{4}$'
		  AND release_date::timestamptz > now() - INTERVAL '${raw.unsafe(
				String(FRESH_WINDOW_DAYS),
			)} days'
		  AND release_date::timestamptz <= now()
		  AND (
		    enriched_at < now() - INTERVAL '${raw.unsafe(
					String(FRESH_REFRESH_INTERVAL_HOURS),
				)} hours'
		  )
		ORDER BY enriched_at ASC
		LIMIT ${FRESH_BATCH}
	`) as unknown as { appid: number; name: string }[];
	await runBatch('fresh', freshRows);

	await raw.end();
}

main().catch(async (e) => {
	console.error('[enrich] fatal:', e);
	await raw.end().catch(() => {});
	process.exit(1);
});
