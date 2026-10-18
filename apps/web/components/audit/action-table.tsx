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

/**
 * Actions newest first; a row expands to its reason, evidence, decision and evidence graph.
 * On phones the Action and Sources columns shrink to zero width with their text hidden; the
 * cells stay in the DOM (a display:none cell would shift the others into the wrong column),
 * and the kind is shown under the line instead.
 */
export function ActionTable({ actions, expanded, onToggle, onDecided, onOpenArtifact }: ActionTableProps) {
  return (
    <table className="w-full table-fixed text-sm">
      <colgroup>
        <col className="w-9 sm:w-10" />
        <col className="w-0 sm:w-36" />
        <col />
        <col className="w-24 sm:w-28" />
        <col className="w-0 sm:w-20" />
      </colgroup>
      <thead>
        <tr className="border-b bg-surface text-left text-xs text-muted-foreground">
          <th className="py-3" />
          <th className="py-3 font-medium">
            <span className="hidden sm:inline">Action</span>
          </th>
          <th className="py-3 font-medium">What and who</th>
          <th className="py-3 font-medium">Status</th>
          <th className="py-3 text-right font-medium sm:pr-5">
            <span className="hidden sm:inline">Sources</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {actions.map((action) => {
          const open = expanded === action.id;
          return (
            <Fragment key={action.id}>
              <tr className={cn("cursor-pointer border-b transition-colors hover:bg-hover", open && "bg-surface")} onClick={() => onToggle(action.id)} aria-expanded={open}>
                <td className="py-3.5 pl-3 sm:pl-4">
                  <ChevronRight className={cn("size-4 text-muted-foreground transition-transform duration-200", open && "rotate-90")} />
                </td>
                <td className="py-3.5 text-xs font-medium text-muted-foreground sm:pr-3">
                  <span className="hidden sm:inline">{KIND_LABEL[action.kind]}</span>
                </td>
                <td className="py-3.5 pr-3">
                  <ActionLine action={action} />
                  <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">{KIND_LABEL[action.kind]}</p>
                </td>
                <td className="py-3.5 pr-3 sm:pr-0">
                  <StatusPill action={action} />
                </td>
                <td className="py-3.5 text-right text-xs text-muted-foreground tabular-nums sm:pr-5">
                  <span className="hidden sm:inline">{action.evidence.length}</span>
                </td>
              </tr>
              {open && (
                <tr className="border-b bg-surface">
                  <td colSpan={5} className="px-3 pt-1 pb-4 sm:px-5 sm:pb-5">
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

/** The status as a quiet tag: ink once approved, muted when rejected, outlined while it waits. */
function StatusPill({ action }: { action: ActionRow }) {
  const style =
    action.status === "approved"
      ? "bg-foreground/[0.08] text-foreground"
      : action.status === "rejected"
        ? "text-muted-foreground line-through decoration-faint"
        : "border text-foreground";
  return <span className={cn("inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium capitalize", style)}>{action.status}</span>;
}

/** The open row: why, based on what, the decision, and the trail drawn as a graph. */
function ExpandedAction({ action, onDecided, onOpenArtifact }: { action: ActionRow; onDecided: (a: ActionRow) => void; onOpenArtifact: (id: string) => void }) {
  const graph = useApi((signal) => api.actionGraph(action.id, signal), [action.id]);
  const canvas = useMemo(() => toCanvasGraph([graph.data]), [graph.data]);
  // The trail is the agent's reasoning: ring the evidence it used.
  const highlighted = useMemo(() => action.evidence.map((e) => e.id), [action.evidence]);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col pt-2">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm leading-relaxed">{action.reason}</p>
            {action.summary && <p className="text-sm leading-relaxed text-muted-foreground">{action.summary}</p>}
            <p className="text-xs break-words text-faint">
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
              <p className="text-xs text-muted-foreground">No artifacts recorded for this action.</p>
            ) : (
              <ul className="space-y-1.5">
                {action.evidence.slice(0, 6).map((e) => (
                  <li key={e.id} className="flex min-w-0 items-baseline gap-2 text-xs">
                    {/* The id keeps its width (up to 60%); the title takes what is left. */}
                    <span className="flex max-w-[60%] min-w-0 shrink-0">
                      <EvidenceChip id={e.id} onOpen={onOpenArtifact} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{e.title && e.title !== e.id ? e.title : (e.type ?? "")}</span>
                  </li>
                ))}
                {action.evidence.length > 6 && <li className="text-xs text-faint">+{action.evidence.length - 6} more</li>}
              </ul>
            )}
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()} className="mt-4 flex flex-1 items-end justify-end">
          <ActionDecision action={action} onDecided={onDecided} />
        </div>
      </div>
      <div className="h-60 overflow-hidden rounded-lg border bg-card sm:h-72">
        {graph.error ? (
          <ErrorState className="m-3" message={graph.error} onRetry={graph.reload} />
        ) : (
          <GraphCanvas className="h-full" nodes={canvas.nodes} edges={canvas.edges} highlightedIds={highlighted} emptyHint={graph.loading ? "Drawing the trail…" : "Nothing to draw."} />
        )}
      </div>
    </div>
  );
}
