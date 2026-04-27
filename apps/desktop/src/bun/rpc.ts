/**
 * Bun-side RPC handlers exposed to the React webview.
 *
 * Three responsibilities:
 *   1. launch — open a storefront URI via Utils.openExternal
 *   2. getInstalledIndex — aggregate per-storefront installed sets, cached
 *      in-process for the session (refreshes on every call to keep things
 *      simple — disks are fast and the user can re-trigger from the UI)
 *   3. refreshGame — proxy through to the API's /games/:appid/refresh
 */
import { BrowserView, Utils } from "electrobun/bun";
import type {
	InstalledIndex,
	LaunchResult,
	RefreshResult,
	SegRPC,
} from "../shared/types";
import { epicLaunchUri, getEpicInstalled } from "./launchers/epic";
import { getGogInstalled, gogLaunchUri } from "./launchers/gog";
import {
	getSteamInstalled,
	steamInstallUri,
	steamLaunchUri,
} from "./launchers/steam";

const API_BASE = process.env.SEG_API_BASE ?? "http://localhost:3110";

function readInstalledIndex(): InstalledIndex {
	return {
		steam: [...getSteamInstalled()],
		epic: [...getEpicInstalled()],
		gog: [...getGogInstalled()],
	};
}

export function defineSegRpc() {
	return BrowserView.defineRPC<SegRPC>({
		handlers: {
			requests: {
				launch: ({ platform, externalId, appid }): LaunchResult => {
					let uri: string;
					switch (platform) {
						case "steam":
							uri = steamLaunchUri(appid);
							break;
						case "epic":
							uri = epicLaunchUri(externalId);
							break;
						case "gog":
							uri = gogLaunchUri(externalId);
							break;
						default:
							return { ok: false, error: `unknown platform: ${platform}` };
					}
					try {
						const ok = Utils.openExternal(uri);
						return { ok, ...(ok ? {} : { error: `openExternal returned false for ${uri}` }) };
					} catch (e) {
						return {
							ok: false,
							error: e instanceof Error ? e.message : String(e),
						};
					}
				},

				getInstalledIndex: (): InstalledIndex => readInstalledIndex(),

				refreshGame: async ({ appid }): Promise<RefreshResult> => {
					const res = await fetch(`${API_BASE}/games/${appid}/refresh`, {
						method: "POST",
					});
					if (!res.ok) {
						throw new Error(`API ${res.status}: ${await res.text()}`);
					}
					return (await res.json()) as RefreshResult;
				},

				openUrl: ({ url }): { ok: boolean } => {
					try {
						return { ok: Utils.openExternal(url) };
					} catch {
						return { ok: false };
					}
				},
			},
			messages: {},
		},
	});
}

export { steamInstallUri };
