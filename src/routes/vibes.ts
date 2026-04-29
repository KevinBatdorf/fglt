import { Hono } from 'hono';
import type postgres from 'postgres';
import { chat, isOllamaEnabled } from '../lib/ollama';

/**
 * GET /vibes
 *   Returns curated vibe-search chips for the home/header. Cached for
 *   24h in `meta.vibes_cache`. If cache is stale and Ollama is up, kicks
 *   off a background regen (stale cache is still served).
 *
 * POST /vibes/regenerate
 *   Forces a regen synchronously and returns the new chips.
 *
 * The Ollama prompt grounds the model in the user's actual library by
 * sending the top SteamSpy tags + Steam genres so the chips reflect what
 * they own.
 */

interface Vibe {
	label: string;
	query: string;
	emoji: string;
}

const STATIC_DEFAULTS: Vibe[] = [
	{ label: 'Cozy & contemplative', query: 'cozy puzzle game with story', emoji: '🍵' },
	{ label: 'Indie horror', query: 'indie first person horror atmospheric', emoji: '🕯️' },
	{ label: 'Cyberpunk', query: 'cyberpunk dystopian neon hacker', emoji: '🌆' },
	{ label: 'Roguelike runs', query: 'roguelike deck builder run-based', emoji: '🎲' },
	{ label: 'Soulslike', query: 'soulslike fast combat parry difficult', emoji: '⚔️' },
	{ label: 'Walking sim', query: 'narrative walking simulator atmospheric story', emoji: '🚶' },
	{ label: 'Couch co-op', query: 'split-screen couch co-op friends', emoji: '🛋️' },
	{ label: 'Retro pixel', query: 'retro pixel art 16-bit platformer', emoji: '👾' },
	{ label: 'Survival craft', query: 'open world survival craft base building', emoji: '🪓' },
	{ label: 'Sci-fi exploration', query: 'atmospheric sci-fi alien exploration', emoji: '🛸' },
	{ label: 'Stealth', query: 'stealth assassin shadow infiltrate', emoji: '🗡️' },
	{ label: 'City builder', query: 'city builder management simulation', emoji: '🏙️' },
	{ label: 'Detective', query: 'detective noir mystery investigation dialog', emoji: '🔎' },
	{ label: 'Hand-drawn', query: 'beautiful hand-drawn art adventure', emoji: '🎨' },
	{ label: 'Speedrun fast', query: 'fast movement speedrun arcade', emoji: '💨' },
	{ label: 'Existential RPG', query: 'existential dread story-driven RPG', emoji: '🌒' },
];

const CACHE_KEY = 'vibes_cache';
const CACHE_TTL_HOURS = 24;
const CHIP_COUNT = 16;

interface CachedVibes {
	vibes: Vibe[];
	generated_at: string;
	source: 'static' | 'llm';
}

async function readCache(raw: postgres.Sql): Promise<CachedVibes | null> {
	const [row] = await raw`SELECT value, updated FROM meta WHERE key = ${CACHE_KEY} LIMIT 1`;
	if (!row?.value) return null;
	try {
		return JSON.parse(row.value as string) as CachedVibes;
	} catch {
		return null;
	}
}

async function writeCache(raw: postgres.Sql, payload: CachedVibes): Promise<void> {
	await raw`
		INSERT INTO meta (key, value, updated)
		VALUES (${CACHE_KEY}, ${JSON.stringify(payload)}, now())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated = now()
	`;
}

function cacheIsStale(payload: CachedVibes | null): boolean {
	if (!payload) return true;
	const age = Date.now() - new Date(payload.generated_at).getTime();
	return age > CACHE_TTL_HOURS * 60 * 60 * 1000;
}

async function generate(raw: postgres.Sql): Promise<CachedVibes> {
	if (!isOllamaEnabled()) {
		return {
			vibes: STATIC_DEFAULTS,
			generated_at: new Date().toISOString(),
			source: 'static',
		};
	}

	// Ground the prompt in the actual library
	const tagRows = await raw`
		SELECT tag, SUM(votes)::bigint AS v
		FROM game_tags
		GROUP BY tag
		ORDER BY v DESC
		LIMIT 40
	`;
	const genreRows = await raw`
		SELECT unnest(genres) AS g, COUNT(*)::int AS c
		FROM games
		GROUP BY g
		ORDER BY c DESC
		LIMIT 10
	`;
	const topTags = tagRows.map((r) => r.tag).join(', ');
	const topGenres = genreRows.map((r) => r.g).join(', ');

	const prompt = `You generate "vibe" search chips for a personal Steam library app. Each chip has:
  - label: 2-4 words, capitalized, evocative (NOT a genre name)
  - query: 4-8 words, lowercase, used as a hybrid keyword+semantic search
  - emoji: ONE emoji that fits the vibe

The user's library skews toward these tags: ${topTags}
And these genres: ${topGenres}

Return EXACTLY ${CHIP_COUNT} chips as a JSON object: {"vibes": [{"label": "...", "query": "...", "emoji": "..."}, ...]}

Vibes should evoke moods/aesthetics/playstyles, not just restate genres. Examples of good vibes: "Cozy & contemplative", "Indie horror", "Cyberpunk", "Roguelike runs", "Couch co-op", "Walking sim". Avoid generic labels like "Action" or "Adventure". Mix moods, time-of-day, gameplay flavors, and aesthetic registers. Make them surprising but accurate to the library.

Return ONLY the JSON object.`;

	const text = await chat(prompt, { json: true, temperature: 0.9 });
	const parsed = JSON.parse(text) as { vibes?: Partial<Vibe>[] };
	const cleaned = (parsed.vibes ?? [])
		.filter(
			(v): v is Vibe =>
				typeof v.label === 'string' &&
				typeof v.query === 'string' &&
				typeof v.emoji === 'string' &&
				v.label.length > 0 &&
				v.query.length > 0,
		)
		.slice(0, CHIP_COUNT);

	if (cleaned.length < 6) {
		// Model returned junk — fall back to defaults rather than serving partial garbage.
		return {
			vibes: STATIC_DEFAULTS,
			generated_at: new Date().toISOString(),
			source: 'static',
		};
	}

	return {
		vibes: cleaned,
		generated_at: new Date().toISOString(),
		source: 'llm',
	};
}

export function vibesRoutes(raw: postgres.Sql) {
	const app = new Hono();

	app.get('/vibes', async (c) => {
		const cached = await readCache(raw);
		if (cached && !cacheIsStale(cached)) return c.json(cached);

		// Stale or empty — kick off background regen, serve whatever we have.
		void generate(raw)
			.then((next) => writeCache(raw, next))
			.catch((e) => console.error('[vibes] background regen failed:', e));

		if (cached) return c.json({ ...cached, stale: true });

		// First-ever call: synchronously generate (or fall back to static).
		try {
			const next = await generate(raw);
			await writeCache(raw, next);
			return c.json(next);
		} catch (e) {
			console.error('[vibes] initial generate failed:', e);
			return c.json({
				vibes: STATIC_DEFAULTS,
				generated_at: new Date().toISOString(),
				source: 'static',
			});
		}
	});

	app.post('/vibes/regenerate', async (c) => {
		try {
			const next = await generate(raw);
			await writeCache(raw, next);
			return c.json(next);
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'unknown';
			return c.json({ error: msg }, 502);
		}
	});

	return app;
}
