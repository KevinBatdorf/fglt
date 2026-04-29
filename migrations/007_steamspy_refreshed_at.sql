-- Track per-game SteamSpy freshness so the daily refresher knows what to
-- re-pull. NULL means never refreshed (or only initially enriched).
ALTER TABLE games ADD COLUMN IF NOT EXISTS steamspy_refreshed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_games_steamspy_refreshed_at ON games(steamspy_refreshed_at);
