/** Names shorter than this are skipped: "Go" or "S3" would match inside too many words. */
const MIN_NAME_LENGTH = 3;
/** A passage is cut to this many characters around the name. */
const MAX_PASSAGE = 240;
/** Email and ticket header lines ("title: …", "Subject: …"): they repeat the title, so they are no passage. */
const HEADER_LINE = /^(?:title|subject|from|to|cc|date|status|priority|assignee|reporter|labels?|summary)\s*:/i;

/** A case-insensitive pattern for `name` as a whole word ("TitanDB", not "TitanDBs" or "xTitanDB"). */
function wordPattern(name: string, flags: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, flags);
}

function usable(names: readonly string[]): string[] {
  return [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= MIN_NAME_LENGTH))];
}

/** How many times `body` names any of `names` (a system and its aliases), as whole words, ignoring case. */
export function countMentions(body: string, names: readonly string[]): number {
  return usable(names).reduce((total, name) => total + (body.match(wordPattern(name, 'giu'))?.length ?? 0), 0);
}

/**
 * The first sentence of `body` that names one of `names`, tried in order (the most
 * specific first), so a citation can show why the document backs the claim. Title
 * lines ("# …") and metadata lines ("**Author:** …") are skipped. Null when none does.
 */
export function passageNaming(body: string, names: readonly string[]): string | null {
  const lines = body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !/^\*\*[^*]+:\*\*/.test(line) && !HEADER_LINE.test(line));
  // A sentence ends at . ! or ? followed by a space or the end, so "max.poll.interval.ms" stays whole.
  const sentences = lines.flatMap((line) => line.match(/.+?(?:[.!?]+(?=\s|$)|$)/g) ?? [line]).map((s) => s.trim()).filter((s) => s.length > 0);
  for (const name of usable(names)) {
    const pattern = wordPattern(name, 'iu');
    const hit = sentences.find((s) => pattern.test(s));
    if (hit) return cut(hit, pattern);
  }
  return null;
}

/** A long sentence cut around the name, with an ellipsis where text was dropped. */
function cut(sentence: string, pattern: RegExp): string {
  if (sentence.length <= MAX_PASSAGE) return sentence;
  const at = sentence.search(pattern);
  const start = Math.max(0, Math.min(at - MAX_PASSAGE / 3, sentence.length - MAX_PASSAGE));
  const piece = sentence.slice(start, start + MAX_PASSAGE).trim();
  return `${start > 0 ? '…' : ''}${piece}${start + MAX_PASSAGE < sentence.length ? '…' : ''}`;
}
