# Steam Library API

A self-hosted Postgres + pgvector database of your owned game library across
**Steam, Epic, and GOG**, enriched with Steam Store metadata, SteamSpy tags +
estimated owners, HowLongToBeat completion times, Steam's own "more like
this" graph, and per-game YouTube videos (walkthroughs / let's-plays /
trailers). Hybrid keyword + semantic vector search via Ollama embeddings.
Bun + Hono API + an MCP server (open locally; OAuth at the proxy layer).

Steam appid is the canonical key — Epic / GOG titles match into Steam via
storesearch, so a single appid can be owned across multiple storefronts.

Modeled after the `anna` project layout (drizzle, postgres-js, in-process MCP
client/server pair).

## Stack

- **Runtime:** Bun
- **API:** Hono
- **DB:** Postgres 17 + pgvector + pg_trgm (Drizzle for the schema)
- **AI provider:** Vercel AI SDK + `@ai-sdk/openai-compatible` — works
  with Ollama (default), OpenAI, Groq, Together, or any OpenAI-compatible
  endpoint. Configured via `AI_BASE_URL` / `AI_API_KEY` / `AI_CHAT_MODEL` /
  `AI_EMBED_MODEL` (falls back to `OLLAMA_URL` for backward compat).
- **Embeddings:** default `nomic-embed-text` (768 dims) via Ollama, but
  swap to `text-embedding-3-small` or any other model by changing
  `AI_EMBED_MODEL`. Schema's `vector(768)` column has to match the
  model's output dimension.
- **External data:** YouTube Data API v3 for per-game videos. OpenCritic /
  IGDB / PCGamingWiki / ProtonDB are planned and slot into the same
  `/games/:appid/refresh` endpoint.
- **MCP:** `@modelcontextprotocol/sdk`, in-process pair, exposed at `POST /mcp`
  (open locally; OAuth at the `expose-tunnels` reverse proxy)
- **HTTP examples:** Yaak workspace under `yaak/`

## Containers (docker-compose)

| service           | role                                              | cron default        |
| ----------------- | ------------------------------------------------- | ------------------- |
| `postgres`        | pgvector DB, port `${POSTGRES_PORT:-5532}`        | —                   |
| `api`             | Hono server, port `${PORT:-3110}`                 | —                   |
| `syncer`          | refreshes owned-games list                        | `0 6 * * *` (06:00) |
| `enricher`        | enriches + embeds new games                       | `*/15 * * * *`      |
| `youtube-syncer`  | discovers YouTube videos per game (newest first)  | `30 6 * * *` (06:30)|

Non-Steam ownership syncs (Epic, GOG) run on the host via `bun run sync:<platform>`
— they are not containerized because they need browser-flow auth that
doesn't fit the cron model. See "Multi-platform ownership" below.

## First-time setup

