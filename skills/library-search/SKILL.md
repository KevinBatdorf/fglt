---
name: library-search
description: This skill should be used when the user asks to "find a game", "search my steam library", "what should I play", "recommend a game", "find similar games", "what's like X", "my unplayed games", "my backlog", "short games to play", "games under N hours", "games I haven't played", "what have I been playing", "stats on my library", or wants to query their owned Steam games. Also use when the user mentions "steam", "my library", "my games", "my backlog", "playtime", "hltb", "howlongtobeat", or asks for game recommendations rooted in what they already own. The library is enriched with Steam appdetails, SteamSpy tags + estimated owners, HowLongToBeat completion times, and Steam's own "more like this" graph, with hybrid keyword + semantic vector search.
---

# Steam Library Search & Recommendations

Self-hosted REST API over a Postgres + pgvector database of the user's owned
games (~thousands of titles, primarily Steam — Epic and GOG ownership are
also tracked when the same title exists on Steam, see "Multi-platform" below).
Each game is enriched with:

- **Steam appdetails** — descriptions, genres, categories, developers, publishers, metacritic score, platforms (windows/mac/linux), controller support, release date, price
- **SteamSpy** — estimated owner range, positive/negative review counts, average/median playtime, peak concurrent users, **user tags with vote counts** (the highest-signal signal for vibe queries)
- **HowLongToBeat** — completion times for main story, main+extras, completionist
- **"More like this" graph** — Steam's own per-game recommendation list, scraped from the store page
- **Embeddings** — 768-dim vectors over `name + top-15 tags + short_description`. Default model is `nomic-embed-text` via Ollama, but the AI helper supports any OpenAI-compatible provider (`AI_BASE_URL` env).
- **YouTube videos** — top ~10 walkthroughs / let's-plays / trailers per game, surfaced on `/games/:appid` (seed runs ~100 games/day until Google's 10k-unit daily quota; newest games processed first)

Search is hybrid: keyword FTS + vector cosine similarity, blended via weighted
sum. Filters (playtime, genre, tag) apply as SQL `WHERE` on the same row.

Call `/stats` to see how many games are synced/enriched/embedded.

## API Base URL

`http://localhost:3110`

## Endpoints

### Search & Browse

| Endpoint | Description |
|---|---|
| `GET /library?q=&tag=&genre=&platform=&min_playtime=&max_playtime=&unplayed=1&limit=50&offset=0&sort=` | Hybrid search across the library; each result has a `platforms` array |
| `GET /games/:appid` | Full record + tags + similar graph + per-platform `ownership` + `videos` |
| `POST /games/:appid/refresh` | Manually re-fetch every external source (YouTube etc.); returns per-source result map |
| `GET /similar?appid=&q=&platform=&max_playtime=&min_positive_pct=&limit=20` | Vector-similarity recs |
| `GET /stats` | DB stats — total, per-platform breakdown (`platforms.steam` etc.), `multi_platform` overlap count, enriched/embedded/played/unplayed, last sync |

### MCP

