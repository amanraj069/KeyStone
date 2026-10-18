import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportStoreFor, LocalExportStore, S3ExportStore } from './export-store';

describe('LocalExportStore', () => {
  let dir = '';
  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'keystone-store-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('writes under DATA_DIR, reads back, and returns null for a missing file', async () => {
    const store = new LocalExportStore(dir);
    await store.put('exports/actions-latest.jsonl', '{"id":"a"}\n');
    expect(await readFile(join(dir, 'exports', 'actions-latest.jsonl'), 'utf8')).toBe('{"id":"a"}\n');
    expect(await store.get('exports/actions-latest.jsonl')).toBe('{"id":"a"}\n');
    expect(await store.get('exports/nope.jsonl')).toBeNull();
    expect(store.locate('exports/x.jsonl')).toBe(join(dir, 'exports', 'x.jsonl'));
  });
});

describe('S3ExportStore', () => {
  it('puts and gets objects in the bucket; a missing key is null', async () => {
    const objects = new Map<string, string>();
    const send = jest.fn(async (command: unknown) => {
      if (command instanceof PutObjectCommand) {
        objects.set(command.input.Key!, String(command.input.Body));
        return {};
      }
      const key = (command as GetObjectCommand).input.Key!;
      if (!objects.has(key)) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      return { Body: { transformToString: async () => objects.get(key) } };
    });
    const store = new S3ExportStore('my-bucket', { send } as never);
    await store.put('exports/actions-latest.jsonl', 'line\n');
    expect(send.mock.calls[0][0]).toBeInstanceOf(PutObjectCommand);
    expect((send.mock.calls[0][0] as PutObjectCommand).input).toMatchObject({ Bucket: 'my-bucket', Key: 'exports/actions-latest.jsonl' });
    expect(await store.get('exports/actions-latest.jsonl')).toBe('line\n');
    expect(await store.get('exports/other.jsonl')).toBeNull();
    expect(store.locate('exports/a.jsonl')).toBe('s3://my-bucket/exports/a.jsonl');
  });
});

describe('exportStoreFor', () => {
  it('uses S3 only when TEXT_STORE=s3', () => {
    expect(exportStoreFor({ TEXT_STORE: 'local', DATA_DIR: '/d' })).toBeInstanceOf(LocalExportStore);
    expect(exportStoreFor({ TEXT_STORE: 's3', S3_BUCKET: 'b', DATA_DIR: '/d' })).toBeInstanceOf(S3ExportStore);
  });
});
