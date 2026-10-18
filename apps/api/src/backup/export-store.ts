import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Where exports (actions-*.jsonl) are written: DATA_DIR on the local disk, or the
 * S3 bucket when TEXT_STORE=s3. Keys are paths like "exports/actions-latest.jsonl".
 */
export interface ExportStore {
  put(key: string, body: string): Promise<void>;
  /** The file's text, or null if it does not exist. */
  get(key: string): Promise<string | null>;
  /** Where a key ends up, for logs and API answers ("/repo/data/exports/..." or "s3://bucket/exports/..."). */
  locate(key: string): string;
}

/** Exports on the local disk, under DATA_DIR. */
export class LocalExportStore implements ExportStore {
  constructor(private readonly dataDir: string) {}

  /** Writes a temp file and renames it, so a crash never leaves half an export. */
  async put(key: string, body: string): Promise<void> {
    const path = this.locate(key);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, body, 'utf8');
    await rename(temp, path);
  }

  async get(key: string): Promise<string | null> {
    try {
      return await readFile(this.locate(key), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  locate(key: string): string {
    return join(this.dataDir, key);
  }
}

/**
 * Exports in an S3 bucket. Credentials and region come from the AWS SDK's usual
 * sources (the EC2 instance role, or AWS_* env vars); they are never logged.
 */
export class S3ExportStore implements ExportStore {
  constructor(
    private readonly bucket: string,
    private readonly client: Pick<S3Client, 'send'> = new S3Client({}),
  ) {}

  async put(key: string, body: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: 'application/x-ndjson' }));
  }

  async get(key: string): Promise<string | null> {
    try {
      const reply = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return (await reply.Body?.transformToString('utf8')) ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  locate(key: string): string {
    return `s3://${this.bucket}/${key}`;
  }
}

/** S3 says "NoSuchKey" (or a bare 404) for an object that does not exist. */
function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

/** The export store for the configured TEXT_STORE (S3 needs S3_BUCKET, which env validation enforces). */
export function exportStoreFor(env: { TEXT_STORE: 'local' | 's3'; S3_BUCKET?: string; DATA_DIR: string }): ExportStore {
  if (env.TEXT_STORE === 's3' && env.S3_BUCKET) return new S3ExportStore(env.S3_BUCKET);
  return new LocalExportStore(env.DATA_DIR);
}
