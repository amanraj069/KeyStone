import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createProvider } from './create-provider';
import { GeminiProvider } from './gemini.provider';
import { LlmCacheMissError, LlmConfigError, type LlmProvider, type LlmSettings } from './llm.types';
import { LlmService, parseJsonObject } from './llm.service';
import { isReasoningModel, OpenAiProvider } from './openai.provider';

const SECRET = 'sk-test-SECRET-never-cache-me';

function settings(cacheDir: string, overrides: Partial<LlmSettings> = {}): LlmSettings {
  return {
    provider: 'openai',
    openai: { apiKey: SECRET, model: 'gpt-5-mini', embedModel: 'text-embedding-3-small', reasoningEffort: 'minimal' },
    gemini: { apiKeys: [], model: 'gemini-2.5-flash', embedModel: 'gemini-embedding-001' },
    embedDim: 4,
    cacheDir,
    cacheOnly: false,
    concurrency: 2,
    ...overrides,
  };
}

/** A provider that records calls and returns canned answers. */
function fakeProvider(answer = '{"systems": ["TitanDB"]}'): LlmProvider & { json: jest.Mock; vectors: jest.Mock } {
  const json = jest.fn().mockResolvedValue({
    text: answer,
    usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 30, reasoningTokens: 10 },
  });
  const vectors = jest.fn(async (texts: string[], dim: number) => ({
    vectors: texts.map((_, i) => Array.from({ length: dim }, () => i)),
    inputTokens: texts.length * 5,
  }));
  return { name: 'openai', model: 'gpt-5-mini', embedModel: 'text-embedding-3-small', generateJson: json, embed: vectors, json, vectors };
}

const Systems = z.object({ systems: z.array(z.string()) });
const request = { task: 'extract-systems', system: 'Find systems.', prompt: 'TitanDB is slow.' };

describe('createProvider (USE_OPENAI switch)', () => {
  it('USE_OPENAI=yes with a key -> OpenAI', () => {
    expect(createProvider(settings('/x'))).toBeInstanceOf(OpenAiProvider);
  });

  it('USE_OPENAI=yes without a key -> clear error', () => {
    const noKey = { apiKey: undefined, model: 'm', embedModel: 'e', reasoningEffort: 'minimal' as const };
    expect(() => createProvider(settings('/x', { openai: noKey }))).toThrow(LlmConfigError);
  });

  it('USE_OPENAI=no with Gemini keys -> Gemini', () => {
    const s = settings('/x', { provider: 'gemini', gemini: { apiKeys: ['g1', 'g2'], model: 'gemini-2.5-flash', embedModel: 'e' } });
    expect(createProvider(s)).toBeInstanceOf(GeminiProvider);
  });

  it('USE_OPENAI=no without Gemini keys -> clear error', () => {
    expect(() => createProvider(settings('/x', { provider: 'gemini' }))).toThrow(/GEMINI_API_KEYS is empty/);
  });
});

