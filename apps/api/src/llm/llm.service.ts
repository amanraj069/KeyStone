import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { z } from 'zod';
import { createProvider } from './create-provider';
import { createLimiter } from './limiter';
import { LlmCache } from './llm-cache';
import {
  LLM_PROVIDER,
  LLM_SETTINGS,
  LlmCacheMissError,
  type LlmJsonRequest,
  type LlmProvider,
  type LlmSettings,
  type LlmTokenUsage,
  NO_TOKENS,
} from './llm.types';
import { withBackoff } from './retry';

/** Counters for this process: how often the LLM was really called vs. answered from cache. */
export interface LlmUsage {
  provider: string;
  model: string;
  jsonCalls: number;
  jsonCacheHits: number;
  embedCalls: number;
  embedCacheHits: number;
  /** Tokens of real (uncached) JSON calls. */
  tokens: LlmTokenUsage;
  /** Input tokens of real embedding calls. */
  embedTokens: number;
}

/** Texts per embedding request (both vendors accept at least 100). */
const EMBED_BATCH = 100;

/**
 * Embedding cache files read at the same time. Each file is ~17 KB of JSON, so reading
 * all ~12k at once held ~300 MB; 256 at a time keeps the seed inside a 1 GB instance.
 */
const CACHE_READ_BATCH = 256;

/** Tries per request for rate limits and server errors (1 + 4 retries with backoff). */
const TRANSIENT_ATTEMPTS = 5;

/** Extra tries when the answer is not valid JSON or fails the schema; the error is shown to the model. */
const VALIDATION_RETRIES = 2;

/** Added to every system prompt; OpenAI's JSON mode also requires the word "JSON". */
const JSON_INSTRUCTION = 'Respond with one JSON object only, no prose and no code fences.';

/**
 * The only way Keystone talks to an LLM.
 * - Provider: OpenAI when USE_OPENAI=yes, else Gemini (created on first use,
 *   so the API starts even without keys).
 * - Every answer is cached on disk; a repeated request costs no LLM call.
 * - Every JSON answer is validated with a Zod schema before it is used or cached.
 * - LLM_CACHE_ONLY=yes turns any cache miss into an error.
 */
