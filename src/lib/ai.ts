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
 *
 * All settings now resolve through `getConfig()` (env > app_settings DB),
 * so the desktop user can change them via the Settings page without
 * touching .env.
 */
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { embed as aiEmbed, embedMany, generateText } from 'ai';
import { type AppConfig, getConfig } from './config';

interface ResolvedAI {
	baseUrl: string;
	apiKey: string;
	providerName: string;
	chatModel: string;
	embedModel: string;
}

async function resolve(): Promise<ResolvedAI> {
	const c = await getConfig();
	const rawBase = c.AI_BASE_URL?.trim();
	const ollamaUrl = c.OLLAMA_URL?.trim();
	const baseUrl =
		rawBase ||
		(ollamaUrl ? `${ollamaUrl.replace(/\/$/, '')}/v1` : '');
	return {
		baseUrl,
		apiKey: c.AI_API_KEY?.trim() || 'unused-but-required',
		providerName: c.AI_PROVIDER_NAME?.trim() || 'openai-compatible',
		chatModel:
			c.AI_CHAT_MODEL?.trim() ||
			c.OLLAMA_CHAT_MODEL?.trim() ||
			'qwen3:14b',
		embedModel:
			c.AI_EMBED_MODEL?.trim() ||
			c.OLLAMA_EMBED_MODEL?.trim() ||
			'nomic-embed-text',
	};
}

// Provider cache keyed on baseUrl+apiKey so reconfiguration via the
// Settings UI invalidates correctly.
let _providerCache: {
	key: string;
	provider: ReturnType<typeof createOpenAICompatible>;
} | null = null;

function getProviderFor(r: ResolvedAI) {
	if (!r.baseUrl) {
		throw new Error(
			'AI provider not configured (set AI_BASE_URL or OLLAMA_URL in Settings)',
		);
	}
	const key = `${r.providerName}|${r.baseUrl}|${r.apiKey}`;
	if (_providerCache?.key !== key) {
		_providerCache = {
			key,
			provider: createOpenAICompatible({
				name: r.providerName,
				baseURL: r.baseUrl,
				apiKey: r.apiKey,
			}),
		};
	}
	return _providerCache.provider;
}

export async function isAIEnabled(): Promise<boolean> {
	const r = await resolve();
	return r.baseUrl.length > 0;
}

/** Backward-compat alias used by older call sites. */
export const isOllamaEnabled = isAIEnabled;

export async function getEmbedModel(): Promise<string> {
	return (await resolve()).embedModel;
}

export async function getChatModel(): Promise<string> {
	return (await resolve()).chatModel;
}

export async function getProviderInfo() {
	const r = await resolve();
	return {
		base_url: r.baseUrl,
		provider: r.providerName,
		chat_model: r.chatModel,
		embed_model: r.embedModel,
	};
}

/** Embed a list of strings. Returns Float32Array vectors. */
export async function embed(texts: string[]): Promise<Float32Array[]> {
	const r = await resolve();
	if (!r.baseUrl) throw new Error('AI provider not configured');
	const provider = getProviderFor(r);
	const model = provider.textEmbeddingModel(r.embedModel);
	const { embeddings } = await embedMany({ model, values: texts });
	return embeddings.map((e) => new Float32Array(e));
}

export async function embedSingle(text: string): Promise<Float32Array> {
	const r = await resolve();
	if (!r.baseUrl) throw new Error('AI provider not configured');
	const provider = getProviderFor(r);
	const model = provider.textEmbeddingModel(r.embedModel);
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
	const r = await resolve();
	if (!r.baseUrl) throw new Error('AI provider not configured');
	const provider = getProviderFor(r);
	const seed = opts.seed ?? Math.floor(Math.random() * 2_147_483_647);
	const { text } = await generateText({
		model: provider(opts.model ?? r.chatModel),
		prompt,
		temperature: opts.temperature ?? 1.0,
		topP: 0.95,
		seed,
		...(opts.json
			? {
					providerOptions: {
						[r.providerName]: { response_format: { type: 'json_object' } },
					},
				}
			: {}),
	});
	return text;
}

// Avoid an unused-import warning when AppConfig is referenced only in JSDoc
type _UnusedAppConfigRef = AppConfig;
