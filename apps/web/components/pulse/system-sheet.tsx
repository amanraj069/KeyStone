"use client";

import { useMemo, useState } from "react";
import type { BusFactorRow } from "@keystone/shared";
import { ArtifactSheet } from "@/components/artifact-sheet";
import { EvidenceChip } from "@/components/evidence-chip";
import { GraphCanvas } from "@/components/graph-canvas";
import { Meter } from "@/components/ui/meter";
import { SHEET_PANEL_WIDTH, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { useApi } from "@/hooks/use-api";
import { api, type ViewGraph } from "@/lib/api";
import { systemKey, toCanvasGraph } from "@/lib/graph";
import { cn } from "@/lib/utils";
import { RISK_COPY } from "./risk";

interface SystemSheetProps {
  row: BusFactorRow | null;
  graph: ViewGraph;
  revision: number;
  onClose: () => void;
}

/** A system's experts and the evidence path of the strongest one, in a side sheet. */
export function SystemSheet({ row, graph, revision, onClose }: SystemSheetProps) {
  const system = row?.system ?? null;
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  const experts = useApi(system ? (signal) => api.experts(system, graph, signal) : null, [system, graph, revision]);
  const shown = experts.data?.system === system ? experts.data : null;
  const canvas = useMemo(() => toCanvasGraph([shown?.evidencePath]), [shown]);
  const red = useMemo(() => (row && (row.riskLevel === "orphaned" || row.riskLevel === "critical") ? [systemKey(row.system)] : []), [row]);
  const top = shown?.experts.slice(0, 6) ?? [];
  const maxScore = top[0]?.score || 1;

  return (
    <>
      <Sheet open={row !== null} onOpenChange={(open) => !open && onClose()}>
        <SheetContent side="right" className={cn(SHEET_PANEL_WIDTH, "gap-0 overflow-y-auto")}>
          {row && (
            <>
              <SheetHeader className="gap-1 border-b px-8 pt-7 pb-5">
                <p className="text-xs font-semibold text-muted-foreground">{RISK_COPY[row.riskLevel].title}</p>
                <SheetTitle className="text-2xl font-semibold tracking-tight">{row.system}</SheetTitle>
                <SheetDescription className="font-light">
                  {row.experts === 0 ? "No active expert." : `${row.experts} active expert${row.experts === 1 ? "" : "s"}.`}
                  {shown?.evidencePath && ` The graph shows ${shown.evidencePath.person}'s most recent work on it.`}
                </SheetDescription>
              </SheetHeader>
              <div className="px-8 pt-6">
                <div className="h-80 overflow-hidden rounded-xl border bg-surface">
                  <GraphCanvas
                    className="h-full"
                    nodes={canvas.nodes}
                    edges={canvas.edges}
                    redIds={red}
                    emptyHint={experts.loading ? "Loading the evidence path…" : "No evidence path for this system."}
                  />
                </div>
              </div>
              <div className="px-8 pt-7 pb-8">
                <p className="section-label mb-4">Who knows it</p>
                {experts.error && <ErrorState message={experts.error} />}
                {experts.loading && !shown && <SkeletonRows count={3} rowClassName="h-16" />}
                {shown && top.length === 0 && <p className="text-sm text-muted-foreground">Nobody has worked on this system enough to count.</p>}
                <ol className="space-y-5">
                  {top.map((expert) => (
                    <li key={expert.person}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm font-semibold">{expert.person}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {expert.relativeScore >= 1 ? "top expert" : `${Math.round(expert.relativeScore * 100)}% of the top`} · last
                          active day {expert.lastActive}
                        </span>
                      </div>
                      <Meter className="mt-2" percent={(expert.score / maxScore) * 100} label={`${expert.person}'s score`} />
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {expert.evidence.slice(0, 5).map((id) => (
                          <EvidenceChip key={id} id={id} onOpen={setOpenArtifact} />
                        ))}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <ArtifactSheet artifactId={openArtifact} onClose={() => setOpenArtifact(null)} />
    </>
  );
}
