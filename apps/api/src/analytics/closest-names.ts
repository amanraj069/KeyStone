/**
 * The names closest to `query`, best first, for "did you mean" suggestions when a
 * system name is not found. Plain string similarity (FalkorDB's Cypher has no
 * edit-distance function); `aliases` let "Postgres" find "PostgreSQL".
 */
export function closestNames(query: string, candidates: readonly { name: string; aliases?: readonly string[] }[], limit = 5): string[] {
  const q = squash(query);
  if (!q) return [];
  return candidates
    .map((c) => ({ name: c.name, distance: Math.min(...[c.name, ...(c.aliases ?? [])].map((n) => distance(q, squash(n)))) }))
    .sort((a, b) => a.distance - b.distance || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((c) => c.name);
}

/** Lower case, letters and digits only: "Titan-DB " -> "titandb". */
function squash(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Edit distance, with containment counted as close ("kafka" in "kafkastreams" costs the extra length / 4). */
function distance(a: string, b: string): number {
  if (!b) return Number.MAX_SAFE_INTEGER;
  if (a === b) return 0;
  if (b.includes(a) || a.includes(b)) return Math.ceil(Math.abs(a.length - b.length) / 4);
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
