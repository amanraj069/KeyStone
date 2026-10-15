/** Which LLM vendor answers: OpenAI when USE_OPENAI=yes, otherwise Gemini. */
export type LlmProviderName = 'openai' | 'gemini';

/** A request for one JSON object. `task` names the job (e.g. "extract-systems") for logs and the cache. */
export interface LlmJsonRequest {
  task: string;
  system: string;
  prompt: string;
  /** JSON Schema of the expected answer. Gemini enforces it (responseJsonSchema); OpenAI uses JSON mode. */
  jsonSchema?: unknown;
}

/** Tokens one or more LLM calls used, as reported by the provider. Reasoning tokens are billed as output. */
export interface LlmTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export const NO_TOKENS: LlmTokenUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

/** The raw answer of one JSON call and what it cost. */
export interface LlmJsonResult {
  text: string;
  usage: LlmTokenUsage;
}

/** OpenAI reasoning effort for GPT-5 models: lower is cheaper and faster. */
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/**
 * What every provider must do. Providers are thin wrappers over a vendor SDK:
 * caching, JSON parsing and Zod validation live in LlmService, so they behave
 * the same whichever vendor is used.
 */
export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  readonly embedModel: string;
  /** Returns the model's raw text (which should be one JSON object) and its token usage. */
  generateJson(request: LlmJsonRequest): Promise<LlmJsonResult>;
  /** One vector of exactly `dimensions` numbers per input text, in order, plus input tokens used. */
  embed(texts: string[], dimensions: number): Promise<{ vectors: number[][]; inputTokens: number }>;
}

/** Settings for LlmService, built from env. API keys never leave this object. */
export interface LlmSettings {
  provider: LlmProviderName;
  openai: { apiKey: string | undefined; model: string; embedModel: string; reasoningEffort: ReasoningEffort };
  gemini: { apiKeys: string[]; model: string; embedModel: string };
  embedDim: number;
  /** Folder for cached LLM outputs (DATA_DIR/llm-cache). */
  cacheDir: string;
  /** Never call the LLM; a cache miss throws (proves reruns cost zero LLM calls). */
  cacheOnly: boolean;
  /** At most this many LLM requests in flight at once (LLM_CONCURRENCY). */
  concurrency: number;
}

/** Injection tokens. LLM_PROVIDER is optional and only set by tests to swap in a fake. */
export const LLM_SETTINGS = Symbol('LLM_SETTINGS');
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

/** The LLM is configured wrongly (missing key for the chosen provider). */
export class LlmConfigError extends Error {
  override name = 'LlmConfigError';
}

/** LLM_CACHE_ONLY=yes and the answer is not cached. */
export class LlmCacheMissError extends Error {
  override name = 'LlmCacheMissError';
}
