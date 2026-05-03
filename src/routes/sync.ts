import { Hono } from 'hono';
import type postgres from 'postgres';
import {
	EPIC_AUTH_URL,
	epicAuthExchange,
	epicLibrary,
	epicLogout,
	epicStatus,
} from '../lib/epic';
import { type EpicGameInput, importEpicLibrary } from '../lib/epic-import';
import {
	clearTokens as clearGogTokens,
	exchangeCodeForTokens as exchangeGogCode,
	getAuthUrl as getGogAuthUrl,
	loadTokens as loadGogTokens,
} from '../lib/gog';
import { syncGogLibrary } from '../lib/gog-sync';
import { fetchOwnedGames } from '../lib/steam';

/**
 * Library sync endpoints — Steam (built-in API), GOG (OAuth), Epic
 * (deferred, requires the legendary CLI tool installed on the host).
 *
 * The GOG flow is what the desktop's Settings → "Connect GOG" wires
 * to: GET the auth URL, open it in a browser, user pastes the code
 * back, POST it here to exchange for tokens, then trigger the sync.
 */
export function syncRoutes(raw: postgres.Sql) {
	const app = new Hono();

	app.post('/sync', async (c) => {
		try {
			const games = await fetchOwnedGames();
			const result = await upsertOwnedGames(raw, games);
			await raw`
				INSERT INTO meta (key, value, updated)
				VALUES ('last_sync', ${new Date().toISOString()}, now())
				ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated = now()
			`;
			return c.json({ ok: true, ...result });
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'unknown';
			return c.json({ error: 'sync failed', detail: msg }, 502);
		}
	});

	// ----- GOG --------------------------------------------------------

	/** Status of stored GOG tokens (for the UI to show Connected vs not). */
	app.get('/sync/gog/status', async (c) => {
		const t = await loadGogTokens().catch(() => null);
		if (!t) return c.json({ authed: false });
		return c.json({
			authed: true,
			user_id: t.user_id,
			expires_at: new Date(t.expires_at).toISOString(),
		});
	});

	/** OAuth URL the user opens in a browser to sign in. */
	app.get('/sync/gog/auth-url', (c) => {
		return c.json({ url: getGogAuthUrl() });
	});

	/**
	 * Exchange the `code` query param the user copied out of the GOG
	 * post-login redirect URL. Persists tokens server-side so subsequent
	 * sync requests don't need re-auth.
	 */
	app.post('/sync/gog/auth-exchange', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { code?: unknown };
		const code = typeof body.code === 'string' ? body.code.trim() : '';
		if (!code) return c.json({ error: 'code is required' }, 400);
		try {
			const tokens = await exchangeGogCode(code);
			return c.json({ ok: true, user_id: tokens.user_id });
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'unknown';
			return c.json({ error: 'exchange failed', detail: msg }, 400);
		}
	});

	/** Run the full GOG library sync. Requires prior /auth-exchange. */
	app.post('/sync/gog', async (c) => {
		try {
			const result = await syncGogLibrary(raw, () => {});
			return c.json({ ok: true, ...result });
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'unknown';
			return c.json({ error: 'gog sync failed', detail: msg }, 502);
		}
	});

	/** Forget the stored GOG tokens — does not touch the imported library. */
	app.post('/sync/gog/disconnect', async (c) => {
		try {
			await clearGogTokens();
			return c.json({ ok: true });
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'unknown';
			return c.json({ error: 'disconnect failed', detail: msg }, 500);
		}
	});

	// ----- Epic --------------------------------------------------------
	//
	// legendary-gl runs INSIDE the API container (installed via the
	// Dockerfile). User clicks "Open Epic sign-in", logs in via the
	// real browser, copies the auth code back, and we exchange it
	// server-side. Tokens land at $XDG_CONFIG_HOME/legendary/user.json
	// which the consumer compose maps onto a persistent volume.

	app.get('/sync/epic/status', (c) => c.json(epicStatus()));

	app.get('/sync/epic/auth-url', (c) => c.json({ url: EPIC_AUTH_URL }));

	app.post('/sync/epic/auth-exchange', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as { code?: unknown };
		const code = typeof body.code === 'string' ? body.code.trim() : '';
		if (!code) return c.json({ error: 'code is required' }, 400);
		// Tolerate the user pasting the whole JSON snippet from the
		// post-login landing page rather than just the bare code.
		const m = code.match(/"authorizationCode"\s*:\s*"([^"]+)"/);
		const real = m ? m[1] : code;
		const r = epicAuthExchange(real);
		return c.json(r, r.ok ? 200 : 400);
	});

	app.post('/sync/epic', async (c) => {
		const lib = epicLibrary();
		if (!lib.ok || !lib.items) {
			return c.json({ error: lib.error ?? 'library fetch failed' }, 502);
		}
		try {
			const result = await importEpicLibrary(raw, lib.items, () => {});
			return c.json({ ok: true, ...result });
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'unknown';
			return c.json({ error: 'epic import failed', detail: msg }, 502);
		}
	});

	app.post('/sync/epic/disconnect', (c) => {
		const r = epicLogout();
		return c.json(r, r.ok ? 200 : 500);
	});

	/**
	 * Legacy endpoint used by the old desktop-side sync flow (shelled
	 * legendary on host, POSTed library here). Kept for backward
	 * compatibility — `POST /sync/epic` is the new path.
	 */
	app.post('/sync/epic/import', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as {
			games?: unknown;
		};
		if (!Array.isArray(body.games)) {
			return c.json({ error: 'games array is required' }, 400);
		}
		try {
			const result = await importEpicLibrary(
				raw,
				body.games as EpicGameInput[],
				() => {},
			);
			return c.json({ ok: true, ...result });
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'unknown';
			return c.json({ error: 'epic import failed', detail: msg }, 502);
		}
	});

	return app;
}

