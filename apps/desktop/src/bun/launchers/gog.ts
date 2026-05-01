/**
 * GOG Galaxy integration via the local Galaxy SQLite database.
 *
 * Galaxy stores its catalog + install state at:
 *   Windows: C:/ProgramData/GOG.com/Galaxy/storage/galaxy-2.0.db
 *
 * The `InstalledBaseProducts` table contains every base product currently
 * installed; `productId` matches the GOG ids we stored in
 * `platform_ownership.external_id` for `platform='gog'`.
 *
 * We open the database read-only via `bun:sqlite`. Falls back to an empty
 * set if Galaxy isn't installed or the schema differs (e.g. on macOS).
 */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';

const CANDIDATES = ['C:/ProgramData/GOG.com/Galaxy/storage/galaxy-2.0.db'];

interface InstalledRow {
	productId: number;
}

export function getGogInstalled(): Set<string> {
	for (const path of CANDIDATES) {
		if (!existsSync(path)) continue;
		try {
			const db = new Database(path, { readonly: true });
			const rows = db
				.prepare('SELECT productId FROM InstalledBaseProducts')
				.all() as InstalledRow[];
			db.close();
			return new Set(rows.map((r) => String(r.productId)));
		} catch (e) {
			console.error(`[gog-launcher] failed to read ${path}:`, e);
			return new Set();
		}
	}
	return new Set();
}

export function gogLaunchUri(externalId: string): string {
	return `goggalaxy://openGameView/${externalId}`;
}
