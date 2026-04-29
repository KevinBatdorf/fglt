const OLLAMA_URL = process.env.OLLAMA_URL || '';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text';

export function isOllamaEnabled(): boolean {
	return OLLAMA_URL.length > 0;
}

export function getEmbedModel(): string {
	return OLLAMA_EMBED_MODEL;
}

async function tryEmbed(texts: string[]): Promise<Float32Array[]> {
	const res = await fetch(`${OLLAMA_URL}/api/embed`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: texts }),
		signal: AbortSignal.timeout(60_000),
	});

	if (res.status === 400) {
		const body = await res.text();
		if (body.includes('context length')) {
			const maxLen = Math.max(...texts.map((t) => t.length));
			if (maxLen <= 1) throw new Error(`Ollama embed failed: ${body}`);
			const half = Math.floor(maxLen / 2);
			return tryEmbed(texts.map((t) => t.slice(0, half)));
		}
		throw new Error(`Ollama embed failed (400): ${body}`);
	}

	if (!res.ok) {
		const body = await res.text();
		throw new Error(`Ollama embed failed (${res.status}): ${body}`);
	}

	const data: { embeddings: number[][] } = await res.json();
	return data.embeddings.map((e) => new Float32Array(e));
}

export function embed(texts: string[]): Promise<Float32Array[]> {
	if (!OLLAMA_URL) throw new Error('OLLAMA_URL not configured');
	return tryEmbed(texts);
}

export async function embedSingle(text: string): Promise<Float32Array> {
	const [result] = await embed([text]);
	return result;
}

/** Format Float32Array as a pgvector literal: "[0.1,0.2,...]" */
export function toVectorLiteral(v: Float32Array | number[]): string {
	return `[${Array.from(v).join(',')}]`;
}

const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || 'qwen3:14b';

/**
 * Send a chat-completion prompt to Ollama. Uses the configured chat model
 * (`OLLAMA_CHAT_MODEL`, default `llama3.2`). Throws on any non-OK response.
 */
export async function chat(
	prompt: string,
	opts: { json?: boolean; model?: string; temperature?: number } = {},
): Promise<string> {
	if (!OLLAMA_URL) throw new Error('OLLAMA_URL not configured');
	const res = await fetch(`${OLLAMA_URL}/api/generate`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			model: opts.model ?? OLLAMA_CHAT_MODEL,
			prompt,
			stream: false,
			format: opts.json ? 'json' : undefined,
			options: { temperature: opts.temperature ?? 0.8 },
		}),
		signal: AbortSignal.timeout(120_000),
	});
	if (!res.ok) {
		throw new Error(`Ollama chat failed (${res.status}): ${await res.text()}`);
	}
	const data = (await res.json()) as { response: string };
	return data.response;
}
