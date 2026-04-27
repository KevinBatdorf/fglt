-- Track ownership of a game across multiple storefronts.
-- Steam appid stays the canonical key; non-Steam stores resolve via name match.

CREATE TABLE IF NOT EXISTS platform_ownership (
	appid           INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
	platform        TEXT NOT NULL,        -- 'steam' | 'epic' | 'gog' | 'itch'
	external_id     TEXT NOT NULL,        -- platform-specific id (epic catalogId, gog id, etc.)
	title_at_source TEXT,                 -- name as listed on that platform (debug aid)
	acquired_at     TIMESTAMPTZ,
	playtime_min    INTEGER NOT NULL DEFAULT 0,
	last_played     TIMESTAMPTZ,
	created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (appid, platform)
);

CREATE INDEX IF NOT EXISTS idx_platform_ownership_platform ON platform_ownership(platform);

-- Unmatched titles from non-Steam stores live here until hand-resolved or
-- discovered on a future Steam sync.
CREATE TABLE IF NOT EXISTS unmatched_ownership (
	platform        TEXT NOT NULL,
	external_id     TEXT NOT NULL,
	title_at_source TEXT NOT NULL,
	developer       TEXT,
	first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
	last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
	resolved_appid  INTEGER,              -- set when hand-matched
	PRIMARY KEY (platform, external_id)
);

-- Backfill Steam ownership from existing is_owned flag.
INSERT INTO platform_ownership (appid, platform, external_id, title_at_source, playtime_min, last_played)
SELECT appid, 'steam', appid::text, name, playtime_min, last_played
FROM games
WHERE is_owned = TRUE
ON CONFLICT (appid, platform) DO NOTHING;
