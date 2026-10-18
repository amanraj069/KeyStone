/** A bracketed citation group, e.g. "[CONF-ENG-443]" or "[T-1, PR-2]"; not a Markdown link "[text](url)". */
const CITATION = /\[([^[\]\n]{1,300})\](?!\()/g;

/** Every id cited in `text`, in order of first appearance. */
export function citedIds(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(CITATION)) {
    for (const id of splitIds(match[1])) if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

export interface CheckedAnswer {
  text: string;
  /** Cited ids that are in the evidence set, in order. */
  valid: string[];
  /** Cited ids that are not (hallucinated): removed from the text. */
  dropped: string[];
}

/**
 * Keeps only citations whose ids are in `evidence`. A group like "[A, X]" becomes
 * "[A]" when X is unknown, and disappears when none of its ids is known.
 */
export function checkCitations(text: string, evidence: ReadonlySet<string>): CheckedAnswer {
  const valid: string[] = [];
  const dropped: string[] = [];
  const cleaned = text.replace(CITATION, (_whole, inner: string) => {
    const ids = splitIds(inner);
    const keep = ids.filter((id) => evidence.has(id));
    for (const id of ids) {
      const list = evidence.has(id) ? valid : dropped;
      if (!list.includes(id)) list.push(id);
    }
    return keep.length > 0 ? `[${keep.join(', ')}]` : '';
  });
  return { text: tidy(cleaned), valid, dropped };
}

function splitIds(inner: string): string[] {
  return inner
    .split(/[,;]/)
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

/**
 * Removes what a dropped citation leaves behind: spaces before punctuation ("word ." ->
 * "word.") and a doubled full stop ("leaves [X]." -> "leaves.."-> "leaves."); a real
 * ellipsis ("...") stays.
 */
export function tidy(text: string): string {
  return text
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/(?<!\.)([.!?])\.(?!\.)/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
