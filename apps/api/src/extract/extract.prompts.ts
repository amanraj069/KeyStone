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