@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private readonly cache: LlmCache;
  private provider: LlmProvider | null;
  private readonly counts = { jsonCalls: 0, jsonCacheHits: 0, embedCalls: 0, embedCacheHits: 0, embedTokens: 0 };
  private readonly tokens: LlmTokenUsage = { ...NO_TOKENS };
  private readonly limit: <T>(job: () => Promise<T>) => Promise<T>;

  constructor(
    @Inject(LLM_SETTINGS) private readonly settings: LlmSettings,
    @Optional() @Inject(LLM_PROVIDER) provider?: LlmProvider,
  ) {
    this.cache = new LlmCache(settings.cacheDir);
    this.provider = provider ?? null;
    this.limit = createLimiter(settings.concurrency);
  }

  /** Logs which provider is active and whether its key is set (never the key itself). */
  onModuleInit(): void {
    const { provider, openai, gemini } = this.settings;
    const model = provider === 'openai' ? `${openai.model}, reasoning ${openai.reasoningEffort}` : gemini.model;
    const embedModel = provider === 'openai' ? openai.embedModel : gemini.embedModel;
    const keySet = provider === 'openai' ? !!openai.apiKey : gemini.apiKeys.length > 0;
    this.logger.log(
      `LLM provider: ${provider} (model ${model}, embeddings ${embedModel} @ ${this.settings.embedDim} dims); ` +
        `API key ${keySet ? 'set' : 'MISSING'}; cache-only ${this.settings.cacheOnly ? 'yes' : 'no'}`,
    );
  }

  /** Asks for one JSON object and returns it validated by `schema`. Cached. */
  async generateObject<T>(schema: z.ZodType<T>, request: LlmJsonRequest): Promise<T> {
    return (await this.generateObjectWithUsage(schema, request)).value;
  }

  /**
   * Same as generateObject, plus this call's own token usage and whether it came
   * from the cache (usage is zero then). Safe to use with concurrent calls.
   */
  async generateObjectWithUsage<T>(
    schema: z.ZodType<T>,
    request: LlmJsonRequest,
  ): Promise<{ value: T; usage: LlmTokenUsage; cached: boolean }> {
    const provider = this.activeProvider();
    const system = `${request.system}\n\n${JSON_INSTRUCTION}`;
    const key = LlmCache.key({ kind: 'json', provider: provider.name, model: provider.model, task: request.task, system, prompt: request.prompt });

    const cached = await this.cache.get<unknown>(key);
    if (cached !== null) {
      this.counts.jsonCacheHits++;
      return { value: schema.parse(cached), usage: { ...NO_TOKENS }, cached: true };
    }
    this.assertMayCall(request.task);

    // Gemini can enforce the schema; describe the input side (before Zod transforms).
    const jsonSchema = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
    const usage: LlmTokenUsage = { ...NO_TOKENS };
    let prompt = request.prompt;
    for (let attempt = 0; ; attempt++) {
      const answer = await this.callProvider(provider, { ...request, system, prompt, jsonSchema });
      for (const field of Object.keys(usage) as (keyof LlmTokenUsage)[]) usage[field] += answer.usage[field];

      // Validate before caching: an invalid answer is never stored.
      const parsed = safeParseAnswer(schema, answer.text, request.task);
      if (parsed.ok) {
        await this.cache.set(key, parsed.value, { task: request.task, provider: provider.name, model: provider.model, createdAt: new Date().toISOString() });
        return { value: parsed.value, usage, cached: false };
      }
      if (attempt >= VALIDATION_RETRIES) throw new Error(`LLM answer for "${request.task}" invalid after ${attempt + 1} tries: ${parsed.error}`);
      // Ask again, telling the model exactly what was wrong.
      prompt = `${request.prompt}\n\nYour previous answer was rejected: ${parsed.error}\nReturn a corrected JSON object.`;
    }
  }

  /** One provider call: waits for a concurrency slot, retries rate limits and server errors with backoff. */
  private async callProvider(provider: LlmProvider, request: LlmJsonRequest) {
    const answer = await this.limit(async () => {
      // Timed inside the concurrency slot, so the log shows provider time, not queue time.
      const started = performance.now();
      const result = await withBackoff(
        () => provider.generateJson(request),
        TRANSIENT_ATTEMPTS,
        (attempt, delay, error) =>
          this.logger.warn(`LLM "${request.task}" retry ${attempt} in ${delay} ms: ${(error as Error).message?.slice(0, 120)}`),
      );
      this.logger.debug(`LLM ${provider.name}/${provider.model} "${request.task}" ${Math.round(performance.now() - started)} ms`);
      return result;
    });
    this.counts.jsonCalls++;
    for (const field of Object.keys(this.tokens) as (keyof LlmTokenUsage)[]) this.tokens[field] += answer.usage[field];
    return answer;
  }

  /** One EMBED_DIM vector per text, in order. Each text is cached separately; only misses are sent. */
  async embed(texts: string[]): Promise<number[][]> {
    const provider = this.activeProvider();
    const dim = this.settings.embedDim;
    const keys = this.embedKeys(provider, texts);

    const vectors = await this.cachedVectors(keys);
    const missing = vectors.flatMap((vector, index) => (vector === null ? [index] : []));
    this.counts.embedCacheHits += texts.length - missing.length;
    if (missing.length > 0) this.assertMayCall('embed');

    for (let start = 0; start < missing.length; start += EMBED_BATCH) {
      const batch = missing.slice(start, start + EMBED_BATCH);
      const { vectors: result, inputTokens } = await this.limit(() =>
        withBackoff(() => provider.embed(batch.map((index) => texts[index]), dim), TRANSIENT_ATTEMPTS),
      );
      this.counts.embedCalls++;
      this.counts.embedTokens += inputTokens;
      if (result.length !== batch.length || result.some((vector) => vector.length !== dim)) {
        throw new Error(`Embedding provider returned ${result.length} vectors, expected ${batch.length} of ${dim} dims`);
      }
      for (const [position, index] of batch.entries()) {
        vectors[index] = result[position];
        await this.cache.set(keys[index], result[position], { kind: 'embed', provider: provider.name, model: provider.embedModel, dim });
      }
    }
    return vectors as number[][];
  }

  /**
   * Positions of the texts whose embedding is NOT cached. Reads the cache only,
   * never calls the provider: the seed command uses it to list every missing
   * entry before it starts, instead of failing on the first one.
   */
  async uncachedEmbeddings(texts: string[]): Promise<number[]> {
    const keys = this.embedKeys(this.activeProvider(), texts);
    const vectors = await this.cachedVectors(keys);
    return vectors.flatMap((vector, index) => (vector === null ? [index] : []));
  }

  /** The cached vector of each key (null when missing), in order, CACHE_READ_BATCH files at a time. */
  private async cachedVectors(keys: string[]): Promise<(number[] | null)[]> {
    const vectors: (number[] | null)[] = [];
    for (let start = 0; start < keys.length; start += CACHE_READ_BATCH) {
      const batch = keys.slice(start, start + CACHE_READ_BATCH);
      vectors.push(...(await Promise.all(batch.map((key) => this.cache.get<number[]>(key)))));
    }
    return vectors;
  }

  /** The cache key of each text's embedding (embed and uncachedEmbeddings must agree on it). */
  private embedKeys(provider: LlmProvider, texts: string[]): string[] {
    const dim = this.settings.embedDim;
    return texts.map((text) => LlmCache.key({ kind: 'embed', provider: provider.name, model: provider.embedModel, dim, text }));
  }

  usage(): LlmUsage {
    const provider = this.settings.provider;
    const model = provider === 'openai' ? this.settings.openai.model : this.settings.gemini.model;
    return { provider, model, ...this.counts, tokens: { ...this.tokens } };
  }

  private activeProvider(): LlmProvider {
    this.provider ??= createProvider(this.settings);
    return this.provider;
  }

  private assertMayCall(task: string): void {
    if (this.settings.cacheOnly) {
      throw new LlmCacheMissError(`LLM_CACHE_ONLY=yes and "${task}" is not cached`);
    }
  }
}

/** Parses and validates an answer; returns a short error description instead of throwing. */
function safeParseAnswer<T>(schema: z.ZodType<T>, text: string, task: string): { ok: true; value: T } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = parseJsonObject(text, task);
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues.slice(0, 5).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
  return { ok: false, error: issues.join('; ') };
}

/** Parses the model's text as one JSON object, tolerating a ```json fence around it. */
export function parseJsonObject(raw: string, task: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`LLM answer for "${task}" is not valid JSON: ${text.slice(0, 120)}`);
  }
}
