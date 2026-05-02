import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fetchCalls, installMockFetch, jsonResponse } from './_test/mockFetch';
import { fetchSteamReviews } from './steam-reviews';

let restore: () => void = () => {};
afterEach(() => restore());
beforeEach(() => {
	fetchCalls.length = 0;
});

describe('fetchSteamReviews', () => {
	test('parses summary and individual reviews', async () => {
		restore = installMockFetch(() =>
			jsonResponse({
				success: 1,
				query_summary: {
					total_reviews: 12345,
					total_positive: 9876,
					review_score_desc: 'Very Positive',
				},
				reviews: [
					{
						recommendationid: '12345',
						author: { steamid: '76561198000000001', playtime_at_review: 1200 },
						language: 'english',
						review: 'Great game.',
						timestamp_created: 1700000000,
						timestamp_updated: 1700000000,
						voted_up: true,
						votes_up: 25,
						votes_funny: 3,
						weighted_vote_score: '0.75',
					},
				],
			}),
		);
		const r = await fetchSteamReviews(1091500);
		expect(r.summary?.num_reviews_total).toBe(12345);
		expect(r.summary?.num_reviews_positive).toBe(9876);
		expect(r.summary?.review_score_desc).toBe('Very Positive');
		expect(r.reviews.length).toBe(1);
		const first = r.reviews[0];
		expect(first.recommendation_id).toBe(12345);
		expect(first.voted_up).toBe(true);
		expect(first.votes_up).toBe(25);
		expect(first.weighted_vote_score).toBe(0.75);
		expect(first.playtime_at_review_min).toBe(1200);
		expect(first.review_text).toBe('Great game.');
		expect(first.timestamp_created).toBeInstanceOf(Date);
	});

	test('returns empty result when Steam reports success != 1', async () => {
		restore = installMockFetch(() => jsonResponse({ success: 2 }));
		const r = await fetchSteamReviews(999);
		expect(r.summary).toBeNull();
		expect(r.reviews).toEqual([]);
	});

	test('throws on non-2xx HTTP status', async () => {
		restore = installMockFetch(() => new Response('', { status: 500 }));
		expect(fetchSteamReviews(1)).rejects.toThrow(/HTTP 500/);
	});
});
