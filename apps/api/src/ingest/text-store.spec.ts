import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalTextStore } from './text-store';

describe('LocalTextStore', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'keystone-text-'));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips text, including ids with ":" and "/"', async () => {
    const store = new LocalTextStore(dir);
    await store.put('artifacts', 'slack_x_2026-01-01T09:00:00/a', 'hello');
    await expect(store.get('artifacts', 'slack_x_2026-01-01T09:00:00/a')).resolves.toBe('hello');
  });

  it('returns null for a missing id', async () => {
    await expect(new LocalTextStore(dir).get('artifacts', 'nope')).resolves.toBeNull();
  });
});
