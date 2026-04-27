-- Drop is_owned: every row in `games` is owned (existence in platform_ownership
-- is the authoritative ownership signal). is_owned was redundant and caused
-- drift bugs (Steam sync would unset Epic/GOG ownership).

-- First, write Steam ownership into platform_ownership for any games that have
-- is_owned=true but no steam ownership row. This shouldn't happen given the
-- 001 backfill, but be safe.
INSERT INTO platform_ownership (appid, platform, external_id, title_at_source, playtime_min, last_played)
SELECT appid, 'steam', appid::text, name, playtime_min, last_played
FROM games
WHERE is_owned = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM platform_ownership po
    WHERE po.appid = games.appid AND po.platform = 'steam'
  )
ON CONFLICT (appid, platform) DO NOTHING;

-- Drop the dependent index, then the column.
DROP INDEX IF EXISTS idx_games_owned;
ALTER TABLE games DROP COLUMN IF EXISTS is_owned;
