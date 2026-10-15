// @google/genai 2.x ships ESM type declarations, which a CommonJS file may only
// import as types (resolution-mode "import"). The SDK itself is loaded with a
// dynamic import() on first use; that also means it is never loaded when
// USE_OPENAI=yes.
import type { GoogleGenAI } from '@google/genai' with { 'resolution-mode': 'import' };
import type { LlmJsonRequest, LlmJsonResult, LlmProvider } from './llm.types';

/** The two SDK methods this provider uses (tests pass fakes with this shape). */
export type GeminiClient = Pick<GoogleGenAI, 'models'>;

/**
 * Gemini via @google/genai. Several API keys rotate round-robin: every call
 * (including LlmService's retry after a 429 or quota error) uses the next key.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;
  private clients: GeminiClient[] | null;
  private nextClient = 0;

  constructor(
    private readonly apiKeys: string[],
    readonly model: string,
    readonly embedModel: string,
    clients?: GeminiClient[],
  ) {
    this.clients = clients ?? null;
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResult> {
    const response = await (await this.client()).models.generateContent({
      model: this.model,
      contents: request.prompt,
      config: {
        systemInstruction: request.system,
        responseMimeType: 'application/json',
        ...(request.jsonSchema ? { responseJsonSchema: request.jsonSchema } : {}),
      },
    });
    const text = response.text;
    if (!text) throw new Error(`Gemini returned no content for task "${request.task}"`);
    const usage = response.usageMetadata;
    return {
      text,
      usage: {
        inputTokens: usage?.promptTokenCount ?? 0,
        cachedInputTokens: usage?.cachedContentTokenCount ?? 0,
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        reasoningTokens: usage?.thoughtsTokenCount ?? 0,
      },
    };
  }

  async embed(texts: string[], dimensions: number): Promise<{ vectors: number[][]; inputTokens: number }> {
    const response = await (await this.client()).models.embedContent({
      model: this.embedModel,
      contents: texts,
      config: { outputDimensionality: dimensions },
    });
    // The embeddings endpoint does not report token usage.
    return { vectors: (response.embeddings ?? []).map((embedding) => embedding.values ?? []), inputTokens: 0 };
  }

  /** Next client in the rotation, creating all of them on first use. */
  private async client(): Promise<GeminiClient> {
    if (!this.clients) {
      const { GoogleGenAI: Client } = await import('@google/genai');
      this.clients = this.apiKeys.map((apiKey) => new Client({ apiKey }));
    }
    const client = this.clients[this.nextClient % this.clients.length];
    this.nextClient++;
    return client;
  }
}
