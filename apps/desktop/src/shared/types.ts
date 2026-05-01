/**
 * Types shared between the Bun main process and the React webview.
 * Imported on both sides for typed RPC.
 */
import type { RPCSchema } from 'electrobun/bun';

export type Platform = 'steam' | 'epic' | 'gog';

export interface InstalledIndex {
	steam: number[]; // Steam appids
	epic: string[]; // Epic app_name values (Legendary catalog ids)
	gog: string[]; // GOG product ids as strings
}

export interface LaunchResult {
	ok: boolean;
	error?: string;
}

export type RefreshSource =
	| 'all'
	| 'steam_appdetails'
	| 'steam_reviews'
	| 'opencritic'
	| 'youtube';

export interface RefreshResult {
	appid: number;
	name: string;
	source: RefreshSource;
	sources: Record<string, { status: string; detail?: unknown }>;
}

export type SegRPC = {
	bun: RPCSchema<{
		requests: {
			launch: {
				params: { platform: Platform; externalId: string; appid: number };
				response: LaunchResult;
			};
			getInstalledIndex: {
				params: Record<string, never>;
				response: InstalledIndex;
			};
			refreshGame: {
				params: { appid: number; source?: RefreshSource };
				response: RefreshResult;
			};
			openUrl: { params: { url: string }; response: { ok: boolean } };
			windowAction: {
				params: {
					action:
						| 'minimize'
						| 'maximize'
						| 'unmaximize'
						| 'close'
						| 'toggleMax';
				};
				response: { isMaximized: boolean };
			};
			windowGetFrame: {
				params: Record<string, never>;
				response: { x: number; y: number; width: number; height: number };
			};
			windowSetPosition: {
				params: { x: number; y: number };
				response: { ok: boolean };
			};
			windowSetFrame: {
				params: { x: number; y: number; width: number; height: number };
				response: { ok: boolean };
			};
			windowSetTitle: {
				params: { title: string };
				response: { ok: boolean };
			};
		};
		messages: Record<string, never>;
	}>;
	webview: RPCSchema<{
		requests: Record<string, never>;
		messages: Record<string, never>;
	}>;
};
