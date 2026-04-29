import { Hono } from 'hono';
import type postgres from 'postgres';
import { getCurrentPlayers } from '../lib/steam-live';

/**
 * GET /curate — pre-baked dashboard for the home page.
 *
 * One round-trip returns everything the home screen needs:
 *   - continue_playing      games with playtime_2wk > 0, top by 2wk playtime
 *   - because_recently      similar to your most-played game in the last 2wks
 *   - because_obsession     similar to your single most-played game ever
 *   - game_of_the_day       deterministic-by-date pick from a quality unplayed pool
 *   - picks_tonight         small random sample of unplayed games
 *   - quick_wins            unplayed + HLTB main <= 5h
 *   - hidden_gems           >=90% positive but <5k reviews, unplayed
 *   - trending              owned games with the highest peak CCU (cultural buzz)
 *   - by_vibe               static list of curated vibe-search prompts the UI
 *                           can render as clickable chips
 *
 * Uses pgvector for the "because" sections — pulls the seed game's embedding
 * and orders other owned games by cosine distance. Falls back gracefully if
 * the seed has no embedding.
 */
export function curateRoutes(raw: postgres.Sql) {
	const app = new Hono();

	app.get('/curate', async (c) => {
		const limit = Math.min(
			Math.max(Number.parseInt(c.req.query('limit') ?? '8', 10) || 8, 4),
			20,
		);

		const cardCols = `
			appid, name, type, short_desc, header_image, release_date,
			genres, categories, playtime_min, playtime_2wk, last_played,
			positive, negative, owners_estimate,
			hltb_main, hltb_extra, metacritic
		`;
		// Steam treats benchmark/creator-tool apps as "games" with genres like
		// Utilities. Exclude them everywhere we surface "what to play".
		const NON_GAME_GENRES = [
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
		const isGame = raw`(g.genres IS NULL OR NOT (g.genres && ${NON_GAME_GENRES}::text[]))`;
		const platformsJoin = `
			LEFT JOIN (
				SELECT appid, array_agg(platform ORDER BY platform) AS platforms
				FROM platform_ownership GROUP BY appid
			) po ON po.appid = g.appid
		`;
		const cardSelect = (ns = 'g') =>
			raw`${raw.unsafe(cardCols.replace(/(\w+)/g, `${ns}.$1`))}, COALESCE(po.platforms, ARRAY[]::text[]) AS platforms`;

		// Continue playing — only real games
		const continuePlaying = await raw`
			SELECT ${cardSelect()}
			FROM games g ${raw.unsafe(platformsJoin)}
			WHERE g.playtime_2wk > 0 AND ${isGame}
			ORDER BY g.playtime_2wk DESC, g.last_played DESC NULLS LAST
			LIMIT ${limit}
		`;

		// Find the seeds for the "because you" sections — exclude utilities so
		// we don't anchor recommendations on benchmarks.
		const recentSeed = continuePlaying[0] ?? null;

		const [obsessionSeed] = await raw`
			SELECT g.appid, g.name, g.header_image, g.embedding
			FROM games g
			WHERE g.playtime_min > 0 AND ${isGame}
			ORDER BY g.playtime_min DESC NULLS LAST
			LIMIT 1
		`;

		async function similarByAppid(appid: number) {
			const [seed] = await raw`
				SELECT appid, embedding FROM games WHERE appid = ${appid} LIMIT 1
			`;
			if (!seed?.embedding) return [];
			const vec = String(seed.embedding);
			return await raw`
				SELECT ${cardSelect()}, 1 - (g.embedding <=> ${vec}::vector) AS similarity
				FROM games g ${raw.unsafe(platformsJoin)}
				WHERE g.embedding IS NOT NULL AND g.appid <> ${appid} AND ${isGame}
				ORDER BY g.embedding <=> ${vec}::vector ASC
				LIMIT ${limit}
			`;
		}

		const becauseRecently = recentSeed
			? {
					seed: pickSeedFields(recentSeed as Record<string, unknown>),
					recs: await similarByAppid(recentSeed.appid as number),
				}
			: null;

		const becauseObsession = obsessionSeed
			? {
					seed: pickSeedFields(obsessionSeed as Record<string, unknown>),
					recs: await similarByAppid(obsessionSeed.appid as number),
				}
			: null;

		// Game of the day — deterministic by UTC date over a quality pool
		// (unplayed, decent positive ratio, finishable in a sitting).
		const dayKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
		const seedNum = Number.parseInt(dayKey, 10);
		const goodPool = await raw`
			SELECT ${cardSelect()}
			FROM games g ${raw.unsafe(platformsJoin)}
			WHERE g.playtime_min = 0
				AND g.short_desc IS NOT NULL
				AND g.positive IS NOT NULL
				AND g.positive + COALESCE(g.negative, 0) >= 200
				AND (g.positive::float / NULLIF(g.positive + COALESCE(g.negative, 0), 0)) >= 0.80
				AND ${isGame}
			ORDER BY g.appid ASC
		`;
		const gameOfTheDay =
			goodPool.length > 0 ? goodPool[seedNum % goodPool.length] : null;

		// Picks tonight — small random sample of unplayed
		const picksTonight = await raw`
			SELECT ${cardSelect()}
			FROM games g ${raw.unsafe(platformsJoin)}
			WHERE g.playtime_min = 0 AND g.header_image IS NOT NULL AND ${isGame}
			ORDER BY random()
			LIMIT 6
		`;

		// Quick wins
		const quickWins = await raw`
			SELECT ${cardSelect()}
			FROM games g ${raw.unsafe(platformsJoin)}
			WHERE g.playtime_min = 0
				AND g.hltb_main IS NOT NULL
				AND g.hltb_main <= 5
				AND g.hltb_main > 0
				AND ${isGame}
			ORDER BY g.hltb_main ASC, g.positive DESC NULLS LAST
			LIMIT ${limit}
		`;

		// Hidden gems — niche but loved
		const hiddenGems = await raw`
			SELECT ${cardSelect()}
			FROM games g ${raw.unsafe(platformsJoin)}
			WHERE g.playtime_min = 0
				AND g.positive IS NOT NULL
				AND (g.positive + COALESCE(g.negative, 0)) BETWEEN 50 AND 5000
				AND (g.positive::float / NULLIF(g.positive + COALESCE(g.negative, 0), 0)) >= 0.90
				AND ${isGame}
			ORDER BY (g.positive::float / NULLIF(g.positive + COALESCE(g.negative, 0), 0)) DESC,
			         g.positive DESC
			LIMIT ${limit}
		`;

		// Trending — top by stored CCU as a candidate pool, then re-rank by
		// LIVE current-player count from Steam's ISteamUserStats endpoint.
		// The stored ccu is just used to pre-filter (so we don't fetch live
		// counts for every game in the library).
		// Trending — pull a generous candidate pool by stored CCU, fetch live
		// player counts for all, return them all sorted by live. The UI can
		// crop for preview rows but the full list is available on the dedicated
		// trending page.
		const trendingCandidates = await raw`
			SELECT ${cardSelect()}
			FROM games g ${raw.unsafe(platformsJoin)}
			WHERE g.ccu IS NOT NULL AND g.ccu > 0 AND ${isGame}
			ORDER BY g.ccu DESC
			LIMIT 120
		`;
		const liveCounts = await getCurrentPlayers(
			trendingCandidates.map((g) => g.appid as number),
		).catch(() => new Map<number, number>());
		const trending = trendingCandidates
			.map((g) => ({
				...g,
				live_players: liveCounts.get(g.appid as number) ?? null,
			}))
			.sort((a, b) => {
				const la = (a.live_players as number | null) ?? -1;
				const lb = (b.live_players as number | null) ?? -1;
				if (la !== lb) return lb - la;
				return (b.ccu as number) - (a.ccu as number);
			});

		const byVibe: { label: string; query: string; emoji: string }[] = [
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
			{
				label: 'Cyberpunk',
				query: 'cyberpunk dystopian neon hacker',
				emoji: '🌆',
			},
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
			{
				label: 'Stealth',
				query: 'stealth assassin shadow infiltrate',
				emoji: '🗡️',
			},
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

		return c.json({
			continue_playing: continuePlaying,
			because_recently: becauseRecently,
			because_obsession: becauseObsession,
			game_of_the_day: gameOfTheDay,
			picks_tonight: picksTonight,
			quick_wins: quickWins,
			hidden_gems: hiddenGems,
			trending,
			by_vibe: byVibe,
		});
	});

	return app;
}

function pickSeedFields(row: Record<string, unknown>) {
	return {
		appid: row.appid as number,
		name: row.name as string,
		header_image: (row.header_image as string | null) ?? null,
		playtime_min: (row.playtime_min as number | null) ?? 0,
		playtime_2wk: (row.playtime_2wk as number | null) ?? 0,
	};
}
