import type { AccuracyRow, B1Results, B2Results, BenchResults, QuestionResult } from '@keystone/shared';
import { REFUSAL } from './bench.constants';

/**
 * Why the baseline might win or tie on a question type: a hypothesis, written
 * down before looking at any answers, and labelled as one in the report.
 */
const HYPOTHESES: Readonly<Record<string, string>> = {
  PERSPECTIVE:
    "who could have seen an event is written in the event's own documents, which the baseline reads directly; Keystone's graph tools describe expertise and ownership, not who saw what.",
  SILENCE:
    'proving that a response never happened needs the trigger documents read in full; the agent spends its five steps on targeted tools and short passages, while the baseline gets the whole budget as raw text.',
  COUNTERFACTUAL:
    'the graph has no causal edges, so for "what if" questions about incidents the agent falls back to the same document search the baseline uses, with less text per step.',
};
const DEFAULT_HYPOTHESIS = 'these questions may depend on document wording more than on graph structure.';

/** Everything results.json derives from the per-question results (recomputed when the report is re-rendered). */
export function summarizeQuestions(
  questions: readonly QuestionResult[],
): Pick<B2Results, 'byType' | 'overall' | 'medianLatencyMs' | 'refusals' | 'paired'> {
  return {
    byType: accuracyByType(questions),
    overall: accuracyRow('overall', questions),
    medianLatencyMs: { keystone: medianLatency(questions, 'keystone'), baseline: medianLatency(questions, 'baseline') },
    refusals: {
      keystone: questions.filter((q) => isRefusal(q.keystone.answer)).length,
      baseline: questions.filter((q) => isRefusal(q.baseline.answer)).length,
    },
    paired: pairedTest(questions),
  };
}

/**
 * 95% Wilson score interval for k correct out of n, as [low, high]; null when n = 0.
 * Unlike the plain normal interval it stays inside 0..1 and behaves at 0% and 100%.
 */
export function wilson(k: number, n: number, z = 1.96): [number, number] | null {
  if (n === 0) return null;
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * Paired comparison of the two systems on the same questions: questions only one of them
 * got right, and the exact two-sided sign test (binomial, p = 0.5) on that split.
 */
export function pairedTest(questions: readonly QuestionResult[]): { keystoneOnly: number; baselineOnly: number; pValue: number } {
  const keystoneOnly = questions.filter((q) => q.keystone.correct === true && q.baseline.correct !== true).length;
  const baselineOnly = questions.filter((q) => q.baseline.correct === true && q.keystone.correct !== true).length;
  return { keystoneOnly, baselineOnly, pValue: signTestP(keystoneOnly, baselineOnly) };
}

/** Exact two-sided sign test: P(a split at least as uneven as a : b) when each side is equally likely. */
export function signTestP(a: number, b: number): number {
  const n = a + b;
  if (n === 0) return 1;
  const k = Math.min(a, b);
  // log binomial coefficients keep this exact enough for any n we will see.
  let logC = 0;
  let tail = 0;
  for (let i = 0; i <= k; i++) {
    if (i > 0) logC += Math.log(n - i + 1) - Math.log(i);
    tail += Math.exp(logC - n * Math.LN2);
  }
  return Math.min(1, 2 * tail);
}

/** The answer declines ("not in the company's records", "not determinable", ...). */
export function isRefusal(answer: string): boolean {
  return REFUSAL.test(answer);
}

/** Accuracy of both systems per question type, alphabetical. */
export function accuracyByType(results: readonly QuestionResult[]): AccuracyRow[] {
  const types = [...new Set(results.map((r) => r.type))].sort();
  return types.map((type) => accuracyRow(type, results.filter((r) => r.type === type)));
}

/** One row: correct counts and accuracy (unscored answers count as not correct), and a verdict. */
export function accuracyRow(type: string, results: readonly QuestionResult[]): AccuracyRow {
  const n = results.length;
  const keystoneCorrect = results.filter((r) => r.keystone.correct === true).length;
  const baselineCorrect = results.filter((r) => r.baseline.correct === true).length;
  const keystone = n === 0 ? null : keystoneCorrect / n;
  const baseline = n === 0 ? null : baselineCorrect / n;
  return {
    type,
    n,
    keystoneCorrect,
    baselineCorrect,
    keystone,
    baseline,
    majority: majorityAccuracy(results),
    keystoneCi: wilson(keystoneCorrect, n),
    baselineCi: wilson(baselineCorrect, n),
    keystoneEvidenceRecall: meanOf(results.map((r) => r.keystone.evidenceRecall)),
    baselineEvidenceRecall: meanOf(results.map((r) => r.baseline.evidenceRecall)),
    verdict: verdict(type, keystone, baseline),
  };
}

/**
 * Accuracy of answering every question with its type's most common gold yes/no
 * (per type, also when the list mixes types). A hindsight reference that knows the
 * answer distribution; null when no question has a yes/no gold answer.
 */
export function majorityAccuracy(results: readonly QuestionResult[]): number | null {
  const withVerdict = results.filter((r) => r.goldVerdict !== null);
  if (withVerdict.length === 0) return null;
  const types = [...new Set(withVerdict.map((r) => r.type))];
  const correct = types.reduce((sum, type) => {
    const ofType = withVerdict.filter((r) => r.type === type);
    const yes = ofType.filter((r) => r.goldVerdict === 'yes').length;
    return sum + Math.max(yes, ofType.length - yes);
  }, 0);
  return correct / results.length;
}

/** Mean of the non-null values; null if there are none. */
export function meanOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length;
}

