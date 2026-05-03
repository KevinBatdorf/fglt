import { useEffect, useState } from 'react';
import type { InstalledIndex } from '../shared/types';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { GameCard } from './GameCard';
import type { LibraryGame } from './lib/api';
import { getCardMinWidth } from './lib/prefs';

interface Props {
	games: LibraryGame[];
	installed: InstalledIndex | null;
	onSelect: (appid: number) => void;
	showMatchPct?: boolean;
	/** If set, cap items at this many rows × the auto-fit column count. */
	maxRows?: number;
	/**
	 * If provided, right-clicking a card opens a context menu populated
	 * with the returned items. The grid manages a single shared menu —
	 * don't render N menus from caller code.
	 */
	cardContextMenu?: (game: LibraryGame) => MenuItem[];
}

/**
 * Card size is the user-controlled pref (the "Card size" slider in
 * Settings). The grid uses CSS `repeat(auto-fill, minmax(N, 1fr))` —
 * it picks as many columns as fit, each at least N px, and stretches
 * to fill the row. Resize the window and columns drop/grow smoothly
 * with no JS measurement.
 *
 * Listens for the pref-change event so editing the slider reflows
 * without a remount.
 */
export function GameGrid({
	games,
	installed,
	onSelect,
	showMatchPct = true,
	maxRows,
	cardContextMenu,
}: Props) {
	const [minWidth, setMinWidth] = useState(getCardMinWidth);
	const [menu, setMenu] = useState<{
		x: number;
		y: number;
		items: MenuItem[];
	} | null>(null);

	useEffect(() => {
		const handler = () => setMinWidth(getCardMinWidth());
		window.addEventListener('fglt:prefs:card-width', handler);
		return () => window.removeEventListener('fglt:prefs:card-width', handler);
	}, []);

	// maxRows × an estimated columns count. We can't know the actual
	// column count without measuring, so this approximates by assuming
	// the container is the typical content width (~1200px). Used only
	// for the "show me 1-2 rows of recommendations" home-page panels;
	// being slightly off is harmless.
	const visible = maxRows
		? games.slice(0, Math.ceil(1200 / minWidth) * maxRows)
		: games;

	return (
		<>
			<div
				className="grid gap-3"
				style={{
					gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`,
				}}
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
