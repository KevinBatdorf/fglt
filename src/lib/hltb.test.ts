import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fetchCalls, installMockFetch, jsonResponse } from './_test/mockFetch';
import {
	__resetHLTBStateForTests,
	fetchHLTB,
	HLTBRateLimitError,
} from './hltb';

let restore: () => void = () => {};
afterEach(() => restore());

// HLTB caches auth across calls in module-level state. Most tests just
// need to call once, and the assertions look at the final outgoing
// /api/find request, so the auth caching doesn't matter — but we reset
// the fetch call log every time via installMockFetch.

const initBody = {
	token: 'tkn-abc',
	hpKey: 'ign_test',
	hpVal: 'val-xyz',
};

const findBody = {
	data: [
		{
			game_name: 'Cyberpunk 2077',
			comp_main: 26 * 3600,
			comp_plus: 60 * 3600,
			comp_100: 100 * 3600,
		},
	],
};

describe('fetchHLTB', () => {
	beforeEach(() => {
		fetchCalls.length = 0;
		// Reset module-level cache + rate-limit flag so each test sees a
		// clean state independently of run order.
		__resetHLTBStateForTests();
	});

	test('returns parsed hours from /api/find', async () => {
		restore = installMockFetch((url) => {
			if (url.includes('/api/find/init')) return jsonResponse(initBody);
			if (url.endsWith('/api/find')) return jsonResponse(findBody);
			return new Response('nope', { status: 404 });
		});
		const r = await fetchHLTB('Cyberpunk 2077');
		expect(r).not.toBeNull();
		expect(r?.main).toBe(26);
		expect(r?.extras).toBe(60);
		expect(r?.completionist).toBe(100);
	});

	test('embeds hpKey/hpVal honeypot in the body and headers on /api/find', async () => {
		restore = installMockFetch((url) => {
			if (url.includes('/api/find/init')) return jsonResponse(initBody);
			if (url.endsWith('/api/find')) return jsonResponse(findBody);
			return new Response('', { status: 404 });
		});
		await fetchHLTB('Cyberpunk 2077');
		const findCall = fetchCalls.find((c) => c.url.endsWith('/api/find'));
		expect(findCall).toBeDefined();
		// Headers
		expect(findCall?.headers['x-auth-token']).toBe('tkn-abc');
		expect(findCall?.headers['x-hp-key']).toBe('ign_test');
		expect(findCall?.headers['x-hp-val']).toBe('val-xyz');
		// Body honeypot — the hpKey value is embedded in the body too with
		// the dynamically-named field
		expect(findCall?.body).toContain('"ign_test":"val-xyz"');
	});

	test('Origin header uses the trailing-slash form HLTB requires', async () => {
		restore = installMockFetch((url) => {
			if (url.includes('/api/find/init')) return jsonResponse(initBody);
			if (url.endsWith('/api/find')) return jsonResponse(findBody);
			return new Response('', { status: 404 });
		});
		await fetchHLTB('Cyberpunk 2077');
		const findCall = fetchCalls.find((c) => c.url.endsWith('/api/find'));
		// Lowercase header key (fetch normalizes); must include the slash
		expect(
			findCall?.headers.origin ??
				findCall?.headers.Origin ??
				findCall?.headers.ORIGIN,
		).toBe('https://howlongtobeat.com/');
	});

	test('throws HLTBRateLimitError on 403 from init', async () => {
		restore = installMockFetch((url) => {
			if (url.includes('/api/find/init'))
				return new Response('', { status: 403 });
			return new Response('', { status: 404 });
		});
		expect(fetchHLTB('Anything')).rejects.toBeInstanceOf(HLTBRateLimitError);
	});

	test('throws HLTBRateLimitError on 429 from /api/find', async () => {
		restore = installMockFetch((url) => {
			if (url.includes('/api/find/init')) return jsonResponse(initBody);
			if (url.endsWith('/api/find')) return new Response('', { status: 429 });
			return new Response('', { status: 404 });
		});
		expect(fetchHLTB('Anything')).rejects.toBeInstanceOf(HLTBRateLimitError);
	});
});
