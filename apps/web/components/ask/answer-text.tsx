import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A bracketed citation group, "[T-1]" or "[T-1, PR-2]", not a Markdown link (same rule as the API). */
const CITATION = /\[([^[\]\n]{1,300})\](?!\()/g;

/** What an artifact id looks like: no spaces or quotes (so a bracketed JSON fragment is not a citation). */
const ID_SHAPE = /^[A-Za-z0-9][\w.:#-]*$/;

/** The ids of a bracket, or null when it is not a citation group and stays as written. */
function citationIds(group: string, cited: ReadonlySet<string> | null): string[] | null {
  const ids = [...new Set(group.split(/[,;]/).map((id) => id.trim()).filter(Boolean))];
  const isCitation = (id: string) => (cited ? cited.has(id) : ID_SHAPE.test(id));
  return ids.length > 0 && ids.every(isCitation) ? ids : null;
}

/**
 * Numbers each cited id by its first appearance in the answer (1, 2, 3...), the
 * way the markers in the text and the Sources list both show them.
 */
export function citationNumbers(text: string, cited: ReadonlySet<string> | null): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const match of text.matchAll(CITATION)) {
    for (const id of citationIds(match[1], cited) ?? []) {
      if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
    }
  }
  return numbers;
}

interface AnswerTextProps {
  text: string;
  /** Ids the API confirmed as cited (after "done"); until then any id-shaped token counts. */
  cited: ReadonlySet<string> | null;
  numbers: ReadonlyMap<string, number>;
  /** The citation that is currently highlighted in the canvas. */
  activeId: string | null;
  onCite: (id: string) => void;
}

/**
 * The answer, one paragraph per blank-line block, with every [ID] group turned into
 * small numbered markers; clicking one highlights that artifact in the graph.
 */
export function AnswerText({ text, cited, numbers, activeId, onCite }: AnswerTextProps) {
  const paragraphs = text.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
  return (
    <div className="space-y-3.5 text-[15px] leading-7 text-foreground/90">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-wrap">
          {withMarkers(paragraph, cited, numbers, activeId, onCite)}
        </p>
      ))}
    </div>
  );
}

function withMarkers(
  paragraph: string,
  cited: ReadonlySet<string> | null,
  numbers: ReadonlyMap<string, number>,
  activeId: string | null,
  onCite: (id: string) => void,
): ReactNode[] {
  const pieces: ReactNode[] = [];
  let last = 0;
  for (const match of paragraph.matchAll(CITATION)) {
    const start = match.index ?? 0;
    const ids = citationIds(match[1], cited);
    if (!ids) continue;
    // The space before a marker belongs to the marker, so it hugs the word it cites.
    pieces.push(paragraph.slice(last, start).trimEnd());
    pieces.push(
      <span key={start} className="ml-1 inline-flex gap-0.5 align-[1px]">
        {ids.map((id) => (
          <Marker key={id} id={id} number={numbers.get(id)} active={id === activeId} onCite={onCite} />
        ))}
      </span>,
    );
    last = start + match[0].length;
  }
  pieces.push(paragraph.slice(last));
  return pieces.map((piece, i) => <Fragment key={i}>{piece}</Fragment>);
}

function Marker({ id, number, active, onCite }: { id: string; number: number | undefined; active: boolean; onCite: (id: string) => void }) {
  return (
    <button
      type="button"
      title={`${id} · show it in the graph`}
      aria-label={`Source ${number ?? id}: ${id}`}
      onClick={(event) => {
        event.stopPropagation();
        onCite(id);
      }}
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] px-1 text-[10.5px] leading-none font-semibold tabular-nums transition-colors duration-150",
        active ? "bg-signal text-white" : "bg-foreground/[0.08] text-muted-foreground hover:bg-foreground/15 hover:text-foreground",
      )}
    >
      {number ?? "•"}
    </button>
  );
}
