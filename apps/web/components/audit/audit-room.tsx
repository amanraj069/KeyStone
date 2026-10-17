"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ActionRow } from "@keystone/shared";
import { ArtifactSheet } from "@/components/artifact-sheet";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { ActionTable } from "./action-table";
import { AuditFilters, type KindFilter, type StatusFilter } from "./audit-filters";

/** Audit: every proposal, filterable; a row opens its evidence and draws its trail. */
export function AuditRoom() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, ActionRow>>({});
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  const list = useApi((signal) => api.actions(status === "all" ? null : status, signal), [status]);

  // Decisions made on this page replace the rows they changed, without a refetch.
  const all = useMemo(() => (list.data ?? []).map((row) => decided[row.id] ?? row), [list.data, decided]);
  const rows = useMemo(() => all.filter((row) => (kind === "all" || row.kind === kind) && (status === "all" || row.status === status)), [all, kind, status]);
  const open = all.filter((r) => r.status === "proposed").length;

  return (
    <PageContainer>
      <PageHeader
        className="animate-fade-up"
        title="Proposals and decisions"
        description={
          list.data
            ? `${all.length} proposal${all.length === 1 ? "" : "s"}${status === "all" ? "" : ` ${status}`}, ${open} waiting for a person. Keystone only proposes; nothing changes until someone approves.`
            : "Keystone only proposes; nothing changes until someone approves."
        }
      />
      <AuditFilters status={status} kind={kind} onStatus={setStatus} onKind={setKind} />

      {list.error ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Panel className="p-5">
          <SkeletonRows count={8} />
        </Panel>
      ) : rows.length === 0 ? (
        all.length === 0 && status === "all" ? (
          <EmptyState
            title="No proposals yet"
            description="Draft a handover plan on What-if, or ask the agent to propose a reassignment. Every proposal lands here for a person to approve."
            action={
              <Button asChild>
                <Link href="/whatif">Open What-if</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState description="No actions match these filters." />
        )
      ) : (
        <Panel className="overflow-hidden">
          <ActionTable
            actions={rows}
            expanded={expanded}
            onToggle={(id) => setExpanded((current) => (current === id ? null : id))}
            onDecided={(action) => setDecided((d) => ({ ...d, [action.id]: action }))}
            onOpenArtifact={setOpenArtifact}
          />
        </Panel>
      )}
      <ArtifactSheet artifactId={openArtifact} onClose={() => setOpenArtifact(null)} />
    </PageContainer>
  );
}
