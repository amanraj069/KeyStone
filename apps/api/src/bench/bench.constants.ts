import { MAX_STEPS, MAX_TOOL_RESULT_CHARS, SAYS_NOT_IN_RECORDS } from '../agent/agent.constants';
import { CHUNK_SIZE } from '../retrieval/chunker';

/**
 * Who checks: the judge and B1's "same system?" checks use BENCH_JUDGE_MODEL when it
 * is set (same provider and cache), otherwise the same model as the systems under test.
 */
export function checkerModel(configured: string | undefined, systemModel: string): string {
  return configured?.trim() || systemModel;
}

/** Questions sampled per question type (BENCH_PER_TYPE overrides it). */
export const DEFAULT_PER_TYPE = 15;

/** Fixed sampling seed (BENCH_SEED overrides it): the same questions on every run. */
export const DEFAULT_SEED = 13;

/** Above this many planned LLM calls the CLI asks before running (--yes skips the question). */
export const CONFIRM_ABOVE_CALLS = 1500;

/** Benchmark projections are named bench_proj_<departure day>; only one exists at a time. */
export const BENCH_PROJECTION_PREFIX = 'bench_proj_';

/** Results folder, relative to DATA_DIR. */
export const RESULTS_DIR = 'bench';
export const RESULTS_JSON = 'results.json';
export const RESULTS_MD = 'results.md';

/**
 * The context either system may put in front of the model, in characters. The
 * agent sees at most MAX_STEPS tool results of at most MAX_TOOL_RESULT_CHARS
 * each, so the baseline gets the same total: top-k chunks until the budget is full.
 */
export const CONTEXT_BUDGET_CHARS = MAX_STEPS * MAX_TOOL_RESULT_CHARS;

/** Chunks the baseline asks the vector index for: enough full-size chunks to fill the budget. */
export const BASELINE_K = Math.ceil(CONTEXT_BUDGET_CHARS / CHUNK_SIZE);

/**
 * Fuzzy name matching: two normalised names match when their edit-distance
 * similarity is at least this (1 - distance / longer length), or when one
 * contains the other and the shorter is at least MIN_CONTAINED_CHARS long.
 */
export const FUZZY_MIN_SIMILARITY = 0.8;
export const MIN_CONTAINED_CHARS = 5;

/**
 * B1's knowledge-share predictor (KNOWLEDGE_SHARE_AS_OF), fixed before running it:
 * the person holds at least a quarter of everyone's knowledge of the system, with at
 * least the expert floor (MIN_EXPERT_SCORE), on systems named in at least 3 documents
 * (fewer is mostly extraction noise); at most 10 systems.
 */
export const SHARE_MIN = 0.25;
export const SHARE_MIN_MENTIONS = 3;
export const SHARE_LIMIT = 10;

/** Genesis domains are only put to the LLM against this many closest at-risk system names. */
export const LLM_SHORTLIST = 5;

/**
 * An answer that declines: the agent's own "not in the company's records" pattern,
 * anywhere in the answer, or a hedge such as "not determinable" / "the documents
 * do not provide". Counted for the report only; it never changes a score.
 */
export const REFUSAL = new RegExp(`${SAYS_NOT_IN_RECORDS.source}|not determinable|\\bdo(?:es)? not (?:contain|provide|say|state)\\b`, 'i');

/** Upper bound of LLM calls one agent run makes: the classifier, MAX_STEPS model turns and one forced final answer. */
export const MAX_AGENT_CALLS = 1 + MAX_STEPS + 1;

// ---------------------------------------------------------------- prompts (scoring prompts run only after both systems answered)

/** Baseline: one prompt with the retrieved chunks, nothing else. */
export const BASELINE_TASK = 'bench-baseline-v2';
export const BASELINE_SYSTEM_PROMPT =
  'You are answering a question about the company Apex Athletics. Answer only from these documents and cite ids: every ' +
  'factual sentence must end with citations in the form [ID] using the document ids shown. The question may ask you to ' +
  'reason about cause, sequence or scope (for example a counterfactual, "would X still have happened without Y", or ' +
  '"did Z follow from W") — work it out from what the documents show about timing, who did what and what references what, ' +
  'and commit to a conclusion even if no single sentence states it outright. Only say the answer is not in the company\'s ' +
  "records when the documents give you no relevant facts to reason from at all. " +
  'Return {"answer": "<your answer with citations>"}.';

/** "Are these two names the same system?" Nothing else is in the prompt. */
export const SAME_SYSTEM_TASK = 'bench-same-system-v1';
export const SAME_SYSTEM_PROMPT = 'Are these two names the same system? Return {"same": "yes"} or {"same": "no"}.';

/**
 * Step one of judging a yes/no question, once per question and independent of any
 * candidate: from the question and its correct conclusion, the correct short answer to
 * the question AS WORDED (yes or no). A candidate that opens with Yes or No is then
 * compared with it directly; others go to the judge below.
 */
export const EXPECTED_TASK = 'bench-expected-v1';
export const EXPECTED_SYSTEM_PROMPT = [
  'You get a question and its correct conclusion. Say what the correct short answer to the question, exactly as it is worded,',
  'is: "yes" or "no". Mind the wording: if the conclusion is that something would NOT have happened without an earlier event,',
  'the answer to "would it still have happened?" is no, and the answer to "was it a consequence of the earlier event?" is yes.',
  'If the question cannot be answered with yes or no, say "unclear".',
  'Return {"answer": "yes" | "no" | "unclear"}.',
].join('\n');

/** Blinded judge: the question, the gold answer and ONE candidate answer; never which system wrote it. */
export const JUDGE_TASK = 'bench-judge-v4';
export const JUDGE_SYSTEM_PROMPT = [
  'You check one answer to a question about a company. You get the question, the correct conclusion (with background) and',
  'a candidate answer. Find the conclusion the candidate reaches about the question, then decide: does it mean the same as',
  'the correct conclusion?',
  'correct: the candidate reaches the same conclusion, in any wording (for example "No, it would not still have happened"',
  'means the same as "the later outcome would NOT have happened as it did").',
  'incorrect: the candidate reaches the opposite conclusion, reaches none, or refuses ("not in the records").',
  "Judge only the conclusion: ignore citation brackets like [ID], extra detail and the quality of the reasoning.",
  'Return {"verdict": "correct" | "incorrect", "reason": "<one line>"}.',
].join('\n');
