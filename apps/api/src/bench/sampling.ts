/**
 * Deterministic sampling: the same seed always picks the same questions, so two
 * runs (or two people) score the same set.
 */

/** mulberry32: a tiny seeded random number generator, uniform in [0, 1). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy (Fisher-Yates) driven by `random`. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Up to `perType` items of each type, chosen with a fixed seed. Items are sorted by
 * id first, so the pick does not depend on file order; each type gets its own
 * generator, so adding questions of one type does not change another type's sample.
 * Returned grouped by type (alphabetical), then by id.
 */
export function samplePerType<T>(items: readonly T[], typeOf: (item: T) => string, idOf: (item: T) => string, perType: number, seed: number): T[] {
  const byType = new Map<string, T[]>();
  for (const item of items) byType.set(typeOf(item), [...(byType.get(typeOf(item)) ?? []), item]);
  return [...byType.keys()].sort().flatMap((type, index) => {
    const sorted = [...byType.get(type)!].sort((a, b) => idOf(a).localeCompare(idOf(b)));
    return shuffle(sorted, seededRandom(seed + index))
      .slice(0, perType)
      .sort((a, b) => idOf(a).localeCompare(idOf(b)));
  });
}
