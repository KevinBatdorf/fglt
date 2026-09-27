import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fetchCalls, installMockFetch, jsonResponse } from './_test/mockFetch';
import {
	__resetHLTBStateForTests,
	fetchHLTB,
	HLTBRateLimitError,
} from './hltb';

let restore: () => void = () => {};
afterEach(() => restore());

const INIT = '/api/search/site/init';
const SEARCH = '/api/search/site';

const initBody = { token: 'tkn-abc' };

const searchBody = {
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

	test('returns parsed hours from /api/search/site', async () => {
		restore = installMockFetch((url) => {
			if (url.includes(INIT)) return jsonResponse(initBody);
			if (url.endsWith(SEARCH)) return jsonResponse(searchBody);
			return new Response('nope', { status: 404 });
		});
		const r = await fetchHLTB('Cyberpunk 2077');
		expect(r).not.toBeNull();
		expect(r?.main).toBe(26);
		expect(r?.extras).toBe(60);
		expect(r?.completionist).toBe(100);
	});

	test('sends the init token as x-auth-token', async () => {
		restore = installMockFetch((url) => {
			if (url.includes(INIT)) return jsonResponse(initBody);
			if (url.endsWith(SEARCH)) return jsonResponse(searchBody);
			return new Response('', { status: 404 });
		});
		await fetchHLTB('Cyberpunk 2077');
		const call = fetchCalls.find((c) => c.url.endsWith(SEARCH));
		expect(call?.headers['x-auth-token']).toBe('tkn-abc');
		expect(call?.body).toContain('"searchTerms":["Cyberpunk","2077"]');
	});

	test('re-inits and retries once when search returns 403', async () => {
		let inits = 0;
		let searches = 0;
		restore = installMockFetch((url) => {
			if (url.includes(INIT)) {
				inits++;
				return jsonResponse({ token: `tkn-${inits}` });
			}
			if (url.endsWith(SEARCH)) {
				searches++;
				return searches === 1
					? new Response('', { status: 403 })
					: jsonResponse(searchBody);
			}
			return new Response('', { status: 404 });
		});
		const r = await fetchHLTB('Cyberpunk 2077');
		expect(r?.main).toBe(26);
		expect(inits).toBe(2);
		const last = fetchCalls.filter((c) => c.url.endsWith(SEARCH)).at(-1);
		expect(last?.headers['x-auth-token']).toBe('tkn-2');
	});

	test('throws HLTBRateLimitError on 403 from init', async () => {
		restore = installMockFetch((url) => {
			if (url.includes(INIT)) return new Response('', { status: 403 });
			return new Response('', { status: 404 });
		});
		expect(fetchHLTB('Anything')).rejects.toBeInstanceOf(HLTBRateLimitError);
	});

	test('throws HLTBRateLimitError on 429 from search', async () => {
		restore = installMockFetch((url) => {
			if (url.includes(INIT)) return jsonResponse(initBody);
			if (url.endsWith(SEARCH)) return new Response('', { status: 429 });
			return new Response('', { status: 404 });
		});
		expect(fetchHLTB('Anything')).rejects.toBeInstanceOf(HLTBRateLimitError);
	});
});
