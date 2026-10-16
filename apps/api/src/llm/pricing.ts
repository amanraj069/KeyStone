import type { LlmTokenUsage } from './llm.types';

/**
 * USD per 1M tokens, for cost reports only (billing is decided by the vendor).
 * gpt-5-nano: from the OpenAI price list the user provided. Others: check the
 * vendor's pricing page before relying on them.
 */
export const PRICES_PER_MILLION: Readonly<Record<string, { input: number; cachedInput: number; output: number }>> = {
  'gpt-5-nano': { input: 0.05, cachedInput: 0.005, output: 0.4 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2.0 },
  // Embeddings bill input tokens only.
  'text-embedding-3-small': { input: 0.02, cachedInput: 0.02, output: 0 },
};

/** Cost of `usage` on `model`, or null if the model has no price entry. Reasoning is already inside outputTokens. */
export function costUsd(model: string, usage: LlmTokenUsage): number | null {
  const price = PRICES_PER_MILLION[model];
  if (!price) return null;
  const freshInput = usage.inputTokens - usage.cachedInputTokens;
  return (freshInput * price.input + usage.cachedInputTokens * price.cachedInput + usage.outputTokens * price.output) / 1e6;
}
