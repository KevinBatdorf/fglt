import { useEffect, useState } from "react";
import { GameImage } from "./GameImage";
import { type CurateResponse, type LibraryGame, api } from "./lib/api";
import type { InstalledIndex } from "../shared/types";

interface Props {
	installed: InstalledIndex | null;
	onSelectGame: (appid: number) => void;
	onPickVibe: (query: string) => void;
}

export function Home({ installed, onSelectGame }: Props) {
	const [data, setData] = useState<CurateResponse | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const ctrl = new AbortController();
		api
			.curate(ctrl.signal)
			.then(setData)
			.catch((e) => {
				if (e.name !== "AbortError") setError(e.message);
			});
		return () => ctrl.abort();
	}, []);

	if (error)
		return (
			<div className="p-6 text-red-400 text-sm">Curation failed: {error}</div>
		);

	if (!data)
		return (
			<div className="p-6 text-zinc-500 text-sm animate-pulse">
				Curating your library…
			</div>
		);

	return (
		<div className="space-y-10 pb-12">
			{data.game_of_the_day && (
				<HeroPick
					game={data.game_of_the_day}
					onSelect={() => onSelectGame(data.game_of_the_day!.appid)}
				/>
			)}

			{data.continue_playing.length > 0 && (
				<Section
					title="Continue playing"
					subtitle="Recent activity in your library"
					games={data.continue_playing}
					installed={installed}
					onSelect={onSelectGame}
				/>
			)}

			{data.because_recently && data.because_recently.recs.length > 0 && (
				<Section
					title={`Because you've been playing ${data.because_recently.seed.name}`}
					subtitle="Vector-similar games you also own"
					games={data.because_recently.recs}
					installed={installed}
					onSelect={onSelectGame}
				/>
			)}

			{data.because_obsession && data.because_obsession.recs.length > 0 && (
				<Section
					title={`Because you've put hours into ${data.because_obsession.seed.name}`}
					subtitle="Deep-cut similars across your collection"
					games={data.because_obsession.recs}
					installed={installed}
					onSelect={onSelectGame}
				/>
			)}

			{data.picks_tonight.length > 0 && (
				<Section
					title="Picks for tonight"
					subtitle="Random unplayed games — refresh the page for a new draw"
					games={data.picks_tonight}
					installed={installed}
					onSelect={onSelectGame}
				/>
			)}

			{data.quick_wins.length > 0 && (
				<Section
					title="Quick wins"
					subtitle="Unplayed and beatable in under 5 hours"
					games={data.quick_wins}
					installed={installed}
					onSelect={onSelectGame}
				/>
			)}

			{data.hidden_gems.length > 0 && (
				<Section
					title="Hidden gems"
					subtitle="≥90% positive · fewer than 5,000 reviews · unplayed"
					games={data.hidden_gems}
					installed={installed}
					onSelect={onSelectGame}
				/>
			)}

			{data.trending.length > 0 && (
				<Section
					title="Trending in your library"
					subtitle="Sorted by peak concurrent users"
					games={data.trending}
					installed={installed}
					onSelect={onSelectGame}
				/>
			)}
		</div>
	);
}

