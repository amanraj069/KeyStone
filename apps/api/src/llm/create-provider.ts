import { GeminiProvider } from './gemini.provider';
import { LlmConfigError, type LlmProvider, type LlmSettings } from './llm.types';
import { OpenAiProvider } from './openai.provider';

/** Builds the provider chosen by USE_OPENAI, failing clearly if its key is missing. */
export function createProvider(settings: LlmSettings): LlmProvider {
  if (settings.provider === 'openai') {
    if (!settings.openai.apiKey) {
      throw new LlmConfigError('USE_OPENAI=yes but OPENAI_API_KEY is empty. Set it in .env.');
    }
    const { apiKey, model, embedModel, reasoningEffort } = settings.openai;
    return new OpenAiProvider(apiKey, model, embedModel, reasoningEffort);
  }
  if (settings.gemini.apiKeys.length === 0) {
    throw new LlmConfigError('USE_OPENAI is not yes, so Gemini is used, but GEMINI_API_KEYS is empty. Set it in .env.');
  }
  return new GeminiProvider(settings.gemini.apiKeys, settings.gemini.model, settings.gemini.embedModel);
}
