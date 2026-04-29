import { Hono } from 'hono';
import type postgres from 'postgres';

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
