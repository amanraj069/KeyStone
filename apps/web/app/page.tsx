"use client";

import { useState } from "react";
import type { BusFactorRow } from "@keystone/shared";
import { ArtifactSheet } from "@/components/artifact-sheet";
import { PageHeader } from "@/components/page-header";
import { BridgesPanel } from "@/components/pulse/bridge-list";
import { LiveUpdate } from "@/components/pulse/live-update";
import { ReplayControl } from "@/components/pulse/replay-control";
import { RiskOverview } from "@/components/pulse/risk-overview";
import { SystemSheet } from "@/components/pulse/system-sheet";
import { SystemsPanel } from "@/components/pulse/systems-panel";
import { PageContainer } from "@/components/shell/app-shell";
import { OptionPills } from "@/components/ui/option-pills";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useLiveGraph } from "@/contexts/live-graph";
import { useApi } from "@/hooks/use-api";
import { api, type ViewGraph } from "@/lib/api";

const VIEWS = [
  { value: "apex", label: "Full company" },
  { value: "apex_replay", label: "Replay" },
] as const satisfies readonly { value: ViewGraph; label: string }[];

/** Org Pulse: where knowledge is thin, who holds teams together, and (in the replay view) the replay. */
export default function OrgPulsePage() {
  const { graph, setGraph, summary, summaryError, revision, replay } = useLiveGraph();
  const busFactor = useApi((signal) => api.busFactor(graph, signal), [graph, revision]);
  const bridges = useApi((signal) => api.bridges(graph, signal), [graph, revision]);
  const central = useApi((signal) => api.centralPeople(graph, signal), [graph, revision]);
  const [open, setOpen] = useState<BusFactorRow | null>(null);
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);

  const replayView = graph === "apex_replay";
  // The replay graph does not exist until a replay has run at least one day.
  const replayNotReady = replayView && !summary && (summaryError || busFactor.error) && !replay?.running;

  return (
    <PageContainer>
      <PageHeader
        title="Org Pulse"
        description="Where Apex's knowledge is thin. A system is at risk when too few active people know it, judged from who wrote, reviewed and worked on what."
        action={<OptionPills label="Graph" options={VIEWS} value={graph} onChange={setGraph} size="md" />}
      />

      {replayView && <ReplayControl />}

      {replayNotReady ? (
        <EmptyState title="No replay yet" description="Start a replay above. The overview and the systems fill in as each day lands." />
      ) : summaryError && !summary ? (
        <ErrorState message={summaryError} />
      ) : (
        <>
          <RiskOverview summary={summary} />
          {/* Live updates change the full company graph, not the replay. */}
          {!replayView && <LiveUpdate />}
          {busFactor.error && !busFactor.data ? <ErrorState message={busFactor.error} onRetry={busFactor.reload} /> : <SystemsPanel rows={busFactor.data} onOpen={setOpen} />}
          <BridgesPanel bridges={bridges.data} central={central.data} error={bridges.error} onOpenArtifact={setOpenArtifact} />
        </>
      )}

      <SystemSheet row={open} graph={graph} revision={revision} onClose={() => setOpen(null)} />
      <ArtifactSheet artifactId={openArtifact} onClose={() => setOpenArtifact(null)} />
    </PageContainer>
  );
}
