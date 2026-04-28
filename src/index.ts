import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { raw } from './db';
import { isOllamaEnabled } from './lib/ollama';
import { isYouTubeEnabled } from './lib/youtube';
import { activityRoutes } from './routes/activity';
import { curateRoutes } from './routes/curate';
import { enrichRoutes } from './routes/enrich';
import { libraryRoutes } from './routes/library';
import { listsRoutes } from './routes/lists';
import { mcpRoutes } from './routes/mcp';
import { refreshRoutes } from './routes/refresh';
import { similarRoutes } from './routes/similar';
import { statsRoutes } from './routes/stats';
import { syncRoutes } from './routes/sync';

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
app.route('/', activityRoutes(raw));
mcpRoutes(app);

app.get('/', (c) =>
	c.json({
		name: 'Steam Library API',
		ollama: isOllamaEnabled(),
		youtube: isYouTubeEnabled(),
		endpoints: [
			'GET  /library?q=&tag=&genre=&platform=&min_playtime=&max_playtime=&unplayed=1&limit=&offset=',
			'GET  /games/:appid',
			'POST /games/:appid/refresh   (re-fetch every external source)',
			'GET  /similar?appid=  | ?q=  &platform=&max_playtime=&min_positive_pct=&limit=',
			'GET  /curate                 (home dashboard: continue/recs/random/etc.)',
			'GET  /stats',
			'POST /sync',
			'GET  /mcp           (discovery)',
			'POST /mcp           (JSON-RPC 2.0; OAuth lives in expose-tunnels proxy)',
		],
	}),
);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

const port = Number.parseInt(process.env.PORT ?? '3110', 10);

export default {
	fetch: app.fetch,
	port,
	idleTimeout: 120,
};
