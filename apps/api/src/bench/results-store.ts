import { type BenchResults, BenchResultsSchema } from '@keystone/shared';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RESULTS_DIR, RESULTS_JSON, RESULTS_MD } from './bench.constants';

/** DATA_DIR/bench/results.json and results.md, or <name>.json / <name>.md for a named run (--out). */
export function resultsPaths(dataDir: string, name?: string): { json: string; md: string } {
  const dir = join(dataDir, RESULTS_DIR);
  return name ? { json: join(dir, `${name}.json`), md: join(dir, `${name}.md`) } : { json: join(dir, RESULTS_JSON), md: join(dir, RESULTS_MD) };
}

/** Writes both files atomically (temp file + rename), so GET /bench/results never reads half a file. */
export async function writeResults(dataDir: string, results: BenchResults, markdown: string, name?: string): Promise<{ json: string; md: string }> {
  const paths = resultsPaths(dataDir, name);
  await mkdir(join(dataDir, RESULTS_DIR), { recursive: true });
  for (const [path, text] of [
    [paths.json, `${JSON.stringify(BenchResultsSchema.parse(results), null, 2)}\n`],
    [paths.md, markdown],
  ] as const) {
    await writeFile(`${path}.tmp`, text, 'utf8');
    await rename(`${path}.tmp`, path);
  }
  return paths;
}

/** The last results, validated; null when the benchmark has not been run. */
export async function readResults(dataDir: string): Promise<BenchResults | null> {
  try {
    return BenchResultsSchema.parse(JSON.parse(await readFile(resultsPaths(dataDir).json, 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
