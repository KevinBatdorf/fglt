import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Hono } from 'hono';
import { z } from 'zod';

/**
 * MCP server proxying our own Hono routes via app.request().
 * Open endpoint, like anna. Public-facing OAuth lives in
 * expose-tunnels/steam-mcp-proxy.js.
 */
function registerTools(server: McpServer, app: Hono) {
	server.registerTool(
		'search_library',
		{
			title: 'Search Library',
			description:
				'Search your owned games using hybrid keyword + semantic vector search. Supports natural-language queries like "cozy puzzle game with story" as well as keyword searches like "hades". Filterable by tag, genre, playtime, and storefront (steam/epic/gog). Each result has a `platforms` array showing where you own it.',
			inputSchema: {
				query: z
					.string()
					.optional()
					.describe('Free-text query — keyword or natural language'),
				tag: z
					.string()
					.optional()
					.describe('Filter by SteamSpy user tag (partial match)'),
				genre: z.string().optional().describe('Filter by Steam genre (exact)'),
				min_playtime: z
					.number()
					.int()
					.optional()
					.describe('Minimum playtime in minutes'),
				max_playtime: z
					.number()
					.int()
					.optional()
					.describe('Maximum playtime in minutes'),
				platform: z
					.enum(['steam', 'epic', 'gog'])
					.optional()
					.describe('Restrict to games owned on a specific storefront'),
				unplayed: z
					.boolean()
					.optional()
					.describe('Only return games never played (playtime = 0)'),
				limit: z.number().int().min(1).max(200).default(25),
				offset: z.number().int().min(0).default(0),
			},
		},
		async (args) => {
			const params = new URLSearchParams();
			if (args.query) params.set('q', args.query);
			if (args.tag) params.set('tag', args.tag);
			if (args.genre) params.set('genre', args.genre);
			if (args.min_playtime !== undefined)
				params.set('min_playtime', String(args.min_playtime));
			if (args.max_playtime !== undefined)
				params.set('max_playtime', String(args.max_playtime));
			if (args.platform) params.set('platform', args.platform);
			if (args.unplayed) params.set('unplayed', '1');
			params.set('limit', String(args.limit ?? 25));
			params.set('offset', String(args.offset ?? 0));
			const res = await app.request(`/library?${params}`);
			const data = await res.json();
			return {
				content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
			};
		},
	);

	server.registerTool(
		'find_similar',
		{
			title: 'Find Similar Games',
			description:
				'Recommend games similar to a given appid (most accurate) or matching a free-text query, using vector embeddings of names + tags + descriptions. Optional storefront filter and review-quality threshold.',
			inputSchema: {
				appid: z
					.number()
					.int()
					.optional()
					.describe('Steam appid of the seed game (preferred)'),
				query: z
					.string()
					.optional()
					.describe('Or a natural-language query if no appid'),
				platform: z
					.enum(['steam', 'epic', 'gog'])
					.optional()
					.describe('Restrict to games owned on a specific storefront'),
				max_playtime: z
					.number()
					.int()
					.optional()
					.describe('Cap result playtime in minutes (e.g. 600 for "shorter")'),
				min_positive_pct: z
					.number()
					.optional()
					.describe('Minimum review positivity percentage (0-100)'),
				limit: z.number().int().min(1).max(100).default(20),
			},
		},
		async (args) => {
			if (!args.appid && !args.query) {
				return {
					content: [
						{
							type: 'text',
							text: JSON.stringify({ error: 'pass appid or query' }),
						},
					],
					isError: true,
				};
			}
			const params = new URLSearchParams();
			if (args.appid) params.set('appid', String(args.appid));
			if (args.query) params.set('q', args.query);
			if (args.platform) params.set('platform', args.platform);
			if (args.max_playtime !== undefined)
				params.set('max_playtime', String(args.max_playtime));
			if (args.min_positive_pct !== undefined)
				params.set('min_positive_pct', String(args.min_positive_pct));
			params.set('limit', String(args.limit ?? 20));
			const res = await app.request(`/similar?${params}`);
			const data = await res.json();
			return {
				content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
				...(res.ok ? {} : { isError: true }),
			};
		},
	);

	server.registerTool(
		'get_game',
		{
			title: 'Get Game Details',
			description:
				'Get the full record for a single game by appid: descriptions, genres, SteamSpy tags with vote counts, HLTB completion times, "more like this" graph, and playtime.',
			inputSchema: { appid: z.number().int() },
		},
		async ({ appid }) => {
			const res = await app.request(`/games/${appid}`);
			const data = await res.json();
			return {
				content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
				...(res.ok ? {} : { isError: true }),
			};
		},
	);

	server.registerTool(
		'recently_played',
		{
			title: 'Recently Played',
			description: 'List games played in the last two weeks, by playtime.',
			inputSchema: {
				limit: z.number().int().min(1).max(100).default(20),
			},
		},
		async ({ limit }) => {
			const params = new URLSearchParams({
				limit: String(limit ?? 20),
				min_playtime: '1',
				sort: 'name',
			});
			const res = await app.request(`/library?${params}`);
			const data = await res.json();
			// Re-sort by 2-week playtime desc client-side
			const sorted = Array.isArray(data?.results)
				? [...data.results].sort(
						(a, b) => (b.playtime_2wk ?? 0) - (a.playtime_2wk ?? 0),
					)
				: [];
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ ...data, results: sorted }, null, 2),
					},
				],
			};
		},
	);

	server.registerTool(
		'unplayed_pile',
		{
			title: 'Unplayed Backlog',
			description:
				'List owned games you have never played (playtime = 0). Optional cap on HLTB main-story length to find quick ones.',
			inputSchema: {
				max_main_hours: z
					.number()
					.optional()
					.describe('Cap on HLTB main-story hours (e.g. 10 for short games)'),
				limit: z.number().int().min(1).max(200).default(50),
			},
		},
		async ({ max_main_hours, limit }) => {
			const params = new URLSearchParams({
				unplayed: '1',
				limit: String(limit ?? 50),
			});
			const res = await app.request(`/library?${params}`);
			const data = await res.json();
			let results = Array.isArray(data?.results) ? data.results : [];
			if (max_main_hours !== undefined) {
				results = results.filter(
					(g: { hltb_main?: number }) =>
						typeof g.hltb_main === 'number' && g.hltb_main <= max_main_hours,
				);
			}
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ count: results.length, results }, null, 2),
					},
				],
			};
		},
	);

	server.registerTool(
		'get_stats',
		{
			title: 'Get Library Stats',
			description:
				'Get database stats: total games, per-platform breakdown, multi-platform count, enriched/embedded counts, played/unplayed, total playtime, last sync.',
			inputSchema: {},
		},
		async () => {
			const res = await app.request('/stats');
			const data = await res.json();
			return {
				content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
			};
		},
	);

	server.registerTool(
		'sync_owned',
		{
			title: 'Sync Owned Games',
			description:
				'Re-fetch the owned-games list from the Steam Web API. Use after buying/refunding games.',
			inputSchema: {},
		},
		async () => {
			const res = await app.request('/sync', { method: 'POST' });
			const data = await res.json();
			return {
				content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
				...(res.ok ? {} : { isError: true }),
			};
		},
	);
}

