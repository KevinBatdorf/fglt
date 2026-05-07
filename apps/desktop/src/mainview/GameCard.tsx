import type { InstalledIndex } from '../shared/types';
import { GameImage } from './GameImage';
import type { LibraryGame } from './lib/api';

interface Props {
	game: LibraryGame;
	installed: InstalledIndex | null;
	onSelect: () => void;
	/** Set to false to suppress the relevance/match badge (e.g. on Home cards). */
	showMatchPct?: boolean;
	/** Optional right-click handler. GameGrid wires this when a context menu is provided. */
	onContextMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

/**
 * All metadata sits on top of the cover with a vertical gradient backdrop.
 * Image-only cards look uniform regardless of title length, and the meta
 * row stays out of the way until the user actually wants to read it.
 */
export function GameCard({
	game,
	installed,
	onSelect,
	showMatchPct = true,
	onContextMenu,
}: Props) {
	const isInstalledHere = installed?.steam.includes(game.appid) ?? false;
	const positivePct =
		game.positive && game.negative !== null
			? Math.round(
					(game.positive / (game.positive + (game.negative ?? 0))) * 100,
				)
			: null;
	const releaseYear = game.release_date?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
	const matchPct =
		showMatchPct && game.score !== undefined && game.score !== null
			? Math.round(game.score * 100)
			: null;
	// LibraryGame doesn't carry community tags (those only come with the
	// detail response), so detect VR via Steam's `categories` array which
	// is already returned by /library. "VR Only", "VR Supported", "Tracked
	// Motion Controllers", etc. all flag a VR title.
	const isVR =
		game.categories?.some((c) => /\bVR\b/i.test(c)) ?? false;
	const metaParts: string[] = [];
	if (game.hltb_main !== null) metaParts.push(`${game.hltb_main}h main`);
	if (positivePct !== null) metaParts.push(`${positivePct}% positive`);
	if (game.playtime_min > 0)
		metaParts.push(`${Math.round(game.playtime_min / 60)}h played`);

	return (
		<button
			type="button"
			onClick={onSelect}
			onContextMenu={onContextMenu}
			className="group relative text-left rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-700 bg-zinc-900 transition-all"
		>
			<GameImage
				appid={game.appid}
				name={game.name}
				variant="library_capsule"
				fallback={game.header_image}
				className="w-full aspect-[2/3] object-cover bg-zinc-900 group-hover:scale-[1.02] transition-transform"
			/>
			{isInstalledHere && (
				<span className="absolute top-2 left-2 text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-emerald-600 text-white shadow">
					Installed
				</span>
			)}
			<div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
				{matchPct !== null ? (
					<span
						className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-emerald-700/90 border border-emerald-600 text-white font-medium"
						title="Hybrid keyword + semantic-vector relevance score"
					>
						{matchPct}% match
					</span>
				) : releaseYear ? (
					<span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded bg-zinc-950/80 border border-zinc-800 text-zinc-300">
						{releaseYear}
					</span>
				) : null}
				{isVR && (
					<span
						className="text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded bg-violet-700/85 border border-violet-500/50 text-violet-50 uppercase"
						title="VR-supported title"
					>
						VR
					</span>
				)}
			</div>
			<div className="absolute inset-x-0 bottom-0 pt-12 pb-2 px-2.5 bg-gradient-to-t from-zinc-950/95 via-zinc-950/75 to-transparent pointer-events-none">
				<div className="text-xs font-medium text-zinc-50 line-clamp-3 leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
					{game.name}
				</div>
				{metaParts.length > 0 && (
					<div className="mt-1 flex items-center gap-2 text-[10px] text-zinc-300 tabular-nums flex-wrap drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
						{metaParts.map((p) => (
							<span key={p}>{p}</span>
						))}
					</div>
				)}
			</div>
		</button>
	);
}
