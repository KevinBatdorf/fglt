/**
 * Single source of truth for loading copy across the app. Every view that
 * has an async fetch should use this so the visual treatment (pulse, color,
 * spacing) stays consistent — previously each call site had its own
 * one-off styling and inconsistent padding.
 */
export function LoadingState({ message = 'Loading…' }: { message?: string }) {
	return (
		<div className="py-8 text-zinc-500 text-sm animate-pulse">{message}</div>
	);
}
