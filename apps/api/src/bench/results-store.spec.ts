import { BenchResultsSchema } from '@keystone/shared';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publishedPaths, publishResults, readResults, writeResults } from './results-store';

describe('benchmark results store', () => {
  let root: string;
  let dataDir: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'keystone-bench-root-'));
    dataDir = join(root, 'data');
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it('serves the published (tracked) results first, else the local run, else nothing', async () => {
    // A real, valid results file: the published one in this repo.
    const sample = BenchResultsSchema.parse(JSON.parse(await readFile(join(__dirname, '../../bench-results/results.json'), 'utf8')));
    await expect(readResults(dataDir, root)).resolves.toBeNull();

    await writeResults(dataDir, { ...sample, generatedAt: '2026-01-01T00:00:00.000Z' }, '# local');
    await expect(readResults(dataDir, root)).resolves.toMatchObject({ generatedAt: '2026-01-01T00:00:00.000Z' });

    const paths = await publishResults({ ...sample, generatedAt: '2026-02-02T00:00:00.000Z' }, '# published', root);
    expect(paths).toEqual(publishedPaths(root));
    expect(paths.json).toBe(join(root, 'apps/api/bench-results/results.json'));
    await expect(readFile(paths.md, 'utf8')).resolves.toBe('# published');
    await expect(readResults(dataDir, root)).resolves.toMatchObject({ generatedAt: '2026-02-02T00:00:00.000Z' });
  });
});
