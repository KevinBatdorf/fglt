import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { raw } from './db';
import { getConfig } from './lib/config';
import { loadTokens as loadGogTokens } from './lib/gog';
import { isOllamaEnabled } from './lib/ollama';
import { isYouTubeEnabled } from './lib/youtube';
import { activityRoutes } from './routes/activity';
import { curateRoutes } from './routes/curate';
import { enrichRoutes } from './routes/enrich';
import { libraryRoutes } from './routes/library';
import { listsRoutes } from './routes/lists';
import { mcpRoutes } from './routes/mcp';
import { refreshRoutes } from './routes/refresh';
import { savedSearchesRoutes } from './routes/saved-searches';
import { settingsRoutes } from './routes/settings';
import { similarRoutes } from './routes/similar';
import { statsRoutes } from './routes/stats';
import { syncRoutes } from './routes/sync';
import { tagsRoutes } from './routes/tags';
import { vibesRoutes } from './routes/vibes';

const app = new Hono();

// Permissive CORS for the Electrobun desktop app + local browser tools.
// All routes are read-mostly and on localhost; the public-facing edge is the
// OAuth proxy in expose-tunnels/, which has its own auth.
app.use(
	'*',
	cors({
		origin: (origin) => origin ?? '*',
		allowMethods: ['GET', 'POST', 'OPTIONS'],
		allowHeaders: ['Content-Type', 'Authorization'],
		credentials: false,
	}),
);

app.route('/', libraryRoutes(raw));
app.route('/', similarRoutes(raw));
app.route('/', statsRoutes(raw));
app.route('/', syncRoutes(raw));
app.route('/', enrichRoutes(raw));
app.route('/', refreshRoutes(raw));
app.route('/', curateRoutes(raw));
app.route('/', listsRoutes(raw));
app.route('/', savedSearchesRoutes(raw));
app.route('/', activityRoutes(raw));
app.route('/', tagsRoutes(raw));
app.route('/', vibesRoutes(raw));
app.route('/', settingsRoutes(raw));
mcpRoutes(app);

app.get('/', async (c) =>
	c.json({
		name: 'Steam Library API',
		ollama: await isOllamaEnabled(),
		youtube: await isYouTubeEnabled(),
		endpoints: [
			'GET  /library?q=&tag=&genre=&platform=&min_playtime=&max_playtime=&unplayed=1&limit=&offset=',
			'GET  /games/:appid',
			'POST /games/:appid/refresh   (re-fetch every external source)',
			'GET  /similar?appid=  | ?q=  &platform=&max_playtime=&min_positive_pct=&limit=',
			'GET  /curate                 (home dashboard: continue/recs/random/etc.)',
			'GET  /stats',
			'GET  /health                 (readiness + setup-status for the desktop app)',
			'POST /sync',
			'GET  /mcp           (discovery)',
			'POST /mcp           (JSON-RPC 2.0; OAuth lives in expose-tunnels proxy)',
		],
	}),
);

/**
 * Lightweight readiness + setup-status probe. Always returns 200 — the
 * body reflects what's healthy and what needs the user's attention. The
 * desktop app polls this and surfaces problems via a top-of-window banner
 * + a "System status" section in Settings.
 */
app.get('/health', async (c) => {
	let dbOk = false;
	let totalGames = 0;
	let lastSync: string | null = null;
	try {
		const [row] = await raw`SELECT 1 AS ok`;
		dbOk = row?.ok === 1;
		if (dbOk) {
			const [gc] = await raw`SELECT COUNT(*)::int AS n FROM games`;
			totalGames = (gc?.n as number) ?? 0;
			const [sync] =
				await raw`SELECT value FROM meta WHERE key = 'last_sync' LIMIT 1`;
			lastSync = (sync?.value as string | undefined) ?? null;
		}
	} catch {
		dbOk = false;
	}

	const cfg = await getConfig();
	const required: string[] = [];
	if (!cfg.STEAM_API_KEY) required.push('STEAM_API_KEY');
	if (!cfg.STEAM_ID) required.push('STEAM_ID');

	return c.json({
		db: dbOk ? 'ok' : 'down',
		ai: (await isOllamaEnabled()) ? 'ok' : 'disabled',
		steam_key: cfg.STEAM_API_KEY ? 'present' : 'missing',
		steam_id: cfg.STEAM_ID ? 'present' : 'missing',
		// Optional enrichment integrations — surfaced in Settings → System
		// status so the user can see at a glance which data sources will
		// fire when the cron jobs next run. 'missing' here just means the
		// matching panel/badge stays empty; the library still works.
		youtube_key: cfg.YOUTUBE_API_KEY ? 'present' : 'missing',
		opencritic_key: cfg.OPENCRITIC_API_KEY ? 'present' : 'missing',
		// GOG ownership — checks whether the OAuth tokens file exists.
		// Epic has no equivalent server-side state (it's a manual CLI
		// flow), so it's not surfaced here.
		gog: (await loadGogTokens().catch(() => null)) ? 'connected' : 'disconnected',
		total_games: totalGames,
		last_sync: lastSync,
		// Next scheduled Steam sync — based on the SYNC_CRON env (default
		// `0 6 * * *`, daily at 06:00 UTC). Computed here so the UI can
		// say "Last sync … · Next sync in 8h" without parsing crons
		// client-side.
		next_sync: nextSyncIso(process.env.SYNC_CRON ?? '0 6 * * *'),
		required_missing: required,
	});
});

/**
 * Compute the next fire time for a 5-field cron expression. Supports
 * the subset we actually use in the consumer compose: `m h * * *`
 * (specific minute + hour, daily). Other expressions degrade to
 * "tomorrow at the same wall-clock time as the cron's hour" — close
 * enough for the UI's "Next sync …" hint.
 */
function nextSyncIso(cron: string): string | null {
	try {
		const parts = cron.trim().split(/\s+/);
		if (parts.length < 2) return null;
		const minute = Number.parseInt(parts[0], 10);
		const hour = Number.parseInt(parts[1], 10);
		if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;
		const now = new Date();
		const next = new Date(
			Date.UTC(
				now.getUTCFullYear(),
				now.getUTCMonth(),
				now.getUTCDate(),
				hour,
				minute,
				0,
				0,
			),
		);
		if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
		return next.toISOString();
	} catch {
		return null;
	}
}

app.notFound((c) => c.json({ error: 'Not found' }, 404));

const port = Number.parseInt(process.env.PORT ?? '3110', 10);

export default {
	fetch: app.fetch,
	port,
	idleTimeout: 120,
};