async function createMcpPair(app: Hono) {
	const server = new McpServer(
		{ name: 'steam-library', version: '0.1.0' },
		{ capabilities: { logging: {} } },
	);
	registerTools(server, app);

	const client = new Client({ name: 'steam-proxy', version: '0.1.0' });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	await server.connect(serverTransport);
	await client.connect(clientTransport);

	return {
		server,
		client,
		close: () => {
			server.close();
			client.close();
		},
	};
}

export function mcpRoutes(app: Hono) {
	app.post('/mcp', async (c) => {
		const body = await c.req.json();
		const { method, params, id } = body ?? {};

		if (!method || id === undefined || id === null) {
			return c.json(
				{
					jsonrpc: '2.0',
					error: { code: -32600, message: 'Invalid request' },
					id: id ?? null,
				},
				400,
			);
		}

		const pair = await createMcpPair(app);
		try {
			if (method === 'initialize') {
				const result = await pair.client.getServerVersion();
				return c.json({ jsonrpc: '2.0', result, id });
			}
			if (method === 'tools/list') {
				const result = await pair.client.listTools();
				return c.json({ jsonrpc: '2.0', result, id });
			}
			if (method === 'tools/call') {
				const result = await pair.client.callTool({
					name: params?.name,
					arguments: params?.arguments ?? {},
				});
				return c.json({ jsonrpc: '2.0', result, id });
			}
			return c.json(
				{
					jsonrpc: '2.0',
					error: { code: -32601, message: `Method not found: ${method}` },
					id,
				},
				400,
			);
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Unknown error';
			return c.json(
				{ jsonrpc: '2.0', error: { code: -32603, message: msg }, id },
				500,
			);
		} finally {
			pair.close();
		}
	});

	// Public discovery (no key required)
	app.get('/mcp', (c) =>
		c.json({
			name: 'steam-library',
			version: '0.1.0',
			description: 'MCP server for your Steam library — search, recs, stats',
			tools: [
				'search_library',
				'find_similar',
				'get_game',
				'recently_played',
				'unplayed_pile',
				'get_stats',
				'sync_owned',
			],
			usage: 'POST JSON-RPC 2.0 to this endpoint with a Bearer token',
		}),
	);
}
