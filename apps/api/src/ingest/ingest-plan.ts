import type { ArtifactRecord } from './artifact-record';
import type { Calendar } from './calendar';
import { type DepartureRow, departuresIn } from './departures';
import { type ArtifactLabel, labelFor } from './labels';
import { type FixesRow, fixesFor, type ReferenceRow, referencesFor } from './links';
import { type RoleRow, rolesFor, type SeenRow, visibilityFor } from './roles';
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
  /** RECEIVED / LISTED_ON edges: who could see an artifact without a role on it. */
  seen: SeenRow[];
  references: ReferenceRow[];
  fixes: FixesRow[];
  departures: DepartureRow[];
}

/**
 * The parsed company, computed once from artifacts.jsonl: roster, every
 * artifact row, role edge and link. Slices are then cut from it.
 */
export interface IngestPlan {
  roster: Roster;
  records: ArtifactRecord[];
  roles: RoleRow[];
  seen: SeenRow[];
  references: ReferenceRow[];
  fixes: FixesRow[];
  /** People announced as leaving in the company's own documents. */
  departures: DepartureRow[];
  /** Simulation days that have at least one artifact, ascending. */
  days: number[];
}

export function buildPlan(records: ArtifactRecord[], calendar: Calendar | null = null): IngestPlan {
  const roster = buildRoster(records);
  const knownIds = new Set(records.map((r) => r.doc_id));
  const docTypeById = new Map(records.map((r) => [r.doc_id, r.doc_type]));
  const roles = records.flatMap((r) => rolesFor(r, roster));
  const rolesById = new Map<string, RoleRow[]>();
  for (const role of roles) rolesById.set(role.artifactId, [...(rolesById.get(role.artifactId) ?? []), role]);
  return {
    roster,
    records,
    roles,
    seen: records.flatMap((r) => visibilityFor(r, roster, rolesById.get(r.doc_id) ?? [])),
    references: records.flatMap((r) => referencesFor(r, knownIds)),
    fixes: records.flatMap((r) => fixesFor(r, docTypeById)),
    departures: records.flatMap((r) => departuresIn(r, roster, calendar)),
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
  const seen = plan.seen.filter((edge) => ids.has(edge.artifactId));

  // Everyone with an edge in the slice must exist as a Person before the edges are written.
  const names = new Set([...roles.map((role) => role.person), ...seen.map((edge) => edge.person)]);
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
    seen,
    references: plan.references.filter((ref) => ids.has(ref.from) || ids.has(ref.to)),
    fixes: plan.fixes.filter((fix) => ids.has(fix.pr) || ids.has(fix.ticket)),
    departures: plan.departures.filter((d) => ids.has(d.artifactId)),
  };
}
