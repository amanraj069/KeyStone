import { LlmCacheMissError, type LlmJsonResult, type LlmProvider, type LlmSettings } from './llm.types';

/**
 * A provider that never talks to a vendor. The seed command (SeedService) gives it
 * to its own LlmService, so a rebuild can only be answered from the cache:
 * any request that is not cached fails here instead of reaching OpenAI or Gemini.
 *
 * It reports the same name and models as the configured provider, because those
 * are part of every cache key: a different name would make every entry a miss.
 */
export class OfflineProvider implements LlmProvider {
  readonly name: LlmProvider['name'];
  readonly model: string;
  readonly embedModel: string;

  constructor(settings: LlmSettings) {
    this.name = settings.provider;
    this.model = settings.provider === 'openai' ? settings.openai.model : settings.gemini.model;
    this.embedModel = settings.provider === 'openai' ? settings.openai.embedModel : settings.gemini.embedModel;
  }

  generateJson(): Promise<LlmJsonResult> {
    return Promise.reject(new LlmCacheMissError('Offline: this answer is not in the LLM cache and no API call is allowed'));
  }

  embed(): Promise<{ vectors: number[][]; inputTokens: number }> {
    return Promise.reject(new LlmCacheMissError('Offline: this embedding is not in the LLM cache and no API call is allowed'));
  }
}

/** The same settings with cacheOnly forced on: a cache miss throws before the provider is even asked. */
export function offlineSettings(settings: LlmSettings): LlmSettings {
  return { ...settings, cacheOnly: true };
}