/** "Keystone ahead by 13 points." or, when the baseline wins or ties, says so with a one-line hypothesis. */
export function verdict(type: string, keystone: number | null, baseline: number | null): string {
  if (keystone === null || baseline === null) return 'No questions.';
  const points = Math.round(Math.abs(keystone - baseline) * 100);
  if (keystone > baseline) return `Keystone ahead by ${points} points.`;
  const why = `Hypothesis: ${HYPOTHESES[type] ?? DEFAULT_HYPOTHESIS}`;
  if (keystone === baseline) return `Tie: the vector-only baseline does as well as Keystone. ${why}`;
  return `The vector-only baseline wins by ${points} points. ${why}`;
}

/** Median of the latencies of answers that ran for real (not cached, no error); null if none. */
export function medianLatency(results: readonly QuestionResult[], system: 'keystone' | 'baseline'): number | null {
  const values = results.filter((r) => !r[system].cached && r[system].error === null).map((r) => r[system].latencyMs);
  return median(values);
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// ---------------------------------------------------------------- results.md

const pct = (value: number | null) => (value === null ? 'n/a' : `${Math.round(value * 100)}%`);
/** "67% (55-77)": an accuracy with its 95% interval. */
const pctCi = (value: number | null, ci: [number, number] | null | undefined) =>
  ci ? `${pct(value)} (${Math.round(ci[0] * 100)}-${Math.round(ci[1] * 100)})` : pct(value);
/** "p = 0.003" / "p < 0.001". */
const pValue = (p: number) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`);
const ms = (value: number | null) => (value === null ? 'n/a' : `${(value / 1000).toFixed(1)} s`);
const list = (items: readonly string[]) => (items.length === 0 ? '—' : items.join(', '));
/** Table cells cannot contain a bare pipe or a line break. */
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function renderMarkdown(results: BenchResults): string {
  const lines: string[] = [
    '# Keystone benchmark',
    '',
    `Generated ${results.generatedAt} with ${results.provider} \`${results.model}\` (judge \`${results.judgeModel}\`, embeddings \`${results.embedModel}\`). ` +
      `${results.rejudgedAt ? `Answers re-scored ${results.rejudgedAt} with the current judge (pnpm bench --rejudge). ` : ''}` +
      `LLM calls (all runs behind this file): at most ${results.llmCalls.estimatedMax} planned, ${results.llmCalls.made} made, ${results.llmCalls.cacheHits} answered from the cache.`,
    '',
  ];
  if (results.b2) lines.push(...renderB2(results.b2));
  if (results.b1) lines.push(...renderB1(results.b1));
  return `${lines.join('\n')}\n`;
}

