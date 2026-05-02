import { useEffect, useState } from 'react';
import type { InstalledIndex } from '../shared/types';
import { GameGrid } from './GameGrid';
import { LoadingState } from './LoadingState';
import { api, type CurateResponse, type LibraryGame } from './lib/api';

interface Props {
	what: 'trending' | 'random' | 'recommended';
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
}

const COPY: Record<Props['what'], { title: string; subtitle: string }> = {
	trending: {
		title: 'Trending in your library',
		subtitle:
			'Games you own, sorted by Steam peak-concurrent-player count (snapshot from when each game was enriched — coarse cultural-heat proxy, not real-time)',
	},
	random: {
		title: 'Random picks',
		subtitle: 'A fresh draw from your unplayed pile',
	},
	recommended: {
		title: 'Recommended for you',
		subtitle: 'Vector-similar to your most-played games',
	},
};

export function Discover({ what, installed, onSelect }: Props) {
	const [data, setData] = useState<CurateResponse | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reroll, setReroll] = useState(0);

	useEffect(() => {
		const ctrl = new AbortController();
		setData(null);
		api
			.curate(ctrl.signal)
			.then(setData)
			.catch((e) => {
				if (e.name !== 'AbortError') setError(e.message);
			});
		return () => ctrl.abort();
	}, [reroll, what]);

	const games = pick(data, what);

	return (
		<div>
			<header className="mb-4 flex items-end justify-between gap-3 flex-wrap">
				<div>
					<h1 className="text-lg font-semibold">{COPY[what].title}</h1>
					<p className="text-xs text-zinc-500 mt-0.5">{COPY[what].subtitle}</p>
				</div>
				{what === 'random' && data && (
					<button
						type="button"
						onClick={() => setReroll((n) => n + 1)}
						className="text-xs px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-zinc-300"
					>
						Re-roll →
					</button>
				)}
			</header>

			{error && <div className="text-red-400 text-sm">{error}</div>}
			{!data && !error && <LoadingState />}
			{data && games.length === 0 && (
				<div className="text-zinc-500 text-sm">Nothing to show yet.</div>
			)}
			{data && games.length > 0 && (
				<GameGrid
					games={games}
					installed={installed}
					onSelect={onSelect}
					showMatchPct={false}
				/>
			)}
		</div>
	);
}

function pick(data: CurateResponse | null, what: Props['what']): LibraryGame[] {
	if (!data) return [];
	if (what === 'trending') return data.trending;
	if (what === 'random') return data.picks_tonight;
	// recommended — blend obsession + recently + hidden_gems, dedup by appid
	const merged = [
		...(data.because_obsession?.recs ?? []),
		...(data.because_recently?.recs ?? []),
		...data.hidden_gems,
	];
	const seen = new Set<number>();
	const out: LibraryGame[] = [];
	for (const g of merged) {
		if (seen.has(g.appid)) continue;
		seen.add(g.appid);
		out.push(g);
	}
	return out;
}

