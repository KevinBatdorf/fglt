import { useEffect, useRef, useState } from 'react';
import { rpc } from './lib/rpc';

/**
 * Custom titlebar for the frameless window. Windows-only: controls match
 * Win11 affordances (red close hover, square min/restore icons).
 *
 * Drag is implemented in JS because Electrobun on Windows doesn't expose
 * a native non-client drag region or `-webkit-app-region: drag`. We capture
 * pointer events on the drag region, compute a delta, and call
 * `windowSetPosition` over RPC. That's an FFI hop per pointermove —
 * acceptable for short drags, and the pointer is captured so the events
 * keep flowing even if the cursor outpaces the window.
 */
export function TitleBar({
	onOpenSettings,
}: {
	onOpenSettings?: () => void;
} = {}) {
	const dragRef = useRef<HTMLDivElement>(null);

	// OS-level window title (taskbar tooltip, Alt-Tab thumbnail, taskbar
	// preview) is always just the app name — current view is already
	// visible in the in-app titlebar/sidebar and doesn't belong in the
	// OS chrome.
	useEffect(() => {
		void rpc.request
			.windowSetTitle({ title: 'Find a Game Like That' })
			.catch(() => {});
	}, []);

	const dragState = useRef<{
		pointerId: number;
		// Screen-space anchor at drag start.
		startScreenX: number;
		startScreenY: number;
		// Window position at drag start.
		startWinX: number;
		startWinY: number;
		// Pending RAF to coalesce pointermove → setPosition.
		pendingX: number | null;
		pendingY: number | null;
		raf: number | null;
	} | null>(null);

	const [isMax, setIsMax] = useState(false);

	async function handleAction(action: 'minimize' | 'close' | 'toggleMax') {
		try {
			const r = await rpc.request.windowAction({ action });
			setIsMax(r.isMaximized);
		} catch (e) {
			console.warn('windowAction failed', action, e);
		}
	}

	function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
		if (e.button !== 0) return; // only left-button drags
		// If we're maximized, the OS convention is: dragging restores the window
		// and starts moving it. We restore first; setPosition then moves it.
		const target = e.currentTarget;
		target.setPointerCapture(e.pointerId);

		void rpc.request.windowGetFrame({}).then(async (frame) => {
			if (!dragRef.current) return;
			let winX = frame.x;
			let winY = frame.y;
			if (isMax) {
				const r = await rpc.request.windowAction({ action: 'unmaximize' });
				setIsMax(r.isMaximized);
				const f2 = await rpc.request.windowGetFrame({});
				winX = f2.x;
				winY = f2.y;
			}
			dragState.current = {
				pointerId: e.pointerId,
				startScreenX: e.screenX,
				startScreenY: e.screenY,
				startWinX: winX,
				startWinY: winY,
				pendingX: null,
				pendingY: null,
				raf: null,
			};
		});
	}

	function flushDrag() {
		const s = dragState.current;
		if (!s) return;
		s.raf = null;
		if (s.pendingX === null || s.pendingY === null) return;
		const x = s.pendingX;
		const y = s.pendingY;
		s.pendingX = null;
		s.pendingY = null;
		void rpc.request.windowSetPosition({ x, y });
	}

	function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
		const s = dragState.current;
		if (!s || s.pointerId !== e.pointerId) return;
		const dx = e.screenX - s.startScreenX;
		const dy = e.screenY - s.startScreenY;
		s.pendingX = s.startWinX + dx;
		s.pendingY = s.startWinY + dy;
		if (s.raf === null) {
			s.raf = requestAnimationFrame(flushDrag);
		}
	}

	function endDrag(e: React.PointerEvent<HTMLDivElement>) {
		const s = dragState.current;
		if (!s) return;
		if (s.raf !== null) {
			cancelAnimationFrame(s.raf);
			flushDrag();
		}
		try {
			e.currentTarget.releasePointerCapture(s.pointerId);
		} catch {
			/* already released */
		}
		dragState.current = null;
	}

	function onDoubleClick() {
		void handleAction('toggleMax');
	}

	return (
		<div className="h-9 flex items-stretch shrink-0 bg-zinc-950 border-b border-zinc-900 select-none">
			<button
				type="button"
				onClick={onOpenSettings}
				aria-label="Settings"
				className="w-9 flex items-center justify-center text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors"
			>
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden
				>
					<title>Settings</title>
					<circle cx="12" cy="12" r="3" />
					<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
				</svg>
			</button>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: drag region for a frameless window must intercept pointer events */}
			<div
				ref={dragRef}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				onDoubleClick={onDoubleClick}
				className="flex-1 flex items-center cursor-default overflow-hidden"
			>
				<span className="font-display italic text-[20px] font-semibold tracking-tight text-zinc-400 whitespace-nowrap ml-1">
					Find a Game Like That
				</span>
			</div>
			<WindowControls
				isMax={isMax}
				onMin={() => handleAction('minimize')}
				onMax={() => handleAction('toggleMax')}
				onClose={() => handleAction('close')}
			/>
		</div>
	);
}

function WindowControls({
	isMax,
	onMin,
	onMax,
	onClose,
}: {
	isMax: boolean;
	onMin: () => void;
	onMax: () => void;
	onClose: () => void;
}) {
	return (
		<div className="flex items-stretch">
			<CtlButton onClick={onMin} aria-label="Minimize">
				<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
					<title>Minimize</title>
					<path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
				</svg>
			</CtlButton>
			<CtlButton onClick={onMax} aria-label={isMax ? 'Restore' : 'Maximize'}>
				{isMax ? (
					<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
						<title>Restore</title>
						<rect
							x="0.5"
							y="2.5"
							width="7"
							height="7"
							fill="none"
							stroke="currentColor"
							strokeWidth="1"
						/>
						<path
							d="M2.5 2.5V0.5h7v7h-2"
							fill="none"
							stroke="currentColor"
							strokeWidth="1"
						/>
					</svg>
				) : (
					<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
						<title>Maximize</title>
						<rect
							x="0.5"
							y="0.5"
							width="9"
							height="9"
							fill="none"
							stroke="currentColor"
							strokeWidth="1"
						/>
					</svg>
				)}
			</CtlButton>
			<CtlButton onClick={onClose} aria-label="Close" variant="close">
				<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
					<title>Close</title>
					<path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1" />
				</svg>
			</CtlButton>
		</div>
	);
}

function CtlButton({
	children,
	onClick,
	variant,
	...rest
}: {
	children: React.ReactNode;
	onClick: () => void;
	variant?: 'close';
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
	const hover =
		variant === 'close'
			? 'hover:bg-red-600 hover:text-white'
			: 'hover:bg-zinc-800';
	return (
		<button
			type="button"
			onClick={onClick}
			className={`w-9 flex items-center justify-center text-zinc-400 transition-colors ${hover}`}
			{...rest}
		>
			{children}
		</button>
	);
}
