import { z } from 'zod';

/** Tokens reported by the provider SDK (zeros when a call was answered from the LLM cache). */
export const BenchTokenUsageSchema = z.object({
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningTokens: z.number(),
});
export type BenchTokenUsage = z.infer<typeof BenchTokenUsageSchema>;

/** How a predicted system was matched to a gold domain name. */
export const MatchViaSchema = z.enum(['exact', 'fuzzy', 'llm']);
export type MatchVia = z.infer<typeof MatchViaSchema>;

export const NameMatchSchema = z.object({ gold: z.string(), predicted: z.string(), via: MatchViaSchema });
export type NameMatch = z.infer<typeof NameMatchSchema>;

/** Precision, recall and F1 (null when undefined: nothing predicted, or nothing to find). */
export const PrfSchema = z.object({
  tp: z.number().int(),
  fp: z.number().int(),
  fn: z.number().int(),
  precision: z.number().nullable(),
  recall: z.number().nullable(),
  f1: z.number().nullable(),
});
export type Prf = z.infer<typeof PrfSchema>;

/** B1: one departure inside the simulated days, predicted on a projection as of the day before. */
export const DepartureScoreSchema = PrfSchema.extend({
  person: z.string(),
  day: z.number().int(),
  asOfDay: z.number().int(),
  projection: z.string(),
  domains: z.array(z.string()),
  /** Systems K5 lists for the person (they are an expert there): the predicted at-risk systems. */
  predicted: z.array(z.string()),
  /** The subset with no backup left (K5 backups = 0). */
  orphaned: z.array(z.string()),
  matches: z.array(NameMatchSchema),
  /** The stricter prediction: only the systems K5 says the person orphans (no backup left). */
  orphanedOnly: PrfSchema,
  /**
   * A second predictor, not K5: systems (core or not) where the person holds a large share
   * of everyone's knowledge as of that day, thread participation included.
   */
  knowledgeShare: PrfSchema.extend({ predicted: z.array(z.string()), matches: z.array(NameMatchSchema) }),
  error: z.string().nullable(),
});
export type DepartureScore = z.infer<typeof DepartureScoreSchema>;

/** B1: a departure before day 1, checked against bus factor (K4) on apex_proj. */
export const GenesisScoreSchema = z.object({
  person: z.string(),
  day: z.number().int(),
  domains: z.array(z.string()),
  /** Domains found among orphaned or critical systems, with the system and its risk level. */
  found: z.array(z.object({ domain: z.string(), system: z.string(), riskLevel: z.string(), via: MatchViaSchema })),
  missing: z.array(z.string()),
  recall: z.number().nullable(),
});
export type GenesisScore = z.infer<typeof GenesisScoreSchema>;

export const B1ResultsSchema = z.object({
  minScore: z.number(),
  departures: z.array(DepartureScoreSchema),
  /** Micro-averaged over all in-simulation departures (summed tp / fp / fn). */
  overall: PrfSchema,
  overallOrphanedOnly: PrfSchema,
  overallKnowledgeShare: PrfSchema,
  genesis: z.array(GenesisScoreSchema),
  genesisOverall: z.object({ found: z.number().int(), total: z.number().int(), recall: z.number().nullable() }),
});
export type B1Results = z.infer<typeof B1ResultsSchema>;

/** How a question's answer was scored. */
export const ScoringMethodSchema = z.enum(['ids', 'name', 'judge']);
export type ScoringMethod = z.infer<typeof ScoringMethodSchema>;

/** One system's answer to one question, and its score. */
export const SystemAnswerSchema = z.object({
  answer: z.string(),
  citedIds: z.array(z.string()),
  /** null when the answer could not be scored (the run or the judge failed). */
  correct: z.boolean().nullable(),
  reason: z.string(),
  toolsUsed: z.array(z.string()),
  steps: z.number().int(),
  latencyMs: z.number(),
  /** The answer came from the LLM cache (its latency is not a real answer time). */
  cached: z.boolean(),
  usage: BenchTokenUsageSchema.nullable(),
  error: z.string().nullable(),
  /** The tool calls in order (Keystone), with their arguments. */
  toolCalls: z.array(z.object({ name: z.string(), args: z.record(z.string(), z.unknown()) })),
  /** Artifact ids the system had in front of it: tool evidence (Keystone) or the pasted chunks' artifacts (baseline). */
  retrieved: z.array(z.string()),
  /** Share of the gold evidence artifacts among `retrieved`; null when the question lists none. */
  evidenceRecall: z.number().nullable(),
});
export type SystemAnswer = z.infer<typeof SystemAnswerSchema>;

