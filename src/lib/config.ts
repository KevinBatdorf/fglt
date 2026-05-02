/**
 * Runtime configuration backed by either process.env or the app_settings
 * Postgres table. Resolution order (per key):
 *
 *   process.env[key]   →   app_settings.value   →   undefined
 *
 * Env wins so dev environments with .env files keep working unchanged;
 * the DB fallback covers the desktop-binary user who has nothing in env
 * and edits values via the Settings → Configuration UI.
 *
 * Cached for 5 seconds so high-frequency callers (the enricher batch
 * loop) don't pound the DB. The settings-write endpoint calls
 * `invalidateConfig()` so a Save in the UI takes effect immediately on
 * the next read.
 */

import { raw } from '../db';

export interface AppConfig {
	STEAM_API_KEY?: string;
	STEAM_ID?: string;
	YOUTUBE_API_KEY?: string;
	OPENCRITIC_API_KEY?: string;
	AI_BASE_URL?: string;
	AI_API_KEY?: string;
	AI_PROVIDER_NAME?: string;
	AI_CHAT_MODEL?: string;
	AI_EMBED_MODEL?: string;
	OLLAMA_URL?: string;
	OLLAMA_CHAT_MODEL?: string;
	OLLAMA_EMBED_MODEL?: string;
	HLTB_DAILY_BUDGET?: string;
	OPENCRITIC_DAILY_BUDGET?: string;
}

export const CONFIG_KEYS: (keyof AppConfig)[] = [
	'STEAM_API_KEY',
	'STEAM_ID',
	'YOUTUBE_API_KEY',
	'OPENCRITIC_API_KEY',
	'AI_BASE_URL',
	'AI_API_KEY',
	'AI_PROVIDER_NAME',
	'AI_CHAT_MODEL',
	'AI_EMBED_MODEL',
	'OLLAMA_URL',
	'OLLAMA_CHAT_MODEL',
	'OLLAMA_EMBED_MODEL',
	'HLTB_DAILY_BUDGET',
	'OPENCRITIC_DAILY_BUDGET',
];

/** Keys whose values must never be returned in plaintext via the API by default. */
export const SENSITIVE_KEYS: ReadonlySet<keyof AppConfig> = new Set([
	'STEAM_API_KEY',
	'OPENCRITIC_API_KEY',
	'YOUTUBE_API_KEY',
	'AI_API_KEY',
]);

const CACHE_TTL_MS = 5_000;
let cached: { value: AppConfig; ts: number } | null = null;

async function loadFromDb(): Promise<Record<string, string>> {
	try {
		const rows = (await raw`SELECT key, value FROM app_settings`) as Array<{
			key: string;
			value: string | null;
		}>;
		const out: Record<string, string> = {};
		for (const r of rows) {
			if (r.value) out[r.key] = r.value;
		}
		return out;
	} catch (e) {
		// DB might be down (or migration not applied) — degrade gracefully.
		console.warn('[config] DB read failed, falling back to env only:', e);
		return {};
	}
}

export async function getConfig(): Promise<AppConfig> {
	if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
		return cached.value;
	}
	const dbValues = await loadFromDb();
	const merged: AppConfig = {};
	for (const key of CONFIG_KEYS) {
		const fromEnv = process.env[key];
		const fromDb = dbValues[key];
		// Empty-string env is treated as unset so the .env.example default
		// (`STEAM_API_KEY=`) doesn't shadow a real DB value.
		const v = (fromEnv && fromEnv.length > 0 ? fromEnv : undefined) ?? fromDb;
		if (v !== undefined && v !== '') merged[key] = v;
	}
	cached = { value: merged, ts: Date.now() };
	return merged;
}

export function invalidateConfig(): void {
	cached = null;
}

/** Test-only: clear the cache between tests. */
export function __resetConfigForTests(): void {
	cached = null;
}
