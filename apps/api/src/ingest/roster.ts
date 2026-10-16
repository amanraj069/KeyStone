import type { ArtifactRecord } from './artifact-record';

/**
 * The roster: which actors are employees (Person nodes) and their department.
 * Everything is derived from artifacts.jsonl only (AGENTS.md section 2).
 *
 * Employee rule (checked against the data: 44 employees, 25 others):
 *   - not a bot/system account (BOT_ACTORS), and
 *   - appears in at least one internal document (Slack, Confluence, Zoom, Jira, PR), and
 *   - either has no email address outside the company domain, or speaks in
 *     Slack/Zoom at least MIN_SPEAKING_TURNS times (new hires write from a personal
 *     address before they start, then talk in Slack).
 *   Vendors, customers and customer organisations only have external addresses
 *   and never speak in internal channels, so they are excluded.
 *
 * Department rule, strongest evidence first:
 *   1. the department of the sprint-backlog Jira tickets they own,
 *   2. the department of the meetings they attend most,
 *   3. the department channel they speak in most,
 *   otherwise null (no MEMBER_OF edge).
 */

/** Bot and system accounts that post in Slack. They are not people. */
export const BOT_ACTORS: ReadonlySet<string> = new Set([
  'GitHub',
  'GitHub Actions',
  'AWS Cost Explorer',
  'Datadog',
  'Snyk Security',
  'PagerDuty',
]);

const INTERNAL_DOC_TYPES: ReadonlySet<string> = new Set(['slack', 'confluence', 'zoom_transcript', 'jira', 'pr']);
const MIN_SPEAKING_TURNS = 3;

/** "Name <user@domain>" -> { name, domain } */
const ADDRESS = /^\s*(.*?)\s*<[^>@]+@([^>]+)>\s*$/;
/** Slack lines start with "Name: message". */
const SLACK_SPEAKER = /^([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?):/gm;
/** Zoom lines look like "**[12:12:00] Name:** text". */
const ZOOM_SPEAKER = /^\*\*\[[\d:]+\] ([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?):\*\*/gm;

export interface RosterPerson {
  name: string;
  dept: string | null;
}

export interface Roster {
  companyDomain: string | null;
  people: RosterPerson[];
  depts: string[];
  isEmployee(name: string): boolean;
}

export function parseAddress(value: unknown): { name: string; domain: string } | null {
  if (typeof value !== 'string') return null;
  const match = ADDRESS.exec(value);
  return match ? { name: match[1], domain: match[2].toLowerCase() } : null;
}

/** Names of the people who actually spoke in a Slack thread or Zoom transcript. */
export function speakersOf(record: ArtifactRecord): string[] {
  return [...messagesBySpeaker(record).keys()];
}

/**
 * Messages per speaker in a Slack thread or Zoom transcript, in order of first
 * message. A message is one line starting with "Name:" (Slack) or
 * "**[hh:mm:ss] Name:**" (Zoom); lines without that prefix continue the previous
 * message (lists, wrapped text). Only names the dataset also lists as actors count.
 */
export function messagesBySpeaker(record: ArtifactRecord): Map<string, number> {
  const pattern = record.doc_type === 'zoom_transcript' ? ZOOM_SPEAKER : SLACK_SPEAKER;
  const counts = new Map<string, number>();
  for (const match of (record.body ?? '').matchAll(pattern)) {
    if (record.actors.includes(match[1])) counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return counts;
}

/** The department named in a dept channel id, e.g. "slack_qa_support_2026-01-05T..." -> QA_Support. */
function channelDept(docId: string, deptByLowerName: Map<string, string>): string | null {
  const match = /^slack_([a-z_]+?)_\d{4}-/.exec(docId);
  return match ? (deptByLowerName.get(match[1]) ?? null) : null;
}

/** Most frequent key of a tally (ties broken alphabetically, so the result is stable). */
function mostFrequent(tally: Map<string, number> | undefined): string | null {
  if (!tally || tally.size === 0) return null;
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function bump(tallies: Map<string, Map<string, number>>, person: string, key: string): void {
  const tally = tallies.get(person) ?? new Map<string, number>();
  tally.set(key, (tally.get(key) ?? 0) + 1);
  tallies.set(person, tally);
}

/** The email domain shared by the most actors: the company's own domain. */
function findCompanyDomain(domainsByName: Map<string, Set<string>>): string | null {
  const counts = new Map<string, number>();
  for (const domains of domainsByName.values()) {
    for (const domain of domains) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return mostFrequent(counts);
}

export function buildRoster(records: readonly ArtifactRecord[]): Roster {
  // Departments are the values the dataset itself uses in the `dept` column.
  const depts = [...new Set(records.map((r) => r.dept).filter((d): d is string => !!d && d.trim() !== ''))].sort();
  const deptByLowerName = new Map(depts.map((d) => [d.toLowerCase(), d]));

  const domainsByName = new Map<string, Set<string>>();
  const internalCount = new Map<string, number>();
  const speakingTurns = new Map<string, number>();
  const sprintDept = new Map<string, Map<string, number>>();
  const meetingDept = new Map<string, Map<string, number>>();
  const channelDeptTally = new Map<string, Map<string, number>>();

  for (const record of records) {
    if (record.doc_type === 'email') {
      for (const field of ['from_addr', 'to_addr']) {
        const address = parseAddress(record.facts[field]);
        if (address) domainsByName.set(address.name, (domainsByName.get(address.name) ?? new Set()).add(address.domain));
      }
    }
    if (INTERNAL_DOC_TYPES.has(record.doc_type)) {
      for (const actor of record.actors) internalCount.set(actor, (internalCount.get(actor) ?? 0) + 1);
    }
    if (record.doc_type === 'slack' || record.doc_type === 'zoom_transcript') {
      for (const speaker of speakersOf(record)) speakingTurns.set(speaker, (speakingTurns.get(speaker) ?? 0) + 1);
    }
    if (record.doc_type === 'jira' && typeof record.facts.sprint_number === 'number' && record.dept) {
      for (const actor of record.actors) bump(sprintDept, actor, record.dept);
    }
    if (record.doc_type === 'zoom_transcript' && record.dept) {
      for (const actor of record.actors) bump(meetingDept, actor, record.dept);
    }
    if (record.doc_type === 'slack') {
      const dept = channelDept(record.doc_id, deptByLowerName);
      if (dept) for (const speaker of speakersOf(record)) bump(channelDeptTally, speaker, dept);
    }
  }

  const companyDomain = findCompanyDomain(domainsByName);
  const isEmployee = (name: string): boolean => {
    if (BOT_ACTORS.has(name) || !internalCount.get(name)) return false;
    const domains = domainsByName.get(name);
    const externalOnly = !!domains && domains.size > 0 && !(companyDomain && domains.has(companyDomain));
    return !externalOnly || (speakingTurns.get(name) ?? 0) >= MIN_SPEAKING_TURNS;
  };

  const names = [...new Set(records.flatMap((r) => r.actors))].filter(isEmployee).sort();
  const people = names.map((name) => ({
    name,
    dept: mostFrequent(sprintDept.get(name)) ?? mostFrequent(meetingDept.get(name)) ?? mostFrequent(channelDeptTally.get(name)),
  }));
  const employees = new Set(names);
  return { companyDomain, people, depts, isEmployee: (name) => employees.has(name) };
}
