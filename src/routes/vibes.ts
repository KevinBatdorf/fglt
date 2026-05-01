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
	{
		label: 'Cozy & contemplative',
		query: 'cozy puzzle game with story',
		emoji: '🍵',
	},
	{
		label: 'Indie horror',
		query: 'indie first person horror atmospheric',
		emoji: '🕯️',
	},
	{ label: 'Cyberpunk', query: 'cyberpunk dystopian neon hacker', emoji: '🌆' },
	{
		label: 'Roguelike runs',
		query: 'roguelike deck builder run-based',
		emoji: '🎲',
	},
	{
		label: 'Soulslike',
		query: 'soulslike fast combat parry difficult',
		emoji: '⚔️',
	},
	{
		label: 'Walking sim',
		query: 'narrative walking simulator atmospheric story',
		emoji: '🚶',
	},
	{
		label: 'Couch co-op',
		query: 'split-screen couch co-op friends',
		emoji: '🛋️',
	},
	{
		label: 'Retro pixel',
		query: 'retro pixel art 16-bit platformer',
		emoji: '👾',
	},
	{
		label: 'Survival craft',
		query: 'open world survival craft base building',
		emoji: '🪓',
	},
	{
		label: 'Sci-fi exploration',
		query: 'atmospheric sci-fi alien exploration',
		emoji: '🛸',
	},
	{ label: 'Stealth', query: 'stealth assassin shadow infiltrate', emoji: '🗡️' },
	{
		label: 'City builder',
		query: 'city builder management simulation',
		emoji: '🏙️',
	},
	{
		label: 'Detective',
		query: 'detective noir mystery investigation dialog',
		emoji: '🔎',
	},
	{
		label: 'Hand-drawn',
		query: 'beautiful hand-drawn art adventure',
		emoji: '🎨',
	},
	{
		label: 'Speedrun fast',
		query: 'fast movement speedrun arcade',
		emoji: '💨',
	},
	{
		label: 'Existential RPG',
		query: 'existential dread story-driven RPG',
		emoji: '🌒',
	},
];

const CACHE_KEY = 'vibes_cache';
const CACHE_TTL_HOURS = 24;
const CHIP_COUNT = 12;

interface CachedVibes {
	vibes: Vibe[];
	generated_at: string;
	source: 'static' | 'llm';
}

interface VibesResponse extends CachedVibes {
	/** True if any AI provider is configured. UI uses this to hide the Refresh button. */
	ai_enabled: boolean;
	/** Set when serving stale cache while a background regen is running. */
	stale?: boolean;
}

async function readCache(raw: postgres.Sql): Promise<CachedVibes | null> {
	const [row] =
		await raw`SELECT value, updated FROM meta WHERE key = ${CACHE_KEY} LIMIT 1`;
	if (!row?.value) return null;
	try {
		return JSON.parse(row.value as string) as CachedVibes;
	} catch {
		return null;
	}
}

