import OpenAI from 'openai';
import type { LlmJsonRequest, LlmJsonResult, LlmProvider, ReasoningEffort } from './llm.types';

/** OpenAI via the official SDK: Chat Completions in JSON mode, and the embeddings endpoint. */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai' as const;
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    readonly embedModel: string,
    private readonly reasoningEffort: ReasoningEffort = 'minimal',
    client?: OpenAI,
  ) {
    // Retries (429, 5xx) are done by LlmService for both vendors, so the SDK's are off.
    this.client = client ?? new OpenAI({ apiKey, maxRetries: 0, timeout: 120_000 });
  }

  async generateJson(request: LlmJsonRequest): Promise<LlmJsonResult> {
    // JSON mode guarantees syntactically valid JSON. Temperature is not sent:
    // the GPT-5 family only accepts the default. reasoning_effort only applies
    // to reasoning models (GPT-5, o-series), so it is not sent to others.
    const completion = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      ...(isReasoningModel(this.model) ? { reasoning_effort: this.reasoningEffort } : {}),
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
    });
    const text = completion.choices[0]?.message?.content;
    if (!text) throw new Error(`OpenAI returned no content for task "${request.task}"`);
    const usage = completion.usage;
    return {
      text,
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      },
    };
  }

  async embed(texts: string[], dimensions: number): Promise<{ vectors: number[][]; inputTokens: number }> {
    const response = await this.client.embeddings.create({ model: this.embedModel, input: texts, dimensions });
    // The API returns one item per input with its index; sort to be safe.
    const vectors = [...response.data].sort((a, b) => a.index - b.index).map((item) => item.embedding);
    return { vectors, inputTokens: response.usage?.prompt_tokens ?? 0 };
  }
}

/** GPT-5 and o-series models reason before answering and accept reasoning_effort. */
export function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/.test(model);
}