function renderB2(b2: NonNullable<BenchResults['b2']>): string[] {
  const rows = [...b2.byType, b2.overall];
  const losses = b2.byType.filter((r) => r.keystone !== null && r.baseline !== null && r.baseline >= r.keystone);
  const judged = b2.questions.filter((q) => q.method === 'judge').length;
  return [
    '## B2 · Question answering',
    '',
    `Up to ${b2.perType} questions per type, sampled with seed ${b2.seed}. Both systems use the same model and the same context ` +
      `budget of ${b2.contextBudgetChars.toLocaleString('en-US')} characters: Keystone through its agent and MCP tools, the ` +
      `baseline with the top ${b2.baselineK} vector-only chunks (Stage 6) pasted into one prompt until the budget is full. ` +
      `${judged} of ${b2.questions.length} questions have a yes/no-with-reason gold answer and were scored by a blinded LLM judge ` +
      'that sees the question, the gold answer and one candidate at a time, never which system wrote it.',
    '',
    ...b2Summary(b2),
    '',
    'Accuracy with its 95% confidence interval (Wilson) in brackets.',
    '',
    '| Question type | n | Keystone | Vector-only | Most common answer (hindsight) | Evidence recall K / V | Verdict |',
    '| --- | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows.map(
      (r) =>
        `| ${r === b2.overall ? '**Overall**' : r.type} | ${r.n} | ${pctCi(r.keystone, r.keystoneCi)} | ${pctCi(r.baseline, r.baselineCi)} | ` +
        `${pct(r.majority)} | ${pct(r.keystoneEvidenceRecall)} / ${pct(r.baselineEvidenceRecall)} | ${cell(r.verdict)} |`,
    ),
    '',
    '| System | Median latency (uncached answers) |',
    '| --- | ---: |',
    `| Keystone | ${ms(b2.medianLatencyMs.keystone)} |`,
    `| Vector-only | ${ms(b2.medianLatencyMs.baseline)} |`,
    '',
    '### Where the baseline wins or ties',
    '',
    ...(losses.length === 0
      ? ['Nowhere in this sample: Keystone is ahead on every question type.']
      : losses.map((r) => `- **${r.type}**: ${r.verdict}`)),
    '',
    `Sample sizes are small (at most ${b2.perType} per type), so a difference of one or two questions is within noise.`,
    '',
  ];
}

/** Plain sentences about the headline numbers, so a reader cannot miss a weak result. */
export function b2Summary(b2: NonNullable<BenchResults['b2']>): string[] {
  const { overall, refusals, medianLatencyMs } = b2;
  const lines: string[] = [];
  if (overall.keystone !== null && overall.baseline !== null && overall.keystone < 0.5 && overall.baseline < 0.5) {
    lines.push(
      `**Both systems get most of these questions wrong** (Keystone ${pct(overall.keystone)}, vector-only ${pct(overall.baseline)}). ` +
        'The lead below is measured on a small sample near the floor; read it as a direction, not a result.',
    );
  }
  if (overall.majority !== null) {
    const best = Math.max(overall.keystone ?? 0, overall.baseline ?? 0);
    lines.push(
      `Reference: always giving each type's most common gold answer would score ${pct(overall.majority)} (hindsight; it knows ` +
        `the answer distribution). ${best < overall.majority ? 'Both systems are below it.' : 'At least one system is above it.'}`,
    );
  }
  if (overall.keystoneEvidenceRecall !== null || overall.baselineEvidenceRecall !== null) {
    lines.push(
      `Evidence recall (share of the answer key's evidence artifacts the system had in front of it): Keystone ` +
        `${pct(overall.keystoneEvidenceRecall)}, vector-only ${pct(overall.baselineEvidenceRecall)}.`,
    );
  }
  if (b2.paired) {
    const { keystoneOnly, baselineOnly, pValue: p } = b2.paired;
    lines.push(
      `Paired on the same ${overall.n} questions: only Keystone right on ${keystoneOnly}, only vector-only right on ${baselineOnly} ` +
        `(exact sign test ${pValue(p)}${p < 0.05 ? ': the gap is unlikely to be chance' : ': not enough to rule out chance'}).`,
    );
  }
  lines.push(
    `Answers that decline ("not in the company's records" or similar): Keystone ${refusals.keystone} of ${overall.n}, ` +
      `vector-only ${refusals.baseline} of ${overall.n}. A refusal is scored as wrong.`,
  );
  if (medianLatencyMs.keystone !== null && medianLatencyMs.baseline !== null && medianLatencyMs.baseline > 0) {
    lines.push(`Keystone is slower: a median ${ms(medianLatencyMs.keystone)} against ${ms(medianLatencyMs.baseline)} (about ${Math.round(medianLatencyMs.keystone / medianLatencyMs.baseline)}x).`);
  }
  return lines.flatMap((line) => [line, '']).slice(0, -1);
}

/** Plain sentences about B1: empty predictions, and why precision is low. */
export function b1Summary(b1: B1Results): string[] {
  const lines = b1.departures
    .filter((d) => d.error === null && d.predicted.length === 0)
    .map((d) => `- K5 listed **no systems** for ${d.person} as of day ${d.asOfDay}: no core system where they met the expert rule, so recall is 0 and precision is undefined.`);
  const wide = b1.departures.filter((d) => d.predicted.length > 2 * Math.max(1, d.domains.length));
  if (wide.length > 0) {
    lines.push(
      `- K5 lists every core system where the person counts as an expert (${wide.map((d) => `${d.predicted.length} for ${d.person}`).join(', ')}), ` +
        'not only the knowledge that leaves with them, so precision is low by construction. The stricter orphaned-only prediction is shown below.',
    );
  }
  if (b1.genesisOverall.total > 0 && b1.genesisOverall.found === 0) {
    lines.push('- **None** of the pre-day-1 departures\' domains shows up as orphaned or critical in bus factor today.');
  }
  return lines;
}