async function writeCache(
	raw: postgres.Sql,
	payload: CachedVibes,
): Promise<void> {
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

// Rotating focal lenses so each regen tackles the prompt from a different
// angle. Picked at random per call to keep output varied.
const LENSES = [
	'mood and emotional register (melancholy / euphoric / unsettling / contemplative)',
	'time of day and atmosphere (rainy 3am / bright weekend afternoon / fluorescent night shift)',
	'session shape (5-min commute / one-sitting story / weeks-long obsession / chaotic friday night)',
	'art direction and visual register (hand-painted / brutalist / lo-fi pixel / VHS / oil-on-canvas)',
	'narrative texture (fairytale grim / corporate noir / cosmic absurd / mundane melancholy)',
	'social context (solo cocoon / couch shouting / async with friends / online stranger trust)',
	'physicality of input (twitchy fingertips / lazy mouse / tense parries / lateral thinking)',
	'world type (single intricate room / continent-scale wander / metroidvania spiral / procedural noise)',
	'how the player feels after a session (proud / wrecked / cozy / wired / sad-good)',
	'aesthetic year/decade vibe (90s CRT / Y2K / 2010s Tumblr / late-night cable)',
];

// Sample-shape examples shown to the model. These DO bias output, so we
// rotate the example pool too. None of these may appear verbatim in the
// returned chips (the prompt forbids it).
const EXAMPLE_POOLS: string[][] = [
	['Cozy 3am', 'Brutalist puzzle', 'Sunday hangover', 'Saturated nostalgia'],
	['One-life dread', 'Bookshop reverie', 'Stoner sandbox', 'Quiet competence'],
	['Corporate noir', 'Folk horror', 'Afternoon fugue', 'Soft sadness'],
	['Fluorescent panic', 'Lo-fi grind', 'Polite menace', 'Glitched memory'],
	['Hand-drawn dread', 'Mechanical zen', 'Desert melancholy', 'Bright cruelty'],
];

async function generate(raw: postgres.Sql): Promise<CachedVibes> {
	if (!isOllamaEnabled()) {
		return {
			vibes: STATIC_DEFAULTS,
			generated_at: new Date().toISOString(),
			source: 'static',
		};
	}

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

	const lens = LENSES[Math.floor(Math.random() * LENSES.length)];
	const examples =
		EXAMPLE_POOLS[Math.floor(Math.random() * EXAMPLE_POOLS.length)];
	const stamp = new Date().toISOString();

	const prompt = `You generate "vibe" search chips for a personal game-library app — short evocative phrases that capture FEELING, not genre.

LIBRARY TAGS: ${topTags}
LIBRARY GENRES: ${topGenres}

THIS ROUND'S CREATIVE LENS: ${lens}

Use that lens to invent ${CHIP_COUNT} fresh, specific, surprising vibes. Output JSON:
  {"vibes": [{"label": "...", "query": "...", "emoji": "..."}, ...]}

RULES:
- label: 2-4 words, sentence case. NEVER a genre name. NEVER generic ("Action", "Adventure", "Indie", "RPG").
- query: 4-8 lowercase words, used for hybrid keyword+vector search. Must MATCH the label's meaning — if the label is about art style, the query MUST contain visual-style nouns (e.g. "pixel art", "hand-drawn", "low-poly"); if it's about session shape, the query MUST contain pacing words (e.g. "short run", "one-sitting"); if it's about mood, the query MUST contain mood-adjacent tags ("melancholy", "atmospheric", "tense"). NEVER let the query drift to an unrelated topic just because it's a popular tag in the library.
- query word choice: prefer SPECIFIC tag-like nouns ("metroidvania", "roguelite deckbuilder", "doom-clone") over filler adjectives. AVOID these filler words: hours, endless, deep, rich, immersive, detailed, invested, beautiful, amazing, epic.
- emoji: ONE emoji that fits.
- Be SPECIFIC and weird. "3am dungeon" beats "Dungeon crawling". "Soft sadness" beats "Sad games".
- Each label must be DIFFERENT in tone/topic from the others — mix textures.
- DO NOT use any of these example labels verbatim: ${examples.join(', ')}.

Examples of the SHAPE we want (do NOT copy): ${examples.join(' / ')}.

Return ONLY the JSON object. (regen=${stamp})`;

	const text = await chat(prompt, { json: true, temperature: 1.05 });
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

	const respond = (body: CachedVibes & { stale?: boolean }): VibesResponse => ({
		...body,
		ai_enabled: isOllamaEnabled(),
	});

	app.get('/vibes', async (c) => {
		// No AI provider configured → just serve the static list, never poke
		// any background regen. The UI uses ai_enabled to hide the Refresh
		// button so it can't trigger an empty action.
		if (!isOllamaEnabled()) {
			return c.json(
				respond({
					vibes: STATIC_DEFAULTS,
					generated_at: new Date().toISOString(),
					source: 'static',
				}),
			);
		}

		const cached = await readCache(raw);
		if (cached && !cacheIsStale(cached)) return c.json(respond(cached));

		void generate(raw)
			.then((next) => writeCache(raw, next))
			.catch((e) => console.error('[vibes] background regen failed:', e));

		if (cached) return c.json(respond({ ...cached, stale: true }));

		try {
			const next = await generate(raw);
			await writeCache(raw, next);
			return c.json(respond(next));
		} catch (e) {
			console.error('[vibes] initial generate failed:', e);
			return c.json(
				respond({
					vibes: STATIC_DEFAULTS,
					generated_at: new Date().toISOString(),
					source: 'static',
				}),
			);
		}
	});

	app.post('/vibes/regenerate', async (c) => {
		if (!isOllamaEnabled()) {
			return c.json({ error: 'AI provider not configured' }, 503);
		}
		try {
			const next = await generate(raw);
			await writeCache(raw, next);
			return c.json(respond(next));
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'unknown';
			return c.json({ error: msg }, 502);
		}
	});

	return app;
}
