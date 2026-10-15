import { ALIAS_FILE, nameKey, normalizeName, normalizeText } from './names';

/**
 * The seed vocabulary of system names, given to the LLM so it reuses existing
 * names exactly. Built ONLY from artifact text (AGENTS.md section 2):
 *   - canonical names from aliases.json (always first),
 *   - system-looking words inside Page titles (CamelCase, acronyms, "...DB", "x.js"),
 *   - capitalised words that appear mid-sentence in MIN_DOCS+ artifacts and are
 *     rarely written in lower case (so "The", "We", "Thanks" drop out),
 *   - two-word names ("Spring Boot", "GitHub Actions") in MIN_DOCS+ artifacts; a
 *     single word that mostly appears inside such a pair ("Boot") is dropped,
 * minus people and organisation names (actors), calendar words and the
 * aliases.json "ignore" list. Capped at MAX_TERMS, most frequent first.
 */

export const MIN_DOCS = 3;
export const MAX_TERMS = 150;

const CALENDAR = new Set(
  [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  ],
);

/** Hyphenated adjectives ("Terraform-managed", "Kafka-based") describe something; they are not names. */
const HYPHEN_ADJECTIVE = /-(?:managed|based|driven|related|level|wide|specific|enabled|aware|ready|first|only|owned|backed|heavy|style|like)$/i;

/** Ticket and document ids ("ENG-112", "CONF-ENG-018") are not system names. */
const TICKET_ID = /^[A-Z]+(?:-[A-Z]+)*-\d+$/;

/** Capitalised English function words ("The Redis" is not a system name). */
const FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'so', 'we', 'our', 'us', 'you', 'your', 'they', 'their', 'it',
  'its', 'this', 'that', 'these', 'those', 'he', 'she', 'my', 'me', 'for', 'to', 'of', 'in', 'on', 'at', 'by', 'with',
  'from', 'as', 'is', 'are', 'was', 'be', 'all', 'any', 'no', 'not', 'yes', 'please', 'also', 'just', 'new', 'per',
]);

/** "Hi Maya", "Thanks Maya", "Dear Maya": the next word is a person's name. */
const GREETING = /\b(?:Hi|Hey|Hello|Dear|Thanks|Thank you|Cheers|cc|CC)[,\s]+([A-Z][a-z]+)/g;

/** "Best,\nMaya" / "Regards,\nMaya": the name on the line after a sign-off. */
const SIGN_OFF = /\b(?:Best|Regards|Best regards|Kind regards|Thanks|Cheers|Sincerely)[,!]?\s*\n\s*([A-Z][a-z]+)/g;

