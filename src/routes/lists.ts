import { Hono } from 'hono';
import type postgres from 'postgres';

/**
 * Lists API — bookmarks, remind-me-later, custom playlists.
 *
 *   GET    /lists                          all lists with game counts
 *   POST   /lists                          create custom (body: {name, emoji?, slug?})
 *   DELETE /lists/:idOrSlug                only non-system lists
 *   GET    /lists/:idOrSlug                detail (incl. games)
 *   POST   /lists/:idOrSlug/games/:appid   add (body: {note?})
 *   DELETE /lists/:idOrSlug/games/:appid   remove
 */
export function listsRoutes(raw: postgres.Sql) {
	const app = new Hono();

	app.get('/lists', async (c) => {
		const rows = await raw`
			SELECT
				l.id, l.slug, l.name, l.emoji, l.is_system, l.created_at,
				COUNT(lg.appid)::int AS count
			FROM lists l
			LEFT JOIN list_games lg ON lg.list_id = l.id
			GROUP BY l.id
			ORDER BY l.is_system DESC, l.created_at ASC
		`;
		return c.json({ lists: rows });
	});

	app.post('/lists', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as {
			name?: string;
			emoji?: string;
			slug?: string;
		};
		if (!body.name || body.name.trim().length === 0) {
			return c.json({ error: 'name required' }, 400);
		}
		const slug = body.slug?.trim() || slugify(body.name);
		try {
			const [row] = await raw`
				INSERT INTO lists (slug, name, emoji, is_system)
				VALUES (${slug}, ${body.name.trim()}, ${body.emoji ?? null}, FALSE)
				RETURNING id, slug, name, emoji, is_system, created_at
			`;
			return c.json(row, 201);
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'unknown';
			if (msg.includes('lists_slug_key')) {
				return c.json({ error: 'slug already exists' }, 409);
			}
			return c.json({ error: msg }, 500);
		}
	});

	app.delete('/lists/:ref', async (c) => {
		const list = await resolveList(raw, c.req.param('ref'));
		if (!list) return c.json({ error: 'not found' }, 404);
		if (list.is_system) {
			return c.json({ error: 'system lists cannot be deleted' }, 400);
		}
		await raw`DELETE FROM lists WHERE id = ${list.id}`;
		return c.json({ ok: true });
	});

	app.get('/lists/:ref', async (c) => {
		const list = await resolveList(raw, c.req.param('ref'));
		if (!list) return c.json({ error: 'not found' }, 404);
		const games = await raw`
			SELECT
				g.appid, g.name, g.short_desc, g.header_image,
				g.release_date, g.genres, g.playtime_min, g.playtime_2wk,
				g.last_played, g.positive, g.negative, g.hltb_main,
				g.metacritic,
				COALESCE(po.platforms, ARRAY[]::text[]) AS platforms,
				lg.note, lg.added_at
			FROM list_games lg
			JOIN games g ON g.appid = lg.appid
			LEFT JOIN (
				SELECT appid, array_agg(platform ORDER BY platform) AS platforms
				FROM platform_ownership GROUP BY appid
			) po ON po.appid = g.appid
			WHERE lg.list_id = ${list.id}
			ORDER BY lg.added_at DESC
		`;
		return c.json({ ...list, games });
	});

	app.post('/lists/:ref/games/:appid', async (c) => {
		const list = await resolveList(raw, c.req.param('ref'));
		if (!list) return c.json({ error: 'list not found' }, 404);
		const appid = Number.parseInt(c.req.param('appid'), 10);
		if (!Number.isFinite(appid)) return c.json({ error: 'bad appid' }, 400);
		const body = (await c.req.json().catch(() => ({}))) as { note?: string };
		const [row] = await raw`
			INSERT INTO list_games (list_id, appid, note)
			VALUES (${list.id}, ${appid}, ${body.note ?? null})
			ON CONFLICT (list_id, appid) DO UPDATE SET
				note = EXCLUDED.note,
				added_at = list_games.added_at
			RETURNING list_id, appid, note, added_at
		`;
		return c.json(row, 201);
	});

	app.delete('/lists/:ref/games/:appid', async (c) => {
		const list = await resolveList(raw, c.req.param('ref'));
		if (!list) return c.json({ error: 'list not found' }, 404);
		const appid = Number.parseInt(c.req.param('appid'), 10);
		if (!Number.isFinite(appid)) return c.json({ error: 'bad appid' }, 400);
		await raw`DELETE FROM list_games WHERE list_id = ${list.id} AND appid = ${appid}`;
		return c.json({ ok: true });
	});

	return app;
}

interface ListRow {
	id: number;
	slug: string;
	name: string;
	emoji: string | null;
	is_system: boolean;
}

async function resolveList(
	raw: postgres.Sql,
	ref: string,
): Promise<ListRow | null> {
	const id = Number.parseInt(ref, 10);
	const rows = Number.isFinite(id)
		? await raw`SELECT id, slug, name, emoji, is_system FROM lists WHERE id = ${id} LIMIT 1`
		: await raw`SELECT id, slug, name, emoji, is_system FROM lists WHERE slug = ${ref} LIMIT 1`;
	return (rows[0] as ListRow | undefined) ?? null;
}

function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 64);
}
