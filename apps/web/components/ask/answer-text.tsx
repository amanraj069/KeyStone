import { Fragment, type ReactNode } from "react";
import type { Citation } from "@keystone/shared";
import { cn } from "@/lib/utils";

/** A bracketed citation group, "[T-1]" or "[T-1, PR-2]", not a Markdown link (same rule as the API, no length cap). */
const CITATION = /\[([^[\]\n]+)\](?!\()/g;

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
  /** Title, type and day of each cited id (after "done"), shown when a marker is hovered. */
  sources: ReadonlyMap<string, Citation>;
  /** The citation that is currently highlighted in the canvas. */
  activeId: string | null;
  onCite: (id: string) => void;
}

/** One block of an answer: a paragraph, or a list whose items may hold one level of sub-items. */
type Block = { kind: "p"; text: string; heading: boolean } | { kind: "list"; ordered: boolean; items: { text: string; children: string[] }[] };

const LIST_ITEM = /^(\s*)(?:[-*•]|\d+[.)])\s+(.*)$/;
const HEADING = /^#{1,4}\s+(.*)$/;

/**
 * The answer's light Markdown, as the model writes it: blank lines between paragraphs,
 * "- " / "1. " lists (an indented item belongs to the item above), "#" headings.
 */
export function answerBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ kind: "p", text: paragraph.join("\n"), heading: false });
    paragraph = [];
  };
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const item = LIST_ITEM.exec(line);
    const heading = HEADING.exec(line.trim());
    if (line.trim() === "") {
      endParagraph();
    } else if (item) {
      endParagraph();
      const ordered = /^\s*\d/.test(line);
      const last = blocks.at(-1);
      const list = last?.kind === "list" ? last : null;
      if (item[1].length > 0 && list && list.items.length > 0) list.items.at(-1)!.children.push(item[2]);
      else if (list && list.ordered === ordered) list.items.push({ text: item[2], children: [] });
      else blocks.push({ kind: "list", ordered, items: [{ text: item[2], children: [] }] });
    } else if (heading) {
      endParagraph();
      blocks.push({ kind: "p", text: heading[1], heading: true });
    } else {
      // A line right after a list continues its last item; otherwise it is paragraph text.
      const last = blocks.at(-1);
      if (paragraph.length === 0 && last?.kind === "list" && /^\s/.test(line)) last.items.at(-1)!.text += ` ${line.trim()}`;
      else paragraph.push(line.trim());
    }
  }
  endParagraph();
  return blocks;
}

/**
 * The answer as paragraphs and lists, with **bold** kept and every [ID] group turned
 * into small numbered markers; clicking one highlights that artifact in the graph.
 */
export function AnswerText({ text, cited, numbers, sources, activeId, onCite }: AnswerTextProps) {
  const inline = (value: string) => withBold(value, (part) => withMarkers(part, cited, numbers, sources, activeId, onCite));
  return (
    <div className="space-y-3 text-[15px] leading-7 text-foreground/90">
      {answerBlocks(text).map((block, index) =>
        block.kind === "p" ? (
          <p key={index} className={cn("whitespace-pre-wrap", block.heading && "font-semibold text-foreground")}>
            {inline(block.text)}
          </p>
        ) : (
          <List key={index} ordered={block.ordered}>
            {block.items.map((item, i) => (
              <li key={i} className="pl-1">
                {inline(item.text)}
                {item.children.length > 0 && (
                  <ul className="mt-1 list-[circle] space-y-1 pl-5 marker:text-faint">
                    {item.children.map((child, j) => (
                      <li key={j} className="pl-1">
                        {inline(child)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </List>
        ),
      )}
    </div>
  );
}

function List({ ordered, children }: { ordered: boolean; children: ReactNode }) {
  const className = cn("space-y-1.5 pl-5 marker:text-faint", ordered ? "list-decimal" : "list-disc");
  return ordered ? <ol className={className}>{children}</ol> : <ul className={className}>{children}</ul>;
}

/** **bold** spans as <strong>; everything else goes through `rest` (the citation markers). */
function withBold(text: string, rest: (part: string) => ReactNode[]): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} className="font-semibold text-foreground">
        {rest(part.slice(2, -2))}
      </strong>
    ) : (
      <Fragment key={i}>{rest(part)}</Fragment>
    ),
  );
}

function withMarkers(
  paragraph: string,
  cited: ReadonlySet<string> | null,
  numbers: ReadonlyMap<string, number>,
  sources: ReadonlyMap<string, Citation>,
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
          <Marker key={id} id={id} number={numbers.get(id)} source={sources.get(id)} active={id === activeId} onCite={onCite} />
        ))}
      </span>,
    );
    last = start + match[0].length;
  }
  pieces.push(paragraph.slice(last));
  return pieces.map((piece, i) => <Fragment key={i}>{piece}</Fragment>);
}

/** "Design: Request TitanDB fix update · confluence · day 23", or the id until the titles arrive. */
function describe(id: string, source: Citation | undefined): string {
  if (!source?.title) return id;
  return [source.title, source.type, source.day !== null ? `day ${source.day}` : null].filter(Boolean).join(" · ");
}

interface MarkerProps {
  id: string;
  number: number | undefined;
  source: Citation | undefined;
  active: boolean;
  onCite: (id: string) => void;
}

function Marker({ id, number, source, active, onCite }: MarkerProps) {
  const label = describe(id, source);
  return (
    <button
      type="button"
      title={`${label}\nClick to show it`}
      aria-label={`Source ${number ?? id}: ${label}`}
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
