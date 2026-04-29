/**
 * Cron entry: embed games whose enriched_at is NOT NULL but embedded_at IS NULL.
 */
import { raw } from '../src/db';
import { isOllamaEnabled } from '../src/lib/ollama';
import { embedOne } from '../src/routes/enrich';

const BATCH = Number.parseInt(process.env.EMBED_BATCH ?? '100', 10);

async function main() {
	if (!isOllamaEnabled()) {
		console.log('[embed] OLLAMA_URL not set — skipping');
		await raw.end();
		return;
	}
	console.log(
		`[embed] starting at ${new Date().toISOString()} (batch=${BATCH})`,
	);
	const rows = await raw`
		SELECT appid, name FROM games
		WHERE enriched_at IS NOT NULL AND embedded_at IS NULL
		ORDER BY appid ASC
		LIMIT ${BATCH}
	`;
	console.log(`[embed] picked ${rows.length} games`);
	let ok = 0;
	let failed = 0;
	for (const r of rows) {
		const appid = r.appid as number;
		try {
			await embedOne(raw, appid);
			ok++;
		} catch (e) {
			failed++;
			console.error(
				`[embed] ${appid} ${r.name} FAILED:`,
				e instanceof Error ? e.message : e,
			);
		}
	}
	console.log(`[embed] done — ok=${ok} failed=${failed}`);
	await raw.end();
}

main().catch(async (e) => {
	console.error('[embed] fatal:', e);
	await raw.end().catch(() => {});
	process.exit(1);
});
