import type { ScoringMethod } from '@keystone/shared';
import { normalizeName } from '../extract/names';
import type { Question } from './answer-key';
import { systemKey } from './name-match';

/**
 * The gold answer of a question, and how it is scored:
 *   ids    the answer is an artifact id or a list of them -> exact match against cited ids
 *   name   the answer is a person or system name         -> normalised string match
 *   judge  anything else (yes/no with a reason, prose)   -> blinded LLM judge
 */
export type GoldAnswer =
  | { method: 'ids'; ids: string[]; text: string }
  | { method: 'name'; name: string; text: string }
  | { method: 'judge'; text: string };

/** What the scorer can look up in the graph: which strings are artifact ids, people or systems. */
export interface KnownNames {
  isArtifactId(value: string): boolean;
  isPersonOrSystem(value: string): boolean;
}

/** The ground-truth field that holds a yes/no verdict, by question type in OrgForge (first one present wins). */
const VERDICT_FIELDS = ['answer', 'could_actor_have_known', 'outcome_changed'] as const;

/**
 * Each verdict in words, so the judge cannot mistake the field's yes/no for the answer
 * to the question as worded ("would X still have happened?" is answered No when the
 * outcome changed).
 */
const VERDICT_TEXT: Record<(typeof VERDICT_FIELDS)[number], (value: boolean) => string> = {
  answer: (v) => `Correct conclusion: ${v ? 'yes, what the question asks about did happen' : 'no, what the question asks about did not happen'}`,
  could_actor_have_known: (v) =>
    `Correct conclusion: the person ${v ? 'could have known' : 'could NOT have known'} about it by then`,
  outcome_changed: (v) =>
    v
      ? 'Correct conclusion: without the earlier event, the later outcome would NOT have happened as it did'
      : 'Correct conclusion: the later outcome would have happened anyway, even without the earlier event',
};
/** Fields that explain the verdict, shown to the judge after it. */
const EXPLANATION_FIELDS = ['outcome', 'reason'] as const;
/** Fields listing the artifacts that support the gold answer. */
const EVIDENCE_FIELDS = ['evidence_artifacts', 'expected_search_space'] as const;

export function goldAnswer(question: Question, known: KnownNames): GoldAnswer {
  const answer = question.ground_truth.answer;
  const values = typeof answer === 'string' ? [answer] : Array.isArray(answer) && answer.every((v) => typeof v === 'string') ? (answer as string[]) : null;
  if (values && values.length > 0) {
    if (values.every((v) => known.isArtifactId(v))) return { method: 'ids', ids: values, text: values.join(', ') };
    if (values.length === 1 && known.isPersonOrSystem(values[0])) return { method: 'name', name: values[0], text: values[0] };
  }
  return { method: 'judge', text: describeGold(question.ground_truth) };
}

/**
 * The gold answer as a few plain lines for the judge: the verdict ("Could actor
 * have known: yes"), its explanation, and the supporting artifact ids.
 */
export function describeGold(truth: Record<string, unknown>): string {
  const lines: string[] = [];
  const verdictField = VERDICT_FIELDS.find((field) => typeof truth[field] === 'boolean');
  if (verdictField) lines.push(VERDICT_TEXT[verdictField](truth[verdictField] as boolean));
  else if (typeof truth.answer === 'string' || typeof truth.answer === 'number') lines.push(`Answer: ${String(truth.answer)}`);
  for (const field of EXPLANATION_FIELDS) {
    if (typeof truth[field] === 'string' && truth[field]) lines.push(`${humanize(field)}: ${truth[field] as string}`);
  }
  const evidence = goldEvidenceCandidates(truth);
  if (evidence.length > 0) lines.push(`Supporting artifacts: ${evidence.join(', ')}`);
  // Nothing recognised: show the whole ground truth rather than nothing.
  return lines.length > 0 ? lines.join('\n') : JSON.stringify(truth);
}

/** The gold yes/no ("yes" / "no"), or null when the gold answer is not a yes/no. */
export function goldVerdict(truth: Record<string, unknown>): 'yes' | 'no' | null {
  const field = VERDICT_FIELDS.find((f) => typeof truth[f] === 'boolean');
  return field ? (truth[field] ? 'yes' : 'no') : null;
}

/**
 * Every string the ground truth lists as supporting evidence (evidence lists and the
 * cause/effect chain), first-seen order. Not all are artifact ids: the caller keeps
 * those that exist in the graph.
 */
