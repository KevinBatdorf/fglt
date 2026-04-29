/**
 * Provider-agnostic AI helpers, backed by Vercel's AI SDK + the OpenAI-
 * compatible adapter. Any OpenAI-compatible endpoint works:
 *
 *   AI_BASE_URL=http://host.docker.internal:11434/v1   (Ollama)
 *   AI_BASE_URL=https://api.openai.com/v1              (OpenAI)
 *   AI_BASE_URL=https://api.together.xyz/v1            (Together)
 *   AI_BASE_URL=https://api.groq.com/openai/v1         (Groq)
 *
 * Backward-compatible: if AI_BASE_URL is missing but OLLAMA_URL is set,
 * we derive the base URL automatically (Ollama exposes OpenAI-compat at
 * `<host>/v1`). Same for model names — AI_CHAT_MODEL falls back to
 * OLLAMA_CHAT_MODEL, AI_EMBED_MODEL falls back to OLLAMA_EMBED_MODEL.
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed as aiEmbed, embedMany, generateText } from 'ai';

const RAW_BASE = process.env.AI_BASE_URL?.trim();
const OLLAMA_URL = process.env.OLLAMA_URL?.trim();
const BASE_URL =
	RAW_BASE || (OLLAMA_URL ? `${OLLAMA_URL.replace(/\/$/, '')}/v1` : '');
const API_KEY = process.env.AI_API_KEY?.trim() || 'unused-but-required';
const PROVIDER_NAME =
	process.env.AI_PROVIDER_NAME?.trim() || 'openai-compatible';

const CHAT_MODEL =
	process.env.AI_CHAT_MODEL?.trim() ||
	process.env.OLLAMA_CHAT_MODEL?.trim() ||
	'qwen3:14b';

const EMBED_MODEL =
	process.env.AI_EMBED_MODEL?.trim() ||
	process.env.OLLAMA_EMBED_MODEL?.trim() ||
	'nomic-embed-text';

let _provider: ReturnType<typeof createOpenAICompatible> | null = null;
function getProvider() {
	if (!BASE_URL) {
		throw new Error(
			'AI provider not configured (set AI_BASE_URL or OLLAMA_URL)',
		);
	}
	if (!_provider) {
		_provider = createOpenAICompatible({
			name: PROVIDER_NAME,
			baseURL: BASE_URL,
			apiKey: API_KEY,
		});
	}
	return _provider;
}

export function isAIEnabled(): boolean {
	return BASE_URL.length > 0;
}

/** Backward-compat alias used by older call sites. */
export const isOllamaEnabled = isAIEnabled;

export function getEmbedModel(): string {
	return EMBED_MODEL;
}

export function getChatModel(): string {
	return CHAT_MODEL;
}

export function getProviderInfo() {
	return {
		base_url: BASE_URL,
		provider: PROVIDER_NAME,
		chat_model: CHAT_MODEL,
		embed_model: EMBED_MODEL,
	};
}

/** Embed a list of strings. Returns Float32Array vectors. */
export async function embed(texts: string[]): Promise<Float32Array[]> {
	if (!isAIEnabled()) throw new Error('AI provider not configured');
	const provider = getProvider();
	const model = provider.textEmbeddingModel(EMBED_MODEL);
	const { embeddings } = await embedMany({ model, values: texts });
	return embeddings.map((e) => new Float32Array(e));
}

export async function embedSingle(text: string): Promise<Float32Array> {
	if (!isAIEnabled()) throw new Error('AI provider not configured');
	const provider = getProvider();
	const model = provider.textEmbeddingModel(EMBED_MODEL);
	const { embedding } = await aiEmbed({ model, value: text });
	return new Float32Array(embedding);
}

/** Format a vector as a pgvector literal: "[0.1,0.2,...]" */
export function toVectorLiteral(v: Float32Array | number[]): string {
	return `[${Array.from(v).join(',')}]`;
}

/**
 * Send a generation prompt. Each call uses a fresh random seed so
 * identical prompts produce different outputs (some providers cache
 * deterministic seeds otherwise).
 */
export async function chat(
	prompt: string,
	opts: {
		json?: boolean;
		model?: string;
		temperature?: number;
		seed?: number;
	} = {},
): Promise<string> {
	if (!isAIEnabled()) throw new Error('AI provider not configured');
	const provider = getProvider();
	const seed = opts.seed ?? Math.floor(Math.random() * 2_147_483_647);
	const { text } = await generateText({
		model: provider(opts.model ?? CHAT_MODEL),
		prompt,
		temperature: opts.temperature ?? 1.0,
		topP: 0.95,
		seed,
		...(opts.json
			? {
					providerOptions: {
						[PROVIDER_NAME]: { response_format: { type: 'json_object' } },
					},
				}
			: {}),
	});
	return text;
}
