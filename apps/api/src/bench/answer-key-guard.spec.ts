import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { findRepoRoot } from '../config/repo-root';

/**
 * Backstop for the ESLint rule: no TypeScript/JavaScript file in apps/ or
 * packages/ may name the answer-key folder, except the benchmark's own code.
 */
const FOLDER = ['answer', 'key'].join('_');
const ALLOWED = [['apps', 'api', 'src', 'bench'].join(sep) + sep];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', 'out', 'build', 'coverage']);
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(join(dir, entry.name));
    return SOURCE.test(entry.name) ? [join(dir, entry.name)] : [];
  });
}

describe('answer key guard', () => {
  it('only src/bench/ names the answer-key folder', () => {
    const root = findRepoRoot(__dirname);
    const offenders = ['apps', 'packages']
      .flatMap((top) => sourceFiles(join(root, top)))
      .map((file) => relative(root, file))
      // eslint.config.mjs files name the folder only to forbid it.
      .filter((file) => !file.endsWith('eslint.config.mjs') && !ALLOWED.some((prefix) => file.startsWith(prefix)))
      .filter((file) => readFileSync(join(root, file), 'utf8').includes(FOLDER));
    expect(offenders).toEqual([]);
  });

  it('only the bench imports the answer-key reader', () => {
    const root = findRepoRoot(__dirname);
    const offenders = sourceFiles(join(root, 'apps', 'api'))
      .map((file) => relative(root, file))
      .filter((file) => !file.startsWith(ALLOWED[0]) && file !== join('apps', 'api', 'scripts', 'bench.ts'))
      .filter((file) => /from\s+['"][^'"]*bench\/answer-key['"]/.test(readFileSync(join(root, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