export function goldEvidenceCandidates(truth: Record<string, unknown>): string[] {
  const lists = [
    ...EVIDENCE_FIELDS.map((field) => truth[field]),
    ...Object.values((truth.evidence_chain_artifacts as Record<string, unknown> | undefined) ?? {}),
  ];
  const ids = lists.flatMap((list) => (Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []));
  return [...new Set(ids)];
}

/** Share of `gold` found in `retrieved`; null when there is no gold evidence. */
export function evidenceRecall(gold: readonly string[], retrieved: readonly string[]): number | null {
  if (gold.length === 0) return null;
  const seen = new Set(retrieved);
  return gold.filter((id) => seen.has(id)).length / gold.length;
}

/** "could_actor_have_known" -> "Could actor have known". */
function humanize(field: string): string {
  const words = field.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Exact ids: correct when every gold id is among the answer's cited ids (ids compared as written). */
export function scoreIds(goldIds: readonly string[], cited: readonly string[]): { correct: boolean; reason: string } {
  const citedSet = new Set(cited);
  const missing = goldIds.filter((id) => !citedSet.has(id));
  return missing.length === 0
    ? { correct: true, reason: `cites ${goldIds.join(', ')}` }
    : { correct: false, reason: `does not cite ${missing.join(', ')}` };
}

/**
 * Normalised name: correct when the answer contains the gold name as whole words,
 * after lower-casing, mapping punctuation to spaces and applying aliases.json to both.
 */
export function scoreName(gold: string, answer: string): { correct: boolean; reason: string } {
  const goldWords = words(gold);
  const answerWords = words(answer);
  const goldKey = systemKey(gold);
  const found =
    containsRun(answerWords, goldWords) ||
    // A multi-word alias in the answer ("Titan DB") still counts for "TitanDB".
    windows(answerWords, 3).some((run) => systemKey(run.join(' ')) === goldKey);
  return found ? { correct: true, reason: `names ${gold}` } : { correct: false, reason: `does not name ${gold}` };
}

function words(text: string): string[] {
  return normalizeName(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

function containsRun(haystack: readonly string[], needle: readonly string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return true;
  }
  return false;
}

/** Every run of 1..max consecutive words. */
function windows(items: readonly string[], max: number): string[][] {
  const runs: string[][] = [];
  for (let i = 0; i < items.length; i++) {
    for (let n = 1; n <= max && i + n <= items.length; n++) runs.push(items.slice(i, i + n));
  }
  return runs;
}

/**
 * The candidate as the judge sees it: without the "Tools tried: ..." note Keystone
 * adds to a refusal, which would tell the judge which system wrote it.
 */
export function blindAnswer(answer: string): string {
  return answer.replace(/\s*Tools tried:[^\n]*$/i, '').replace(/\s*No tools were tried\.\s*$/i, '').trim();
}

/**
 * The expected yes/no for a counterfactual question whose wording settles it, or null
 * (then the expected-answer model decides). Two unambiguous shapes:
 *   "would X still have happened" / "... have occurred without Y"  ->  no when the outcome changed
 *   "was X a (direct) consequence of / due to / a result of Y"      ->  yes when the outcome changed
 */
export function expectedFromWording(questionText: string, truth: Record<string, unknown>): 'yes' | 'no' | null {
  if (typeof truth.outcome_changed !== 'boolean') return null;
  const text = questionText.toLowerCase();
  const changed = truth.outcome_changed;
  if (/\b(consequence|result) of\b|\bdue to\b|\bdepend(ed|s)? on\b/.test(text)) return changed ? 'yes' : 'no';
  if (/\bstill\b/.test(text) || /\bwithout\b/.test(text)) return changed ? 'no' : 'yes';
  return null;
}

/**
 * The yes/no a candidate opens with ("No: ...", "Yes.", "Yes/No: No."), or null when
 * it does not open with one. Only the opening counts: that is the answer's verdict.
 */
export function leadingVerdict(answer: string): 'yes' | 'no' | null {
  const text = answer.trim().replace(/^\W*yes\s*\/\s*no\W*/i, '');
  const match = /^\W*(yes|no)\b/i.exec(text);
  return match ? (match[1].toLowerCase() as 'yes' | 'no') : null;
}

/** The judge's user prompt: question, reference, one candidate. Nothing names the system. */
export function judgePrompt(question: string, gold: string, candidate: string): string {
  return `Question:\n${question}\n\nReference answer:\n${gold}\n\nCandidate answer:\n${candidate || '(empty)'}`;
}

export type { ScoringMethod };
