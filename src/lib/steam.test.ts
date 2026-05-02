import { afterEach, describe, expect, test } from 'bun:test';
import {
	fetchCalls,
	installMockFetch,
	jsonResponse,
} from './_test/mockFetch';
import { fetchAppDetails, stripHtml } from './steam';

let restore: () => void = () => {};
afterEach(() => restore());

describe('stripHtml', () => {
	test('removes tags + decodes common entities', () => {
		expect(stripHtml('<p>Hello&nbsp;<b>world</b>!</p>')).toBe('Hello world!');
	});

	test('preserves line breaks across <br>', () => {
		expect(stripHtml('one<br>two<br />three')).toBe('one\ntwo\nthree');
	});

	test('passes undefined through unchanged', () => {
		expect(stripHtml(undefined)).toBeUndefined();
	});
});

describe('fetchAppDetails', () => {
	test('returns parsed AppDetails when Steam reports success', async () => {
		restore = installMockFetch(() =>
			jsonResponse({
				'1091500': {
					success: true,
					data: {
						type: 'game',
						name: 'Cyberpunk 2077',
						short_description: 'An open-world RPG.',
						developers: ['CD PROJEKT RED'],
						publishers: ['CD PROJEKT RED'],
						platforms: { windows: true, mac: false, linux: false },
						genres: [{ id: '3', description: 'RPG' }],
						categories: [{ id: 2, description: 'Single-player' }],
						release_date: { coming_soon: false, date: 'Dec 9, 2020' },
						metacritic: { score: 86, url: 'https://metacritic.com/x' },
						screenshots: [
							{
								id: 1,
								path_thumbnail: 'thumb.jpg',
								path_full: 'full.jpg',
							},
						],
					},
				},
			}),
		);
		const d = await fetchAppDetails(1091500);
		expect(d).not.toBeNull();
		expect(d?.name).toBe('Cyberpunk 2077');
		expect(d?.metacritic?.score).toBe(86);
		expect(d?.platforms?.windows).toBe(true);
		expect(d?.screenshots?.[0]?.path_full).toBe('full.jpg');
		// Verify the URL we hit
		expect(fetchCalls[0].url).toContain('store.steampowered.com/api/appdetails');
		expect(fetchCalls[0].url).toContain('appids=1091500');
	});

	test('returns null when Steam reports success: false', async () => {
		restore = installMockFetch(() =>
			jsonResponse({ '999999999': { success: false } }),
		);
		const d = await fetchAppDetails(999999999);
		expect(d).toBeNull();
	});

	test('throws on 429 rate limit', async () => {
		restore = installMockFetch(() => new Response('', { status: 429 }));
		expect(fetchAppDetails(1)).rejects.toThrow(/rate-limited/);
	});
});
