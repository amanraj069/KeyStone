"use client";

import { Fragment, useMemo } from "react";
import type { ActionRow } from "@keystone/shared";
import { ChevronRight } from "lucide-react";
import { ActionDecision } from "@/components/actions/action-decision";
import { KIND_LABEL } from "@/components/actions/action-copy";
import { ActionLine } from "@/components/actions/action-line";
import { EvidenceChip } from "@/components/evidence-chip";
import { GraphCanvas } from "@/components/graph-canvas";
import { ErrorState } from "@/components/ui/states";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { toCanvasGraph } from "@/lib/graph";
import { cn } from "@/lib/utils";

interface ActionTableProps {
  actions: ActionRow[];
  expanded: string | null;
  onToggle: (id: string) => void;
  onDecided: (action: ActionRow) => void;
  onOpenArtifact: (id: string) => void;
}

/** Actions newest first; a row expands to its reason, evidence, decision and evidence graph. */
export function ActionTable({ actions, expanded, onToggle, onDecided, onOpenArtifact }: ActionTableProps) {
  return (
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col className="w-10" />
        <col className="w-36" />
        <col />
        <col className="w-28" />
        <col className="w-20" />
      </colgroup>
      <thead>
        <tr className="border-b text-left text-xs text-muted-foreground">
          <th className="py-3" />
          <th className="py-3 font-semibold">Action</th>
          <th className="py-3 font-semibold">What and who</th>
          <th className="py-3 font-semibold">Status</th>
          <th className="py-3 pr-5 text-right font-semibold">Sources</th>
        </tr>
      </thead>
      <tbody>
        {actions.map((action) => {
          const open = expanded === action.id;
          return (
            <Fragment key={action.id}>
              <tr className={cn("cursor-pointer border-b transition-colors hover:bg-foreground/[0.03]", open && "bg-surface")} onClick={() => onToggle(action.id)} aria-expanded={open}>
                <td className="py-3.5 pl-4">
                  <ChevronRight className={cn("size-4 text-muted-foreground transition-transform duration-200", open && "rotate-90")} />
                </td>
                <td className="py-3.5 pr-3 text-xs font-semibold text-muted-foreground">{KIND_LABEL[action.kind]}</td>
                <td className="py-3.5 pr-3">
                  <ActionLine action={action} />
                </td>
                <td className="py-3.5">
                  <StatusPill action={action} />
                </td>
                <td className="py-3.5 pr-5 text-right text-xs text-muted-foreground tabular-nums">{action.evidence.length}</td>
              </tr>
              {open && (
                <tr className="border-b bg-surface">
                  <td colSpan={5} className="px-5 pt-1 pb-5">
                    <ExpandedAction action={action} onDecided={onDecided} onOpenArtifact={onOpenArtifact} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function StatusPill({ action }: { action: ActionRow }) {
  const style =
    action.status === "approved" ? "bg-primary/10 text-primary dark:bg-primary/40 dark:text-foreground" : action.status === "rejected" ? "bg-foreground/[0.06] text-muted-foreground" : "bg-foreground/[0.06] text-foreground";
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize", style)}>{action.status}</span>;
}

/** The open row: why, based on what, the decision, and the trail drawn as a graph. */
function ExpandedAction({ action, onDecided, onOpenArtifact }: { action: ActionRow; onDecided: (a: ActionRow) => void; onOpenArtifact: (id: string) => void }) {
  const graph = useApi((signal) => api.actionGraph(action.id, signal), [action.id]);
  const canvas = useMemo(() => toCanvasGraph([graph.data]), [graph.data]);
  // The trail is the agent's reasoning: ring the evidence it used.
  const highlighted = useMemo(() => action.evidence.map((e) => e.id), [action.evidence]);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-4 pt-2">
        <div className="space-y-1.5">
          <p className="text-sm leading-relaxed">{action.reason}</p>
          {action.summary && <p className="text-sm leading-relaxed font-light text-muted-foreground">{action.summary}</p>}
          <p className="text-xs font-light text-faint">
            <span className="code-id">{action.id}</span> · day {action.day} · proposed by {action.createdBy}
            {action.planId && (
              <>
                {" "}
                · part of <span className="code-id">{action.planId}</span>
              </>
            )}
          </p>
        </div>
        <div>
          <p className="section-label mb-2">Based on</p>
          {action.evidence.length === 0 ? (
            <p className="text-xs font-light text-muted-foreground">No artifacts recorded for this action.</p>
          ) : (
            <ul className="space-y-1.5">
              {action.evidence.slice(0, 6).map((e) => (
                <li key={e.id} className="flex items-baseline gap-2 text-xs">
                  <EvidenceChip id={e.id} onOpen={onOpenArtifact} />
                  <span className="min-w-0 truncate font-light text-muted-foreground">{e.title && e.title !== e.id ? e.title : (e.type ?? "")}</span>
                </li>
              ))}
              {action.evidence.length > 6 && <li className="text-xs text-faint">+{action.evidence.length - 6} more</li>}
            </ul>
          )}
        </div>
        <div onClick={(e) => e.stopPropagation()} className="flex justify-start">
          <ActionDecision action={action} onDecided={onDecided} />
        </div>
      </div>
      <div className="h-72 overflow-hidden rounded-2xl border bg-card">
        {graph.error ? (
          <ErrorState className="m-3" message={graph.error} onRetry={graph.reload} />
        ) : (
          <GraphCanvas className="h-full" nodes={canvas.nodes} edges={canvas.edges} highlightedIds={highlighted} emptyHint={graph.loading ? "Drawing the trail…" : "Nothing to draw."} />
        )}
      </div>
    </div>
  );
}