function renderB1(b1: B1Results): string[] {
  const d = b1.departures;
  return [
    '## B1 · Departure prediction',
    '',
    `${d.length} departure${d.length === 1 ? '' : 's'} inside the simulated days with ${d.reduce((n, r) => n + r.domains.length, 0)} gold domains: ` +
      'read these as worked examples, not as a score.',
    '',
    'For each departure inside the simulated days, departure impact (K5, minScore ' +
      `${b1.minScore}) ran on a projection built as of the day before. Headline metric: the strict prediction — only the systems K5 says the ` +
      "person orphans (no backup left) — matched against the person's actual knowledge domains (normalised names from aliases.json, then fuzzy " +
      'matching, then an LLM yes/no for leftover pairs). This is what the departure actually leaves uncovered.',
    '',
    '| Person | Left on day | Orphaned (K5 backups = 0) | Gold domains | Precision | Recall | F1 |',
    '| --- | ---: | --- | --- | ---: | ---: | ---: |',
    ...d.map(
      (r) =>
        `| ${r.person} | ${r.day} | ${cell(list(r.orphaned))}${r.error ? ` (error: ${cell(r.error)})` : ''} | ${cell(list(r.domains))} | ` +
        `${pct(r.orphanedOnly.precision)} | ${pct(r.orphanedOnly.recall)} | ${pct(r.orphanedOnly.f1)} |`,
    ),
    `| **Overall (micro)** | | | | ${pct(b1.overallOrphanedOnly.precision)} | ${pct(b1.overallOrphanedOnly.recall)} | ${pct(b1.overallOrphanedOnly.f1)} |`,
    '',
    ...b1Summary(b1),
    '',
    'Broad prediction, for context (every system K5 counts the person as an expert on, not only what leaves with them — precision is low ' +
      'here by construction):',
    '',
    '| Person | Left on day | Projection | Predicted (K5) | Gold domains | Matches | Precision | Recall | F1 |',
    '| --- | ---: | --- | --- | --- | --- | ---: | ---: | ---: |',
    ...d.map(
      (r) =>
        `| ${r.person} | ${r.day} | as of day ${r.asOfDay} | ${cell(list(r.predicted))}${r.error ? ` (error: ${cell(r.error)})` : ''} | ` +
        `${cell(list(r.domains))} | ${cell(list(r.matches.map((m) => `${m.gold} = ${m.predicted} (${m.via})`)))} | ` +
        `${pct(r.precision)} | ${pct(r.recall)} | ${pct(r.f1)} |`,
    ),
    `| **Overall (micro)** | | | | | | ${pct(b1.overall.precision)} | ${pct(b1.overall.recall)} | ${pct(b1.overall.f1)} |`,
    '',
    'A second predictor (not K5): systems, core or not, where the person holds at least a quarter of everyone\'s knowledge as of ' +
      'the day before, thread participation included:',
    '',
    '| Person | Predicted (knowledge share) | Matches | Precision | Recall | F1 |',
    '| --- | --- | --- | ---: | ---: | ---: |',
    ...d.map(
      (r) =>
        `| ${r.person} | ${cell(list(r.knowledgeShare.predicted))} | ${cell(list(r.knowledgeShare.matches.map((m) => `${m.gold} = ${m.predicted} (${m.via})`)))} | ` +
        `${pct(r.knowledgeShare.precision)} | ${pct(r.knowledgeShare.recall)} | ${pct(r.knowledgeShare.f1)} |`,
    ),
    `| **Overall (micro)** | | | ${pct(b1.overallKnowledgeShare.precision)} | ${pct(b1.overallKnowledgeShare.recall)} | ${pct(b1.overallKnowledgeShare.f1)} |`,
    '',
    'Departures before day 1 (genesis gaps): do their domains show up as orphaned or critical in bus factor (K4) on apex_proj?',
    '',
    '| Person | Day | Domains | Found as orphaned / critical | Recall |',
    '| --- | ---: | --- | --- | ---: |',
    ...b1.genesis.map(
      (g) =>
        `| ${g.person} | ${g.day} | ${cell(list(g.domains))} | ${cell(list(g.found.map((f) => `${f.domain} = ${f.system} (${f.riskLevel}, ${f.via})`)))} | ${pct(g.recall)} |`,
    ),
    `| **Overall** | | | ${b1.genesisOverall.found} of ${b1.genesisOverall.total} domains | ${pct(b1.genesisOverall.recall)} |`,
    '',
  ];
}
