# Find a Game Like That

A self-hosted game library + recommendation engine for your **Steam, Epic,
and GOG** collection — Postgres + pgvector, hybrid keyword + semantic
search, enriched with Steam Store metadata, SteamSpy tags / estimated
owners, HowLongToBeat completion times, OpenCritic + Metacritic scores,
Steam user reviews, Steam's "more like this" graph, and per-game YouTube
videos. Bun + Hono API, Electrobun desktop app, and an MCP server (open
locally; OAuth at the proxy layer).

Steam appid is the canonical key — Epic / GOG titles match into Steam via
storesearch, so a single appid can be owned across multiple storefronts.

Repo: <https://github.com/KevinBatdorf/faglt>

## Stack

- **Runtime:** Bun
- **API:** Hono
- **DB:** Postgres 17 + pgvector + pg_trgm (Drizzle for the schema)
- **Desktop:** Electrobun + React + Vite + Tailwind
- **AI provider:** Vercel AI SDK + `@ai-sdk/openai-compatible` — works
  with Ollama (default), OpenAI, Groq, Together, or any OpenAI-compatible
  endpoint. Configured via `AI_BASE_URL` / `AI_API_KEY` / `AI_CHAT_MODEL` /
  `AI_EMBED_MODEL` (falls back to `OLLAMA_URL` for backward compat).
- **Embeddings:** default `nomic-embed-text` (768 dims) via Ollama, but
  swap to `text-embedding-3-small` or any other model by changing
  `AI_EMBED_MODEL`. Schema's `vector(768)` column has to match the
  model's output dimension.
- **External data:** Steam appdetails, SteamSpy, HowLongToBeat, OpenCritic
  (RapidAPI), Steam user reviews (public), YouTube Data API v3. Each
  source has its own rate-budget logic that leaves headroom for manual
  refreshes from the desktop.
- **MCP:** `@modelcontextprotocol/sdk`, in-process pair, exposed at
  `POST /mcp` (open locally; OAuth at the `expose-tunnels` reverse proxy)
- **HTTP examples:** Yaak workspace under `yaak/`

## Containers (docker-compose)

| service               | role                                              | cron default        |
| --------------------- | ------------------------------------------------- | ------------------- |
| `postgres`            | pgvector DB, port `${POSTGRES_PORT:-5532}`        | —                   |
| `api`                 | Hono server, port `${PORT:-3110}`                 | —                   |
| `syncer`              | refreshes owned-games list                        | `0 6 * * *` (06:00) |
| `enricher`            | enriches new games + backfills missing fields + re-pulls fresh releases | `*/15 * * * *` |
| `steamspy-refresher`  | refreshes SteamSpy tags / playtime weekly         | `0 5 * * *` (05:00) |
| `youtube-syncer`      | discovers YouTube videos per game (newest first)  | `30 6 * * *` (06:30)|

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

   Optional but recommended for full enrichment:
   - `YOUTUBE_API_KEY` — see "External data" below
   - `OPENCRITIC_API_KEY` — RapidAPI free tier; see comment block in
     `.env.example`

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
   minutes (default). For ~2-3k games at ~1.5s/game it'll take a few hours total.
6. Launch the desktop app:
   ```bash
   bun run desktop
   ```

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

## External data

Per-game external data is fetched by the enricher (or source-specific
crons) and stored in side tables:

- **Steam appdetails** (`games.*`) — descriptions, screenshots, metacritic,
  release date, developers, publishers, genres, controller support, etc.
- **SteamSpy** (`games.*` + `game_tags`) — owner-estimate range,
  positive/negative review counts, avg/median playtime, CCU, user-tag votes
- **HowLongToBeat** (`games.hltb_*`) — main / +extras / completionist hours,
  scraped from the public site (init+token+honeypot flow). Self-throttled
  via `HLTB_DAILY_BUDGET` (default 80/process)
