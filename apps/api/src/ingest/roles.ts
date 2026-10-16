import type { ArtifactRecord } from './artifact-record';
import { messagesBySpeaker, parseAddress, type Roster } from './roster';

/** One Person -> Artifact edge to write. */
export interface RoleRow {
  rel: 'AUTHORED' | 'REVIEWED' | 'ASSIGNED' | 'PARTICIPATED';
  person: string;
  artifactId: string;
  day: number | null;
  status: string | null;
  /** PARTICIPATED only: messages this person wrote in the conversation (1 when unknown). */
  messages: number | null;
  /**
   * PARTICIPATED only: did the person write at least one line? False for people only
   * listed on a thread or meeting with no speaker lines, and for Salesforce actors.
   * Only written participation counts as activity (firstDay / lastSeenDay).
   */
  wrote: boolean | null;
}

/**
 * Who did what on an artifact, per doc_type. Only employees get edges.
 * AUTHORED means real authorship; taking part in a conversation is PARTICIPATED.
 *
 *   slack            one speaker ("Name: ...")                        AUTHORED
 *                    two or more speakers                             PARTICIPATED {messages}
 *   zoom_transcript  every speaker ("**[hh:mm:ss] Name:**")           PARTICIPATED {messages}
 *                    (both fall back to the listed actors, messages 1 and wrote false, when no speaker line matches)
 *   confluence       the "**Author:** Name" line, else the first actor AUTHORED
 *   pr               facts.author AUTHORED, facts.reviewer REVIEWED (else first actor AUTHORED)
 *   jira, sprint     every actor (the ticket owners)                  ASSIGNED {status}
 *   jira, other      first actor AUTHORED (the creator), the others   ASSIGNED {status}
 *   email            the sender (facts.sent_by or the from_addr name) AUTHORED
 *   sf_opp           every actor (no author is recorded)              PARTICIPATED {messages: 1, wrote: false}
 *   alerts, invoices, NPS surveys, Zendesk tickets: no people involved
 *
 * The `actors` list alone is not used for Slack: it includes people a thread
 * merely mentions, not only those who wrote in it.
 */
export function rolesFor(record: ArtifactRecord, roster: Roster): RoleRow[] {
  const day = record.day;
  const status = typeof record.facts.status === 'string' ? record.facts.status : null;
  const row = (rel: RoleRow['rel'], person: string, messages = 1, wrote = false): RoleRow => ({
    rel,
    person,
    artifactId: record.doc_id,
    day,
    status: rel === 'ASSIGNED' ? status : null,
    messages: rel === 'PARTICIPATED' ? messages : null,
    wrote: rel === 'PARTICIPATED' ? wrote : null,
  });
  const employees = (names: readonly string[]) => unique(names).filter(roster.isEmployee);

  switch (record.doc_type) {
    case 'slack':
    case 'zoom_transcript': {
      const counts = messagesBySpeaker(record);
      const speakers = employees([...counts.keys()]);
      const people = speakers.length > 0 ? speakers : employees(record.actors);
      // The single writer of a thread is its author; a meeting or a conversation has participants.
      if (record.doc_type === 'slack' && people.length === 1) return [row('AUTHORED', people[0])];
      return people.map((p) => row('PARTICIPATED', p, counts.get(p) ?? 1, counts.has(p)));
    }
    case 'confluence': {
      const author = /\*\*Author:\*\*\s*([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)/.exec(record.body ?? '')?.[1];
      return employees([author ?? record.actors[0] ?? '']).map((p) => row('AUTHORED', p));
    }
    case 'pr': {
      const author = typeof record.facts.author === 'string' ? record.facts.author : record.actors[0];
      const reviewer = typeof record.facts.reviewer === 'string' ? record.facts.reviewer : undefined;
      return [
        ...employees([author ?? '']).map((p) => row('AUTHORED', p)),
        ...employees(reviewer && reviewer !== author ? [reviewer] : []).map((p) => row('REVIEWED', p)),
      ];
    }
    case 'jira': {
      const people = employees(record.actors);
      if (typeof record.facts.sprint_number === 'number') return people.map((p) => row('ASSIGNED', p));
      return people.map((p, index) => row(index === 0 ? 'AUTHORED' : 'ASSIGNED', p));
    }
    case 'email': {
      const sender =
        typeof record.facts.sent_by === 'string' ? record.facts.sent_by : parseAddress(record.facts.from_addr)?.name;
      return employees(sender ? [sender] : []).map((p) => row('AUTHORED', p));
    }
    case 'sf_opp':
      return employees(record.actors).map((p) => row('PARTICIPATED', p));
    default:
      return [];
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => v.trim() !== ''))];
}
