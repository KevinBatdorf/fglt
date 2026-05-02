import { afterEach, describe, expect, test } from 'bun:test';
import { installMockFetch, jsonResponse } from './_test/mockFetch';
import { fetchSteamSpy } from './steamspy';

let restore: () => void = () => {};
afterEach(() => restore());

describe('fetchSteamSpy', () => {
	test('returns full record for a known appid', async () => {
		restore = installMockFetch(() =>
			jsonResponse({
				appid: 1091500,
				name: 'Cyberpunk 2077',
				developer: 'CD PROJEKT RED',
				publisher: 'CD PROJEKT RED',
				positive: 713071,
				negative: 131850,
				owners: '20,000,000 .. 50,000,000',
				average_forever: 0,
				ccu: 22000,
				tags: { 'Open World': 1500, RPG: 1100 },
			}),
		);
		const d = await fetchSteamSpy(1091500);
		expect(d).not.toBeNull();
		expect(d?.name).toBe('Cyberpunk 2077');
		expect(d?.positive).toBe(713071);
		expect(d?.tags?.['Open World']).toBe(1500);
	});

	test('returns null for an unknown app (empty body)', async () => {
		restore = installMockFetch(() => jsonResponse({}));
		const d = await fetchSteamSpy(0);
		expect(d).toBeNull();
	});

	test('throws on non-2xx', async () => {
		restore = installMockFetch(() => new Response('', { status: 503 }));
		expect(fetchSteamSpy(1)).rejects.toThrow(/steamspy failed: 503/);
	});
});
