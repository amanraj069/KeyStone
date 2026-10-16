import { normalizeName } from '../extract/names';

/** Words that, at the end of a name, do not change which system it is: "Telemetry service" = "Telemetry". */
const GENERIC_SUFFIXES = new Set(['service', 'services', 'system', 'systems', 'api', 'apis']);

/**
 * Version tokens: "v2", "v2.14.3-rc1", "3.11", "1.21.0", and one- or two-digit
 * numbers ("Java 8", "Java 17"). Three or more bare digits stay ("HTTP 500"),
 * and digits inside a word stay ("S3", "EC2", "OAuth2").
 */
const VERSION = /^(v\d+(\.\d+)*|\d+\.\d+(\.\d+)*|\d{1,2})([-_.]?(rc|beta|alpha|preview)\.?\d*)?$/i;

/**
 * The key two System names must share to be merged automatically:
 * lower case, without version numbers, punctuation or a generic last word.
 *   "Telemetry Service", "telemetry-service", "Telemetry v2" -> "telemetry"
 *   "Java 8", "Java 17", "Java" -> "java";  "PaymentsAPI" stays "paymentsapi".
 * Returns null when nothing meaningful is left (e.g. a bare "v2.14.3-rc1").
 * Done in TypeScript because FalkorDB's Cypher has no regular-expression replace.
 */
export function mergeKey(name: string): string | null {
  const words = normalizeName(name)
    .toLowerCase()
    .split(' ')
    .filter((token) => !VERSION.test(token))
    .flatMap((token) => token.split(/[-_/]/))
    .filter((token) => !VERSION.test(token))
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length > 0);
  // Drop generic last words, but never the only word ("API" stays "api").
  while (words.length > 1 && GENERIC_SUFFIXES.has(words[words.length - 1])) words.pop();
  const key = words.join('');
  return key.length >= 2 ? key : null;
}

export interface SystemRow {
  name: string;
  mentionCount: number;
  authorCount: number;
}

/** Several System names that are the same system; `keep` survives, `merge` are folded into it. */
export interface MergeGroup {
  keep: string;
  merge: string[];
}

/**
 * Groups systems by mergeKey. The survivor is the most mentioned name (then more
 * authors, then the shorter name, then alphabetical), so the familiar spelling wins.
 */
export function planMerges(systems: readonly SystemRow[]): MergeGroup[] {
  const byKey = new Map<string, SystemRow[]>();
  for (const system of systems) {
    const key = mergeKey(system.name);
    if (key) byKey.set(key, [...(byKey.get(key) ?? []), system]);
  }
  const groups: MergeGroup[] = [];
  for (const members of byKey.values()) {
    if (members.length < 2) continue;
    const [keep, ...rest] = [...members].sort(survivorFirst);
    groups.push({ keep: keep.name, merge: rest.map((m) => m.name) });
  }
  return groups.sort((a, b) => a.keep.localeCompare(b.keep));
}

function survivorFirst(a: SystemRow, b: SystemRow): number {
  return (
    b.mentionCount - a.mentionCount ||
    b.authorCount - a.authorCount ||
    a.name.length - b.name.length ||
    a.name.localeCompare(b.name)
  );
}
