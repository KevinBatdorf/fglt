CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS games (
	appid           INTEGER PRIMARY KEY,
	name            TEXT NOT NULL,
	type            TEXT,
	playtime_min    INTEGER NOT NULL DEFAULT 0,
	playtime_2wk    INTEGER NOT NULL DEFAULT 0,
	last_played     TIMESTAMPTZ,

	-- appdetails enrichment
	short_desc      TEXT,
	about           TEXT,
	detailed_desc   TEXT,
	release_date    TEXT,
	is_free         BOOLEAN,
	required_age    INTEGER,
	developers      TEXT[],
	publishers      TEXT[],
	genres          TEXT[],
	categories      TEXT[],
	platforms       JSONB,           -- {windows, mac, linux}
	controller      TEXT,            -- 'full' | 'partial' | null
	metacritic      INTEGER,
	metacritic_url  TEXT,
	header_image    TEXT,
	capsule_image   TEXT,
	website         TEXT,
	price_cents     INTEGER,
	currency        TEXT,

	-- steamspy enrichment
	owners_estimate TEXT,            -- "1,000,000 .. 2,000,000"
	positive        INTEGER,
	negative        INTEGER,
	avg_playtime    INTEGER,
	median_playtime INTEGER,
	ccu             INTEGER,         -- peak concurrent

	-- hltb enrichment
	hltb_main       REAL,            -- hours
	hltb_extra      REAL,
	hltb_complete   REAL,

	-- embedding
	embedding       vector(768),

	-- timestamps
	created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
	enriched_at     TIMESTAMPTZ,
	embedded_at     TIMESTAMPTZ,
	youtube_fetched_at TIMESTAMPTZ,

	-- generated full-text search vector
	search          TSVECTOR GENERATED ALWAYS AS (
		setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
		setweight(to_tsvector('english', coalesce(short_desc, '')), 'B') ||
		setweight(to_tsvector('english', coalesce(about, '')), 'C')
	) STORED
);

CREATE INDEX IF NOT EXISTS idx_games_search      ON games USING gin(search);
CREATE INDEX IF NOT EXISTS idx_games_name_trgm   ON games USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_games_enriched_at ON games(enriched_at);
CREATE INDEX IF NOT EXISTS idx_games_embedded_at ON games(embedded_at);
CREATE INDEX IF NOT EXISTS idx_games_youtube_fetched_at ON games(youtube_fetched_at);

-- Tags from SteamSpy with vote counts (a game's "vibe")
CREATE TABLE IF NOT EXISTS game_tags (
	appid       INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
	tag         TEXT NOT NULL,
	votes       INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (appid, tag)
);

CREATE INDEX IF NOT EXISTS idx_game_tags_tag ON game_tags(tag);

-- "More like this" graph scraped from each store page
CREATE TABLE IF NOT EXISTS game_similar (
	appid          INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
	similar_appid  INTEGER NOT NULL,   -- target appid (may not be in games table)
	rank           INTEGER NOT NULL,
	PRIMARY KEY (appid, similar_appid)
);

CREATE INDEX IF NOT EXISTS idx_game_similar_target ON game_similar(similar_appid);

-- Bookkeeping for cron workers (last sync timestamps, etc.)
CREATE TABLE IF NOT EXISTS meta (
	key     TEXT PRIMARY KEY,
	value   TEXT,
	updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-storefront ownership. Steam appid is the canonical key; non-Steam stores
-- resolve via name match (see scripts/sync-epic.ts etc.).
CREATE TABLE IF NOT EXISTS platform_ownership (
	appid           INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
	platform        TEXT NOT NULL,
	external_id     TEXT NOT NULL,
	title_at_source TEXT,
	acquired_at     TIMESTAMPTZ,
	playtime_min    INTEGER NOT NULL DEFAULT 0,
	last_played     TIMESTAMPTZ,
	created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (appid, platform)
);

CREATE INDEX IF NOT EXISTS idx_platform_ownership_platform ON platform_ownership(platform);

-- YouTube videos (walkthroughs / let's-plays / trailers) discovered per game.
CREATE TABLE IF NOT EXISTS game_videos (
	appid          INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
	video_id       TEXT NOT NULL,
	title          TEXT NOT NULL,
	channel        TEXT,
	channel_id     TEXT,
	description    TEXT,
	thumbnail_url  TEXT,
	published_at   TIMESTAMPTZ,
	rank           INTEGER NOT NULL DEFAULT 0,
	query_used     TEXT,
	fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (appid, video_id)
);

CREATE INDEX IF NOT EXISTS idx_game_videos_fetched ON game_videos(fetched_at);

-- Non-Steam titles that didn't resolve to an appid yet.
CREATE TABLE IF NOT EXISTS unmatched_ownership (
	platform        TEXT NOT NULL,
	external_id     TEXT NOT NULL,
	title_at_source TEXT NOT NULL,
	developer       TEXT,
	first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
	last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
	resolved_appid  INTEGER,
	PRIMARY KEY (platform, external_id)
);
