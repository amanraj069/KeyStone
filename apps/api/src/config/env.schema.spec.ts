import { isAbsolute } from 'node:path';
import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const minimal = { FALKOR_PASSWORD: 'secret-value' };

  it('applies defaults when only the password is set', () => {
    const env = validateEnv(minimal);
    expect(env.FALKOR_HOST).toBe('localhost');
    expect(env.FALKOR_PORT).toBe(6379);
    expect(env.EMBED_DIM).toBe(768);
    expect(env.TEXT_STORE).toBe('local');
    expect(env.GEMINI_API_KEYS).toEqual([]);
    expect(isAbsolute(env.DATA_DIR)).toBe(true);
  });

  it('splits GEMINI_API_KEYS on commas and drops blanks', () => {
    const env = validateEnv({ ...minimal, GEMINI_API_KEYS: ' k1, k2 ,,k3 ' });
    expect(env.GEMINI_API_KEYS).toEqual(['k1', 'k2', 'k3']);
  });

  it('requires FALKOR_PASSWORD', () => {
    expect(() => validateEnv({})).toThrow(/FALKOR_PASSWORD/);
  });

  it('requires S3_BUCKET when TEXT_STORE=s3', () => {
    expect(() => validateEnv({ ...minimal, TEXT_STORE: 's3', S3_BUCKET: '' })).toThrow(/S3_BUCKET/);
  });

  it('never echoes the password in the error message', () => {
    const run = () => validateEnv({ FALKOR_PASSWORD: 'hunter2-secret', FALKOR_PORT: 'not-a-port' });
    expect(run).toThrow(/FALKOR_PORT/);
    expect(run).not.toThrow(/hunter2-secret/);
  });
});
