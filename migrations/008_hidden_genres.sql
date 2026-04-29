-- Seed the curated hidden-genres list as a meta entry so users can edit it
-- via /settings/hidden-genres. The previous behavior hardcoded these in
-- src/routes/curate.ts; the route now reads them from meta on each call.
INSERT INTO meta (key, value, updated)
VALUES (
	'hidden_genres',
	'["Utilities","Software Training","Web Publishing","Audio Production","Video Production","Animation & Modeling","Game Development","Photo Editing","Education","Design & Illustration","Documentary"]',
	now()
)
ON CONFLICT (key) DO NOTHING;
