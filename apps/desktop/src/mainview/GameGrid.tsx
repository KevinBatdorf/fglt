import { useEffect, useRef, useState } from 'react';
import type { InstalledIndex } from '../shared/types';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { GameCard } from './GameCard';
import type { LibraryGame } from './lib/api';
import { getCardsPerRow } from './lib/prefs';

/**
 * Below this card width, drop a column. Picked so a card always has
 * enough room for the header image + title + tag chips without
 * truncating illegibly.
 */
const MIN_CARD_WIDTH_PX = 160;

interface Props {
	games: LibraryGame[];
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
	showMatchPct?: boolean;
	/** If set, cap items at this many rows × the cards-per-row pref. */
	maxRows?: number;
	/**
	 * If provided, right-clicking a card opens a context menu populated
	 * with the returned items. The grid manages a single shared menu —
	 * don't render N menus from caller code.
	 */
	cardContextMenu?: (game: LibraryGame) => MenuItem[];
}

/**
 * Cards-per-row is a user pref but the grid drops columns when the
 * window narrows below a per-card minimum — so resizing the window
 * actually reflows instead of squishing cards into illegible
 * thumbnails. Pref acts as the MAX (preferred) count; actual count is
 * `min(pref, floor(containerWidth / MIN_CARD_WIDTH))`.
 *
 * ResizeObserver tracks the grid container so this updates live.
 * Listens for the pref-change event too, so editing the slider in
 * Settings reflows without a remount.
 */
export function GameGrid({
	games,
	installed,
	onSelect,
	showMatchPct = true,
	maxRows,
	cardContextMenu,
}: Props) {
	const [prefPerRow, setPrefPerRow] = useState(getCardsPerRow);
	const [containerWidth, setContainerWidth] = useState(0);
	const containerRef = useRef<HTMLDivElement>(null);
	const [menu, setMenu] = useState<{
		x: number;
		y: number;
		items: MenuItem[];
	} | null>(null);

	useEffect(() => {
		const handler = () => setPrefPerRow(getCardsPerRow());
		window.addEventListener('fglt:prefs:cards-per-row', handler);
		return () => window.removeEventListener('fglt:prefs:cards-per-row', handler);
	}, []);

	useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const ro = new ResizeObserver((entries) => {
			for (const e of entries) setContainerWidth(e.contentRect.width);
		});
		ro.observe(el);
		// Seed immediately so the first render isn't a 1-column flash.
		setContainerWidth(el.getBoundingClientRect().width);
		return () => ro.disconnect();
	}, []);

	// Width-based cap. We approximate the gap as 12px (Tailwind gap-3) so
	// the math is `(width + gap) / (minCardWidth + gap)`. Floor clamped
	// to at least 1 column so tiny windows still render something.
	const widthCap =
		containerWidth > 0
			? Math.max(
					1,
					Math.floor((containerWidth + 12) / (MIN_CARD_WIDTH_PX + 12)),
				)
			: prefPerRow;
	const perRow = Math.min(prefPerRow, widthCap);
	const visible = maxRows ? games.slice(0, perRow * maxRows) : games;

	return (
		<>
			<div
				ref={containerRef}
				className="grid gap-3"
				style={{ gridTemplateColumns: `repeat(${perRow}, minmax(0, 1fr))` }}
			>
				{visible.map((g) => (
					<GameCard
						key={g.appid}
						game={g}
						installed={installed}
						onSelect={() => onSelect(g.appid)}
						showMatchPct={showMatchPct}
						onContextMenu={
							cardContextMenu
								? (e) => {
										e.preventDefault();
										e.stopPropagation();
										const items = cardContextMenu(g);
										if (items.length === 0) return;
										setMenu({ x: e.clientX, y: e.clientY, items });
									}
								: undefined
						}
					/>
				))}
			</div>
			{menu && (
				<ContextMenu
					x={menu.x}
					y={menu.y}
					items={menu.items}
					onClose={() => setMenu(null)}
				/>
			)}
		</>
	);
}
