/**
 * Webview-side RPC client. Inside the Electrobun shell this binds to the
 * named-pipe bridge and gives us typed `rpc.request.*` / `rpc.send.*`. When
 * the bundle is loaded in a regular browser (e.g. Playwright pointing at the
 * Vite dev server for screenshots) the Electroview constructor would throw
 * because `window.__electrobunWindowId` is undefined; we degrade to a stub
 * so the UI still renders.
 */
import { Electroview } from "electrobun/view";
import type { SegRPC } from "../../shared/types";

interface SegRpcShape {
	request: {
		launch: SegRPC["bun"]["requests"]["launch"]["request"] extends never
			? never
			: (params: SegRPC["bun"]["requests"]["launch"]["params"]) => Promise<
					SegRPC["bun"]["requests"]["launch"]["response"]
				>;
		getInstalledIndex: (
			params: SegRPC["bun"]["requests"]["getInstalledIndex"]["params"],
		) => Promise<SegRPC["bun"]["requests"]["getInstalledIndex"]["response"]>;
		refreshGame: (
			params: SegRPC["bun"]["requests"]["refreshGame"]["params"],
		) => Promise<SegRPC["bun"]["requests"]["refreshGame"]["response"]>;
		openUrl: (
			params: SegRPC["bun"]["requests"]["openUrl"]["params"],
		) => Promise<SegRPC["bun"]["requests"]["openUrl"]["response"]>;
	};
	send: Record<string, never>;
}

function inElectrobun(): boolean {
	if (typeof window === "undefined") return false;
	const w = window as Window &
		Partial<{ __electrobunWebviewId: number; __electrobunWindowId: number }>;
	return typeof w.__electrobunWebviewId !== "undefined";
}

function createStubRpc(): SegRpcShape {
	const warn = (name: string) =>
		console.warn(`[rpc-stub] ${name} called outside Electrobun (no-op)`);
	return {
		request: {
			launch: async () => {
				warn("launch");
				return { ok: false, error: "Running in browser stub" };
			},
			getInstalledIndex: async () => {
				warn("getInstalledIndex");
				return { steam: [], epic: [], gog: [] };
			},
			refreshGame: async ({ appid }) => {
				warn("refreshGame");
				return { appid, name: "", sources: {} };
			},
			openUrl: async ({ url }) => {
				warn(`openUrl(${url})`);
				return { ok: false };
			},
		},
		send: {},
	};
}

let rpcImpl: SegRpcShape;
try {
	if (!inElectrobun()) throw new Error("Not in Electrobun host");
	const electroviewRpc = Electroview.defineRPC<SegRPC>({
		handlers: { requests: {}, messages: {} },
	});
	const electroview = new Electroview({ rpc: electroviewRpc });
	// Cast: the Electroview-generated rpc object satisfies SegRpcShape.
	rpcImpl = electroview.rpc as unknown as SegRpcShape;
} catch (err) {
	console.warn(
		"Electrobun bridge unavailable; UI is rendering in browser-stub mode.",
		err,
	);
	rpcImpl = createStubRpc();
}

export const rpc = rpcImpl;