/**
 * Sync owned Steam games into `games` and `platform_ownership(platform='steam')`.
 * Removes Steam ownership rows for refunded/removed titles. A game with
 * remaining non-Steam ownership stays in `games`; one with zero ownership
 * gets fully deleted.
 */
export async function upsertOwnedGames(
	raw: postgres.Sql,
	games: Awaited<ReturnType<typeof fetchOwnedGames>>,
): Promise<{
	inserted: number;
	updated: number;
	total: number;
	removed: number;
}> {
	if (games.length === 0)
		return { inserted: 0, updated: 0, total: 0, removed: 0 };

	const beforeRows =
		await raw`SELECT COUNT(*)::int AS c FROM platform_ownership WHERE platform = 'steam'`;
	const before = (beforeRows[0]?.c as number) ?? 0;

	const currentAppids = games.map((g) => g.appid);

	// Drop Steam ownership for games no longer in the owned list (refunds, etc.)
	await raw`
		DELETE FROM platform_ownership
		WHERE platform = 'steam' AND appid <> ALL(${currentAppids}::int[])
	`;

	for (const g of games) {
		const lastPlayed = g.last_played?.toISOString() ?? null;
		await raw`
			INSERT INTO games (appid, name, playtime_min, playtime_2wk, last_played, updated_at)
			VALUES (${g.appid}, ${g.name}, ${g.playtime_minutes}, ${g.playtime_2weeks}, ${lastPlayed}, now())
			ON CONFLICT (appid) DO UPDATE SET
				name = EXCLUDED.name,
				playtime_min = EXCLUDED.playtime_min,
				playtime_2wk = EXCLUDED.playtime_2wk,
				last_played = EXCLUDED.last_played,
				updated_at = now()
		`;
		await raw`
			INSERT INTO platform_ownership
				(appid, platform, external_id, title_at_source, playtime_min, last_played)
			VALUES
				(${g.appid}, 'steam', ${String(g.appid)}, ${g.name}, ${g.playtime_minutes}, ${lastPlayed})
			ON CONFLICT (appid, platform) DO UPDATE SET
				title_at_source = EXCLUDED.title_at_source,
				playtime_min = EXCLUDED.playtime_min,
				last_played = EXCLUDED.last_played,
				updated_at = now()
		`;
	}

	// Cascade-delete games with zero ownership rows after the cleanup above.
	const removedRows = await raw`
		DELETE FROM games
		WHERE NOT EXISTS (SELECT 1 FROM platform_ownership po WHERE po.appid = games.appid)
		RETURNING appid
	`;

	const afterRows =
		await raw`SELECT COUNT(*)::int AS c FROM platform_ownership WHERE platform = 'steam'`;
	const after = (afterRows[0]?.c as number) ?? 0;

	return {
		inserted: Math.max(0, after - before),
		updated: games.length,
		total: after,
		removed: removedRows.length,
	};
}
