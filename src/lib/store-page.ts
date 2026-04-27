/**
 * Scraper for the Steam store page HTML — the "More like this" carousel
 * (Steam's own per-game recommendation list).
 *
 * The carousel renders client-side from a JSON payload at:
 *   https://store.steampowered.com/recommended/morelike/app/<appid>
 * which returns HTML with embedded data-ds-appid attributes.
 */

import { parse } from 'node-html-parser';

export async function fetchSimilarAppids(appid: number): Promise<number[]> {
	const url = `https://store.steampowered.com/recommended/morelike/app/${appid}/`;
	const res = await fetch(url, {
		headers: {
			'User-Agent': 'steam-library-tool/0.1',
			'Accept-Language': 'en-US,en;q=0.9',
			Cookie: 'birthtime=568022401; mature_content=1; wants_mature_content=1',
		},
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) {
		throw new Error(`morelike failed: ${res.status}`);
	}
	const html = await res.text();
	const root = parse(html);

	const seen = new Set<number>();
	const out: number[] = [];
	for (const node of root.querySelectorAll('[data-ds-appid]')) {
		const raw = node.getAttribute('data-ds-appid') || '';
		// Steam sometimes packs multiple appids in one attr separated by commas
		for (const part of raw.split(/[,\s]+/)) {
			const n = Number.parseInt(part, 10);
			if (Number.isFinite(n) && n !== appid && !seen.has(n)) {
				seen.add(n);
				out.push(n);
			}
		}
	}
	return out;
}
