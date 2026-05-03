# Find a Game Like That

Self-hosted desktop app for searching and getting recommendations across
your Steam, Epic, and GOG libraries. Search by what a game *feels* like
("cozy puzzle", "3am dread"), get weekend-length picks, hidden gems,
"more like this" suggestions — all from your own backlog.

![Find a Game Like That — desktop app screenshot](apps/desktop/assets/screenshot.png)

## Install

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   and make sure it's running.
2. Download the desktop app from
   [the latest release](https://github.com/KevinBatdorf/fglt/releases/latest)
   and launch it. First start takes ~3 min while it builds the backend
   image; subsequent launches are instant.
3. Add your Steam credentials when the app prompts:
   - Steam API key — <https://steamcommunity.com/dev/apikey>
   - Steam ID (64-bit) — <https://steamid.io/>

The enricher fills in metadata, screenshots, reviews, and HowLongToBeat
times in the background. ~2,000 games is fully enriched in a few hours.

## Optional integrations

All optional, all set in **Settings → Configuration**:

- **AI (Ollama / OpenAI / Groq / Together)** — semantic search and
  vibe-chip generation. Without it, search is keyword-only.
- **YouTube API key** — gameplay videos on each game's detail page.
- **OpenCritic** (RapidAPI) — critic scores alongside Metacritic.

## Multi-platform

Epic + GOG titles are matched into Steam appids. Steam is the source of
truth; non-Steam-only games are skipped.

- **Epic:** `pip install --user legendary-gl`, `legendary auth`,
  `bun run sync:epic`.
- **GOG:** `bun run auth:gog`, follow the OAuth flow, `bun run sync:gog`.

## Hacking

Architecture and dev workflow live in [`CLAUDE.md`](./CLAUDE.md).

## License

Vibe-coded AI slop I built for my own use and threw up here in case
anyone else finds it useful. If I have to pick a license: **MIT**.
