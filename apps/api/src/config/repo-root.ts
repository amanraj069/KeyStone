import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Finds the monorepo root by walking up from `start` until we see
 * pnpm-workspace.yaml. Used so `.env` and a relative DATA_DIR mean the same
 * thing whether you run from the repo root or from apps/api.
 * Falls back to `start` (e.g. inside a Docker image with no workspace file).
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start); // reached filesystem root
    dir = parent;
  }
}
