/**
 * HowLongToBeat unofficial search.
 *
 * No public API; HLTB's frontend POSTs to /api/seek/<token>. The token is
 * embedded in their JS bundle; we parse it lazily and cache it.
 *
 * Returns hours for: main story, main+extras, completionist.
 */

let cachedToken: { value: string; ts: number } | null = null;
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // 6h

const HEADERS = {
	'User-Agent':
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
		'(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
	Origin: 'https://howlongtobeat.com',
	Referer: 'https://howlongtobeat.com/',
	'Content-Type': 'application/json',
};

async function getSearchToken(): Promise<string> {
	if (cachedToken && Date.now() - cachedToken.ts < TOKEN_TTL_MS) {
		return cachedToken.value;
	}
	const home = await fetch('https://howlongtobeat.com/', {
		headers: HEADERS,
		signal: AbortSignal.timeout(20_000),
	});
	const html = await home.text();
	const scriptMatch = html.match(
		/\/_next\/static\/chunks\/pages\/_app-[^"]+\.js/,
	);
	if (!scriptMatch) throw new Error('hltb: app script not found');
	const scriptUrl = `https://howlongtobeat.com${scriptMatch[0]}`;
	const js = await (
		await fetch(scriptUrl, {
			headers: HEADERS,
			signal: AbortSignal.timeout(20_000),
		})
	).text();
	const tokenMatch = js.match(/"\/api\/seek\/"\.concat\("([a-f0-9]{16,})"\)/);
	const altMatch = js.match(/\/api\/seek\/([a-f0-9]{16,})/);
	const token = tokenMatch?.[1] ?? altMatch?.[1];
	if (!token) throw new Error('hltb: search token not found');
	cachedToken = { value: token, ts: Date.now() };
	return token;
}

export interface HLTBResult {
	main?: number;
	extras?: number;
	completionist?: number;
}

export async function fetchHLTB(name: string): Promise<HLTBResult | null> {
	const token = await getSearchToken();
	const body = {
		searchType: 'games',
		searchTerms: name.split(/\s+/).filter(Boolean),
		searchPage: 1,
		size: 5,
		searchOptions: {
			games: {
				userId: 0,
				platform: '',
				sortCategory: 'popular',
				rangeCategory: 'main',
				rangeTime: { min: null, max: null },
				gameplay: { perspective: '', flow: '', genre: '' },
				rangeYear: { min: '', max: '' },
				modifier: '',
			},
			users: { sortCategory: 'postcount' },
			lists: { sortCategory: 'follows' },
			filter: '',
			sort: 0,
			randomizer: 0,
		},
		useCache: true,
	};

	const res = await fetch(`https://howlongtobeat.com/api/seek/${token}`, {
		method: 'POST',
		headers: HEADERS,
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(30_000),
	});
	if (!res.ok) {
		// token may have rotated; clear cache so next call refetches
		cachedToken = null;
		throw new Error(`hltb seek failed: ${res.status}`);
	}
	const data: {
		data?: Array<{
			game_name?: string;
			comp_main?: number;
			comp_plus?: number;
			comp_100?: number;
		}>;
	} = await res.json();
	const first = data.data?.[0];
	if (!first) return null;

	// Fields are in seconds.
	const toHours = (s?: number) =>
		typeof s === 'number' && s > 0
			? Math.round((s / 3600) * 10) / 10
			: undefined;

	return {
		main: toHours(first.comp_main),
		extras: toHours(first.comp_plus),
		completionist: toHours(first.comp_100),
	};
}
