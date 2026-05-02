-- Drop the bullseye emoji from the seeded Play next list. Sidebar will
-- now fall back to the default 📋 icon for it (consistent with other
-- system-seeded lists having no custom icon by default).
UPDATE lists SET emoji = NULL WHERE slug = 'play_next';
