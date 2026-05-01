-- Replace the two seeded system lists (bookmarks, remind_later) with a
-- single "Play next" default. Preserves any user-added games — only drops
-- the original system lists if they are empty.

INSERT INTO lists (slug, name, emoji, is_system) VALUES
	('play_next', 'Play next', '🎯', TRUE)
ON CONFLICT (slug) DO NOTHING;

DELETE FROM lists
WHERE slug IN ('bookmarks', 'remind_later')
	AND is_system = TRUE
	AND id NOT IN (SELECT DISTINCT list_id FROM list_games);
