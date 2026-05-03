# Find a Game Like That

A self-hosted desktop app for searching and getting recommendations across
your **Steam, Epic, and GOG** libraries — runs entirely on your own machine.

Search by what a game *feels* like ("cozy puzzle", "3am dread"), not just
its title. Get weekend-length picks, hidden gems, controversial favorites,
and "more like this game I love" suggestions, all pulled from your own
backlog.

> **Status:** early days. Releases below — but expect rough edges.
> Issues and PRs welcome at <https://github.com/KevinBatdorf/fglt>.

<!-- Screenshot lands here once captured at apps/desktop/assets/screenshot.png -->

## Install

Three steps. No clone, no `.env`, no terminal commands.

1. **Install Docker Desktop.** [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
   for Windows / macOS, or Docker Engine for Linux. Make sure it's
   *running* — Docker Desktop doesn't auto-start by default.

2. **Download the desktop app** for your OS from
   [the latest release](https://github.com/KevinBatdorf/fglt/releases/latest)
   and launch it. The app brings up its own Postgres + API + cron
   workers via Docker on first launch — **first start takes ~3 min
   one-time** while it builds the API image locally on your machine.
   Subsequent launches are instant.

3. **Add your Steam credentials.** Once the backend is up, the app
   opens to **Settings → Configuration** and stays there until you
   fill in:
   - **Steam API key** — free at <https://steamcommunity.com/dev/apikey>
   - **Steam ID (64-bit)** — paste your Steam profile URL into <https://steamid.io/>

   Hit Save. The app unlocks within a second or two and starts syncing.

## First run

After the initial sync the **enricher** cron runs every 15 minutes and
gradually fills in metadata, screenshots, reviews, and HowLongToBeat
times. A 2,000-game library is fully enriched in a few hours.

The home page becomes interesting once a few hundred games are enriched.
Until then the app's a bit of a "dashboard waiting for paint" — that's
expected.

## Optional integrations

Every key below is **optional** and lives in **Settings → Configuration**
inside the desktop app. The library is fully usable without any of them.

| Add this | What you get | How |
|---|---|---|
| **YouTube API key** | Walkthrough / let's-play videos on each game's detail page | <https://console.cloud.google.com> → enable "YouTube Data API v3" → paste the key into Settings |
| **OpenCritic key** | Aggregated critic scores alongside Metacritic | Sign up free at <https://rapidapi.com/opencritic-opencritic-default/api/opencritic-api>, copy your `X-RapidAPI-Key`, paste into Settings |
| **Ollama** | Local AI for embeddings + "vibe" chip generation. Free, private. | Install [Ollama](https://ollama.com) and pull `nomic-embed-text` + a chat model like `qwen3:14b`. The default config talks to `http://host.docker.internal:11434`. |
| **OpenAI / Groq / Together** | Cloud AI as an alternative | Set the AI base URL + API key + chat/embed model names in Settings |

If you skip the AI integrations, search still works (keyword-only) and
the "vibe" chips fall back to a static list. Skip YouTube if you don't
want videos. Skip OpenCritic if Metacritic-only is enough — Metacritic
comes free through Steam.

## Multi-platform

Steam is the canonical source. Epic and GOG titles are matched into Steam
appids so a single game can show ownership across all your stores.

- **Epic:** install [`legendary-gl`](https://github.com/derrod/legendary)
  (`pip install --user legendary-gl`), run `legendary auth`, then
  `bun run sync:epic` from the project root.
- **GOG:** `bun run auth:gog` (browser sign-in, paste back the code), then
  `bun run sync:gog`.

itch.io is intentionally not supported — most itch titles aren't on Steam
and the matching falls apart.

## Updates

The app checks for new releases on launch and periodically. When one's
ready, you'll see a banner asking to restart. No need to re-download.

## Contributing / hacking

Architecture, schema, API endpoints, and dev workflow live in
[`CLAUDE.md`](./CLAUDE.md). Pull requests welcome.
