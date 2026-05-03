/**
 * Webview-side RPC client. Inside the Electrobun shell this binds to the
 * named-pipe bridge and gives us typed `rpc.request.*` / `rpc.send.*`. When
 * the bundle is loaded in a regular browser (e.g. Playwright pointing at the
 * Vite dev server for screenshots) the Electroview constructor would throw
 * because `window.__electrobunWindowId` is undefined; we degrade to a stub
 * so the UI still renders.
 */
import { Electroview } from 'electrobun/view';
import type { FgltRPC } from '../../shared/types';

interface FgltRpcShape {
	request: {
		launch: (
			params: FgltRPC['bun']['requests']['launch']['params'],
		) => Promise<FgltRPC['bun']['requests']['launch']['response']>;
		getInstalledIndex: (
			params: FgltRPC['bun']['requests']['getInstalledIndex']['params'],
		) => Promise<FgltRPC['bun']['requests']['getInstalledIndex']['response']>;
		refreshGame: (
			params: FgltRPC['bun']['requests']['refreshGame']['params'],
		) => Promise<FgltRPC['bun']['requests']['refreshGame']['response']>;
		openUrl: (
			params: FgltRPC['bun']['requests']['openUrl']['params'],
		) => Promise<FgltRPC['bun']['requests']['openUrl']['response']>;
		windowAction: (
			params: FgltRPC['bun']['requests']['windowAction']['params'],
		) => Promise<FgltRPC['bun']['requests']['windowAction']['response']>;
		windowGetFrame: (
			params: FgltRPC['bun']['requests']['windowGetFrame']['params'],
		) => Promise<FgltRPC['bun']['requests']['windowGetFrame']['response']>;
		windowSetPosition: (
			params: FgltRPC['bun']['requests']['windowSetPosition']['params'],
		) => Promise<FgltRPC['bun']['requests']['windowSetPosition']['response']>;
		windowSetFrame: (
			params: FgltRPC['bun']['requests']['windowSetFrame']['params'],
		) => Promise<FgltRPC['bun']['requests']['windowSetFrame']['response']>;
		windowSetTitle: (
			params: FgltRPC['bun']['requests']['windowSetTitle']['params'],
		) => Promise<FgltRPC['bun']['requests']['windowSetTitle']['response']>;
		updaterStatus: (
			params: FgltRPC['bun']['requests']['updaterStatus']['params'],
		) => Promise<FgltRPC['bun']['requests']['updaterStatus']['response']>;
		updaterCheckNow: (
			params: FgltRPC['bun']['requests']['updaterCheckNow']['params'],
		) => Promise<FgltRPC['bun']['requests']['updaterCheckNow']['response']>;
		updaterApply: (
			params: FgltRPC['bun']['requests']['updaterApply']['params'],
		) => Promise<FgltRPC['bun']['requests']['updaterApply']['response']>;
		dockerStatus: (
			params: FgltRPC['bun']['requests']['dockerStatus']['params'],
		) => Promise<FgltRPC['bun']['requests']['dockerStatus']['response']>;
		dockerStart: (
			params: FgltRPC['bun']['requests']['dockerStart']['params'],
		) => Promise<FgltRPC['bun']['requests']['dockerStart']['response']>;
		dockerStop: (
			params: FgltRPC['bun']['requests']['dockerStop']['params'],
		) => Promise<FgltRPC['bun']['requests']['dockerStop']['response']>;
		dockerRebuild: (
			params: FgltRPC['bun']['requests']['dockerRebuild']['params'],
		) => Promise<FgltRPC['bun']['requests']['dockerRebuild']['response']>;
		epicStatus: (
			params: FgltRPC['bun']['requests']['epicStatus']['params'],
		) => Promise<FgltRPC['bun']['requests']['epicStatus']['response']>;
		epicAuthExchange: (
			params: FgltRPC['bun']['requests']['epicAuthExchange']['params'],
		) => Promise<FgltRPC['bun']['requests']['epicAuthExchange']['response']>;
		epicSync: (
			params: FgltRPC['bun']['requests']['epicSync']['params'],
		) => Promise<FgltRPC['bun']['requests']['epicSync']['response']>;
		epicLogout: (
			params: FgltRPC['bun']['requests']['epicLogout']['params'],
		) => Promise<FgltRPC['bun']['requests']['epicLogout']['response']>;
	};
	send: Record<string, never>;
}

function inElectrobun(): boolean {
	if (typeof window === 'undefined') return false;
	const w = window as Window &
		Partial<{ __electrobunWebviewId: number; __electrobunWindowId: number }>;
	return typeof w.__electrobunWebviewId !== 'undefined';
}

function createStubRpc(): FgltRpcShape {
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
			// Docker stubs report a friendly "running" so the in-browser
			// preview doesn't paint a perpetual "Docker not installed" banner.
			dockerStatus: () => Promise.resolve({ kind: 'running' as const }),
			dockerStart: () => Promise.resolve({ ok: false, error: 'browser stub' }),
			dockerStop: () => Promise.resolve({ ok: false, error: 'browser stub' }),
			dockerRebuild: () =>
				Promise.resolve({ ok: false, error: 'browser stub' }),
			epicStatus: () =>
				Promise.resolve({ kind: 'not_installed' as const }),
			epicAuthExchange: () =>
				Promise.resolve({ ok: false, error: 'browser stub' }),
			epicSync: () =>
				Promise.resolve({ ok: false, error: 'browser stub' }),
			epicLogout: () =>
				Promise.resolve({ ok: false, error: 'browser stub' }),
		},
		send: {},
	};
}

let rpcImpl: FgltRpcShape;
try {
	if (!inElectrobun()) throw new Error('Not in Electrobun host');
	const electroviewRpc = Electroview.defineRPC<FgltRPC>({
		handlers: { requests: {}, messages: {} },
	});
	const electroview = new Electroview({ rpc: electroviewRpc });
	// Cast: the Electroview-generated rpc object satisfies FgltRpcShape.
	rpcImpl = electroview.rpc as unknown as FgltRpcShape;
} catch (err) {
	console.warn(
		'Electrobun bridge unavailable; UI is rendering in browser-stub mode.',
		err,
	);
	rpcImpl = createStubRpc();
}

export const rpc = rpcImpl;
