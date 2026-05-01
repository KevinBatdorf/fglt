import { useEffect } from 'react';

export interface MenuItem {
	label: string;
	onClick: () => void;
	danger?: boolean;
	disabled?: boolean;
}

/**
 * Floating context menu used by right-click affordances. Closes on
 * outside-click or Escape. Caller is responsible for positioning (clientX,
 * clientY from the contextmenu event) and managing open/closed state.
 *
 * Items inside the menu opt out of outside-click via the `data-context-menu`
 * marker on the wrapper, so clicks on items still fire the item handler
 * before close.
 */
export function ContextMenu({
	x,
	y,
	items,
	onClose,
}: {
	x: number;
	y: number;
	items: MenuItem[];
	onClose: () => void;
}) {
	useEffect(() => {
		const onDown = (e: MouseEvent) => {
			const t = e.target as HTMLElement | null;
			if (t?.closest('[data-context-menu]')) return;
			onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('mousedown', onDown);
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('mousedown', onDown);
			window.removeEventListener('keydown', onKey);
		};
	}, [onClose]);

	return (
		<div
			data-context-menu
			role="menu"
			style={{ left: x, top: y }}
			className="fixed z-50 min-w-44 rounded-md border border-zinc-800 bg-zinc-950 shadow-xl py-1"
		>
			{items.map((item) => (
				<button
					key={item.label}
					type="button"
					role="menuitem"
					disabled={item.disabled}
					onClick={() => {
						if (item.disabled) return;
						item.onClick();
						onClose();
					}}
					className={`w-full px-3 py-1.5 text-left text-sm transition-colors disabled:opacity-40 ${
						item.danger
							? 'text-red-400 hover:bg-zinc-900 hover:text-red-300'
							: 'text-zinc-200 hover:bg-zinc-900 hover:text-zinc-50'
					}`}
				>
					{item.label}
				</button>
			))}
		</div>
	);
}