function HeroPick({
	game,
	onSelect,
}: {
	game: LibraryGame;
	onSelect: () => void;
}) {
	const positivePct =
		game.positive && game.negative !== null
			? Math.round((game.positive / (game.positive + (game.negative ?? 0))) * 100)
			: null;
	const releaseYear =
		game.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
	const topGenres = game.genres?.slice(0, 3).join(" / ") ?? "";
	return (
		<section className="relative overflow-hidden rounded-xl border border-zinc-800">
			<div className="absolute inset-0">
				<GameImage
					appid={game.appid}
					name=""
					alt=""
					variant="library_hero"
					fallback={game.header_image}
					className="w-full h-full object-cover opacity-50"
				/>
				<div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/80 to-zinc-950/30" />
			</div>
			<div className="relative px-8 py-10 lg:py-14 max-w-3xl">
				<div className="text-[10px] uppercase tracking-[0.2em] text-emerald-400 font-bold mb-3">
					Game of the day
				</div>
				<h2 className="text-3xl lg:text-4xl font-bold mb-3 leading-tight">
					{game.name}
				</h2>
				{game.short_desc && (
					<p className="text-sm text-zinc-300 mb-5 line-clamp-3 max-w-xl">
						{game.short_desc}
					</p>
				)}
				<div className="flex flex-wrap items-center gap-3 text-xs text-zinc-300 mb-5 tabular-nums">
					{releaseYear && <span>{releaseYear}</span>}
					{topGenres && <span>{topGenres}</span>}
					{game.platforms.map((p) => (
						<span
							key={p}
							className="px-2 py-0.5 rounded bg-zinc-900/80 border border-zinc-800 uppercase tracking-wide text-[10px]"
						>
							{p}
						</span>
					))}
					{game.hltb_main !== null && <span>{game.hltb_main}h main</span>}
					{positivePct !== null && <span>{positivePct}% positive</span>}
					{game.metacritic !== null && <span>MC {game.metacritic}</span>}
				</div>
				<button
					type="button"
					onClick={onSelect}
					className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm transition-colors"
				>
					View details →
				</button>
			</div>
		</section>
	);
}

function Section({
	title,
	subtitle,
	games,
	installed,
	onSelect,
}: {
	title: string;
	subtitle?: string;
	games: LibraryGame[];
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
}) {
	return (
		<section>
			<SectionHeader title={title} subtitle={subtitle} />
			<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
				{games.slice(0, 6).map((g) => (
					<TileCard
						key={g.appid}
						game={g}
						installed={installed}
						onSelect={() => onSelect(g.appid)}
					/>
				))}
			</div>
		</section>
	);
}

function SectionHeader({
	title,
	subtitle,
}: {
	title: string;
	subtitle?: string;
}) {
	return (
		<div className="mb-3">
			<h2 className="text-lg font-semibold text-zinc-100">{title}</h2>
			{subtitle && (
				<p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>
			)}
		</div>
	);
}

function TileCard({
	game,
	installed,
	onSelect,
}: {
	game: LibraryGame;
	installed: InstalledIndex | null;
	onSelect: () => void;
}) {
	const isInstalled =
		installed !== null && installed.steam.includes(game.appid);
	const positivePct =
		game.positive && game.negative !== null
			? Math.round((game.positive / (game.positive + (game.negative ?? 0))) * 100)
			: null;
	const releaseYear =
		game.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
	return (
		<button
			type="button"
			onClick={onSelect}
			className="group text-left rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-700 bg-zinc-900 transition-all"
		>
			<div className="relative">
				<GameImage
					appid={game.appid}
					name={game.name}
					variant="library_capsule"
					fallback={game.header_image}
					className="w-full aspect-[2/3] object-cover bg-zinc-900 group-hover:scale-[1.02] transition-transform"
				/>
				{isInstalled && (
					<span className="absolute top-2 left-2 text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-600 text-white shadow">
						Installed
					</span>
				)}
				{releaseYear && (
					<span className="absolute top-2 right-2 text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-zinc-950/80 border border-zinc-800 text-zinc-300">
						{releaseYear}
					</span>
				)}
			</div>
			<div className="p-2.5">
				<div className="text-xs font-medium text-zinc-100 line-clamp-2 leading-tight min-h-[2.25rem]">
					{game.name}
				</div>
				<div className="mt-1.5 flex items-center gap-2 text-[10px] text-zinc-500 tabular-nums flex-wrap">
					{game.hltb_main !== null && <span>{game.hltb_main}h main</span>}
					{positivePct !== null && <span>{positivePct}% positive</span>}
					{game.playtime_min > 0 && (
						<span>{Math.round(game.playtime_min / 60)}h played</span>
					)}
				</div>
			</div>
		</button>
	);
}
