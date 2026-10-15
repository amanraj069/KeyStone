import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Every LLM output is cached on disk (AGENTS.md section 3), keyed by a hash of
 * everything that could change the answer: provider, model, task, prompt...
 * The same request never calls the LLM twice, and the cache can be kept to
 * rebuild the graph with zero LLM calls. API keys are never part of the key or the file.
 */
export class LlmCache {
  constructor(private readonly dir: string) {}

  /** sha256 of the request parts, with object keys sorted so the hash is stable. */
  static key(parts: Record<string, unknown>): string {
    return createHash('sha256').update(stableStringify(parts)).digest('hex');
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const entry = JSON.parse(await readFile(this.pathFor(key), 'utf8')) as { value: T };
      return entry.value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Writes atomically (temp file + rename), so a crash never leaves half a file. */
  async set(key: string, value: unknown, meta: Record<string, unknown>): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify({ meta, value }), 'utf8');
    await rename(temp, path);
  }

  /** Files are spread over 256 sub-folders by the first two hex characters. */
  private pathFor(key: string): string {
    return join(this.dir, key.slice(0, 2), `${key}.json`);
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