/** Words that look like product or technology names: inner capitals, acronyms, digits, "DB" or ".js" endings. */
const SYSTEM_SHAPE = /^(?:[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[A-Z]{2,}[a-z0-9]*|[A-Za-z]+\d[A-Za-z0-9]*|[A-Za-z]+DB|[A-Za-z]+\.js)$/;

const TOKEN = /[A-Za-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*/g;

export interface VocabularyInput {
  /** Bodies of all artifacts (from the TextStore). */
  texts: readonly string[];
  /** Titles of Page artifacts. */
  pageTitles: readonly string[];
  /** Every actor name (people, contacts, organisations); their words are excluded. */
  actorNames: readonly string[];
  aliases?: Readonly<Record<string, string>>;
  ignore?: readonly string[];
}

export function buildVocabulary(input: VocabularyInput): string[] {
  const aliases = input.aliases ?? ALIAS_FILE.aliases;
  const excluded = new Set<string>([
    ...CALENDAR,
    ...(input.ignore ?? ALIAS_FILE.ignore).map((w) => w.toLowerCase()),
    ...input.actorNames.flatMap((name) => name.toLowerCase().split(/\s+/)),
  ]);
  const actorFirstNames = new Set(input.actorNames.map((name) => name.split(/\s+/)[0]));
  // Names of people that are not actors: greeted people ("Hi Maya") and surnames after an
  // actor's first name ("Nora Klein"). Collected from the texts before counting.
  for (const raw of input.texts) {
    const text = normalizeText(raw);
    for (const match of text.matchAll(GREETING)) excluded.add(match[1].toLowerCase());
    for (const match of text.matchAll(SIGN_OFF)) excluded.add(match[1].toLowerCase());
    for (const match of text.matchAll(/\b([A-Z][a-z]+) (?:O')?([A-Z][a-z]+)\b/g)) {
      if (actorFirstNames.has(match[1])) excluded.add(match[2].toLowerCase());
    }
  }
  const usable = (word: string) =>
    word.length >= 2 &&
    !excluded.has(word.toLowerCase()) &&
    !FUNCTION_WORDS.has(word.toLowerCase()) &&
    !TICKET_ID.test(word) &&
    !HYPHEN_ADJECTIVE.test(word);

  // Count, per word, in how many artifacts it is capitalised mid-sentence vs written in lower case.
  const capitalisedDocs = new Map<string, number>();
  const lowercaseDocs = new Map<string, number>();
  const pairDocs = new Map<string, number>();
  for (const raw of input.texts) {
    const text = normalizeText(raw);
    const capitalised = new Set<string>();
    const lowercase = new Set<string>();
    const pairs = new Set<string>();
    let previous: { word: string; end: number; midSentence: boolean } | null = null;
    for (const match of text.matchAll(TOKEN)) {
      const word = match[0];
      const start = match.index ?? 0;
      if (word[0] === word[0].toLowerCase()) {
        lowercase.add(word.toLowerCase());
        previous = null;
        continue;
      }
      const midSentence = !atSentenceStart(text, start);
      if (midSentence || SYSTEM_SHAPE.test(word)) capitalised.add(word);
      // Two capitalised words separated by one space, the first mid-sentence, form a candidate
      // pair ("runs on Spring Boot"). Title Case headings start a line, so they do not count.
      if (previous?.midSentence && text.slice(previous.end, start) === ' ') pairs.add(`${previous.word} ${word}`);
      previous = { word, end: start + word.length, midSentence };
    }
    for (const word of capitalised) capitalisedDocs.set(word, (capitalisedDocs.get(word) ?? 0) + 1);
    for (const word of lowercase) lowercaseDocs.set(word, (lowercaseDocs.get(word) ?? 0) + 1);
    for (const pair of pairs) pairDocs.set(pair, (pairDocs.get(pair) ?? 0) + 1);
  }

  const singles = [...capitalisedDocs.entries()]
    .filter(([word, docs]) => docs >= MIN_DOCS && usable(word))
    // Proper names are almost never written in lower case.
    .filter(([word, docs]) => (lowercaseDocs.get(word.toLowerCase()) ?? 0) <= 0.2 * docs);
  const goodPairs = [...pairDocs.entries()].filter(([pair, docs]) => {
    const [first, second] = pair.split(' ');
    if (docs < MIN_DOCS || !usable(first) || !usable(second) || excluded.has(pair.toLowerCase())) return false;
    // A real two-word name: at least one half mostly appears inside it ("Boot" in "Spring Boot").
    // Two systems that merely sit next to each other ("TitanDB RDS") both appear alone too.
    const dependent = (half: string) => docs >= 0.6 * (capitalisedDocs.get(half) ?? docs);
    return dependent(first) || dependent(second);
  });
  // A word that appears inside a kept pair in most of its documents is only part of that name.
  const insidePair = (word: string, docs: number) =>
    goodPairs.some(([pair, pairCount]) => pair.split(' ').includes(word) && pairCount >= 0.6 * docs);
  const frequent = [...singles.filter(([word, docs]) => !insidePair(word, docs)), ...goodPairs]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word);

  const fromTitles = input.pageTitles.flatMap((title) =>
    [...normalizeName(title).matchAll(TOKEN)].map((m) => m[0]).filter((w) => SYSTEM_SHAPE.test(w) && usable(w)),
  );

  // Canonical alias targets first, then frequent words, then title words; one entry per name.
  const ordered = [...new Set(Object.values(aliases).map(normalizeName)), ...frequent, ...fromTitles];
  const variantKeys = lowerKeys(aliases);
  const seen = new Set<string>();
  const vocabulary: string[] = [];
  for (const name of ordered) {
    const key = nameKey(name);
    if (seen.has(key) || key in variantKeys) continue;
    seen.add(key);
    vocabulary.push(name);
    if (vocabulary.length >= MAX_TERMS) break;
  }
  return vocabulary;
}

/**
 * True if the word at `index` starts a sentence: after . ! ? or a "Name:" label
 * (also markdown "**Name:**"), at the start of a line or bullet, or at the very start.
 */
function atSentenceStart(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 8), index);
  return index === 0 || /(?:[.!?:][*_)\]"'\s]*|\n[\s>*#-]*|^\s*)$/.test(before);
}

/** Alias variants (lower-cased) never appear in the vocabulary: only their canonical names do. */
function lowerKeys(aliases: Readonly<Record<string, string>>): Record<string, true> {
  const result: Record<string, true> = {};
  for (const variant of Object.keys(aliases)) {
    if (nameKey(variant) !== nameKey(aliases[variant])) result[nameKey(variant)] = true;
  }
  return result;
}
