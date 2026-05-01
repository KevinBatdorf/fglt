-- Distinguish "never tried" from "tried, Steam returned nothing".
-- enriched_at predates the screenshots column (migration 009), so we can't
-- use it as a proxy. This explicit marker also lets the backfill cron skip
-- games whose screenshots are confirmed-empty instead of retrying forever.
ALTER TABLE games
	ADD COLUMN IF NOT EXISTS screenshots_fetched_at TIMESTAMPTZ;

-- Backfill: any row with non-empty screenshots was definitely fetched.
UPDATE games
SET screenshots_fetched_at = COALESCE(enriched_at, now())
WHERE jsonb_array_length(screenshots) > 0
  AND screenshots_fetched_at IS NULL;