| Endpoint | Description |
|---|---|
| `GET /mcp` | Public discovery |
| `POST /mcp` | JSON-RPC 2.0 (open locally; OAuth at the proxy layer in `D:\code\expose-tunnels\`) |

### Library / Search

```
GET /library?q=<text>&tag=&genre=&platform=&min_playtime=&max_playtime=&unplayed=1&limit=50&offset=0&sort=name
```

Returns owned games (every row in the library is owned via at least one
storefront). All params optional and combinable:

- `q` — free-text query. Triggers **hybrid search** (60% vector + 40% FTS rank) when Ollama is configured. Falls back to FTS-only otherwise. Without `q`, sorted alphabetically.
- `tag` — SteamSpy user tag, partial match (e.g. `tag=Roguelike`, `tag=Cozy`)
- `genre` — Steam genre, exact match (e.g. `genre=Indie`)
- `platform` — restrict to a specific storefront: `steam`, `epic`, or `gog`
- `min_playtime` / `max_playtime` — bounds in **minutes**
- `unplayed=1` — only games with `playtime_min = 0`
- `sort=name|relevance` — defaults to `relevance` when `q` is set, `name` otherwise
- `limit` / `offset` — pagination

Each result row: `appid, name, type, short_desc, header_image, release_date, genres, categories, playtime_min, playtime_2wk, last_played, positive, negative, owners_estimate, hltb_main, hltb_extra, metacritic, platforms` (an array like `["steam", "epic"]`).

### Game detail

```
GET /games/:appid
```

Returns the full enriched record plus:
- `platforms` — array like `["steam", "epic", "gog"]`
- `ownership` — per-platform rows with `{platform, external_id, title_at_source, acquired_at, playtime_min, last_played}` — exposes per-store metadata
- `tags` — array of `{tag, votes}` from SteamSpy, sorted by vote count desc
- `similar` — array of `{appid, rank, name, header_image}` from Steam's "more like this" carousel
- `videos` — array of `{video_id, title, channel, channel_id, description, thumbnail_url, published_at, rank}` discovered via the YouTube Data API (gameplay / walkthrough / let's-play / trailer mix). Empty if `youtube_fetched_at` is null on this game.

### Similar / Recommendations

```
GET /similar?appid=<seed>           — recommend by vector cosine to seed game
GET /similar?q=<text>                — recommend by free-text query embedding
```

Required: one of `appid` or `q`. All recommendations are pulled from the
owned library (everything in `games` is owned). Optional filters:

- `platform` — restrict to `steam` / `epic` / `gog`
- `max_playtime=<minutes>` — cap on user playtime (e.g. `max_playtime=600` = under 10h played)
- `min_positive_pct=<0-100>` — minimum review positivity
- `limit` (default 20)

Each result row also includes `similarity` (0..1) — higher is more similar.

**`appid` is preferred over `q`** when the user names a specific game — it's
more accurate. Pass `q` for vibe queries like "cozy puzzle game with story".

### Stats

```
GET /stats
```

Returns:
- `total` — total games in the library (every row is owned via at least one storefront)
- `platforms` — per-storefront counts, e.g. `{steam: 2135, epic: 321, gog: 36}`
- `multi_platform` — number of games owned on more than one storefront
- `enriched` — have appdetails fetched
- `embedded` — have Ollama vector
- `played` / `unplayed` — `playtime_min > 0` / `= 0`
- `total_playtime_min` — sum across all
- `meta[]` — bookkeeping (e.g. `last_sync`)

## Common workflows

**"What should I play?"** — `GET /library?unplayed=1&limit=50` then filter by mood/length. Or `GET /library?q=cozy short&unplayed=1`.

**"What's like Hades?"** — find the appid first via `GET /library?q=hades&limit=1`, then `GET /similar?appid=<id>` to get owned-library recommendations.

**"What do I own on GOG?"** — `GET /library?platform=gog&limit=100`.

**"Do I own Wolfenstein TNO anywhere?"** — find the appid (`GET /library?q=Wolfenstein+New+Order&limit=1`), then `GET /games/:appid` and read the `platforms` array.

**"What have I been playing?"** — `GET /library?min_playtime=1` and sort client-side by `playtime_2wk` desc.

**"How long is X?"** — `GET /games/:appid` → look at `hltb_main`, `hltb_extra`, `hltb_complete` (hours).

**"Quick games?"** — `GET /library?unplayed=1` then filter results where `hltb_main <= 10`.

**"Show me a walkthrough / trailer for X"** — `GET /games/:appid` → use the `videos` array (already fetched if `youtube_fetched_at` is set; otherwise `POST /games/:appid/refresh` to fetch it now).

**"Refresh data on X"** — `POST /games/:appid/refresh`. Re-fetches every configured external source. Per-source status returns in `sources.<name>.status` (`ok` / `rate_limited` / `error` / `disabled`).

## Multi-platform ownership

Steam appid is the canonical ID. The `platform_ownership` table records which
storefronts own each appid (`steam`, `epic`, `gog`). A game can have multiple
rows — e.g. owned on both Steam and Epic. Games that exist only on Epic/GOG
and not on Steam are **not** in the library (they can't be matched to an
appid, so they're dropped). This is intentional: Steam is the source of truth.

`/library` and `/similar` results include a `platforms` array per row.
`/games/:appid` includes both `platforms` and a richer `ownership` array with
per-store metadata (`external_id`, `title_at_source`, `acquired_at`,
`playtime_min`, `last_played`). Use the `?platform=<store>` filter on
`/library` and `/similar` to scope to a single storefront.

## Notes

- The library refreshes daily at 06:00 via the `syncer` cron. Trigger `POST /sync` after a recent purchase if you want immediate visibility.
- Epic/GOG ownership is synced on the host with `bun run sync:epic` / `sync:gog` (manual, browser-auth required once).
- Enrichment runs every 15 minutes in batches of 50; for ~3000 games this takes several hours from cold start. `GET /stats` shows progress.
- YouTube video discovery runs daily at 06:30 UTC, ~100 games/day until quota; newest games first. Full library seed takes ~24 days at the floor.
- The AI provider must have an embedding model loaded (default `nomic-embed-text` via Ollama; any OpenAI-compatible provider works via env vars). Vector search degrades gracefully to FTS-only if the provider is unreachable.
- The MCP server (7 tools — `search_library`, `find_similar`, `get_game`, `recently_played`, `unplayed_pile`, `get_stats`, `sync_owned`) is exposed publicly via OAuth at `https://steam.share.cool.omg.lol/mcp` (the same `clients.json` as the anna connector). Enrichment, embedding, and video discovery are automatic via cron containers; no manual data-fetch tool is exposed via MCP — for that, use the `/games/:appid/refresh` REST endpoint.
