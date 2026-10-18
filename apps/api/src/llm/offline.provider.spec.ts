import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { LlmCacheMissError, type LlmProvider, type LlmSettings } from './llm.types';
import { LlmService } from './llm.service';
import { OfflineProvider, offlineSettings } from './offline.provider';

function settings(cacheDir: string, provider: 'openai' | 'gemini' = 'openai'): LlmSettings {
  return {
    provider,
    openai: { apiKey: 'sk-test', model: 'gpt-5-nano', embedModel: 'text-embedding-3-small', reasoningEffort: 'minimal' },
    gemini: { apiKeys: [], model: 'gemini-2.5-flash', embedModel: 'gemini-embedding-001' },
    embedDim: 3,
    cacheDir,
    cacheOnly: false,
    concurrency: 2,
  };
}

/** A working provider with the same name and models, used to fill the cache. */
function online(): LlmProvider {
  return {
    name: 'openai',
    model: 'gpt-5-nano',
    embedModel: 'text-embedding-3-small',
    generateJson: async () => ({ text: '{"ok": true}', usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0 } }),
    embed: async (texts, dim) => ({ vectors: texts.map(() => Array.from({ length: dim }, () => 0.5)), inputTokens: 1 }),
  };
}

describe('OfflineProvider (seed: zero API calls)', () => {
  let dir = '';
  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'keystone-offline-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('mirrors the configured provider name and models, which are part of every cache key', () => {
    expect(new OfflineProvider(settings(dir))).toMatchObject({ name: 'openai', model: 'gpt-5-nano', embedModel: 'text-embedding-3-small' });
    expect(new OfflineProvider(settings(dir, 'gemini'))).toMatchObject({ name: 'gemini', model: 'gemini-2.5-flash', embedModel: 'gemini-embedding-001' });
  });

  it('answers what an online run cached, and refuses everything else without an API call', async () => {
    const schema = z.object({ ok: z.boolean() });
    const request = { task: 't', system: 's', prompt: 'p' };
    await new LlmService(settings(dir), online()).generateObject(schema, request);
    await new LlmService(settings(dir), online()).embed(['cached text']);

    const offline = new LlmService(offlineSettings(settings(dir)), new OfflineProvider(settings(dir)));
    await expect(offline.generateObject(schema, request)).resolves.toEqual({ ok: true });
    await expect(offline.embed(['cached text'])).resolves.toEqual([[0.5, 0.5, 0.5]]);
    await expect(offline.generateObject(schema, { ...request, prompt: 'new' })).rejects.toBeInstanceOf(LlmCacheMissError);
    await expect(offline.embed(['new text'])).rejects.toBeInstanceOf(LlmCacheMissError);
    expect(offline.usage()).toMatchObject({ jsonCalls: 0, embedCalls: 0 });
  });

  it('uncachedEmbeddings lists the positions of texts with no cached vector', async () => {
    await new LlmService(settings(dir), online()).embed(['a', 'c']);
    const offline = new LlmService(offlineSettings(settings(dir)), new OfflineProvider(settings(dir)));
    await expect(offline.uncachedEmbeddings(['a', 'b', 'c', 'd'])).resolves.toEqual([1, 3]);
  });
});
