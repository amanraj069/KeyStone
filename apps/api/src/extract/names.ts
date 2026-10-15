import aliasFile from './aliases.json';

/** Unicode dashes and odd spaces that appear in the corpus, mapped to plain ASCII. */
const PUNCTUATION: Readonly<Record<string, string>> = {
  '\u2010': '-', '\u2011': '-', '\u2012': '-', '\u2013': '-', '\u2014': '-', '\u2212': '-',
  '\u00a0': ' ', '\u202f': ' ', '\u2019': "'",
};

/** "  terraform\u2011infra. " -> "terraform-infra": ASCII punctuation, single spaces, no edge punctuation. */
export function normalizeName(raw: string): string {
  return raw
    .replace(/[\u2010-\u2014\u2212\u00a0\u202f\u2019]/g, (ch) => PUNCTUATION[ch] ?? ch)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s"'`([{]+|[\s"'`)\]}.,;:!?]+$/g, '');
}

/**
 * Like normalizeName but for whole documents: maps the same dashes and spaces,
 * keeps line breaks (sentence and heading detection needs them), and turns the
 * literal "\\n" sequences found in some JSON-like page bodies into real line breaks.
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\\n/g, '\n')
    .replace(/[\u2010-\u2014\u2212\u00a0\u202f\u2019]/g, (ch) => PUNCTUATION[ch] ?? ch);
}

/** Case-insensitive comparison key: "Redis Cache" and "redis cache" are the same name. */
export function nameKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

/**
 * Spelling-only key: lower case with spaces, hyphens and punctuation removed, so
 * "Cloud Be es", "CloudBees" and "cloud-bees" match. (The model sometimes splits
 * words with stray spaces.) Different words still differ: "Redis cache" != "Redis".
 */
export function compactKey(name: string): string {
  return normalizeName(name).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The hand-edited alias file (apps/api/src/extract/aliases.json). */
export interface AliasFile {
  aliases: Record<string, string>;
  ignore: string[];
}

export const ALIAS_FILE: AliasFile = { aliases: aliasFile.aliases, ignore: aliasFile.ignore };

/**
 * Turns any spelling the LLM returns into one canonical System name:
 *   1. an explicit alias from aliases.json ("TiDB" -> "TitanDB"),
 *   2. otherwise a spelling-only match with the vocabulary or an earlier name
 *      ("redis" -> "Redis", "Cloud Be es" -> "CloudBees"),
 *   3. otherwise the normalised name itself (a new system).
 * It remembers which raw spellings mapped to each canonical name (System.aliases).
 */
export class Canonicalizer {
  // Keyed by compactKey, so spelling-only variants land on the same name.
  private readonly byKey = new Map<string, string>();
  private readonly variants = new Map<string, Set<string>>();

  constructor(vocabulary: readonly string[], aliases: Readonly<Record<string, string>> = ALIAS_FILE.aliases) {
    for (const name of vocabulary) this.byKey.set(compactKey(name), normalizeName(name));
    // Aliases win over the vocabulary; their targets are canonical names too.
    for (const [variant, canonical] of Object.entries(aliases)) {
      this.byKey.set(compactKey(variant), normalizeName(canonical));
      this.byKey.set(compactKey(canonical), normalizeName(canonical));
    }
  }

  /** The canonical name, or null for an empty / unusable name. */
  canonical(raw: string): string | null {
    const cleaned = normalizeName(raw);
    if (cleaned.length < 2 || cleaned.length > 80) return null;
    const key = compactKey(cleaned);
    if (key.length < 2) return null;
    // First spelling seen becomes the canonical name for a new system.
    const canonical = this.byKey.get(key) ?? cleaned;
    if (!this.byKey.has(key)) this.byKey.set(key, canonical);
    if (cleaned !== canonical) {
      this.variants.set(canonical, (this.variants.get(canonical) ?? new Set()).add(cleaned));
    }
    return canonical;
  }

  /** Raw spellings seen for a canonical name (stored as System.aliases). */
  aliasesOf(canonical: string): string[] {
    return [...(this.variants.get(canonical) ?? [])].sort();
  }
}
