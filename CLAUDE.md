# Steam Library API

Self-hosted Postgres + pgvector database of an owned Steam library, enriched
with Steam Store metadata, SteamSpy tags, HowLongToBeat completion times, and
the Steam "more like this" graph. Hybrid keyword + semantic search via Ollama.

## Commands

- `bun run dev` — Start the API server locally (port 3110)
- `bun run sync` — Re-fetch the owned-games list from the Steam Web API
- `bun run sync:epic` — Sync Epic Games library (requires legendary, see below)
- `bun run auth:gog` / `bun run sync:gog` — Auth and sync GOG library (OAuth, see below)
- `bun run sync:youtube` — Discover YouTube videos for the next batch of un-fetched games (newest first; stops on quota)
- `bun run desktop` — Launch the SEG desktop app (Electrobun shell at `apps/desktop/`, Vite HMR on :5173, expects API on :3110)
- `bun run enrich` — Enrich a batch of un-enriched games (appdetails + SteamSpy + HLTB + similar)
- `bun run embed` — Embed enriched-but-unembedded games via Ollama
- `bun run lint` — Lint with Biome (errors on warnings)
- `bun run lint:fix` — Auto-fix lint/format issues

## Multi-platform ownership

Steam appid is the canonical key. Non-Steam titles (Epic / GOG / itch) are
matched to a Steam appid via `store.steampowered.com/api/storesearch` and
recorded in `platform_ownership`. Misses go to `unmatched_ownership` for
hand-resolution. A Steam appid can have multiple ownership rows — that's the
"I own this on Steam AND Epic" case.

### Epic setup (once per machine)

```sh
pip install --user legendary-gl
legendary auth          # browser SSO; pastes back an auth code
bun run sync:epic       # pulls library, matches each title, upserts
```

`scripts/sync-epic.ts` resolves the `legendary` binary in this order:
`$LEGENDARY_BIN`, then `legendary` on PATH, then common pip `--user` install
paths. Set `LEGENDARY_BIN` if your install is elsewhere.

### GOG setup (once per machine)

```sh
bun run auth:gog                    # prints OAuth URL
# sign in via browser, copy `code` query param from the redirect URL
bun run auth:gog <code>             # persists tokens to data/gog-tokens.json
bun run sync:gog
```

GOG OAuth uses the public Galaxy client credentials. Tokens auto-refresh on
each sync (refresh token rotates per call); no manual re-auth needed.

### Matching

Steam title resolution lives in `src/lib/match-steam-appid.ts`. Confidence
threshold is 0.85; below that, titles drop into `unmatched_ownership` instead
of being guessed. **Games that don't match a Steam appid are ignored** —
Steam is the source of truth.

## External data refresh (YouTube et al.)

Per-game external data (videos, future: OpenCritic, IGDB, ProtonDB, PCGW) is
discovered automatically by source-specific cron containers and persisted in
side tables (`game_videos`, etc.). The `youtube-syncer` runs daily at
`30 6 * * *` UTC (just after Google's 00:00 PT quota reset), picks
newest-game-first, and stops cleanly on a 403 quotaExceeded — see
`scripts/sync-youtube.ts` and `src/lib/youtube.ts`.

Free YouTube quota is **10,000 units/day**, search.list = **100 units/call**,
so ~100 games/day. Full library seed takes ~24 days at the floor.

### Manual refresh

`POST /games/:appid/refresh` re-fetches every external source for one game
and returns a per-source result map (`{youtube: {status: "ok", detail: ...},
opencritic: {status: "rate_limited", ...}}`). No internal rate-gate — manual
= user-initiated, upstream rate limits surface in the response. Future UI
will wire a "refresh" button to this endpoint.

When adding a new external source: drop a `<source>_fetched_at` column on
`games`, add a side table if structured, plug a fetcher into the `/refresh`
handler in `src/routes/refresh.ts`, and add a sync container to
docker-compose with the same supercronic-with-startup-run pattern.

## Stack

- **Runtime:** Bun
- **Framework:** Hono
- **Database:** PostgreSQL 17 + pgvector + pg_trgm via Drizzle ORM + raw postgres.js
- **Search:** Postgres FTS (weighted tsvector, generated columns + GIN), hybrid with pgvector cosine similarity (768-dim Ollama embeddings)
- **Linter:** Biome (tabs, single quotes, Bun globals)
- **Public auth:** OAuth 2.0 reverse proxy in `D:\code\expose-tunnels\steam-mcp-proxy.js` (mirrors anna's pattern)

## Project Structure

- `src/` — API server (routes, db, lib)
- `scripts/` — Cron entrypoints (sync-owned, enrich, embed, sync-youtube, sync-epic, sync-gog, auth-gog)
- `apps/desktop/` — Electrobun desktop UI (React + Vite + Tailwind, talks to localhost:3110)
- `yaak/` — Yaak workspace (HTTP request examples)
- `skills/library-search/` — Claude Code plugin skill
- `.claude-plugin/` — Plugin manifest
- `migrations/` — Numbered SQL migrations applied via `docker exec ... psql < ...`

## Containers (docker-compose)

| service           | role                                              | cron default        |
| ----------------- | ------------------------------------------------- | ------------------- |
| `postgres`        | pgvector DB (port 5532 to avoid clashing w/ anna) | —                   |
| `api`             | Hono server (port 3110)                           | —                   |
| `syncer`          | refreshes owned-games list                        | `0 6 * * *` (06:00) |
| `enricher`        | enriches + embeds new games                       | `*/15 * * * *`      |
| `youtube-syncer`  | discovers YouTube videos per game (newest first)  | `30 6 * * *` (06:30)|

Non-Steam ownership syncs (Epic, GOG) run on the host via `bun run sync:<x>`
— they need browser-flow auth that doesn't fit the cron model.

## Status Check

When asked for status, run these and report the results:

- `docker ps --format "table {{.Names}}\t{{.Status}}"` — Container health
- `curl -s http://localhost:3110/stats` — Counts and last-sync time
- `bun run lint` — Linter

## Workflow

- Work in small, incremental steps — make a change, test it, then move on
- Run `bun run lint` before committing — must pass clean
- When changing API endpoints, update both the Yaak workspace in `yaak/` AND
  `expose-tunnels/steam-mcp-proxy.js` (the MCP tool definitions and dispatch
  in the proxy mirror the REST routes — they are not auto-derived)

## Conventions

- FTS uses `websearch_to_tsquery('english', q)` — handles "quoted phrases" and `-exclusions` natively
- Generated tsvector columns must use only IMMUTABLE functions — array-derived FTS (e.g. `array_to_string(genres, ' ')`) won't work; filter on arrays via `= ANY(...)` instead
- `similar` is reserved in Postgres — use `similar_appid` or quote it
- `Date` doesn't auto-bind in postgres.js raw queries — use `.toISOString()` for timestamps
- `JSONB` columns: stringify and cast (`${JSON.stringify(obj)}::jsonb`); `raw.json()` does not exist
- Steam appdetails endpoint rate-limits at ~200 req / 5 min — enricher sleeps 1500ms between games
- Embedding doc per game = `name + top-15 tags by votes + short_description` (skip detailed_description, it's marketing copy noise)
- Vector dim is 768 (`nomic-embed-text`); changing the model means changing the schema
- YouTube quota = 10,000 units/day, 100 units per `search.list` call → ~100 games/day max
- Cron containers should follow the "startup-run + supercronic" pattern (see `enricher` and `youtube-syncer` commands) so a rebuild backfills immediately instead of waiting for the next scheduled fire
