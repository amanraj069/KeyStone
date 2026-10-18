"use client";

import { useMemo, useState } from "react";
import { Maximize2, Waypoints } from "lucide-react";
import { GraphCanvas } from "@/components/graph-canvas";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AgentTurn } from "@/hooks/use-ask";
import { artifactKey, discoveryOrder, orphanedKeys, toCanvasGraph } from "@/lib/graph";

interface TurnGraphProps {
  turn: AgentTurn;
  /** Only the selected answer draws its graph; the others offer to show theirs. */
  active: boolean;
  /** The cited artifact singled out in the graph, if any. */
  citation: string | null;
  onSelect: () => void;
  onClearCitation: () => void;
}

const NONE: string[] = [];

/**
 * The graph an answer walked, inside the answer itself. It draws as the tools return;
 * once the answer is done its whole path is highlighted, and a citation singles out
 * that artifact. "Expand" opens the same graph full size, where it can be zoomed.
 */
export function TurnGraph({ turn, active, citation, onSelect, onClearCitation }: TurnGraphProps) {
  const [expanded, setExpanded] = useState(false);
  // Built from the per-tool paths only, so nodes keep their places when "done" arrives.
  const canvas = useMemo(() => toCanvasGraph(turn.paths), [turn.paths]);
  const finalKeys = useMemo(() => (turn.finalPath ? toCanvasGraph([turn.finalPath]).nodes.map((n) => n.key) : NONE), [turn.finalPath]);
  const red = useMemo(() => orphanedKeys(turn.paths), [turn.paths]);
  // What the agent found first is whitish orange, what it found last is orange.
  const order = useMemo(() => discoveryOrder(turn.paths, turn.pathRoots), [turn.paths, turn.pathRoots]);

  const { highlighted, faded } = useMemo(() => {
    if (citation) {
      const key = artifactKey(citation);
      return { highlighted: [key], faded: canvas.nodes.filter((n) => n.key !== key).map((n) => n.key) };
    }
    return { highlighted: finalKeys, faded: NONE };
  }, [citation, canvas.nodes, finalKeys]);

  if (canvas.nodes.length === 0) return null;

  const tools = `${turn.steps.length} tool call${turn.steps.length === 1 ? "" : "s"}`;
  const summary = `${canvas.nodes.length} nodes from ${tools}`;

  if (!active) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        className="flex w-full items-center gap-2 rounded-xl border border-dashed px-3.5 py-2.5 text-left text-xs font-semibold text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
      >
        <Waypoints className="size-3.5 shrink-0" />
        Show the agent&apos;s path
        <span className="truncate font-normal text-faint">· {summary}</span>
      </button>
    );
  }

  const caption = citation ? (
    <>
      Showing <span className="code-id">{citation}</span>
    </>
  ) : turn.status === "streaming" ? (
    "Drawing as the tools answer…"
  ) : (
    summary
  );

  const graph = (interactive: boolean, className: string) => (
    <GraphCanvas
      className={className}
      nodes={canvas.nodes}
      edges={canvas.edges}
      highlightedIds={highlighted}
      fadedIds={faded}
      redIds={red}
      pathOrder={order}
      interactive={interactive}
    />
  );

  return (
    // Clicks inside the graph belong to the graph, not to the answer around it.
    <div onClick={(event) => event.stopPropagation()} className="overflow-hidden rounded-xl border bg-surface/60">
      <div className="flex items-center gap-2 border-b px-3 py-2 sm:px-3.5">
        <Waypoints className="size-3.5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">The agent&apos;s path</span> · {caption}
        </p>
        {!citation && <PathLegend />}
        {citation && (
          <button type="button" onClick={onClearCitation} className="shrink-0 text-xs font-semibold text-muted-foreground hover:text-foreground">
            Whole path
          </button>
        )}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          aria-label="Expand the graph"
          className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
        >
          <Maximize2 className="size-3.5" />
          <span className="hidden sm:inline">Expand</span>
        </button>
      </div>
      {graph(false, "h-64 sm:h-72")}

      <Sheet open={expanded} onOpenChange={setExpanded}>
        <SheetContent side="right" className="w-full gap-0 sm:max-w-none lg:w-[min(72rem,80vw)]">
          <SheetHeader className="gap-2 border-b px-4 pt-5 pb-4 pr-12 sm:px-6 sm:pt-6 sm:pr-14">
            <SheetTitle className="text-lg leading-snug font-semibold tracking-tight">The agent&apos;s path</SheetTitle>
            <SheetDescription className="min-w-0 truncate text-sm">
              &ldquo;{turn.question}&rdquo;
            </SheetDescription>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  <span className="font-semibold text-foreground">{canvas.nodes.length}</span> node{canvas.nodes.length === 1 ? "" : "s"}
                </span>
                <span>
                  <span className="font-semibold text-foreground">{canvas.edges.length}</span> edge{canvas.edges.length === 1 ? "" : "s"}
                </span>
                <span>
                  <span className="font-semibold text-foreground">{turn.steps.length}</span> tool call{turn.steps.length === 1 ? "" : "s"}
                </span>
                {citation && (
                  <span>
                    Showing <span className="code-id">{citation}</span>
                  </span>
                )}
              </div>
              {!citation && <PathLegend />}
            </div>
          </SheetHeader>
          {graph(true, "flex-1")}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** How to read the path's colours: from what the agent found first (whitish orange) to last (orange). */
function PathLegend() {
  return (
    <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground sm:flex" title="The order in which the agent found each node">
      first
      <span
        aria-hidden
        className="h-2.5 w-28 rounded-full"
        style={{ background: "linear-gradient(to right, color-mix(in oklch, var(--signal) 45%, transparent), color-mix(in oklch, var(--signal) 85%, black))" }}
      />
      last
    </span>
  );
}
