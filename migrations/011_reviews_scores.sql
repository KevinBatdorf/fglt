-- Steam user reviews + external aggregated scores (OpenCritic, future: IGDB,
-- ProtonDB). Reviews are an open-ended set per game; scores are exactly
-- one row per (game, source). Fetched_at columns on games gate cron retries.

CREATE TABLE IF NOT EXISTS game_reviews (
	appid                 INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
	recommendation_id     BIGINT  NOT NULL,        -- Steam's review id
	author_steamid        TEXT,
	voted_up              BOOLEAN NOT NULL,
	votes_up              INTEGER NOT NULL DEFAULT 0,
	votes_funny           INTEGER NOT NULL DEFAULT 0,
	weighted_vote_score   REAL,                    -- Steam's helpfulness rank
	playtime_at_review_min INTEGER,                -- minutes at time of review
	language              TEXT,
	review_text           TEXT,
	timestamp_created     TIMESTAMPTZ,
	timestamp_updated     TIMESTAMPTZ,
	fetched_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (appid, recommendation_id)
);

CREATE INDEX IF NOT EXISTS idx_game_reviews_appid_score
	ON game_reviews(appid, weighted_vote_score DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS game_external_scores (
	appid                 INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
	source                TEXT    NOT NULL,        -- 'opencritic' | 'igdb' | ...
	score                 REAL,                    -- normalized 0..100 where applicable
	max_score             REAL    NOT NULL DEFAULT 100,
	tier                  TEXT,                    -- e.g. 'Mighty', 'Strong'
	url                   TEXT,
	percent_recommended   REAL,                    -- 0..100
	num_reviews           INTEGER,
	raw                   JSONB,
	fetched_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (appid, source)
);

ALTER TABLE games
	ADD COLUMN IF NOT EXISTS steam_reviews_fetched_at TIMESTAMPTZ,
	ADD COLUMN IF NOT EXISTS opencritic_fetched_at    TIMESTAMPTZ;
