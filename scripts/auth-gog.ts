/**
 * One-time GOG OAuth helper.
 *
 *   bun run auth:gog              # prints the auth URL
 *   bun run auth:gog <code>       # exchanges the code for tokens
 *
 * The auth URL redirects to a GOG-hosted page after sign-in; the URL bar
 * will contain `?code=<auth_code>` — paste that code as the argument.
 */
import { exchangeCodeForTokens, getAuthUrl, loadTokens } from '../src/lib/gog';

const code = process.argv[2];

if (!code) {
	const existing = await loadTokens();
	if (existing) {
		console.log(`[auth-gog] already authed as user_id=${existing.user_id}`);
		console.log(`[auth-gog] tokens at data/gog-tokens.json`);
		console.log(
			'[auth-gog] re-auth by visiting the URL below and re-running with the code:',
		);
	} else {
		console.log('[auth-gog] not authed yet. Open this URL, sign in, then look at');
		console.log('[auth-gog] the redirected URL — copy the `code` query param:');
	}
	console.log('');
	console.log(getAuthUrl());
	console.log('');
	console.log('Then run: bun run auth:gog <code>');
	process.exit(0);
}

const tokens = await exchangeCodeForTokens(code);
console.log(`[auth-gog] success — user_id=${tokens.user_id}`);
console.log('[auth-gog] tokens saved to data/gog-tokens.json');
console.log('[auth-gog] now run `bun run sync:gog`');
