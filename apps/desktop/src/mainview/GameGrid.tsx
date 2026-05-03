import { useEffect, useState } from 'react';
import type { InstalledIndex } from '../shared/types';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { GameCard } from './GameCard';
import type { LibraryGame } from './lib/api';
import { getCardsPerRow } from './lib/prefs';

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
 * Cards-per-row is a user pref; the grid stretches each column equally so
 * cards grow/shrink with the viewport. Listens for the pref-change event so
 * the grid reflows live without remounts.
 */
export function GameGrid({
	games,
	installed,
	onSelect,
	showMatchPct = true,
	maxRows,
	cardContextMenu,
}: Props) {
	const [perRow, setPerRow] = useState(getCardsPerRow);
	const [menu, setMenu] = useState<{
		x: number;
		y: number;
		items: MenuItem[];
	} | null>(null);

	useEffect(() => {
		const handler = () => setPerRow(getCardsPerRow());
		window.addEventListener('fglt:prefs:cards-per-row', handler);
		return () => window.removeEventListener('fglt:prefs:cards-per-row', handler);
	}, []);

	const visible = maxRows ? games.slice(0, perRow * maxRows) : games;

	return (
		<>
			<div
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