- **OpenCritic** (`game_external_scores`) — aggregated critic score, tier,
  % recommended. Requires a free RapidAPI key in `OPENCRITIC_API_KEY`.
  Free tier is ~25 lookups/day; cron caps at 20 to leave manual headroom
- **Steam user reviews** (`game_reviews`) — top 20 most-helpful English
  reviews per game (public endpoint, no key)
- **YouTube Data API v3** (`game_videos`) — top 10 walkthrough/let's-play
  videos per game. Free quota = 10,000 units/day, 100 units per search →
  ~100 games/day; cron capped at 90 to leave 10 manual fetches free

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

### OpenCritic setup

OpenCritic moved their public API behind RapidAPI. Sign up at
<https://rapidapi.com/opencritic-opencritic-default/api/opencritic-api>,
subscribe to the free Basic plan, copy your `X-RapidAPI-Key`, and:

```bash
echo 'OPENCRITIC_API_KEY=...' >> .env
docker compose up -d --build api enricher
```

Without a key, OpenCritic is silently disabled and the desktop app shows a
clear "needs RapidAPI key" placeholder pointing back to the env file.
Metacritic still works without setup — it comes through Steam appdetails.

### Manual refresh

`POST /games/:appid/refresh?source=<source>` re-fetches one external source
for one game and returns a per-source result map. Source filter is optional
(default `all`). Per-section "Fetch now" buttons in the desktop call this
with the right `source` so you don't burn unrelated rate budgets.

```json
{
  "appid": 1145360,
  "name": "Hades",
  "source": "youtube",
  "sources": {
    "youtube": { "status": "ok", "detail": { "videos": 10 } }
  }
}
```

When adding a new external source: drop a `<source>_fetched_at` column on
`games`, add a side table if structured, plug a fetcher into the `/refresh`
handler in `src/routes/refresh.ts`, and add it to the enricher's backfill
query in `scripts/enrich.ts`.

## Endpoints

| route                              | description                                                   |
| ---------------------------------- | ------------------------------------------------------------- |
| `GET  /library`                    | List/search the library. `q` triggers hybrid search.          |
| `GET  /games/:appid`               | Full record + tags + similar graph + ownership + videos + reviews + scores |
| `POST /games/:appid/refresh?source=` | Re-fetch one (or all) external sources for one game         |
| `GET  /similar?appid=` / `?q=`     | Vector recs from a seed game or natural-language query        |
| `GET  /stats`                      | Counts incl. per-platform breakdown + multi-platform overlap  |
| `GET  /lists` / `POST` / `PATCH` / `DELETE`  | User-defined lists (Play next, custom playlists)    |
| `GET  /saved_searches` / `POST` / `DELETE`   | Live saved searches with cached counts              |
| `GET  /vibes` / `POST /vibes/regenerate`     | LLM-generated "vibe" search chips                   |
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
?max_hltb_main=<hours>    weekend-game filter
?unplayed=1               only games with playtime = 0
?recently_added=1         games added since the initial seed
?appids=<csv>             restrict to a specific appid set
?limit=&offset=
?sort=name|relevance
```

Each result row includes a `platforms` array showing every storefront that
owns this appid, plus a hybrid relevance `score` when `q` is set.

## Desktop app

Electrobun shell at `apps/desktop/`. React + Vite + Tailwind, talks to the
Hono API on `localhost:3110`. Custom Win11-style titlebar, JS-driven
window resize, persisted window position, hybrid search bar, vibe chips,
recently viewed log, saved searches, lists with right-click rename/delete,
clickable detail-page tags, screenshot lightbox, per-source fetch buttons.

```bash
bun run desktop          # launches the desktop window
```

## MCP tools

- `search_library` — hybrid search (with `platform` filter)
- `find_similar` — recs by appid or query (with `platform` filter)
- `get_game` — full record + per-platform `ownership`
- `recently_played`
- `unplayed_pile` — backlog, optional `max_main_hours` cap (HLTB)
- `get_stats` — includes per-platform breakdown
- `sync_owned`

Auth: the **local** `/mcp` endpoint is open. Public exposure happens via the
OAuth-flowed reverse proxy in `D:\code\expose-tunnels\` — see "Connecting
from Claude" below.

## Connecting from Claude

The proxy lives at
[`D:\code\expose-tunnels\steam-mcp-proxy.js`](../expose-tunnels/steam-mcp-proxy.js)
and is exposed at `https://steam.share.cool.omg.lol` via the
`expose-steam` service in `expose-tunnels/docker-compose.yml`.

