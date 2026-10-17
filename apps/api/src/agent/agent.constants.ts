/** At most this many tool calls per question. */
export const MAX_STEPS = 5;
/** Wall-clock budget per question; after it the model must answer from what it has. */
export const BUDGET_MS = 60_000;
/** Extra time the final, tool-free answer may take after the budget ran out. */
export const FINAL_ANSWER_GRACE_MS = 20_000;
/** A tool result is cut to this many characters before it goes to the model (graphPath never does). */
export const MAX_TOOL_RESULT_CHARS = 12_000;

export const QUESTION_LABELS = ['who_knows', 'why', 'what_if', 'freshness', 'general'] as const;
export type QuestionLabel = (typeof QUESTION_LABELS)[number];

export const SYSTEM_PROMPT =
  "You are Keystone, an analyst for Apex Athletics. Answer only from tool results. Every factual sentence must end with " +
  "citations in the form [ID] using artifact ids from tool evidence. If tools return nothing relevant, say the answer is not " +
  "in the company's records. Prefer graph tools over search_knowledge when the question is about people, ownership, risk, " +
  'departures or decisions.';

export const CLASSIFY_SYSTEM_PROMPT = [
  'Classify a question about a company into exactly one label:',
  '- who_knows: who knows, owns or is the expert on something; who to ask.',
  '- why: the reasons behind a decision or a change.',
  '- what_if: the impact of someone leaving or of a hypothetical change.',
  '- freshness: whether documents or information are current, stale or out of date.',
  '- general: anything else, including greetings and personal or trivia questions about people (tastes, hobbies, private life)',
  '  that work documents would not answer.',
  'Return {"label": "<one of the labels>"}.',
].join('\n');

/** Bump when the classification prompt changes (part of the LLM cache key). */
export const CLASSIFY_TASK = 'agent-classify-v2';

export const NOT_IN_RECORDS = "The answer is not in the company's records.";

/**
 * The model saying, in its own words, that the records do not have the answer:
 * "Not in Apex Athletics records", "There is no recorded information about X in
 * Apex Athletics records", "The answer is not in the company's records".
 * Only checked against the answer's first sentence, so an answer that merely
 * mentions a gap later on is not mistaken for a refusal.
 */
export const SAYS_NOT_IN_RECORDS = /\b(?:not|no|nothing)\b[^.]{0,100}?\b(?:in|from)\s+(?:the\s+)?(?:company'?s|apex(?:\s+athletics)?(?:'?s)?)\s+records\b/i;

/** Sent when a limit is hit: the model gets one more call, without tools. */
export const FINAL_ANSWER_PROMPT =
  'Stop calling tools. Answer the question now from the tool results above, following the citation rules. ' +
  "If they do not answer it, say the answer is not in the company's records.";

/** Injection tokens. */
export const AGENT_MODEL = Symbol('AGENT_MODEL');
export const AGENT_TOOLS = Symbol('AGENT_TOOLS');
