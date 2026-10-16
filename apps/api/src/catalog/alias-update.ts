import { compactKey } from '../extract/names';
import type { MergeGroup } from './merge-key';

/** apps/api/src/extract/aliases.json as stored on disk. */
export interface AliasFileJson {
  _comment?: string;
  aliases: Record<string, string>;
  ignore: string[];
}

/**
 * Records merges in aliases.json so a future extraction produces the merged
 * names directly: every merged name becomes an alias of its survivor, and
 * existing aliases that pointed at a merged name are redirected. Names that
 * differ from the survivor only in spelling are skipped (the Canonicalizer
 * already matches those). Returns a new object; the input is not changed.
 */
export function withMergedAliases(file: AliasFileJson, groups: readonly MergeGroup[]): AliasFileJson {
  const aliases = { ...file.aliases };
  const survivorOf = new Map<string, string>();
  for (const group of groups) for (const name of group.merge) survivorOf.set(name, group.keep);

  for (const [variant, target] of Object.entries(aliases)) {
    const survivor = survivorOf.get(target);
    if (survivor) aliases[variant] = survivor;
  }
  for (const [name, survivor] of survivorOf) {
    if (compactKey(name) !== compactKey(survivor)) aliases[name] = survivor;
  }
  return { ...file, aliases };
}
