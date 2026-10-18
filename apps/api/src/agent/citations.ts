/**
 * A bracketed citation group, e.g. "[CONF-ENG-443]" or "[T-1, PR-2]"; not a Markdown link "[text](url)".
 * No length cap: a model that lists 25 ids in one bracket must still go through the guardrail.
 */
const CITATION = /\[([^[\]\n]+)\](?!\()/g;

/** At most this many citation markers in one place of the answer; the rest stay in its sources. */
export const MAX_MARKERS_PER_PLACE = 3;

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

/**
 * The checked answer as a reader sees it, line by line: neighbouring groups ("[A] [B]")
 * become one; a group that only repeats ids just shown ("... [A, B]. [A, B]") goes; a
 * group shows at most MAX_MARKERS_PER_PLACE ids; and a line that only lists sources
 * ("Evidence: [A, B, ...]") goes, because the app lists them under the answer. Ids are
 * only ever removed, never added, so every marker left is still a checked citation.
 */
export function compactCitations(text: string): string {
  const lines = text.split('\n').flatMap((line) => {
    const compacted = compactLine(line);
    return compacted === null ? [] : [compacted];
  });
  return tidy(lines.join('\n'));
}

/** One line of compactCitations, or null when the line is only a list of sources. */
function compactLine(line: string): string | null {
  const matches = [...line.matchAll(CITATION)];
  if (matches.length === 0) return line;
  // "The sources are: [A, B, C]" is a lead-in to ids and nothing else.
  if (/:\s*[.]?$/.test(line.replace(CITATION, '').trim())) return null;

  let out = '';
  let last = 0;
  // The group being built, the text before it, and every id cited earlier on this line.
  let group: string[] | null = null;
  let gap = '';
  const earlier: string[] = [];
  const flush = () => {
    if (group === null) return;
    // Only punctuation since the last marker, and nothing new: a repeat of what was just cited.
    const repeat = earlier.length > 0 && /^[\s.,;:!?]*$/.test(gap) && group.every((id) => earlier.includes(id));
    out += gap + (repeat ? '' : `[${group.slice(0, MAX_MARKERS_PER_PLACE).join(', ')}]`);
    earlier.push(...group);
  };
  for (const match of matches) {
    const start = match.index ?? 0;
    const between = line.slice(last, start);
    const ids = splitIds(match[1]);
    if (group !== null && between.trim() === '') {
      for (const id of ids) if (!group.includes(id)) group.push(id);
    } else {
      flush();
      group = [...new Set(ids)];
      gap = between;
    }
    last = start + match[0].length;
  }
  flush();
  return out + line.slice(last);
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
