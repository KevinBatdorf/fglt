import { useRef } from 'react';
import { rpc } from './lib/rpc';

/**
 * Frameless windows on Windows lose their native resize border. We replicate
 * it in JS: 8 invisible hit regions around the perimeter, each capturing
 * pointer events and calling `windowSetFrame` over RPC. Same trade as the
 * TitleBar drag — one FFI hop per pointermove, RAF-coalesced.
 *
 * Edges sit absolutely positioned over the app root with a high z-index so
 * they intercept the pointer before content. Width is 5px to match the
 * Win11 frame; corners are 10x10 for an easier grab.
 */
type EdgeKey = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

// Reasonable lower bound — below this the sidebar+detail layout breaks
// (sidebar starts at 224px at narrow widths, search bar collapses, etc.).
const MIN_W = 900;
const MIN_H = 600;

const EDGE_STYLE: Record<EdgeKey, string> = {
	n: 'top-0 left-2.5 right-2.5 h-1.5 cursor-ns-resize',
	s: 'bottom-0 left-2.5 right-2.5 h-1.5 cursor-ns-resize',
	e: 'top-2.5 bottom-2.5 right-0 w-1.5 cursor-ew-resize',
	w: 'top-2.5 bottom-2.5 left-0 w-1.5 cursor-ew-resize',
	nw: 'top-0 left-0 w-2.5 h-2.5 cursor-nwse-resize',
	ne: 'top-0 right-0 w-2.5 h-2.5 cursor-nesw-resize',
	sw: 'bottom-0 left-0 w-2.5 h-2.5 cursor-nesw-resize',
	se: 'bottom-0 right-0 w-2.5 h-2.5 cursor-nwse-resize',
};

interface DragState {
	pointerId: number;
	edge: EdgeKey;
	startScreenX: number;
	startScreenY: number;
	startX: number;
	startY: number;
	startW: number;
	startH: number;
	pendingX: number;
	pendingY: number;
	pendingW: number;
	pendingH: number;
	raf: number | null;
}

export function ResizeEdges() {
	const dragState = useRef<DragState | null>(null);

	function flush() {
		const s = dragState.current;
		if (!s) return;
		s.raf = null;
		rpc.request
			.windowSetFrame({
				x: s.pendingX,
				y: s.pendingY,
				width: s.pendingW,
				height: s.pendingH,
			})
			.catch((e) => console.warn('windowSetFrame failed', e));
	}

	function onPointerDown(edge: EdgeKey, e: React.PointerEvent<HTMLDivElement>) {
		if (e.button !== 0) return;
		e.currentTarget.setPointerCapture(e.pointerId);
		void rpc.request.windowGetFrame({}).then((f) => {
			dragState.current = {
				pointerId: e.pointerId,
				edge,
				startScreenX: e.screenX,
				startScreenY: e.screenY,
				startX: f.x,
				startY: f.y,
				startW: f.width,
				startH: f.height,
				pendingX: f.x,
				pendingY: f.y,
				pendingW: f.width,
				pendingH: f.height,
				raf: null,
			};
		});
	}

	function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
		const s = dragState.current;
		if (!s || s.pointerId !== e.pointerId) return;
		const dx = e.screenX - s.startScreenX;
		const dy = e.screenY - s.startScreenY;
		let { startX: x, startY: y, startW: w, startH: h } = s;
		if (s.edge.includes('e')) w = Math.max(MIN_W, s.startW + dx);
		if (s.edge.includes('w')) {
			const newW = Math.max(MIN_W, s.startW - dx);
			x = s.startX + (s.startW - newW);
			w = newW;
		}
		if (s.edge.includes('s')) h = Math.max(MIN_H, s.startH + dy);
		if (s.edge.includes('n')) {
			const newH = Math.max(MIN_H, s.startH - dy);
			y = s.startY + (s.startH - newH);
			h = newH;
		}
		s.pendingX = x;
		s.pendingY = y;
		s.pendingW = w;
		s.pendingH = h;
		if (s.raf === null) s.raf = requestAnimationFrame(flush);
	}

	function endDrag(e: React.PointerEvent<HTMLDivElement>) {
		const s = dragState.current;
		if (!s) return;
		if (s.raf !== null) {
			cancelAnimationFrame(s.raf);
			flush();
		}
		try {
			e.currentTarget.releasePointerCapture(s.pointerId);
		} catch {
			/* already released */
		}
		dragState.current = null;
	}

	return (
		<>
			{(Object.keys(EDGE_STYLE) as EdgeKey[]).map((edge) => (
				// biome-ignore lint/a11y/noStaticElementInteractions: invisible hit region for window resize
				<div
					key={edge}
					onPointerDown={(e) => onPointerDown(edge, e)}
					onPointerMove={onPointerMove}
					onPointerUp={endDrag}
					onPointerCancel={endDrag}
					className={`absolute z-[60] ${EDGE_STYLE[edge]}`}
				/>
			))}
		</>
	);
}
