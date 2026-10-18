"use client";

import { useState } from "react";
import type { Bridge } from "@keystone/shared";
import { Meter } from "@/components/ui/meter";
import { OptionPills } from "@/components/ui/option-pills";
import { Panel, PanelHeading } from "@/components/ui/panel";
import { ErrorState, SkeletonRows } from "@/components/ui/states";

interface BridgesPanelProps {
  bridges: Bridge[] | null;
  /** PageRank on the same network (K8c): null while loading or if it failed. */
  central?: Bridge[] | null;
  error: string | null;
  onOpenArtifact: (id: string) => void;
}

const VIEWS = [
  { value: "bridges", label: "Connect teams" },
  { value: "central", label: "Centre of the network" },
] as const;

/**
 * Two readings of who works with whom: the people who connect teams (betweenness,
 * K8b) and the people at the centre of the network (PageRank, K8c), strongest first.
 */
export function BridgesPanel({ bridges: bridgeRows, central, error, onOpenArtifact }: BridgesPanelProps) {
  const [view, setView] = useState<(typeof VIEWS)[number]["value"]>("bridges");
  const showCentral = view === "central" && central;
  const bridges = showCentral ? central : bridgeRows;
  const max = bridges?.[0]?.score || 1;
  return (
    <Panel className="p-5 sm:p-8">
      <PanelHeading
        title={showCentral ? "Central people" : "Bridge people"}
        description={
          showCentral
            ? "PageRank on who works with whom: people whose colleagues are themselves well connected. Losing one slows everyone around them."
            : "The people most often on the shortest path between colleagues who work together. If they leave, teams stop talking to each other."
        }
        action={central ? <OptionPills label="Measure" options={VIEWS} value={view} onChange={setView} /> : undefined}
      />
      <div className="mt-6">
        {error && !bridges ? (
          <ErrorState message={error} />
        ) : !bridges ? (
          <SkeletonRows count={5} rowClassName="h-14" />
        ) : bridges.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nobody works across teams yet.</p>
        ) : (
          <ol className="grid grid-cols-1 gap-x-10 gap-y-1 md:grid-cols-2">
            {bridges.slice(0, 8).map((bridge, index) => (
              <li key={bridge.person} className="grid grid-cols-[1.75rem_1fr] items-center gap-x-2 border-b py-3.5 last:border-b-0 md:[&:nth-last-child(2)]:border-b-0">
                <span className="text-xs font-medium text-faint tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium">{bridge.person}</p>
                    <p className="max-w-[55%] truncate text-xs text-muted-foreground">{bridge.dept?.replace(/_/g, " ") ?? "No department"}</p>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <Meter percent={(bridge.score / max) * 100} label={`${bridge.person}'s ${showCentral ? "PageRank" : "betweenness"}`} />
                    {bridge.evidence[0] && (
                      <button type="button" className="code-id shrink-0 text-muted-foreground hover:text-foreground hover:underline" onClick={() => onOpenArtifact(bridge.evidence[0])} title={bridge.evidence[0]}>
                        source
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}