1. Copy env file and fill it in:
   ```bash
   cp .env.example .env
   ```
   You need:
   - `STEAM_API_KEY` — get one at <https://steamcommunity.com/dev/apikey>
   - `STEAM_ID` — your 64-bit SteamID (paste your profile URL into <https://steamid.io/>)

   Local `/mcp` is open — public auth lives in the `expose-tunnels` proxy
   (see "Connecting from Claude" below).
2. Configure your AI provider (defaults to Ollama). For Ollama, pull the
   models you want:
   ```bash
   ollama pull nomic-embed-text   # embeddings
   ollama pull qwen3:14b          # vibe-chip generation (any chat model works)
   ```
   For a different provider, set in `.env`:
   ```
   AI_BASE_URL=https://api.openai.com/v1
   AI_API_KEY=sk-...
   AI_CHAT_MODEL=gpt-4o-mini
   AI_EMBED_MODEL=text-embedding-3-small
   ```
3. Bring everything up:
   ```bash
   docker compose up -d --build
   ```
4. Trigger an initial sync (or just wait for the syncer cron):
   ```bash
   curl -X POST http://localhost:3110/sync
   ```
5. The enricher will start working through the library in batches every 15
   minutes (default). For 3k games at ~1.5s/game it'll take a few hours total.

## Multi-platform ownership (Epic, GOG)

Steam appid is the canonical key. Non-Steam titles are matched to a Steam
appid via `store.steampowered.com/api/storesearch` and recorded in
`platform_ownership(appid, platform, external_id, ...)`. A single appid can
have multiple ownership rows — that's the "I own this on Steam AND Epic" case
this whole feature exists for.

**Games that don't exist on Steam are ignored.** Steam is the source of
truth. Misses are logged in `unmatched_ownership` for diagnostics only — they
do not appear in search results or stats.

### Epic setup (once per machine)

```bash
pip install --user legendary-gl
legendary auth          # browser SSO; pastes back an auth code
bun run sync:epic       # pulls library, matches titles, upserts
```

`scripts/sync-epic.ts` resolves the `legendary` binary in this order:
`$LEGENDARY_BIN`, then `legendary` on PATH, then common pip `--user` install
paths. Set `LEGENDARY_BIN` if your install lives elsewhere.

The matcher (`src/lib/match-steam-appid.ts`) uses a 0.85 confidence threshold;
below that, titles drop into `unmatched_ownership` instead of being guessed.

### GOG setup (once per machine)

```bash
bun run auth:gog                    # prints the GOG OAuth URL
# open the URL in a browser, sign in, look at the redirected URL bar,
# copy the `code` query param, then:
bun run auth:gog <code>             # exchanges the code, persists tokens
bun run sync:gog                    # pulls library, matches titles, upserts
```

Tokens land at `data/gog-tokens.json` (gitignored) and refresh automatically
on each sync — no re-auth needed unless GOG invalidates them.

### itch

itch.io is **deliberately skipped** — most itch titles don't exist on Steam,
so the canonical-appid model breaks down for it.

## External data: videos and future sources

Per-game external data is fetched by source-specific cron containers and
stored in side tables. Currently:

- **YouTube** (`game_videos` table) — top 10 walkthrough/let's-play/review
  videos per game. Free quota = 10,000 units/day, 100 units per search → ~100
  games/day, so a full 2,300-game seed takes ~24 days at the floor.

### YouTube setup

```bash
# 1. Create an API key
#    console.cloud.google.com → New project → Enable "YouTube Data API v3"
#    → Credentials → Create API key
# 2. Drop it in .env
echo 'YOUTUBE_API_KEY=AIza...' >> .env
docker compose up -d --build youtube-syncer
```

The container runs once on startup (handy after rebuilds) and then daily at
06:30 UTC, just after Google's 00:00 PT quota reset. The cron stops cleanly
on a 403 quotaExceeded.

### Manual refresh

`POST /games/:appid/refresh` re-fetches every external source for one game
and returns a per-source result map. No internal rate-gate — upstream rate
limits surface in the response. Intended for a future UI's "refresh" button.

```json
{
  "appid": 1145360,
  "name": "Hades",
  "sources": {
    "youtube": { "status": "ok", "detail": { "videos": 10 } }
  }
}
```

When adding a new external source: drop a `<source>_fetched_at` column on
`games`, add a side table if structured, plug a fetcher into the `/refresh`
handler in `src/routes/refresh.ts`, and add a sync container to
docker-compose with the same supercronic-with-startup-run pattern.

## Endpoints

| route                              | description                                                   |
| ---------------------------------- | ------------------------------------------------------------- |
| `GET  /library`                    | List/search the library. `q` triggers hybrid search.          |
| `GET  /games/:appid`               | Full record + tags + similar graph + `ownership` + `videos`   |
| `POST /games/:appid/refresh`       | Re-fetch every external source for one game; per-source results |
| `GET  /similar?appid=`             | Vector recs from a seed game                                  |
| `GET  /similar?q=`                 | Vector recs from natural-language query                       |
| `GET  /stats`                      | Counts incl. per-platform breakdown + multi-platform overlap  |
| `POST /sync`                       | Re-fetch owned games from Steam Web API                       |
| `GET  /mcp` / `POST /mcp`          | MCP discovery + JSON-RPC 2.0 (open locally; OAuth at proxy)   |

Enrichment, embedding, and external-data discovery endpoints exist for the
cron containers but are not exposed via MCP or the Yaak workspace — they run
automatically.

### Library query parameters

```
?q=<text>                 hybrid keyword + vector
?tag=<partial>            SteamSpy user tag (e.g. "Roguelike")
?genre=<exact>            Steam genre
?platform=<store>         steam | epic | gog
?min_playtime=<minutes>
?max_playtime=<minutes>
?unplayed=1               only games with playtime = 0
?limit=&offset=
?sort=name|relevance
```

Each result row includes a `platforms` array showing every storefront that
owns this appid.

## MCP tools

- `search_library` — hybrid search (with `platform` filter)
- `find_similar` — recs by appid or query (with `platform` filter)
- `get_game` — full record + per-platform `ownership`
- `recently_played`
- `unplayed_pile` — backlog, optional `max_main_hours` cap (HLTB)
- `get_stats` — includes per-platform breakdown
- `sync_owned`

Auth: the **local** `/mcp` endpoint is open (matches anna). Public exposure
happens via the OAuth-flowed reverse proxy in `D:\code\expose-tunnels\` — see
"Connecting from Claude" below.

## Connecting from Claude

Mirrors the anna setup. The proxy lives at
[`D:\code\expose-tunnels\steam-mcp-proxy.js`](../expose-tunnels/steam-mcp-proxy.js)
and is exposed at `https://steam.share.cool.omg.lol` via the
`expose-steam` service in `expose-tunnels/docker-compose.yml`.

1. Bring up the steam stack: `docker compose up -d --build` (in this dir).
2. Bring up the tunnel: `docker compose up -d expose-steam` (in
   `D:\code\expose-tunnels\`). It auto-rebuilds and shares
   `https://steam.share.cool.omg.lol`.
3. **Register an OAuth client** (only needed once — and you can reuse the
   same `clients.json` entry that anna uses):
   ```bash
   cd D:\code\expose-tunnels
   node create-client.js
   ```
4. In Claude (Settings → Connectors → Add custom MCP), paste:
   - URL: `https://steam.share.cool.omg.lol/mcp`
   - It auto-discovers OAuth from `/.well-known/oauth-authorization-server`,
     redirects you to authorize, exchanges the code, and stashes a bearer
     token. From then on Claude can call your tools.

The proxy persists tokens to
[`steam-tokens.json`](../expose-tunnels/steam-tokens.json) so they survive
container restarts. Clients are loaded from the shared
[`clients.json`](../expose-tunnels/clients.json) (same file anna's proxy
reads), so registering a client once works for both connectors.

## Yaak

Open the `yaak/` folder in [Yaak](https://yaak.app). The `Local` environment
defines `baseUrl=http://localhost:3110`. Folders:

- **Discover** — vibe/keyword searches (horror, cozy, cyberpunk), tag filter, untouched indies
- **What to play** — full backlog, recently active, started-but-not-finished, deeply-played
- **Cross-platform** — `?platform=epic`, `?platform=gog`, multi-store stats
- **Game detail** — Hades full record, Wolfenstein TNO (the only tri-store game), refresh example
- **Recommendations** — like Hades, like Disco Elysium, vibe queries, short+polished+rated
- **MCP** — discovery, tools/list, and 5 tool-call examples

## Schema highlights

`games` has the full appdetails payload (descriptions, genres, categories,
platforms, metacritic, controller support, price), the SteamSpy enrichment
(owner-estimate range, positive/negative reviews, avg/median playtime, peak
CCU), HLTB hours (main / +extras / completionist), a 768-dim `embedding`, and
a generated `search` tsvector weighting name > genres > short description >
about.

`game_tags` is the SteamSpy tag-vote table (the highest-signal field for
"vibe" queries — feeds into the embedding doc).

`game_similar` is the appid-to-appid "more like this" graph scraped from each
store page; used for the `get_game` response and as a future re-ranker.

`platform_ownership` records per-storefront ownership keyed on
`(appid, platform)` — `steam`, `epic`, or `gog` — with each platform's
external id, acquired_at, and per-store playtime. The `is_owned` flag has
been replaced by the existence of any row in this table.

`unmatched_ownership` is the diagnostic landing zone for non-Steam titles
that didn't resolve to a Steam appid (Epic exclusives, GOG retro games, etc.).
Not used by any user-facing route.

`game_videos` is the per-game YouTube video set discovered by `youtube-syncer`,
plus an updated `games.youtube_fetched_at` sentinel for the cron's "what's
next?" query.

## Notes / gotchas

- Steam's `appdetails` endpoint rate-limits at ~200 requests / 5 minutes, so
  the enricher sleeps 1500ms between games by default.
- HLTB has no public API; we lazy-fetch their search token from their JS
  bundle and cache it for 6h. If they rotate it, the next request retries.
- YouTube quota = 10,000 units/day, 100 units per search → ~100 games/day.
  `youtube-syncer` stops cleanly on the 403 instead of hammering.
- Cron containers should follow the "startup-run + supercronic" pattern (see
  `enricher` and `youtube-syncer` commands) so a rebuild backfills
  immediately instead of waiting for the next scheduled fire.
- `nomic-embed-text` returns 768 dims; if you switch models you must update
  `vector(768)` in `init.sql` and the schema.
- Default Postgres host port is `5532` (not the usual 5432) to avoid clashing
  with `anna`.
