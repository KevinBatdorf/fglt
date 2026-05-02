/**
 * Webview-side RPC client. Inside the Electrobun shell this binds to the
 * named-pipe bridge and gives us typed `rpc.request.*` / `rpc.send.*`. When
 * the bundle is loaded in a regular browser (e.g. Playwright pointing at the
 * Vite dev server for screenshots) the Electroview constructor would throw
 * because `window.__electrobunWindowId` is undefined; we degrade to a stub
 * so the UI still renders.
 */
import { Electroview } from 'electrobun/view';
import type { SegRPC } from '../../shared/types';

interface SegRpcShape {
	request: {
		launch: (
			params: SegRPC['bun']['requests']['launch']['params'],
		) => Promise<SegRPC['bun']['requests']['launch']['response']>;
		getInstalledIndex: (
			params: SegRPC['bun']['requests']['getInstalledIndex']['params'],
		) => Promise<SegRPC['bun']['requests']['getInstalledIndex']['response']>;
		refreshGame: (
			params: SegRPC['bun']['requests']['refreshGame']['params'],
		) => Promise<SegRPC['bun']['requests']['refreshGame']['response']>;
		openUrl: (
			params: SegRPC['bun']['requests']['openUrl']['params'],
		) => Promise<SegRPC['bun']['requests']['openUrl']['response']>;
		windowAction: (
			params: SegRPC['bun']['requests']['windowAction']['params'],
		) => Promise<SegRPC['bun']['requests']['windowAction']['response']>;
		windowGetFrame: (
			params: SegRPC['bun']['requests']['windowGetFrame']['params'],
		) => Promise<SegRPC['bun']['requests']['windowGetFrame']['response']>;
		windowSetPosition: (
			params: SegRPC['bun']['requests']['windowSetPosition']['params'],
		) => Promise<SegRPC['bun']['requests']['windowSetPosition']['response']>;
		windowSetFrame: (
			params: SegRPC['bun']['requests']['windowSetFrame']['params'],
		) => Promise<SegRPC['bun']['requests']['windowSetFrame']['response']>;
		windowSetTitle: (
			params: SegRPC['bun']['requests']['windowSetTitle']['params'],
		) => Promise<SegRPC['bun']['requests']['windowSetTitle']['response']>;
		updaterStatus: (
			params: SegRPC['bun']['requests']['updaterStatus']['params'],
		) => Promise<SegRPC['bun']['requests']['updaterStatus']['response']>;
		updaterCheckNow: (
			params: SegRPC['bun']['requests']['updaterCheckNow']['params'],
		) => Promise<SegRPC['bun']['requests']['updaterCheckNow']['response']>;
		updaterApply: (
			params: SegRPC['bun']['requests']['updaterApply']['params'],
		) => Promise<SegRPC['bun']['requests']['updaterApply']['response']>;
	};
	send: Record<string, never>;
}

function inElectrobun(): boolean {
	if (typeof window === 'undefined') return false;
	const w = window as Window &
		Partial<{ __electrobunWebviewId: number; __electrobunWindowId: number }>;
	return typeof w.__electrobunWebviewId !== 'undefined';
}

function createStubRpc(): SegRpcShape {
	const warn = (name: string) =>
		console.warn(`[rpc-stub] ${name} called outside Electrobun (no-op)`);
	return {
		request: {
			launch: () => {
				warn('launch');
				return Promise.resolve({
					ok: false,
					error: 'Running in browser stub',
				});
			},
			getInstalledIndex: () => {
				warn('getInstalledIndex');
				return Promise.resolve({ steam: [], epic: [], gog: [] });
			},
			refreshGame: ({ appid, source }) => {
				warn('refreshGame');
				return Promise.resolve({
					appid,
					name: '',
					source: source ?? 'all',
					sources: {},
				});
			},
			openUrl: ({ url }) => {
				warn(`openUrl(${url})`);
				return Promise.resolve({ ok: false });
			},
			windowAction: () => Promise.resolve({ isMaximized: false }),
			windowGetFrame: () =>
				Promise.resolve({ x: 0, y: 0, width: 0, height: 0 }),
			windowSetPosition: () => Promise.resolve({ ok: false }),
			windowSetFrame: () => Promise.resolve({ ok: false }),
			windowSetTitle: () => Promise.resolve({ ok: false }),
			updaterStatus: () =>
				Promise.resolve({
					currentVersion: null,
					updateAvailable: false,
					updateReady: false,
					latestVersion: null,
					lastChecked: null,
					lastError: null,
					checking: false,
				}),
			updaterCheckNow: () =>
				Promise.resolve({
					currentVersion: null,
					updateAvailable: false,
					updateReady: false,
					latestVersion: null,
					lastChecked: null,
					lastError: null,
					checking: false,
				}),
			updaterApply: () => Promise.resolve({ ok: false, error: 'browser stub' }),
		},
		send: {},
	};
}

let rpcImpl: SegRpcShape;
try {
	if (!inElectrobun()) throw new Error('Not in Electrobun host');
	const electroviewRpc = Electroview.defineRPC<SegRPC>({
		handlers: { requests: {}, messages: {} },
	});
	const electroview = new Electroview({ rpc: electroviewRpc });
	// Cast: the Electroview-generated rpc object satisfies SegRpcShape.
	rpcImpl = electroview.rpc as unknown as SegRpcShape;
} catch (err) {
	console.warn(
		'Electrobun bridge unavailable; UI is rendering in browser-stub mode.',
		err,
	);
	rpcImpl = createStubRpc();
}

export const rpc = rpcImpl;