describe('LlmService', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'keystone-llm-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('validates the answer and caches it: a repeat costs zero calls', async () => {
    const provider = fakeProvider();
    const llm = new LlmService(settings(dir), provider);

    await expect(llm.generateObject(Systems, request)).resolves.toEqual({ systems: ['TitanDB'] });
    await expect(llm.generateObject(Systems, request)).resolves.toEqual({ systems: ['TitanDB'] });
    expect(provider.json).toHaveBeenCalledTimes(1);
    expect(llm.usage()).toMatchObject({ jsonCalls: 1, jsonCacheHits: 1 });
    // Only the real call is counted in tokens.
    expect(llm.usage().tokens).toEqual({ inputTokens: 100, cachedInputTokens: 0, outputTokens: 30, reasoningTokens: 10 });
  });

  it('generateObjectWithUsage reports each call\'s own tokens, and zero for a cache hit', async () => {
    const llm = new LlmService(settings(dir), fakeProvider());
    await expect(llm.generateObjectWithUsage(Systems, request)).resolves.toMatchObject({
      cached: false,
      usage: { inputTokens: 100, outputTokens: 30 },
    });
    await expect(llm.generateObjectWithUsage(Systems, request)).resolves.toMatchObject({
      cached: true,
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it('a new process reads the same cache from disk', async () => {
    await new LlmService(settings(dir), fakeProvider()).generateObject(Systems, request);
    const second = fakeProvider();
    await new LlmService(settings(dir), second).generateObject(Systems, request);
    expect(second.json).not.toHaveBeenCalled();
  });

  it('tells the model to answer in JSON', async () => {
    const provider = fakeProvider();
    await new LlmService(settings(dir), provider).generateObject(Systems, request);
    expect(provider.json.mock.calls[0][0].system).toMatch(/JSON/);
  });

  it('gives up after 1 + 2 validation retries and caches nothing', async () => {
    const provider = fakeProvider('{"systems": "not a list"}'); // always invalid
    const llm = new LlmService(settings(dir), provider);
    await expect(llm.generateObject(Systems, request)).rejects.toThrow(/invalid after 3 tries/);
    await expect(llm.generateObject(Systems, request)).rejects.toThrow();
    expect(provider.json).toHaveBeenCalledTimes(6);
  });

  it('retries with the validation error in the prompt, then succeeds', async () => {
    const provider = fakeProvider();
    provider.json.mockResolvedValueOnce({
      text: '{"systems": [1]}',
      usage: { inputTokens: 50, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 0 },
    });
    const llm = new LlmService(settings(dir), provider);
    const answer = await llm.generateObjectWithUsage(Systems, request);

    expect(answer.value).toEqual({ systems: ['TitanDB'] });
    expect(provider.json).toHaveBeenCalledTimes(2);
    expect(provider.json.mock.calls[1][0].prompt).toMatch(/previous answer was rejected: systems\.0/);
    expect(answer.usage.inputTokens).toBe(150); // both tries are counted
  });

  it('sends a JSON Schema with the request (Gemini enforces it)', async () => {
    const provider = fakeProvider();
    await new LlmService(settings(dir), provider).generateObject(Systems, request);
    expect(provider.json.mock.calls[0][0].jsonSchema).toMatchObject({ type: 'object', properties: { systems: { type: 'array' } } });
  });

  it('never runs more provider calls at once than the concurrency setting', async () => {
    let inFlight = 0;
    let peak = 0;
    const provider = fakeProvider();
    provider.json.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
      return { text: '{"systems": []}', usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0 } };
    });
    const llm = new LlmService(settings(dir, { concurrency: 2 }), provider);
    await Promise.all(Array.from({ length: 6 }, (_, i) => llm.generateObject(Systems, { ...request, prompt: `doc ${i}` })));
    expect(peak).toBe(2);
  });

  it('LLM_CACHE_ONLY: a miss throws, a hit works', async () => {
    const cacheOnly = new LlmService(settings(dir, { cacheOnly: true }), fakeProvider());
    await expect(cacheOnly.generateObject(Systems, request)).rejects.toBeInstanceOf(LlmCacheMissError);

    await new LlmService(settings(dir), fakeProvider()).generateObject(Systems, request);
    await expect(cacheOnly.generateObject(Systems, request)).resolves.toEqual({ systems: ['TitanDB'] });
  });

  it('embeds only uncached texts and returns vectors in input order', async () => {
    const provider = fakeProvider();
    const llm = new LlmService(settings(dir), provider);
    await llm.embed(['a', 'b']);
    const result = await llm.embed(['b', 'c', 'a']);

    expect(result).toHaveLength(3);
    expect(result.every((v) => v.length === 4)).toBe(true);
    expect(provider.vectors).toHaveBeenLastCalledWith(['c'], 4);
    expect(llm.usage()).toMatchObject({ embedCalls: 2, embedCacheHits: 2 });
  });

  it('reads cached vectors back in input order across several read batches', async () => {
    const provider = fakeProvider();
    // Each vector holds its text's number, so the order can be checked.
    provider.vectors.mockImplementation(async (texts: string[], dim: number) => ({
      vectors: texts.map((text) => Array.from({ length: dim }, () => Number(text.slice(1)))),
      inputTokens: texts.length,
    }));
    const texts = Array.from({ length: 600 }, (_, i) => `t${i}`); // more than 2 x 256 cache files
    await new LlmService(settings(dir), provider).embed(texts);

    const fresh = new LlmService(settings(dir), provider);
    const result = await fresh.embed(texts);
    expect(result.map((vector) => vector[0])).toEqual(texts.map((_, i) => i));
    expect(fresh.usage()).toMatchObject({ embedCalls: 0, embedCacheHits: 600 });
    expect(await fresh.uncachedEmbeddings(['t5', 'new', 't599', 'other'])).toEqual([1, 3]);
  });

  it('rejects vectors of the wrong size', async () => {
    const provider = fakeProvider();
    provider.vectors.mockResolvedValueOnce({ vectors: [[1, 2]], inputTokens: 1 });
    await expect(new LlmService(settings(dir), provider).embed(['x'])).rejects.toThrow(/4 dims/);
  });

  it('never writes the API key into the cache', async () => {
    const llm = new LlmService(settings(dir), fakeProvider());
    await llm.generateObject(Systems, request);
    await llm.embed(['hello']);
    for (const sub of await readdir(dir)) {
      for (const file of await readdir(join(dir, sub))) {
        expect(await readFile(join(dir, sub, file), 'utf8')).not.toContain(SECRET);
      }
    }
  });
});

describe('isReasoningModel', () => {
  it.each([
    ['gpt-5-nano', true],
    ['gpt-5-mini', true],
    ['o4-mini', true],
    ['gpt-4o-mini', false],
    ['gpt-4.1-mini', false],
  ])('%s -> %p', (model, expected) => {
    expect(isReasoningModel(model)).toBe(expected);
  });
});

describe('parseJsonObject', () => {
  it('accepts a ```json fence', () => {
    expect(parseJsonObject('```json\n{"a": 1}\n```', 't')).toEqual({ a: 1 });
  });

  it('explains non-JSON answers', () => {
    expect(() => parseJsonObject('Sure! Here you go', 't')).toThrow(/not valid JSON/);
  });
});
