import type { ArtifactRecord } from './artifact-record';
import type { Calendar } from './calendar';
import type { Roster } from './roster';

/** A person announced as leaving in an artifact. */
export interface DepartureRow {
  person: string;
  artifactId: string;
  /** The announced last day (calendar day), or the document's day when no date is given. */
  departedDay: number;
}

const NAME = String.raw`([A-Z][a-z]+(?: [A-Z][a-z]+)?)`;

/**
 * Explicit announcements only: each pattern names the person who is leaving.
 * Generic words ("last day of last month", "handover", "notice period") are not
 * enough, because the company's documents use them for unrelated things.
 */
const ANNOUNCEMENTS: readonly RegExp[] = [
  new RegExp(String.raw`${NAME}(?:'s|’s) (?:last|final) (?:day|working day)\b`, 'g'),
  new RegExp(String.raw`${NAME} (?:is|will be) leaving (?:Apex|the company|us|the team)\b`, 'g'),
  new RegExp(String.raw`${NAME} has (?:resigned|left (?:Apex|the company|the team))\b`, 'g'),
  new RegExp(String.raw`(?:[Ff]arewell to|[Ss]ay goodbye to|[Oo]ffboarding (?:for )?)${NAME}\b`, 'g'),
];

const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/;

/**
 * Departures announced in the company's own documents (never the answer key).
 * departedDay: a date in the announcing sentence, converted through the calendar
 * (a date after the simulated period becomes lastDay + 1: still there at the end);
 * otherwise the day of the announcing document. Only employees count.
 */
export function departuresIn(record: ArtifactRecord, roster: Roster, calendar: Calendar | null): DepartureRow[] {
  if (record.day === null) return [];
  const text = `${record.title ?? ''}\n${record.body ?? ''}`;
  const rows = new Map<string, DepartureRow>();
  for (const pattern of ANNOUNCEMENTS) {
    for (const match of text.matchAll(pattern)) {
      const person = match[1];
      if (!roster.isEmployee(person) || rows.has(person)) continue;
      const sentence = sentenceAround(text, match.index ?? 0);
      rows.set(person, { person, artifactId: record.doc_id, departedDay: announcedDay(sentence, record.day, calendar) });
    }
  }
  return [...rows.values()];
}

function announcedDay(sentence: string, documentDay: number, calendar: Calendar | null): number {
  const date = ISO_DATE.exec(sentence)?.[1];
  if (!date || !calendar) return documentDay;
  const day = calendar.dayByDate.get(date);
  if (day !== undefined) return day;
  // A date outside the calendar: after the simulated period means "still here at the end".
  return date > [...calendar.dayByDate.keys()].sort().at(-1)! ? calendar.lastDay + 1 : documentDay;
}

/** The sentence (or line) containing position `index`. */
function sentenceAround(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf('\n', index), text.lastIndexOf('. ', index)) + 1;
  const ends = [text.indexOf('\n', index), text.indexOf('. ', index)].filter((i) => i >= 0);
  return text.slice(start, ends.length ? Math.min(...ends) : text.length);
}
