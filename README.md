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

You'll need **Docker** (for the local database + sync workers) and a
**Steam API key**.

1. Clone and configure:
   ```bash
   git clone https://github.com/KevinBatdorf/fglt.git
   cd fglt
   cp .env.example .env
   ```
   Open `.env` and fill in:
   - `STEAM_API_KEY` — get one (free) at <https://steamcommunity.com/dev/apikey>
   - `STEAM_ID` — your 64-bit SteamID. Paste your Steam profile URL into <https://steamid.io/> to find it.

2. Start the local stack:
   ```bash
   docker compose up -d
   ```
   This brings up Postgres, the API, and the cron workers that sync your
   library and enrich it over time.

3. Download the desktop app for your OS from
   [the latest release](https://github.com/KevinBatdorf/fglt/releases/latest)
   and run it.

## First run

The app shows a banner at the top if anything's not quite right (Docker
isn't running, library's empty, an integration's not configured). Follow
the instructions there.

For an initial sync, either wait for the daily sync cron, or kick it off
manually:
```bash
curl -X POST http://localhost:3110/sync
```

After sync, the **enricher** runs every 15 minutes and gradually fills in
metadata, screenshots, reviews, and HowLongToBeat times. A 2,000-game
library is fully enriched in a few hours.

## Optional integrations

| Add this | What you get | How |
|---|---|---|
| **YouTube API key** | Walkthrough / let's-play videos on each game's detail page | <https://console.cloud.google.com> → enable "YouTube Data API v3" → drop key in `.env` as `YOUTUBE_API_KEY` |
| **OpenCritic key** | Aggregated critic scores alongside Metacritic | Sign up free at <https://rapidapi.com/opencritic-opencritic-default/api/opencritic-api>, copy your `X-RapidAPI-Key`, add to `.env` as `OPENCRITIC_API_KEY` |
| **Ollama** | Local AI for embeddings + "vibe" chip generation. Free, private. | Default. Install [Ollama](https://ollama.com) and pull `nomic-embed-text` + a chat model like `qwen3:14b` |
| **OpenAI / Groq / Together** | Cloud AI as an alternative | Set `AI_BASE_URL` + `AI_API_KEY` + `AI_CHAT_MODEL` + `AI_EMBED_MODEL` in `.env` |

If you skip the AI integrations, search still works (keyword-only) and the
"vibe" chips fall back to a static list. Skip YouTube if you don't want
videos. Skip OpenCritic if Metacritic-only is enough — Metacritic comes
free through Steam.

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
