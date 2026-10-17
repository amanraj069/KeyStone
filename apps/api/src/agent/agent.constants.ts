/** At most this many tool calls per question. */
export const MAX_STEPS = 5;
/** Wall-clock budget per question; after it the model must answer from what it has. */
export const BUDGET_MS = 60_000;
/** Extra time the final, tool-free answer may take after the budget ran out. */
export const FINAL_ANSWER_GRACE_MS = 20_000;
/** A tool result is cut to this many characters before it goes to the model (graphPath never does). */
export const MAX_TOOL_RESULT_CHARS = 12_000;

import type { QuestionLabel } from '@keystone/shared';

export { QUESTION_LABELS, type QuestionLabel } from '@keystone/shared';

export const SYSTEM_PROMPT = [
  'You are Keystone, an analyst for Apex Athletics. Answer only from tool results. Every factual sentence must end with',
  'citations in the form [ID] using artifact ids from tool evidence.',
  "Day numbers in questions (\"Day 8\") are the company's timeline; tools take them as day / fromDay / toDay.",
  'Tools: who_knows, bus_factor, simulate_departure and trace_decision for expertise, ownership, knowledge risk, departures and',
  'decisions. For a specific event: find_event locates its documents, then a verdict tool decides from the graph:',
  'check_follow_up (did a response follow it?), check_visibility (could a person have known about it?), check_causal_link (did',
  'one event lead to another?). get_artifact, what_followed and find_artifacts show details; search_knowledge finds what',
  'documents say.',
  "Trust a verdict tool's answer unless the documents clearly contradict it.",
  'If the question can be answered yes or no, start the answer with "Yes" or "No", then the evidence.',
  'If you found the documents the question is about and what it asks for is not there, that is an answer: say so (for',
  'example "No: nothing followed it in days 13-28") and cite the documents you checked.',
  "Say the answer is not in the company's records only when no tool found anything the question is about.",
].join(' ');

/**
 * Per question type, how to use the tools; added to the question (with the label) so
 * the model starts with the right tool. Types without a recipe get only the label.
 * Each recipe ends in a verdict tool, and says what to answer when it finds nothing:
 * a rule that follows from the evidence (no record of X means no X), never a guess.
 */
export const LABEL_HINTS: Partial<Record<QuestionLabel, string>> = {
  event:
    '1) find_event with the day, the people named and a few words about the triggering event. 2) check_follow_up on the best ' +
    'candidate with the kind of response asked about (ticket, support_ticket, postmortem, page, email, thread, meeting, deal, ' +
    '...). followed true: answer Yes; false: answer No and cite the starting document. If the best candidate is clearly not the ' +
    'event, check the next one. If no candidate is the event, answer No: no such response is in the records.',
  visibility:
    'Call check_visibility once: person = the person whose knowledge is asked about, day = the day asked, description = a few ' +
    'words about the event, title = a quoted title if there is one, eventPeople = other people named as part of the event. ' +
    "could_have_known: they could have known; no_record_of_involvement or event_not_found: they could not have known. Answer " +
    'the question as worded ("would they have been outside the visibility?" is Yes when they could not have known).',
  counterfactual:
    '1) find_event for the earlier event and again for the later outcome. 2) check_causal_link with their ids. verdict linked ' +
    'or likely: the outcome followed from the earlier event, so without it the outcome would not have happened as it did; ' +
    'no_evidence: nothing recorded ties them, so it would likely have happened anyway. Answer the question as worded ' +
    '("would Y still have happened?" is No when the verdict is linked or likely).',
};

/** An answer that opens with a verdict ("Yes", "No:", "No,") is an answer, never a refusal. */
export const STARTS_WITH_VERDICT = /^\W*(?:yes|no)\b/i;

export const CLASSIFY_SYSTEM_PROMPT = [
  'Classify a question about a company into exactly one label:',
  '- who_knows: who knows, owns or is the expert on something; who to ask.',
  '- why: the reasons behind a decision or a change.',
  '- what_if: the impact of someone leaving, or of a hypothetical future change.',
  '- event: whether something happened or was done, e.g. a ticket, page, reply or follow-up created after or in response to something.',
  '- visibility: whether a person knew, saw, could have learned about or was aware of something.',
  '- counterfactual: what would have happened if a past event had been different or had not happened.',
  '- freshness: whether documents or information are current, stale or out of date.',
  '- general: anything else, including greetings and personal or trivia questions about people (tastes, hobbies, private life)',
  '  that work documents would not answer.',
  'Return {"label": "<one of the labels>"}.',
].join('\n');

/** Bump when the classification prompt changes (part of the LLM cache key). */
export const CLASSIFY_TASK = 'agent-classify-v3';

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
  'Stop calling tools. Answer the question now from the tool results above, following the citation rules; start with Yes or ' +
  "No if it is a yes/no question. If the tools never found the documents it is about, say the answer is not in the company's records.";

/** Injection tokens. */
export const AGENT_MODEL = Symbol('AGENT_MODEL');
export const AGENT_TOOLS = Symbol('AGENT_TOOLS');
