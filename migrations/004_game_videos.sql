-- YouTube videos discovered for each game (walkthroughs / let's-plays / trailers).
-- Seeded by scripts/sync-youtube.ts (newest games first, stops on quota error).

CREATE TABLE IF NOT EXISTS game_videos (
	appid          INTEGER NOT NULL REFERENCES games(appid) ON DELETE CASCADE,
	video_id       TEXT NOT NULL,                 -- YouTube video id (11 chars)
	title          TEXT NOT NULL,
	channel        TEXT,
	channel_id     TEXT,
	description    TEXT,
	thumbnail_url  TEXT,
	published_at   TIMESTAMPTZ,
	rank           INTEGER NOT NULL DEFAULT 0,    -- ordering within the search result
	query_used     TEXT,                          -- query string we issued (for debug)
	fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
	PRIMARY KEY (appid, video_id)
);

CREATE INDEX IF NOT EXISTS idx_game_videos_fetched ON game_videos(fetched_at);

-- Sentinel timestamp on `games` so the cron can pick rows that need (re)fetching.
ALTER TABLE games ADD COLUMN IF NOT EXISTS youtube_fetched_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_games_youtube_fetched_at ON games(youtube_fetched_at);
