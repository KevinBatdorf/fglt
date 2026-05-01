-- Steam appdetails returns a screenshots[] array with thumbnail + full URLs.
-- Capture it so the desktop UI can render a gallery on the detail page.
ALTER TABLE games
	ADD COLUMN IF NOT EXISTS screenshots JSONB NOT NULL DEFAULT '[]'::jsonb;
