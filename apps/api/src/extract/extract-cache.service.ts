import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ArtifactExtraction } from './extract.schema';

/** One cached extraction: the answer plus the fingerprint of everything that produced it. */
interface CacheEntry {
  fingerprint: string;
  docId: string;
  createdAt: string;
  value: ArtifactExtraction;
}

/**
 * Extraction results per artifact at DATA_DIR/cache/extract/<doc_id>.json.
 * A cached result is only reused if its fingerprint (prompt version, provider,
 * model and a hash of the document) still matches, so improving the prompt or
 * switching model re-extracts instead of silently reusing old answers.
 * S3 storage (when S3_BUCKET is set) is planned for Stage 14.
 */
export class ExtractCacheService {
  private readonly dir: string;

  constructor(dataDir: string, s3Bucket?: string) {
    if (s3Bucket) throw new Error('S3 extraction cache is not implemented yet (Stage 14); unset S3_BUCKET');
    this.dir = join(dataDir, 'cache', 'extract');
  }

  async get(docId: string, fingerprint: string): Promise<ArtifactExtraction | null> {
    try {
      const entry = JSON.parse(await readFile(this.pathFor(docId), 'utf8')) as CacheEntry;
      return entry.fingerprint === fingerprint ? entry.value : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async set(docId: string, fingerprint: string, value: ArtifactExtraction): Promise<void> {
    const path = this.pathFor(docId);
    await mkdir(dirname(path), { recursive: true });
    const entry: CacheEntry = { fingerprint, docId, createdAt: new Date().toISOString(), value };
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(entry), 'utf8');
    await rename(temp, path);
  }

  /** Doc ids contain ':' and '/', so they are URL-encoded into a safe file name. */
  private pathFor(docId: string): string {
    return join(this.dir, `${encodeURIComponent(docId)}.json`);
  }
}
