import { type BenchResults, BenchResultsSchema } from '@keystone/shared';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findRepoRoot } from '../config/repo-root';
import { PUBLISHED_RESULTS_DIR, RESULTS_DIR, RESULTS_JSON, RESULTS_MD } from './bench.constants';

/** DATA_DIR/bench/results.json and results.md, or <name>.json / <name>.md for a named run (--out). */
export function resultsPaths(dataDir: string, name?: string): { json: string; md: string } {
  const dir = join(dataDir, RESULTS_DIR);
  return name ? { json: join(dir, `${name}.json`), md: join(dir, `${name}.md`) } : { json: join(dir, RESULTS_JSON), md: join(dir, RESULTS_MD) };
}

/**
 * The published results: apps/api/bench-results/results.json and results.md, tracked
 * by git and copied into the API image, so a new run reaches the deployed site with a
 * commit instead of an upload of DATA_DIR. Found from the repo root (also /repo in Docker).
 */
export function publishedPaths(root: string = findRepoRoot()): { json: string; md: string } {
  const dir = join(root, PUBLISHED_RESULTS_DIR);
  return { json: join(dir, RESULTS_JSON), md: join(dir, RESULTS_MD) };
}

/** Writes both files atomically (temp file + rename), so GET /bench/results never reads half a file. */
export async function writeResults(dataDir: string, results: BenchResults, markdown: string, name?: string): Promise<{ json: string; md: string }> {
  const paths = resultsPaths(dataDir, name);
  await mkdir(join(dataDir, RESULTS_DIR), { recursive: true });
  await writePair(paths, results, markdown);
  return paths;
}

/** Writes results.json and results.md to the tracked folder (commit them to publish a run). */
export async function publishResults(results: BenchResults, markdown: string, root?: string): Promise<{ json: string; md: string }> {
  const paths = publishedPaths(root);
  await mkdir(join(paths.json, '..'), { recursive: true });
  await writePair(paths, results, markdown);
  return paths;
}

async function writePair(paths: { json: string; md: string }, results: BenchResults, markdown: string): Promise<void> {
  for (const [path, text] of [
    [paths.json, `${JSON.stringify(BenchResultsSchema.parse(results), null, 2)}\n`],
    [paths.md, markdown],
  ] as const) {
    await writeFile(`${path}.tmp`, text, 'utf8');
    await rename(`${path}.tmp`, path);
  }
}

/**
 * The results the site shows, validated: the published (tracked) results first, else
 * DATA_DIR/bench/results.json from a local run; null when neither exists.
 */
export async function readResults(dataDir: string, root?: string): Promise<BenchResults | null> {
  for (const path of [publishedPaths(root).json, resultsPaths(dataDir).json]) {
    try {
      return BenchResultsSchema.parse(JSON.parse(await readFile(path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return null;
}
