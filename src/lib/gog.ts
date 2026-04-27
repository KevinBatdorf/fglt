/**
 * GOG.com OAuth + library helpers.
 *
 * Uses the GOG Galaxy client credentials (publicly known — embedded in the
 * Galaxy desktop binary, used by every third-party GOG client). Refresh
 * tokens rotate on each use; we persist them to data/gog-tokens.json.
 *
 * Auth flow (first-time, interactive):
 *   1. Open `getAuthUrl()` in a browser
 *   2. Sign in to GOG; the page redirects to a localhost-ish URL containing
 *      `?code=<auth_code>` in the query string
 *   3. Run `bun run scripts/auth-gog.ts <code>` to exchange + persist tokens
 *
 * Subsequent runs: `loadTokens()` -> `refreshAccessToken()` -> API calls.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const CLIENT_ID = '46899977096215655';
const CLIENT_SECRET =
	'9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9';
const REDIRECT_URI = 'https://embed.gog.com/on_login_success?origin=client';
const AUTH_BASE = 'https://auth.gog.com';
const EMBED_BASE = 'https://embed.gog.com';

const TOKEN_PATH = 'data/gog-tokens.json';

export interface GogTokens {
	access_token: string;
	refresh_token: string;
	expires_at: number;
	user_id: string;
}

export interface GogProduct {
	id: number;
	title: string;
	url?: string;
	image?: string;
	worksOn?: { Windows?: boolean; Mac?: boolean; Linux?: boolean };
	category?: string;
	releaseDate?: string;
	dlcCount?: number;
	rating?: number;
}

export function getAuthUrl(): string {
	const url = new URL(`${AUTH_BASE}/auth`);
	url.searchParams.set('client_id', CLIENT_ID);
	url.searchParams.set('redirect_uri', REDIRECT_URI);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('layout', 'client2');
	return url.toString();
}

interface TokenResponse {
	access_token: string;
	refresh_token: string;
	expires_in: number;
	user_id: string;
}

async function postToken(params: URLSearchParams): Promise<TokenResponse> {
	const url = new URL(`${AUTH_BASE}/token`);
	for (const [k, v] of params) url.searchParams.set(k, v);
	const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
	if (!res.ok) {
		throw new Error(`GOG token endpoint failed: ${res.status} ${await res.text()}`);
	}
	return (await res.json()) as TokenResponse;
}

export async function exchangeCodeForTokens(code: string): Promise<GogTokens> {
	const data = await postToken(
		new URLSearchParams({
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			grant_type: 'authorization_code',
			code,
			redirect_uri: REDIRECT_URI,
		}),
	);
	const tokens: GogTokens = {
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: Date.now() + data.expires_in * 1000,
		user_id: data.user_id,
	};
	await saveTokens(tokens);
	return tokens;
}

async function refreshAccessToken(tokens: GogTokens): Promise<GogTokens> {
	const data = await postToken(
		new URLSearchParams({
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			grant_type: 'refresh_token',
			refresh_token: tokens.refresh_token,
		}),
	);
	const next: GogTokens = {
		access_token: data.access_token,
		refresh_token: data.refresh_token,
		expires_at: Date.now() + data.expires_in * 1000,
		user_id: data.user_id,
	};
	await saveTokens(next);
	return next;
}

export async function loadTokens(): Promise<GogTokens | null> {
	if (!existsSync(TOKEN_PATH)) return null;
	const raw = await readFile(TOKEN_PATH, 'utf8');
	return JSON.parse(raw) as GogTokens;
}

async function saveTokens(tokens: GogTokens): Promise<void> {
	await mkdir(dirname(TOKEN_PATH), { recursive: true });
	await writeFile(TOKEN_PATH, JSON.stringify(tokens, null, 2), 'utf8');
}

/** Get a valid access token, refreshing if needed. Throws if not yet authed. */
export async function getValidTokens(): Promise<GogTokens> {
	const existing = await loadTokens();
	if (!existing) {
		throw new Error(
			'GOG not authed yet. Run `bun run auth:gog` to get the auth URL, then `bun run auth:gog <code>` with the code.',
		);
	}
	if (Date.now() < existing.expires_at - 60_000) return existing;
	return await refreshAccessToken(existing);
}

/** Fetch a single page of owned products. */
async function fetchProductsPage(
	tokens: GogTokens,
	page: number,
): Promise<{ products: GogProduct[]; totalPages: number; totalProducts: number }> {
	const url = new URL(`${EMBED_BASE}/account/getFilteredProducts`);
	url.searchParams.set('mediaType', '1'); // games (vs. movies)
	url.searchParams.set('page', String(page));
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${tokens.access_token}` },
		signal: AbortSignal.timeout(20_000),
	});
	if (!res.ok) {
		throw new Error(`GOG library page ${page} failed: ${res.status}`);
	}
	const data = (await res.json()) as {
		totalProducts: number;
		totalPages: number;
		products: GogProduct[];
	};
	return data;
}

/** Pull every owned product across all pages. */
export async function fetchAllProducts(): Promise<GogProduct[]> {
	const tokens = await getValidTokens();
	const first = await fetchProductsPage(tokens, 1);
	const all = [...first.products];
	for (let p = 2; p <= first.totalPages; p++) {
		const page = await fetchProductsPage(tokens, p);
		all.push(...page.products);
	}
	return all;
}
