import type { ArtifactRecord } from './artifact-record';

/** Artifact -> Artifact edge from the dataset's own link fields. */
export interface ReferenceRow {
  from: string;
  to: string;
  /** Which field the link came from: an artifact_ids key (e.g. "source_email") or "causal_chain". */
  kind: string;
}

/** PR -> Ticket edge, when a PR title starts with "[TICKET-ID]". */
export interface FixesRow {
  pr: string;
  ticket: string;
}

/** Strings inside a value that may be a string, a list, or nested lists. */
function flattenStrings(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(flattenStrings);
  return [];
}

/**
 * Links from artifact_ids values and facts.causal_chain that point at ANOTHER
 * artifact in the file. Paths, embed ids and self-links are ignored.
 */
export function referencesFor(record: ArtifactRecord, knownIds: ReadonlySet<string>): ReferenceRow[] {
  const candidates: ReferenceRow[] = [
    ...Object.entries(record.artifact_ids).flatMap(([kind, value]) =>
      flattenStrings(value).map((to) => ({ from: record.doc_id, to, kind })),
    ),
    ...flattenStrings(record.facts.causal_chain).map((to) => ({ from: record.doc_id, to, kind: 'causal_chain' })),
  ];
  const seen = new Set<string>();
  return candidates.filter((ref) => {
    const key = `${ref.to}|${ref.kind}`;
    if (ref.to === ref.from || !knownIds.has(ref.to) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const TICKET_IN_TITLE = /^\s*\[([A-Z]+-\d+)\]/;

/** "[ENG-107] Add cost-tagging metadata ..." on a PR -> the PR FIXES ticket ENG-107 (if it is a jira artifact). */
export function fixesFor(record: ArtifactRecord, docTypeById: ReadonlyMap<string, string>): FixesRow[] {
  if (record.doc_type !== 'pr') return [];
  const title = typeof record.facts.pr_title === 'string' ? record.facts.pr_title : (record.title ?? '');
  const ticket = TICKET_IN_TITLE.exec(title)?.[1];
  return ticket && docTypeById.get(ticket) === 'jira' ? [{ pr: record.doc_id, ticket }] : [];
}
