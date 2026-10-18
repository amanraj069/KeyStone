"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ActionRow } from "@keystone/shared";
import { ArtifactSheet } from "@/components/artifact-sheet";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Panel } from "@/components/ui/panel";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { ActionTable } from "./action-table";
import { AuditFilters, type KindFilter, type StatusFilter } from "./audit-filters";
import { NotesPanel } from "./notes-panel";

const PAGE_SIZE = 20;

/** Audit: every proposal, filterable and paginated; a row opens its evidence and draws its trail. */
export function AuditRoom() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, ActionRow>>({});
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);
  const list = useApi((signal) => api.actions(status === "all" ? null : status, signal), [status]);

  // Decisions made on this page replace the rows they changed, without a refetch.
  const all = useMemo(() => (list.data ?? []).map((row) => decided[row.id] ?? row), [list.data, decided]);
  const rows = useMemo(() => all.filter((row) => (kind === "all" || row.kind === kind) && (status === "all" || row.status === status)), [all, kind, status]);
  const open = all.filter((r) => r.status === "proposed").length;

  // A filter change can shrink the list enough to leave `page` past the end; clamp rather than reset to 1,
  // which would jar the person back to the top every time they approve the last action on a page.
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const paged = useMemo(() => rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE), [rows, current]);

  const changeStatus = (next: StatusFilter) => {
    setStatus(next);
    setPage(1);
  };
  const changeKind = (next: KindFilter) => {
    setKind(next);
    setPage(1);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Proposals and decisions"
        description={
          list.data
            ? `${all.length} proposal${all.length === 1 ? "" : "s"}${status === "all" ? "" : ` ${status}`}, ${open} waiting for a person. Keystone only proposes; nothing changes until someone approves.`
            : "Keystone only proposes; nothing changes until someone approves."
        }
      />
      <NotesPanel onOpenArtifact={setOpenArtifact} />
      <AuditFilters status={status} kind={kind} onStatus={changeStatus} onKind={changeKind} />

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
            actions={paged}
            expanded={expanded}
            onToggle={(id) => setExpanded((current) => (current === id ? null : id))}
            onDecided={(action) => setDecided((d) => ({ ...d, [action.id]: action }))}
            onOpenArtifact={setOpenArtifact}
          />
          {pageCount > 1 && (
            <div className="flex flex-col items-center justify-between gap-3 border-t px-5 py-3 sm:flex-row">
              <p className="text-xs text-muted-foreground">
                Showing {(current - 1) * PAGE_SIZE + 1}–{Math.min(current * PAGE_SIZE, rows.length)} of {rows.length}
              </p>
              <Pagination page={current} pageCount={pageCount} onPage={setPage} />
            </div>
          )}
        </Panel>
      )}
      <ArtifactSheet artifactId={openArtifact} onClose={() => setOpenArtifact(null)} />
    </PageContainer>
  );
}
