import type { ArtifactRecord } from './artifact-record';
import { type ArtifactLabel, labelFor } from './labels';
import { type FixesRow, fixesFor, type ReferenceRow, referencesFor } from './links';
import { type RoleRow, rolesFor } from './roles';
import { buildRoster, type Roster, type RosterPerson } from './roster';

/** Properties of one Artifact node (long text goes to the TextStore, not here). */
export interface ArtifactRow {
  id: string;
  type: string;
  title: string;
  day: number | null;
  dayUnknown: boolean | null;
  isIncident: boolean;
  bodyLength: number;
}

/** Everything to write for one ingest step (the whole company, or one day of a replay). */
export interface IngestSlice {
  depts: string[];
  people: RosterPerson[];
  artifactsByLabel: Map<ArtifactLabel, ArtifactRow[]>;
  bodies: { id: string; body: string }[];
  roles: RoleRow[];
  references: ReferenceRow[];
  fixes: FixesRow[];
}

/**
 * The parsed company, computed once from artifacts.jsonl: roster, every
 * artifact row, role edge and link. Slices are then cut from it.
 */
export interface IngestPlan {
  roster: Roster;
  records: ArtifactRecord[];
  roles: RoleRow[];
  references: ReferenceRow[];
  fixes: FixesRow[];
  /** Simulation days that have at least one artifact, ascending. */
  days: number[];
}

export function buildPlan(records: ArtifactRecord[]): IngestPlan {
  const roster = buildRoster(records);
  const knownIds = new Set(records.map((r) => r.doc_id));
  const docTypeById = new Map(records.map((r) => [r.doc_id, r.doc_type]));
  return {
    roster,
    records,
    roles: records.flatMap((r) => rolesFor(r, roster)),
    references: records.flatMap((r) => referencesFor(r, knownIds)),
    fixes: records.flatMap((r) => fixesFor(r, docTypeById)),
    days: [...new Set(records.map((r) => r.day).filter((d): d is number => d !== null))].sort((a, b) => a - b),
  };
}

export function toArtifactRow(record: ArtifactRecord): ArtifactRow {
  return {
    id: record.doc_id,
    type: record.doc_type,
    title: record.title ?? '',
    day: record.day,
    dayUnknown: record.dayUnknown === true ? true : null,
    isIncident: record.is_incident,
    bodyLength: (record.body ?? '').length,
  };
}

/**
 * The slice for a set of artifacts: the artifacts themselves, the people and
 * departments involved, their role edges, and every link that touches them.
 * A link to an artifact that is not in the graph yet is skipped by the MATCH in
 * the query, and created later, when the slice containing the other end loads.
 */
export function sliceFor(plan: IngestPlan, include: (record: ArtifactRecord) => boolean): IngestSlice {
  const records = plan.records.filter(include);
  const ids = new Set(records.map((r) => r.doc_id));
  const roles = plan.roles.filter((role) => ids.has(role.artifactId));

  const names = new Set(roles.map((role) => role.person));
  const people = plan.roster.people.filter((person) => names.has(person.name));
  const depts = [...new Set(people.map((p) => p.dept).filter((d): d is string => d !== null))].sort();

  const artifactsByLabel = new Map<ArtifactLabel, ArtifactRow[]>();
  for (const record of records) {
    const label = labelFor(record.doc_type);
    const rows = artifactsByLabel.get(label) ?? [];
    rows.push(toArtifactRow(record));
    artifactsByLabel.set(label, rows);
  }

  return {
    depts,
    people,
    artifactsByLabel,
    bodies: records.map((r) => ({ id: r.doc_id, body: r.body ?? '' })),
    roles,
    references: plan.references.filter((ref) => ids.has(ref.from) || ids.has(ref.to)),
    fixes: plan.fixes.filter((fix) => ids.has(fix.pr) || ids.has(fix.ticket)),
  };
}
