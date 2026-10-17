import { Fragment } from "react";
import { EvidenceChip } from "@/components/evidence-chip";

/** A bracketed citation group, "[T-1]" or "[T-1, PR-2]", not a Markdown link (same rule as the API). */
const CITATION = /\[([^[\]\n]{1,300})\](?!\()/g;

/** What an artifact id looks like: no spaces or quotes (so a bracketed JSON fragment is not a citation). */
const ID_SHAPE = /^[A-Za-z0-9][\w.:#-]*$/;

interface AnswerTextProps {
  text: string;
  /** Ids the API confirmed as cited (after "done"); until then any id-shaped token counts. */
  cited: ReadonlySet<string> | null;
  /** The citation chip that is currently highlighted in the canvas. */
  activeId: string | null;
  onCite: (id: string) => void;
}

/** The answer with every [ID] turned into a chip that highlights the artifact in the canvas. */
export function AnswerText({ text, cited, activeId, onCite }: AnswerTextProps) {
  const pieces: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(CITATION)) {
    const start = match.index ?? 0;
    pieces.push(text.slice(last, start));
    const ids = match[1].split(/[,;]/).map((id) => id.trim()).filter(Boolean);
    const isCitation = (id: string) => (cited ? cited.has(id) : ID_SHAPE.test(id));
    if (!ids.every(isCitation)) {
      // Not a citation group: keep the text as written.
      pieces.push(match[0]);
      last = start + match[0].length;
      continue;
    }
    pieces.push(
      <span key={start} className="inline-flex flex-wrap gap-1 align-baseline">
        {ids.map((id) => (
          <EvidenceChip key={id} id={id} active={id === activeId} onOpen={onCite} title={`Show ${id} in the graph`} />
        ))}
      </span>,
    );
    last = start + match[0].length;
  }
  pieces.push(text.slice(last));
  return (
    <p className="text-sm leading-relaxed whitespace-pre-wrap sm:text-[15px]">
      {pieces.map((piece, i) => (
        <Fragment key={i}>{piece}</Fragment>
      ))}
    </p>
  );
}