1. Bring up this stack: `docker compose up -d --build` (in this dir).
2. Bring up the tunnel: `docker compose up -d expose-steam` (in
   `D:\code\expose-tunnels\`). It auto-rebuilds and shares
   `https://steam.share.cool.omg.lol`.
3. **Register an OAuth client** (only needed once):
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
container restarts.

## Yaak

Open the `yaak/` folder in [Yaak](https://yaak.app). The `Local` environment
defines `baseUrl=http://localhost:3110`. Folders cover Discover, What to
play, Cross-platform, Game detail, Recommendations, Lists, Vibes, Admin
(activity / enrich / sync / tags / hidden genres), and MCP (discovery,
tools/list, tool-call examples).

## Schema highlights

`games` has the full appdetails payload (descriptions, genres, categories,
platforms, metacritic, controller support, price), the SteamSpy enrichment
(owner-estimate range, positive/negative reviews, avg/median playtime, peak
CCU), HLTB hours (main / +extras / completionist), a 768-dim `embedding`,
and a generated `search` tsvector weighting name > genres > short
description > about. `*_fetched_at` columns gate cron retries per source.

`game_tags` is the SteamSpy tag-vote table (the highest-signal field for
"vibe" queries — feeds into the embedding doc).

`game_similar` is the appid-to-appid "more like this" graph scraped from
each store page; surfaced under "Steam's more like this" in the desktop
detail view, filtered to games you actually own.

`game_reviews` is the top-20 most-helpful English Steam reviews per game.

`game_external_scores` is per-game per-source scores (currently OpenCritic;
extensible to IGDB / others).

`game_videos` is the per-game YouTube video set.

`platform_ownership` records per-storefront ownership keyed on
`(appid, platform)` — `steam`, `epic`, or `gog` — with each platform's
external id, acquired_at, and per-store playtime.

`unmatched_ownership` is the diagnostic landing zone for non-Steam titles
that didn't resolve to a Steam appid.

`lists` + `list_games` are user-defined collections. `saved_searches` are
live queries that re-run each time they're opened.

## Notes / gotchas

- Steam's `appdetails` endpoint rate-limits at ~200 requests / 5 minutes, so
  the enricher sleeps 1500ms between games by default and the per-tick
  batch sizes are tuned to stay under that ceiling.
- HLTB has no public API; we hit their `/api/find/init` → `/api/find` flow
  with the `x-auth-token` / `x-hp-key` / `x-hp-val` headers + body
  honeypot they introduced in their 2025 redesign. If they change it
  again, see `src/lib/hltb.ts`.
- YouTube quota = 10,000 units/day, 100 units per search → ~100 games/day.
  The cron caps at 90 to leave 10 slots free for manual fetches.
- OpenCritic's free RapidAPI tier is ~25 lookups/day; cron caps at 20 to
  leave headroom. Process-wide rate-limit short-circuit on 429.
- Cron containers follow the "startup-run + supercronic" pattern (see
  `enricher` and `youtube-syncer` commands) so a rebuild backfills
  immediately instead of waiting for the next scheduled fire.
- `nomic-embed-text` returns 768 dims; if you switch models you must update
  `vector(768)` in `init.sql` and the schema.
- Default Postgres host port is `5532` (not the usual 5432) to avoid clashing
  with other local Postgres instances.
