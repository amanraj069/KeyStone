import type { MatchVia, NameMatch, Prf } from '@keystone/shared';
import { ALIAS_FILE, compactKey } from '../extract/names';
import { FUZZY_MIN_SIMILARITY, MIN_CONTAINED_CHARS } from './bench.constants';

/**
 * Comparison key for a system name: aliases.json applied (so "TiDB" and "TitanDB"
 * agree), then lower case with spaces, hyphens and punctuation removed.
 * "Redis-cache" -> "rediscache". The alias file holds artifact spellings only.
 */
export function systemKey(name: string, aliases: Readonly<Record<string, string>> = ALIAS_FILE.aliases): string {
  const key = compactKey(name);
  const canonical = aliasIndex(aliases).get(key);
  return canonical ?? key;
}

/** compactKey(variant) -> compactKey(canonical), built once per alias object. */
const indexCache = new WeakMap<object, Map<string, string>>();
function aliasIndex(aliases: Readonly<Record<string, string>>): Map<string, string> {
  let index = indexCache.get(aliases);
  if (!index) {
    index = new Map(Object.entries(aliases).map(([variant, canonical]) => [compactKey(variant), compactKey(canonical)]));
    indexCache.set(aliases, index);
  }
  return index;
}

/** 1 - editDistance / longer length, on two keys (1 = identical). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = Math.max(a.length, b.length);
  return longer === 0 ? 1 : 1 - editDistance(a, b) / longer;
}

/** Levenshtein distance. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * How two names match without an LLM, or null: "exact" when the keys are equal,
 * "fuzzy" when they are close (similarity) or one contains the other
 * ("authservice" in "legacyauthservice").
 */
export function matchWithoutLlm(a: string, b: string, aliases?: Readonly<Record<string, string>>): Exclude<MatchVia, 'llm'> | null {
  const ka = systemKey(a, aliases);
  const kb = systemKey(b, aliases);
  if (!ka || !kb) return null;
  if (ka === kb) return 'exact';
  if (similarity(ka, kb) >= FUZZY_MIN_SIMILARITY) return 'fuzzy';
  const [shorter, longer] = ka.length <= kb.length ? [ka, kb] : [kb, ka];
  if (shorter.length >= MIN_CONTAINED_CHARS && longer.includes(shorter)) return 'fuzzy';
  return null;
}

export interface MatchResult {
  matches: NameMatch[];
  /** Pairs no rule matched where the gold or the predicted name is still unmatched: the LLM's turn. */
  leftovers: { gold: string; predicted: string }[];
}

/**
 * Matches gold names to predicted names: exact, then fuzzy. A name may match more
 * than one on the other side (two spellings of one system). Pairs left over are
 * those where at least one side found nothing yet.
 */
export function matchNames(gold: readonly string[], predicted: readonly string[], aliases?: Readonly<Record<string, string>>): MatchResult {
  const matches: NameMatch[] = [];
  for (const g of gold) {
    for (const p of predicted) {
      const via = matchWithoutLlm(g, p, aliases);
      if (via) matches.push({ gold: g, predicted: p, via });
    }
  }
  const goldHit = new Set(matches.map((m) => m.gold));
  const predictedHit = new Set(matches.map((m) => m.predicted));
  // A pair where both names already matched something adds nothing (it cannot change a score).
  const leftovers = gold.flatMap((g) => predicted.filter((p) => !goldHit.has(g) || !predictedHit.has(p)).map((p) => ({ gold: g, predicted: p })));
  return { matches, leftovers };
}

/** Precision, recall and F1 from matches: a predicted name is right if it matches any gold name, and vice versa. */
export function scoreMatches(gold: readonly string[], predicted: readonly string[], matches: readonly NameMatch[]): Prf {
  const tp = new Set(matches.map((m) => m.predicted)).size;
  const found = new Set(matches.map((m) => m.gold)).size;
  return prf(tp, predicted.length - tp, gold.length - found, found);
}

/**
 * P/R/F1 from counts. `found` is the number of gold names matched; it differs
 * from tp when one predicted name matches two gold names (or the reverse).
 * Undefined ratios (nothing predicted, nothing to find) are null.
 */
export function prf(tp: number, fp: number, fn: number, found = tp): Prf {
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = found + fn === 0 ? null : found / (found + fn);
  let f1: number | null = null;
  if (precision !== null && recall !== null) f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1 };
}
