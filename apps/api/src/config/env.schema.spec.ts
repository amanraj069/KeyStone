import { isAbsolute } from 'node:path';
import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const minimal = { FALKOR_PASSWORD: 'secret-value' };

  it('applies defaults when only the password is set', () => {
    const env = validateEnv(minimal);
    expect(env.FALKOR_HOST).toBe('localhost');
    expect(env.FALKOR_PORT).toBe(6379);
    expect(env.EMBED_DIM).toBe(768);
    expect(env.MEMORY_WARN_MB).toBe(3000);
    expect(env.MEMORY_MAX_MB).toBe(3600);
    expect(env.TEXT_STORE).toBe('local');
    expect(env.GEMINI_API_KEYS).toEqual([]);
    expect(env.USE_OPENAI).toBe(false);
    expect(env.OPENAI_MODEL).toBe('gpt-5-nano');
    expect(env.LLM_CACHE_ONLY).toBe(false);
    expect(isAbsolute(env.DATA_DIR)).toBe(true);
  });

  it('splits GEMINI_API_KEYS on commas and drops blanks', () => {
    const env = validateEnv({ ...minimal, GEMINI_API_KEYS: ' k1, k2 ,,k3 ' });
    expect(env.GEMINI_API_KEYS).toEqual(['k1', 'k2', 'k3']);
  });

  it.each([
    ['yes', true],
    ['YES', true],
    ['true', true],
    ['1', true],
    ['no', false],
    ['false', false],
    ['', false],
  ])('reads USE_OPENAI=%p as %p', (raw, expected) => {
    expect(validateEnv({ ...minimal, USE_OPENAI: raw }).USE_OPENAI).toBe(expected);
  });

  it('rejects an unclear USE_OPENAI value', () => {
    expect(() => validateEnv({ ...minimal, USE_OPENAI: 'maybe' })).toThrow(/USE_OPENAI/);
  });

  it('requires FALKOR_PASSWORD', () => {
    expect(() => validateEnv({})).toThrow(/FALKOR_PASSWORD/);
  });

  it('requires S3_BUCKET when TEXT_STORE=s3', () => {
    expect(() => validateEnv({ ...minimal, TEXT_STORE: 's3', S3_BUCKET: '' })).toThrow(/S3_BUCKET/);
  });

  it('rejects a non-integer EMBED_DIM (it is interpolated into Cypher)', () => {
    expect(() => validateEnv({ ...minimal, EMBED_DIM: '768; DROP' })).toThrow(/EMBED_DIM/);
    expect(() => validateEnv({ ...minimal, EMBED_DIM: '7.5' })).toThrow(/EMBED_DIM/);
  });

  it('requires MEMORY_WARN_MB below MEMORY_MAX_MB', () => {
    expect(() => validateEnv({ ...minimal, MEMORY_WARN_MB: '3700', MEMORY_MAX_MB: '3600' })).toThrow(/MEMORY_WARN_MB/);
  });

  it('never echoes the password in the error message', () => {
    const run = () => validateEnv({ FALKOR_PASSWORD: 'hunter2-secret', FALKOR_PORT: 'not-a-port' });
    expect(run).toThrow(/FALKOR_PORT/);
    expect(run).not.toThrow(/hunter2-secret/);
  });
});
