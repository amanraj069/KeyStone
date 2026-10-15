/**
 * Smoke test for the configured LLM provider. Run after putting a key in .env:
 *   pnpm llm-check
 * It makes one JSON call and one embedding call with the provider chosen by
 * USE_OPENAI (yes -> OpenAI, else Gemini), then repeats both to show they now
 * come from the cache (zero extra LLM calls). Prints PASS/FAIL per step.
 * The API key is never printed.
 */
import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { z } from 'zod';
import { validateEnv } from '../src/config/env.schema';
import { findRepoRoot } from '../src/config/repo-root';
import { llmSettingsFromEnv } from '../src/llm/llm-settings';
import { LlmService } from '../src/llm/llm.service';

const Answer = z.object({ capital: z.string(), confidence: z.number().min(0).max(1) });
const REQUEST = {
  task: 'llm-check',
  system: 'You answer geography questions.',
  prompt: 'What is the capital of France? Reply as {"capital": string, "confidence": number between 0 and 1}.',
};

async function main(): Promise<void> {
  loadDotenv({ path: join(findRepoRoot(), '.env'), quiet: true });
  const settings = llmSettingsFromEnv(validateEnv(process.env));
  const llm = new LlmService(settings);
  llm.onModuleInit(); // logs provider, model and whether the key is set

  let failures = 0;
  const step = async (label: string, work: () => Promise<string>) => {
    const started = performance.now();
    try {
      const detail = await work();
      console.log(`PASS  ${label.padEnd(30)} ${detail} (${Math.round(performance.now() - started)} ms)`);
    } catch (error) {
      failures++;
      console.log(`FAIL  ${label.padEnd(30)} ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  await step('JSON answer', async () => JSON.stringify(await llm.generateObject(Answer, REQUEST)));
  await step(`Embedding (${settings.embedDim} dims)`, async () => {
    const [vector] = await llm.embed(['Keystone LLM check']);
    return `${vector.length} numbers, first ${vector[0]?.toFixed(4)}`;
  });
  const before = llm.usage();
  await step('Repeat from cache', async () => {
    await llm.generateObject(Answer, REQUEST);
    await llm.embed(['Keystone LLM check']);
    const after = llm.usage();
    const extra = after.jsonCalls + after.embedCalls - (before.jsonCalls + before.embedCalls);
    if (extra !== 0) throw new Error(`${extra} extra LLM calls`);
    return '0 extra LLM calls';
  });

  console.log('\nUsage:', JSON.stringify(llm.usage()));
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error('LLM check could not run:', error instanceof Error ? error.message : error);
  process.exit(1);
});
