"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArtifactSheet } from "@/components/artifact-sheet";
import { Composer } from "@/components/ask/composer";
import { Suggestions } from "@/components/ask/suggestions";
import { TurnView } from "@/components/ask/turn-view";
import { GraphCanvas } from "@/components/graph-canvas";
import { PageHeader } from "@/components/page-header";
import { RoomContainer } from "@/components/shell/app-shell";
import { Panel } from "@/components/ui/panel";
import { useAsk } from "@/hooks/use-ask";
import { artifactKey, EMPTY_GRAPH, orphanedKeys, toCanvasGraph } from "@/lib/graph";

/**
 * Ask: the conversation on the left, the graph the agent walked on the right.
 * Tool results draw as they stream; when the answer is done its whole path is
 * highlighted, and a citation chip singles out that artifact.
 */
export default function AskPage() {
  const { turns, ask, stop, busy } = useAsk();
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [citation, setCitation] = useState<string | null>(null);
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // A new question becomes the one the canvas shows.
  const latestId = turns.at(-1)?.id ?? null;
  useEffect(() => {
    setActiveTurnId(latestId);
    setCitation(null);
  }, [latestId]);

  // Keep the newest text in view while it streams.
  const latest = turns.at(-1);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [latest?.answer, latest?.steps.length]);

  const turn = turns.find((t) => t.id === activeTurnId) ?? null;
  const paths = turn?.paths;
  const finalPath = turn?.finalPath;
  // Built from the per-tool paths only, so nodes keep their places when "done" arrives.
  const canvas = useMemo(() => (paths ? toCanvasGraph(paths) : EMPTY_GRAPH), [paths]);
  const finalKeys = useMemo(() => (finalPath ? toCanvasGraph([finalPath]).nodes.map((n) => n.key) : []), [finalPath]);
  const red = useMemo(() => (paths ? orphanedKeys(paths) : []), [paths]);

  const { highlighted, faded } = useMemo(() => {
    if (citation) {
      const key = artifactKey(citation);
      return { highlighted: [key], faded: canvas.nodes.filter((n) => n.key !== key).map((n) => n.key) };
    }
    return { highlighted: finalKeys, faded: [] as string[] };
  }, [citation, canvas.nodes, finalKeys]);

  const onCite = (turnId: string, id: string) => {
    const target = turns.find((t) => t.id === turnId);
    const inGraph = target ? toCanvasGraph(target.paths).nodes.some((n) => n.artifactId === id) : false;
    setActiveTurnId(turnId);
    if (!inGraph) {
      // Not on any tool's graph (e.g. found by search): open it instead.
      setCitation(null);
      setOpenArtifact(id);
      return;
    }
    setCitation((current) => (current === id && turnId === activeTurnId ? null : id));
  };

  return (
    <RoomContainer>
      <PageHeader title="Ask" description="Questions answered from the company graph. Every claim cites the document it came from." />
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        <Panel className="flex min-h-[75dvh] flex-col overflow-hidden lg:min-h-0" aria-label="Conversation">
          <div ref={scroller} className="flex flex-1 flex-col overflow-y-auto px-4 sm:px-6">
            {turns.length === 0 ? (
              <Suggestions onPick={ask} disabled={busy} />
            ) : (
              <div className="mx-auto w-full max-w-2xl space-y-8 py-6">
                {turns.map((t) => (
                  <TurnView
                    key={t.id}
                    turn={t}
                    active={t.id === activeTurnId}
                    activeCitation={citation}
                    onCite={onCite}
                    onSelect={(id) => {
                      setActiveTurnId(id);
                      setCitation(null);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="border-t bg-surface/60 p-3 sm:p-4">
            <div className="mx-auto w-full max-w-2xl">
              <Composer busy={busy} onAsk={ask} onStop={stop} />
            </div>
          </div>
        </Panel>

        <Panel className="flex min-h-[60dvh] flex-col overflow-hidden lg:min-h-0" aria-label="Graph">
          <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-bold tracking-tight">The agent&apos;s path</h2>
              <p className="mt-0.5 truncate text-xs font-light text-muted-foreground">
                {citation ? (
                  <>
                    Showing <span className="code-id">{citation}</span>
                  </>
                ) : turn?.status === "streaming" ? (
                  "Drawing as the tools answer…"
                ) : turn ? (
                  <>
                    {/* With several questions asked, say which one the graph is for. */}
                    {turns.length > 1 && <span className="font-semibold text-foreground">“{turn.question}” · </span>}
                    {canvas.nodes.length} nodes from {turn.steps.length} tool call{turn.steps.length === 1 ? "" : "s"}
                  </>
                ) : (
                  "Every node the agent touches appears here."
                )}
              </p>
            </div>
            {citation && (
              <button type="button" className="shrink-0 text-xs font-semibold text-muted-foreground hover:text-foreground" onClick={() => setCitation(null)}>
                Show the whole path
              </button>
            )}
          </div>
          <GraphCanvas
            className="flex-1"
            nodes={canvas.nodes}
            edges={canvas.edges}
            highlightedIds={highlighted}
            fadedIds={faded}
            redIds={red}
            emptyHint={turn ? "These tools returned no graph to draw. The sources are in the answer." : "Ask a question to see the graph it walks."}
          />
        </Panel>
      </div>
      <ArtifactSheet artifactId={openArtifact} onClose={() => setOpenArtifact(null)} />
    </RoomContainer>
  );
}
