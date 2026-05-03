/**
 * Sync owned GOG library into platform_ownership. Thin wrapper around
 * `src/lib/gog-sync.ts` so the API can call the same logic via
 * `POST /sync/gog`.
 *
 * Pre-req: GOG must be authed (one-time browser flow). Run the desktop
 * app's Settings → Connect GOG, OR `bun run auth:gog` from a terminal.
 */
import { raw } from '../src/db';
import { syncGogLibrary } from '../src/lib/gog-sync';

console.log(`[sync-gog] starting at ${new Date().toISOString()}`);

try {
	await syncGogLibrary(raw, console.log);
	await raw.end();
} catch (e) {
	console.error('[sync-gog] fatal:', e);
	await raw.end().catch(() => {});
	process.exit(1);
}
