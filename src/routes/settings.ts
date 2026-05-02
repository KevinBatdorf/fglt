import { Hono } from 'hono';
import type postgres from 'postgres';
import {
	type AppConfig,
	CONFIG_KEYS,
	getConfig,
	invalidateConfig,
	SENSITIVE_KEYS,
} from '../lib/config';

/**
 * Per-instance settings backed by the `meta` table. Currently exposes
 * `hidden_genres` — the list of Steam genre names to exclude from curated
 * views (home dashboard, trending, recommended, random). The Settings
 * page in the desktop app lets the user edit it; /curate reads it on
 * each request.
 */
export function settingsRoutes(raw: postgres.Sql) {
	const app = new Hono();

	app.get('/settings/hidden-genres', async (c) => {
		const list = await readHiddenGenres(raw);
		return c.json({ hidden_genres: list });
	});

	app.post('/settings/hidden-genres', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as {
			hidden_genres?: unknown;
		};
		if (!Array.isArray(body.hidden_genres)) {
			return c.json(
				{ error: 'hidden_genres must be an array of strings' },
				400,
			);
		}
		const cleaned = Array.from(
			new Set(
				body.hidden_genres
					.filter((g): g is string => typeof g === 'string')
					.map((g) => g.trim())
					.filter((g) => g.length > 0),
			),
		).sort();
		await raw`
			INSERT INTO meta (key, value, updated)
			VALUES ('hidden_genres', ${JSON.stringify(cleaned)}, now())
			ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated = now()
		`;
		return c.json({ hidden_genres: cleaned });
	});

	/**
	 * GET /settings/config — return the current resolved config map.
	 * Sensitive values (API keys) are masked by default; pass ?reveal=1
	 * to get them in plaintext (the desktop UI uses this on click-to-reveal).
	 */
	app.get('/settings/config', async (c) => {
		const reveal = c.req.query('reveal') === '1';
		const cfg = await getConfig();
		const out: Record<string, string | undefined> = {};
		for (const key of CONFIG_KEYS) {
			const v = cfg[key];
			if (v === undefined) {
				out[key] = undefined;
				continue;
			}
			if (!reveal && SENSITIVE_KEYS.has(key)) {
				// Show only the last 4 chars so the user can verify the right
				// key is set without exposing it.
				out[key] = v.length <= 4 ? '••••' : `••••${v.slice(-4)}`;
			} else {
				out[key] = v;
			}
		}
		return c.json({ config: out });
	});

	/**
	 * POST /settings/config — upsert one or more keys. Body shape:
	 *   { STEAM_API_KEY: 'abc...', STEAM_ID: '7656...' }
	 * Empty string deletes the row (treats unset and empty the same).
	 */
	app.post('/settings/config', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Partial<
			Record<keyof AppConfig, string>
		>;
		const allowed = new Set(CONFIG_KEYS);
		const updates: Array<{ key: string; value: string }> = [];
		const deletes: string[] = [];
		for (const [k, v] of Object.entries(body)) {
			if (!allowed.has(k as keyof AppConfig)) continue;
			if (typeof v !== 'string') continue;
			if (v === '') deletes.push(k);
			else updates.push({ key: k, value: v });
		}
		if (deletes.length > 0) {
			await raw`DELETE FROM app_settings WHERE key = ANY(${deletes})`;
		}
		for (const u of updates) {
			await raw`
				INSERT INTO app_settings (key, value, updated_at)
				VALUES (${u.key}, ${u.value}, now())
				ON CONFLICT (key) DO UPDATE
					SET value = EXCLUDED.value, updated_at = now()
			`;
		}
		// Bust the in-process cache so subsequent reads on this API instance
		// see the new values immediately. Other processes (cron containers)
		// will pick them up on their own 5s TTL.
		invalidateConfig();
		return c.json({ ok: true, updated: updates.length, deleted: deletes.length });
	});

	app.get('/genres', async (c) => {
		const rows = await raw`
			SELECT g, COUNT(*)::int AS games
			FROM (SELECT unnest(genres) AS g FROM games WHERE genres IS NOT NULL) sub
			GROUP BY g
			ORDER BY games DESC, g ASC
		`;
		return c.json({
			genres: rows.map((r) => ({
				name: r.g as string,
				games: r.games as number,
			})),
		});
	});

	return app;
}

const DEFAULT_HIDDEN: string[] = [
	'Utilities',
	'Software Training',
	'Web Publishing',
	'Audio Production',
	'Video Production',
	'Animation & Modeling',
	'Game Development',
	'Photo Editing',
	'Education',
	'Design & Illustration',
	'Documentary',
];

export async function readHiddenGenres(raw: postgres.Sql): Promise<string[]> {
	const [row] = await raw`
		SELECT value FROM meta WHERE key = 'hidden_genres' LIMIT 1
	`;
	if (!row?.value) return DEFAULT_HIDDEN;
	try {
		const parsed = JSON.parse(row.value as string) as unknown;
		if (Array.isArray(parsed)) {
			return parsed.filter((g): g is string => typeof g === 'string');
		}
	} catch {
		/* fall through */
	}
	return DEFAULT_HIDDEN;
}
