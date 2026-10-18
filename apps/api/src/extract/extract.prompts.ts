/**
 * Prompts for extraction. Bump PROMPT_VERSION whenever a prompt or the output
 * schema changes: it is part of the cache fingerprint, so old answers are not reused.
 */
export const PROMPT_VERSION = 'extract-v2';
export const LINKS_PROMPT_VERSION = 'links-v1';

/** Long bodies are cut so one call stays small (the longest artifact is ~11.7k characters). */
export const MAX_BODY_CHARS = 12_000;

export const ARTIFACT_SYSTEM_PROMPT = [
  'You read one internal document from a sports-technology company and extract facts stated in it.',
  'Return {"systems": [...], "decisions": [...], "asserts": [...]}.',
  '',
  'systems: named technical systems the document talks about: software services, databases, queues,',
  'infrastructure, cloud services, developer tools and internal products.',
  'Not people, teams, departments, customers, companies, meetings, or generic words ("the dashboard", "the API").',
  'At most 8, the most relevant first. Each: {"name": string, "relevance": 0..1 (how central the system is to this document)}.',
  'If a system matches a name in the KNOWN SYSTEMS list, use that exact name.',
  '',
  'decisions (at most 5): significant technical or product decisions the document states were made or proposed:',
  'adopting or dropping a system, changing how a system works, or setting a policy.',
  'Not scheduling, meeting logistics, follow-ups, thanks or status updates.',
  'Each: {"summary": at most 30 words, "systems": [names it is about], "kind": "adopt"|"deprecate"|"change"|"policy",',
  '"confidence": 0..1 that this really is a decision stated in the text}.',
  '',
  'asserts (only when the document type is Page, otherwise []; at most 5): factual claims the page makes about',
  'how a system works or is configured (at most 25 words each),',
  'e.g. a documented rule or setting. Each: {"claim": string, "system": name}.',
  '',
  'Rules: extract only what the text states. Do not infer anything about people (skills, roles, departures).',
  'Use empty arrays when nothing applies.',
].join('\n');

export interface ArtifactPromptInput {
  type: string;
  title: string;
  day: number | null;
  authors: string[];
  body: string;
  vocabulary: readonly string[];
}

export function artifactPrompt(input: ArtifactPromptInput): string {
  return [
    `KNOWN SYSTEMS: ${input.vocabulary.join(', ')}`,
    '',
    `Document type: ${input.type}`,
    `Title: ${input.title}`,
    `Day: ${input.day ?? 'unknown'}`,
    `Authors: ${input.authors.join(', ') || 'unknown'}`,
    '',
    input.body.slice(0, MAX_BODY_CHARS),
  ].join('\n');
}

export const LINKS_SYSTEM_PROMPT = [
  'You are given, for one technical system, its decisions in date order and claims made by documentation pages.',
  'Return {"supersedes": [{"newerId", "olderId"}], "asserts": [{"pageId", "decisionId"}]}.',
  'supersedes: only when the newer decision clearly replaces or reverses the older one (not when it merely adds detail).',
  'asserts: when a page claim restates a decision (says the same thing about the system).',
  'Use only the ids given. Use empty arrays when nothing applies.',
].join('\n');

export interface LinksPromptInput {
  system: string;
  decisions: { id: string; day: number | null; summary: string }[];
  claims: { pageId: string; claim: string }[];
}

export function linksPrompt(input: LinksPromptInput): string {
  return [
    `System: ${input.system}`,
    '',
    'Decisions (oldest first):',
    ...input.decisions.map((d) => `- ${d.id} (day ${d.day ?? '?'}): ${d.summary}`),
    '',
    'Page claims:',
    ...(input.claims.length ? input.claims.map((c) => `- ${c.pageId}: ${c.claim}`) : ['(none)']),
  ].join('\n');
}

/**
 * Targeted second pass for stale pages: same output as the links pass, but it
 * shows when each page was written and asks for a link for every claim, also to
 * decisions that were later replaced (that is what makes a page stale).
 */
export const STALE_LINKS_PROMPT_VERSION = 'links-stale-v1';

export const STALE_LINKS_SYSTEM_PROMPT = [
  'You check documentation pages against the decisions made about one technical system.',
  'Decisions are listed oldest first with their day; page claims say what each page states, with the day the page was written.',
  'Return {"supersedes": [{"newerId", "olderId"}], "asserts": [{"pageId", "decisionId"}]}.',
  'asserts: for EVERY page claim, link it to the decision it restates or relies on, if one matches,',
  'even when that decision was later replaced. A page written before a newer decision often still describes',
  'the older behaviour: link it to the older decision.',
  'supersedes: when a later decision replaces, reverses or changes the same aspect of an earlier one',
  '(a new value or limit, a different tool, a dropped practice). Not when it only adds detail.',
  'Use only the ids given. Use empty arrays when nothing applies.',
].join('\n');

export interface StaleLinksPromptInput extends LinksPromptInput {
  claims: { pageId: string; pageDay: number | null; claim: string }[];
}

export function staleLinksPrompt(input: StaleLinksPromptInput): string {
  return [
    `System: ${input.system}`,
    '',
    'Decisions (oldest first):',
    ...input.decisions.map((d) => `- ${d.id} (day ${d.day ?? '?'}): ${d.summary}`),
    '',
    'Page claims:',
    ...input.claims.map((c) => `- ${c.pageId} (page written day ${c.pageDay ?? '?'}): ${c.claim}`),
  ].join('\n');
}

/**
 * Live documents: the decisions of ONE new document against the earlier decisions
 * about the same system. Focused on what is new, so a change of value, tool or
 * practice is found even among hundreds of older decisions (the general links pass
 * is deliberately conservative and sees everything at once).
 */
export const LIVE_LINKS_PROMPT_VERSION = 'links-live-v1';

export const LIVE_LINKS_SYSTEM_PROMPT = [
  'A new document records one or more decisions about a technical system. You also get the earlier decisions about it, oldest first.',
  'Return {"supersedes": [{"newerId", "olderId"}], "asserts": []}: for each new decision, the earlier decisions it replaces,',
  'reverses or changes on the same aspect (a new value or limit, a different tool or approach, a dropped practice).',
  'Not when it only adds detail or concerns a different aspect. newerId must be a new decision, olderId an earlier one.',
  'Use only the ids given. Use empty arrays when nothing applies.',
].join('\n');

export function liveLinksPrompt(input: { system: string; earlier: LinksPromptInput['decisions']; added: LinksPromptInput['decisions'] }): string {
  return [
    `System: ${input.system}`,
    '',
    'New decisions:',
    ...input.added.map((d) => `- ${d.id} (day ${d.day ?? '?'}): ${d.summary}`),
    '',
    'Earlier decisions (oldest first):',
    ...(input.earlier.length ? input.earlier.map((d) => `- ${d.id} (day ${d.day ?? '?'}): ${d.summary}`) : ['(none)']),
  ].join('\n');
}
