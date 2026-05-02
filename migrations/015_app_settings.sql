-- User-tweakable settings managed by the desktop UI's Configuration page.
-- Plain key/value (text/text). Sensitive values (API keys) are stored as
-- plaintext — this is a localhost-only DB, no external access. Encryption
-- can come later if/when the app goes hosted/multi-user.
--
-- Resolution order at runtime: process.env[key] OR app_settings.value.
-- Env wins so existing dev `.env` setups stay untouched.

CREATE TABLE IF NOT EXISTS app_settings (
	key         TEXT PRIMARY KEY,
	value       TEXT,
	updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
