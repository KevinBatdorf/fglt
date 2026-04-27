-- Make is_owned reflect "owned on ANY platform", not just Steam.
-- Without this, Epic-only / GOG-only entries are invisible to /library?owned_only=1.

UPDATE games SET is_owned = TRUE
WHERE is_owned = FALSE
  AND EXISTS (SELECT 1 FROM platform_ownership po WHERE po.appid = games.appid);
