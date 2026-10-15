import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';

/**
 * One line of data/artifacts.jsonl, as written by scripts/prepare_orgforge.py.
 * Only the fields ingestion uses are declared; Zod passes the rest through.
 * This file is the ONLY input ingestion may read (AGENTS.md section 2).
 */
export const ArtifactRecordSchema = z.looseObject({
  doc_id: z.string().min(1),
  doc_type: z.string().min(1),
  title: z.string().nullable(),
  body: z.string().nullable(),
  day: z.number().int().nullable(),
  dayUnknown: z.boolean().optional(),
  date: z.string().nullable(),
  dept: z.string().nullable(),
  is_incident: z.boolean(),
  actors: z.array(z.string()),
  tags: z.array(z.string()),
  artifact_ids: z.record(z.string(), z.unknown()),
  facts: z.record(z.string(), z.unknown()),
});
export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>;

export const ARTIFACTS_FILE = 'artifacts.jsonl';

/** Reads and validates every line of DATA_DIR/artifacts.jsonl. Throws with the line number on bad data. */
export async function readArtifacts(dataDir: string): Promise<ArtifactRecord[]> {
  const path = join(dataDir, ARTIFACTS_FILE);
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  const records: ArtifactRecord[] = [];
  let lineNumber = 0;
  for await (const line of lines) {
    lineNumber++;
    if (line.trim() === '') continue;
    const parsed = ArtifactRecordSchema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`${path}:${lineNumber}: ${issue?.path.join('.')} ${issue?.message}`);
    }
    records.push(parsed.data);
  }
  return records;
}
