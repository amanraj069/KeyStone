import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Long text lives outside the graph (AGENTS.md section 3): artifact bodies are
 * stored here, keyed by artifact id, and the graph keeps only bodyLength.
 */
export interface TextStore {
  put(kind: 'artifacts' | 'chunks', id: string, text: string): Promise<void>;
  get(kind: 'artifacts' | 'chunks', id: string): Promise<string | null>;
}

/** TextStore on the local disk: DATA_DIR/text/<kind>/<encoded id>.txt */
export class LocalTextStore implements TextStore {
  constructor(private readonly dataDir: string) {}

  async put(kind: 'artifacts' | 'chunks', id: string, text: string): Promise<void> {
    const dir = join(this.dataDir, 'text', kind);
    await mkdir(dir, { recursive: true });
    await writeFile(this.pathFor(kind, id), text, 'utf8');
  }

  async get(kind: 'artifacts' | 'chunks', id: string): Promise<string | null> {
    try {
      return await readFile(this.pathFor(kind, id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  /** Ids contain characters like ':' and '/', so they are URL-encoded into a safe file name. */
  private pathFor(kind: string, id: string): string {
    return join(this.dataDir, 'text', kind, `${encodeURIComponent(id)}.txt`);
  }
}