export const QuestionResultSchema = z.object({
  id: z.string(),
  type: z.string(),
  difficulty: z.string().nullable(),
  question: z.string(),
  method: ScoringMethodSchema,
  gold: z.string(),
  /** The gold yes/no, when the gold answer is one. */
  goldVerdict: z.enum(['yes', 'no']).nullable(),
  /** Artifact ids the answer key cites as evidence (only ids that exist in the graph). */
  goldEvidence: z.array(z.string()),
  keystone: SystemAnswerSchema,
  baseline: SystemAnswerSchema,
});
export type QuestionResult = z.infer<typeof QuestionResultSchema>;

/** Accuracy of both systems on one question type (or overall). */
export const AccuracyRowSchema = z.object({
  type: z.string(),
  /** Questions sampled (the chart labels each bar group with it). */
  n: z.number().int(),
  keystoneCorrect: z.number().int(),
  baselineCorrect: z.number().int(),
  keystone: z.number().nullable(),
  baseline: z.number().nullable(),
  /**
   * Hindsight reference: accuracy of always giving this type's most common gold yes/no
   * (null when the gold answers are not yes/no). Not a system; a floor to read the others against.
   */
  majority: z.number().nullable(),
  /** Mean evidence recall over questions that list gold evidence (null if none do). */
  keystoneEvidenceRecall: z.number().nullable(),
  baselineEvidenceRecall: z.number().nullable(),
  /** 95% Wilson confidence interval of each accuracy, [low, high] (null when n = 0). */
  keystoneCi: z.tuple([z.number(), z.number()]).nullable().optional(),
  baselineCi: z.tuple([z.number(), z.number()]).nullable().optional(),
  /** Plain-language verdict, with a one-line hypothesis when the baseline wins or ties. */
  verdict: z.string(),
});
export type AccuracyRow = z.infer<typeof AccuracyRowSchema>;

export const B2ResultsSchema = z.object({
  perType: z.number().int(),
  seed: z.number().int(),
  /** Characters of retrieved context either system may put in front of the model. */
  contextBudgetChars: z.number().int(),
  baselineK: z.number().int(),
  sampled: z.array(z.object({ type: z.string(), available: z.number().int(), sampled: z.number().int() })),
  questions: z.array(QuestionResultSchema),
  byType: z.array(AccuracyRowSchema),
  overall: AccuracyRowSchema,
  /** Median latency of answers that were not served from the cache (null if none). */
  medianLatencyMs: z.object({ keystone: z.number().nullable(), baseline: z.number().nullable() }),
  /** Answers that say the records do not hold the answer (a pattern match on the answer text). */
  refusals: z.object({ keystone: z.number().int(), baseline: z.number().int() }),
  /**
   * Paired comparison on the same questions: how many only Keystone got right, how many
   * only the baseline did, and the exact two-sided sign test p-value on those (the chance
   * of a split at least this uneven if both systems were equally good).
   */
  paired: z.object({ keystoneOnly: z.number().int(), baselineOnly: z.number().int(), pValue: z.number() }).optional(),
});
export type B2Results = z.infer<typeof B2ResultsSchema>;

/** data/bench/results.json, also served by GET /bench/results. */
export const BenchResultsSchema = z.object({
  generatedAt: z.string(),
  /** Set when the stored answers were scored again with a newer judge (pnpm bench --rejudge). */
  rejudgedAt: z.string().optional(),
  provider: z.string(),
  model: z.string(),
  /** The model that judged the answers (the same as `model` unless BENCH_JUDGE_MODEL is set). */
  judgeModel: z.string(),
  embedModel: z.string(),
  llmCalls: z.object({ estimatedMax: z.number().int(), made: z.number().int(), cacheHits: z.number().int() }),
  /** What the question file looked like (field names, types and counts, one example per type). */
  inspection: z.object({
    rows: z.number().int(),
    fields: z.array(z.string()),
    types: z.array(z.object({ type: z.string(), count: z.number().int() })),
    examples: z.record(z.string(), z.unknown()),
  }),
  b1: B1ResultsSchema.nullable(),
  b2: B2ResultsSchema.nullable(),
});
export type BenchResults = z.infer<typeof BenchResultsSchema>;
