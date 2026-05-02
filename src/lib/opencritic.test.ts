import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fetchCalls, installMockFetch, jsonResponse } from './_test/mockFetch';

// Set the API key BEFORE importing the lib so isOpenCriticEnabled() picks it up.
process.env.OPENCRITIC_API_KEY = 'test-key';
const {
	__resetOpenCriticStateForTests,
	fetchOpenCriticScore,
	OpenCriticRateLimitError,
} = await import('./opencritic');
const { __resetConfigForTests } = await import('./config');

let restore: () => void = () => {};
afterEach(() => restore());
beforeEach(() => {
	fetchCalls.length = 0;
	__resetOpenCriticStateForTests();
	__resetConfigForTests();
});

const searchHits = [
	{ id: 8525, name: 'Cyberpunk 2077', dist: 0 },
	{ id: 9999, name: 'Cybernetic Junk', dist: 0.8 },
];

const gameBody = {
	id: 8525,
	name: 'Cyberpunk 2077',
	medianScore: 80,
	topCriticScore: 76.1,
	percentRecommended: 65.7,
	numReviews: 226,
	tier: 'Strong',
	tierData: { name: 'Strong' },
	url: 'https://opencritic.com/game/8525/cyberpunk-2077',
};

describe('fetchOpenCriticScore', () => {
	test('returns parsed score when search matches with low dist', async () => {
		restore = installMockFetch((url) => {
			if (url.includes('/game/search')) return jsonResponse(searchHits);
			if (url.endsWith('/game/8525')) return jsonResponse(gameBody);
			return new Response('', { status: 404 });
		});
		const r = await fetchOpenCriticScore(1091500, 'Cyberpunk 2077');
		expect(r).not.toBeNull();
		expect(r?.score).toBe(80);
		expect(r?.tier).toBe('Strong');
		expect(r?.percent_recommended).toBe(65.7);
		expect(r?.opencritic_id).toBe(8525);
	});

	test('falls back to topCriticScore when medianScore is missing', async () => {
		restore = installMockFetch((url) => {
			if (url.includes('/game/search')) return jsonResponse(searchHits);
			if (url.endsWith('/game/8525'))
				return jsonResponse({ ...gameBody, medianScore: undefined });
			return new Response('', { status: 404 });
		});
		const r = await fetchOpenCriticScore(1, 'Cyberpunk 2077');
		expect(r?.score).toBe(76.1);
	});

	test('returns null when best search hit is too distant', async () => {
		restore = installMockFetch((url) => {
			if (url.includes('/game/search'))
				return jsonResponse([{ id: 1, name: 'Unrelated', dist: 0.7 }]);
			return new Response('', { status: 404 });
		});
		const r = await fetchOpenCriticScore(1, 'Anything');
		expect(r).toBeNull();
	});

	test('sends RapidAPI auth headers', async () => {
		restore = installMockFetch((url) => {
			if (url.includes('/game/search')) return jsonResponse(searchHits);
			if (url.endsWith('/game/8525')) return jsonResponse(gameBody);
			return new Response('', { status: 404 });
		});
		await fetchOpenCriticScore(1, 'Cyberpunk 2077');
		const searchCall = fetchCalls.find((c) => c.url.includes('/game/search'));
		expect(searchCall?.headers['x-rapidapi-key']).toBe('test-key');
		expect(searchCall?.headers['x-rapidapi-host']).toBe(
			'opencritic-api.p.rapidapi.com',
		);
	});

	test('throws OpenCriticRateLimitError on 429 + trips process flag', async () => {
		restore = installMockFetch(() => new Response('', { status: 429 }));
		expect(fetchOpenCriticScore(1, 'X')).rejects.toBeInstanceOf(
			OpenCriticRateLimitError,
		);
	});
});
