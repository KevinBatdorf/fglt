-- Capture the moment "initial setup" ends so the Recently-added view can
-- skip the bulk sync rows. Anything created after this timestamp counts as
-- a real addition (a new purchase, a hand-added Epic/GOG entry, etc.).
INSERT INTO meta (key, value, updated)
VALUES ('initial_setup_until', now()::text, now())
ON CONFLICT (key) DO NOTHING;
