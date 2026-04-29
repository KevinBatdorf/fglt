/**
 * Backward-compat shim. The AI provider abstraction now lives in `./ai`
 * and supports any OpenAI-compatible endpoint (Ollama, OpenAI, Together,
 * Groq, etc.). Existing call sites import from this file unchanged.
 */
export {
	chat,
	embed,
	embedSingle,
	getChatModel,
	getEmbedModel,
	getProviderInfo,
	isAIEnabled,
	isOllamaEnabled,
	toVectorLiteral,
} from './ai';
