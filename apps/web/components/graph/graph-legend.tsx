"use client";

import type { CanvasNode } from "@/lib/graph";
import { LABEL_VARS } from "./palette";

/** The labels present in the graph, each with its canvas colour. */
export function GraphLegend({ nodes }: { nodes: CanvasNode[] }) {
  const labels = [...new Set(nodes.map((node) => node.label))].sort();
  if (labels.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem] text-muted-foreground">
      {labels.map((label) => (
        <li key={label} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: `var(${LABEL_VARS[label] ?? "--node-artifact"})` }} />
          {label}
        </li>
      ))}
    </ul>
  );
}
