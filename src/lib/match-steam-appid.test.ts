import { afterEach, describe, expect, test } from 'bun:test';
import { installMockFetch, jsonResponse } from './_test/mockFetch';
import { matchSteamAppid, normalize } from './match-steam-appid';

let restore: () => void = () => {};
afterEach(() => restore());

describe('normalize', () => {
	test.each([
		['The Witcher 3: Wild Hunt', 'witcher 3 wild hunt'],
		['HALF-LIFE™', 'half life'],
		['  A   Hat   In   Time  ', 'hat in time'],
		// "the" / "a" / "an" stripped, punctuation collapsed
		['DOOM (2016)', 'doom 2016'],
	])('normalizes %p → %p', (input, expected) => {
		expect(normalize(input)).toBe(expected);
	});
});

describe('matchSteamAppid', () => {
	test('returns the appid when Steam returns a strong-match candidate', async () => {
		restore = installMockFetch(() =>
			jsonResponse({
				items: [
					{ id: 292030, name: 'The Witcher 3: Wild Hunt' },
					{ id: 12345, name: 'Witcher Adventure Game' },
				],
			}),
		);
		const r = await matchSteamAppid('The Witcher 3: Wild Hunt');
		expect(r.appid).toBe(292030);
		expect(r.confidence).toBeGreaterThanOrEqual(0.85);
	});

	test('returns null appid when nothing crosses the 0.85 threshold', async () => {
		restore = installMockFetch(() =>
			jsonResponse({
				items: [
					{ id: 1, name: 'Unrelated Title' },
					{ id: 2, name: 'Something Else' },
				],
			}),
		);
		const r = await matchSteamAppid('The Witcher 3: Wild Hunt');
		expect(r.appid).toBeNull();
		expect(r.confidence).toBeLessThan(0.85);
		// Still surfaces top candidates for diagnostic logging
		expect(r.candidates.length).toBeGreaterThan(0);
	});

	test('returns null appid + zero confidence when Steam returns no items', async () => {
		restore = installMockFetch(() => jsonResponse({ items: [] }));
		const r = await matchSteamAppid('Some Title');
		expect(r.appid).toBeNull();
		expect(r.confidence).toBe(0);
	});
});
