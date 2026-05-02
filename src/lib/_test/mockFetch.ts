/**
 * Tiny fetch mock for lib tests. Replaces `globalThis.fetch` with a
 * configurable handler and records every call so tests can assert on them.
 *
 * Usage:
 *   import { installMockFetch, fetchCalls } from './_test/mockFetch';
 *   const restore = installMockFetch((url) => {
 *     if (url.includes('/api/find/init')) return jsonResponse({ token: 'x', hpKey: 'k', hpVal: 'v' });
 *     return new Response('not found', { status: 404 });
 *   });
 *   // ... run code ...
 *   expect(fetchCalls.length).toBe(2);
 *   restore();
 *
 * Keeping it tiny rather than pulling in msw / nock — the surface here is
 * just "match URL prefix → return canned body".
 */

export interface FetchCall {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | null;
}

export const fetchCalls: FetchCall[] = [];

export function jsonResponse(
	body: unknown,
	init?: { status?: number; headers?: Record<string, string> },
): Response {
	return new Response(JSON.stringify(body), {
		status: init?.status ?? 200,
		headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
	});
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

export function installMockFetch(handler: Handler): () => void {
	const original = globalThis.fetch;
	fetchCalls.length = 0;

	globalThis.fetch = (async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		const headers: Record<string, string> = {};
		if (init?.headers) {
			if (init.headers instanceof Headers) {
				init.headers.forEach((v, k) => {
					headers[k] = v;
				});
			} else if (Array.isArray(init.headers)) {
				for (const [k, v] of init.headers) headers[k] = v;
			} else {
				Object.assign(headers, init.headers);
			}
		}
		fetchCalls.push({
			url,
			method: init?.method ?? 'GET',
			headers,
			body:
				typeof init?.body === 'string'
					? init.body
					: init?.body
						? String(init.body)
						: null,
		});
		return handler(url, init);
	}) as typeof fetch;

	return () => {
		globalThis.fetch = original;
	};
}
