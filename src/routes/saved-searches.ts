import { Hono } from 'hono';
import type postgres from 'postgres';

/**
 * Saved searches ("Curated") API. Each row is a named live query that
 * re-runs as a normal `/library` search when the user opens it.
 *
 *   GET    /saved_searches               all saved searches with live counts
 *   POST   /saved_searches               create (body: {name, query, tag_filter?, sort_order?, emoji?})
 *   GET    /saved_searches/:idOrSlug     fetch one (without games — UI runs the search itself)
 *   DELETE /saved_searches/:idOrSlug     delete
 *
 * Live count is FTS-only (no vector) — accurate for keyword filtering,
 * which is what determines "is this game in the matches set". Vector only
 * affects ordering, not membership. Cached in-process for 60s per
 * (query, tag_filter) so a sidebar refresh doesn't hammer the DB.
 */
export function savedSearchesRoutes(raw: postgres.Sql) {
	const app = new Hono();

	const countCache = new Map<string, { count: number; expires: number }>();
	const COUNT_TTL_MS = 60_000;

	async function liveCount(query: string, tagFilter: string | null) {
		const cacheKey = `${query}|${tagFilter ?? ''}`;
		const cached = countCache.get(cacheKey);
		if (cached && cached.expires > Date.now()) return cached.count;
		const conds = [raw`g.search @@ websearch_to_tsquery('english', ${query})`];
		if (tagFilter) {
			conds.push(
				raw`g.appid IN (SELECT appid FROM game_tags WHERE tag ILIKE ${`%${tagFilter}%`})`,
			);
		}
		const where = conds.reduce((acc, cond, i) =>
			i === 0 ? cond : raw`${acc} AND ${cond}`,
		);
		const [row] =
			await raw`SELECT COUNT(*)::int AS n FROM games g WHERE ${where}`;
		const count = (row?.n as number) ?? 0;
		countCache.set(cacheKey, { count, expires: Date.now() + COUNT_TTL_MS });
		return count;
	}

	app.get('/saved_searches', async (c) => {
		const rows = await raw`
			SELECT id, slug, name, emoji, query, tag_filter, sort_order, created_at
			FROM saved_searches
			ORDER BY created_at DESC
		`;
		const out = await Promise.all(
			rows.map(async (r) => ({
				...r,
				count: await liveCount(
					r.query as string,
					(r.tag_filter as string | null) ?? null,
				),
			})),
		);
		return c.json({ saved_searches: out });
	});

	app.post('/saved_searches', async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as {
			name?: string;
			query?: string;
			tag_filter?: string;
			sort_order?: string;
			emoji?: string;
		};
		if (!body.name || body.name.trim().length === 0) {
			return c.json({ error: 'name required' }, 400);
		}
		if (!body.query || body.query.trim().length === 0) {
			return c.json({ error: 'query required' }, 400);
		}
		const slug = await uniqueSlug(raw, slugify(body.name));
		try {
			const [row] = await raw`
				INSERT INTO saved_searches (slug, name, emoji, query, tag_filter, sort_order)
				VALUES (
					${slug},
					${body.name.trim()},
					${body.emoji ?? null},
					${body.query.trim()},
					${body.tag_filter?.trim() || null},
					${body.sort_order?.trim() || null}
				)
				RETURNING id, slug, name, emoji, query, tag_filter, sort_order, created_at
			`;
			return c.json(row, 201);
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'unknown';
			return c.json({ error: msg }, 500);
		}
	});

	app.get('/saved_searches/:ref', async (c) => {
		const row = await resolve(raw, c.req.param('ref'));
		if (!row) return c.json({ error: 'not found' }, 404);
		return c.json({
			...row,
			count: await liveCount(
				row.query,
				(row.tag_filter as string | null) ?? null,
			),
		});
	});

	app.delete('/saved_searches/:ref', async (c) => {
		const row = await resolve(raw, c.req.param('ref'));
		if (!row) return c.json({ error: 'not found' }, 404);
		await raw`DELETE FROM saved_searches WHERE id = ${row.id}`;
		return c.json({ ok: true });
	});

	return app;
}

interface Row {
	id: number;
	slug: string;
	name: string;
	emoji: string | null;
	query: string;
	tag_filter: string | null;
	sort_order: string | null;
}

async function resolve(raw: postgres.Sql, ref: string): Promise<Row | null> {
	const id = Number.parseInt(ref, 10);
	const rows = Number.isFinite(id)
		? await raw`SELECT id, slug, name, emoji, query, tag_filter, sort_order
			FROM saved_searches WHERE id = ${id} LIMIT 1`
		: await raw`SELECT id, slug, name, emoji, query, tag_filter, sort_order
			FROM saved_searches WHERE slug = ${ref} LIMIT 1`;
	return (rows[0] as Row | undefined) ?? null;
}

function slugify(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 64);
}

async function uniqueSlug(raw: postgres.Sql, base: string): Promise<string> {
	if (!base) return `search_${Date.now()}`;
	let candidate = base;
	for (let i = 2; i < 100; i++) {
		const [row] =
			await raw`SELECT 1 FROM saved_searches WHERE slug = ${candidate} LIMIT 1`;
		if (!row) return candidate;
		candidate = `${base}_${i}`;
	}
	return `${base}_${Date.now()}`;
}
