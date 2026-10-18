"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ArtifactSheet } from "@/components/artifact-sheet";
import { GraphLegend } from "@/components/graph/graph-legend";
import type { CanvasEdge, CanvasNode } from "@/lib/graph";
import { cn } from "@/lib/utils";

// react-force-graph-2d touches window and canvas, so it only loads in the browser.
const GraphCanvasView = dynamic(() => import("@/components/graph/graph-canvas-view"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 animate-pulse bg-muted/40" />,
});

export interface GraphCanvasProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  /** Node keys or artifact ids drawn with the signal ring (the agent's path, a selection). */
  highlightedIds?: readonly string[];
  /** Node keys or artifact ids pushed into the background. */
  fadedIds?: readonly string[];
  /** Node keys or artifact ids filled with the signal colour (risk). */
  redIds?: readonly string[];
  /** Node keys or artifact ids with a pulsing signal ring (newly at risk). */
  pulseIds?: readonly string[];
  /** How long highlight changes animate (default 300 ms). */
  animationMs?: number;
  /** Shown when there are no nodes. */
  emptyHint?: string;
  className?: string;
}

const NONE: readonly string[] = [];

/**
 * The force-directed graph used on every page. Nodes are coloured by label; people
 * and systems are always named, artifacts on hover. Highlight changes animate over
 * 300 ms. Clicking an artifact opens it in a side sheet.
 */
export function GraphCanvas({
  nodes,
  edges,
  highlightedIds = NONE,
  fadedIds = NONE,
  redIds = NONE,
  pulseIds = NONE,
  animationMs = 300,
  emptyHint,
  className,
}: GraphCanvasProps) {
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  // Sets keep their identity while the arrays do, so the view animates only on real changes.
  const highlighted = useMemo(() => new Set(highlightedIds), [highlightedIds]);
  const faded = useMemo(() => new Set(fadedIds), [fadedIds]);
  const red = useMemo(() => new Set(redIds), [redIds]);
  const pulse = useMemo(() => new Set(pulseIds), [pulseIds]);

  return (
    <div className={cn("relative flex min-h-0 flex-col", className)}>
      <div className="relative min-h-0 flex-1">
        {nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center px-8 text-center text-sm text-muted-foreground">
            {emptyHint ?? "Nothing to draw yet."}
          </div>
        ) : (
          <div className="absolute inset-0">
            <GraphCanvasView
            nodes={nodes}
            edges={edges}
            highlightedIds={highlighted}
            fadedIds={faded}
            redIds={red}
            pulseIds={pulse}
            animationMs={animationMs}
            onArtifactClick={setOpenArtifact}
            />
          </div>
        )}
      </div>
      {nodes.length > 0 && (
        <div className="pointer-events-none absolute inset-x-4 bottom-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <GraphLegend nodes={nodes} />
          <span className="truncate text-[0.7rem] text-faint">{nodes.length} nodes · hover an artifact for its title, click to open it</span>
        </div>
      )}
      <ArtifactSheet artifactId={openArtifact} onClose={() => setOpenArtifact(null)} />
    </div>
  );
}
