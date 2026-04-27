/**
 * Webview-side RPC client. The Electroview instance is created in main.tsx
 * and the typed `rpc` proxy is exported here so any component can call
 * `rpc.request.launch({...})` etc.
 */
import { Electroview } from "electrobun/view";
import type { SegRPC } from "../../shared/types";

const electroviewRpc = Electroview.defineRPC<SegRPC>({
	handlers: {
		requests: {},
		messages: {},
	},
});

export const electroview = new Electroview({ rpc: electroviewRpc });

export const rpc = electroview.rpc;
