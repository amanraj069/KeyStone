import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * The ONLY code that reads data/answer_key/ (AGENTS.md section 2). The ESLint rule
 * in apps/api/eslint.config.mjs and answer-key-guard.spec.ts fail if the folder
 * name appears anywhere else in apps/ or packages/. Benchmark code reads it only to
 * pick questions and to SCORE answers; nothing read here reaches the graph, the
 * agent's tools, embeddings or the system prompts of the systems being measured.
 */
const ANSWER_KEY_DIR = 'answer_key';

/** One person who left (departures.json, written by scripts/prepare_orgforge.py). */
export const DepartureSchema = z.object({
  name: z.string(),
  role: z.string().nullable(),
  day: z.number().int(),
  documentedPct: z.number().nullable(),
  domains: z.array(z.string()),
  before_day_1: z.boolean(),
});
export type Departure = z.infer<typeof DepartureSchema>;

/** One evaluation question (questions.jsonl). Only these fields are relied on; the rest are kept as is. */
export const QuestionSchema = z.looseObject({
  question_id: z.string(),
  question_type: z.string(),
  question_text: z.string(),
  difficulty: z.string().optional(),
  ground_truth: z.record(z.string(), z.unknown()),
});
export type Question = z.infer<typeof QuestionSchema>;

export async function readDepartures(dataDir: string): Promise<Departure[]> {
  const text = await readFile(join(dataDir, ANSWER_KEY_DIR, 'departures.json'), 'utf8');
  return z.array(DepartureSchema).parse(JSON.parse(text));
}

export async function readQuestions(dataDir: string): Promise<Question[]> {
  const text = await readFile(join(dataDir, ANSWER_KEY_DIR, 'questions.jsonl'), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      const parsed = QuestionSchema.safeParse(JSON.parse(line));
      if (!parsed.success) throw new Error(`questions.jsonl line ${i + 1}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return parsed.data;
    });
}

export interface QuestionFileSummary {
  rows: number;
  /** Every top-level field, most common first, with how many rows have it. */
  fields: { field: string; rows: number }[];
  types: { type: string; count: number }[];
  /** The first question of each type, as stored. */
  examples: Record<string, Question>;
}

/** What the question file looks like: printed before anything runs (Part B2, step 1). */
export function inspectQuestions(questions: readonly Question[]): QuestionFileSummary {
  const fieldCounts = new Map<string, number>();
  const typeCounts = new Map<string, number>();
  const examples: Record<string, Question> = {};
  for (const question of questions) {
    for (const field of Object.keys(question)) fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
    typeCounts.set(question.question_type, (typeCounts.get(question.question_type) ?? 0) + 1);
    examples[question.question_type] ??= question;
  }
  return {
    rows: questions.length,
    fields: [...fieldCounts].map(([field, rows]) => ({ field, rows })).sort((a, b) => b.rows - a.rows || a.field.localeCompare(b.field)),
    types: [...typeCounts].map(([type, count]) => ({ type, count })).sort((a, b) => a.type.localeCompare(b.type)),
    examples,
  };
}
