"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArtifactSheet } from "@/components/artifact-sheet";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/shell/app-shell";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { DecisionTimeline } from "./decision-timeline";
import { StalePages } from "./stale-pages";
import { SystemPicker } from "./system-picker";

/** Decisions: what was decided about a system and what replaced what; pages that went out of date. */
export function DecisionsRoom() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const systems = useApi((signal) => api.systems(signal), []);
  const stale = useApi((signal) => api.staleDocs(signal), []);
  const system = params.get("system") ?? systems.data?.[0]?.name ?? null;
  const decisions = useApi(system ? (signal) => api.decisions(system, signal) : null, [system]);
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  const select = (name: string) => router.replace(`${pathname}?system=${encodeURIComponent(name)}`, { scroll: false });

  const info = systems.data?.find((s) => s.name === system);
  const rows = decisions.loading ? null : decisions.data;
  const staleLine =
    stale.data && stale.data.length === 0 ? " No page currently states a replaced decision." : "";

  return (
    <PageContainer>
      <PageHeader
        eyebrow={info ? (info.core ? "Core system" : "System") : undefined}
        title={system ?? "Decisions"}
        description={
          info
            ? `What was decided about it, where, and what replaced what, newest first.${staleLine}`
            : "What was decided about each system, where, and what replaced it."
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[270px_minmax(0,1fr)] lg:items-start">
        <Panel className="h-72 overflow-hidden sm:h-80 lg:sticky lg:top-20 lg:h-[calc(100dvh-6.5rem)]" aria-label="Systems">
          <SystemPicker systems={systems.data} selected={system} onSelect={select} error={systems.error} />
        </Panel>

        <div className="min-w-0 space-y-6">
          {stale.error && <ErrorState message={stale.error} onRetry={stale.reload} />}
          {stale.data && stale.data.length > 0 && <StalePages docs={stale.data} onOpenArtifact={setOpenArtifact} />}
          {decisions.error ? (
            <ErrorState message={decisions.error} onRetry={decisions.reload} />
          ) : !rows ? (
            <Panel className="p-6 sm:p-8">
              <SkeletonRows count={6} rowClassName="h-16" />
            </Panel>
          ) : rows.length === 0 ? (
            <EmptyState title="No decisions" description={`No decisions about ${system} were found in the records.`} />
          ) : (
            // No overflow-hidden here: it would stop the timeline's day labels from sticking.
            <Panel>
              <DecisionTimeline key={system} rows={rows} onOpenArtifact={setOpenArtifact} />
            </Panel>
          )}
        </div>
      </div>
      <ArtifactSheet artifactId={openArtifact} onClose={() => setOpenArtifact(null)} />
    </PageContainer>
  );
}
