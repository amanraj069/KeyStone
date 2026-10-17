"use client";

import type { ActionKind, ActionRow, HandoverPlan } from "@keystone/shared";
import { CircleCheck, CircleDashed, CircleX } from "lucide-react";
import { ActionDecision } from "@/components/actions/action-decision";
import { ActionLine } from "@/components/actions/action-line";
import { KIND_LABEL } from "@/components/actions/action-copy";
import { EvidenceChip } from "@/components/evidence-chip";

interface HandoverChecklistProps {
  plan: HandoverPlan;
  onChange: (action: ActionRow) => void;
  onOpenArtifact: (id: string) => void;
}

const ORDER: ActionKind[] = ["reassign", "review_doc", "runbook"];

/** The handover plan as a checklist: one row per proposed action, each approved or rejected by a person. */
export function HandoverChecklist({ plan, onChange, onOpenArtifact }: HandoverChecklistProps) {
  const done = plan.children.filter((c) => c.status !== "proposed").length;
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-surface p-4">
        <p className="text-xs font-bold text-muted-foreground">
          {plan.created ? "New plan" : "Open plan"} · {done} of {plan.children.length} decided
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]" role="progressbar" aria-valuemin={0} aria-valuemax={plan.children.length} aria-valuenow={done} aria-label="Items decided">
          <div className="h-full rounded-full bg-primary transition-[width] duration-500 dark:bg-ring" style={{ width: `${plan.children.length ? (done / plan.children.length) * 100 : 0}%` }} />
        </div>
        {plan.plan.summary && <p className="mt-1.5 text-sm leading-relaxed">{plan.plan.summary}</p>}
        <p className="code-id mt-2 text-faint">{plan.plan.id}</p>
      </div>
      {ORDER.map((kind) => {
        const items = plan.children.filter((c) => c.kind === kind);
        if (items.length === 0) return null;
        return (
          <section key={kind}>
            <h3 className="mb-2.5 text-sm font-bold">
              {KIND_LABEL[kind]} <span className="text-xs font-semibold text-muted-foreground tabular-nums">{items.length}</span>
            </h3>
            <ul className="divide-y overflow-hidden rounded-xl border">
              {items.map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-3 py-2.5">
                  <StatusIcon status={item.status} />
                  <div className="min-w-0 flex-1">
                    <ActionLine action={item} />
                    <div className="mt-1.5 flex flex-wrap items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        {item.targetType !== "System" && item.target && <EvidenceChip id={item.target} onOpen={onOpenArtifact} />}
                        {item.evidence.slice(0, 2).map((e) => (
                          <EvidenceChip key={e.id} id={e.id} onOpen={onOpenArtifact} title={e.title ?? e.id} />
                        ))}
                      </div>
                      <ActionDecision action={item} onDecided={onChange} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {plan.skipped.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Not in the plan: {plan.skipped.map((s) => `${s.target} (${s.reason})`).join("; ")}
        </p>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: ActionRow["status"] }) {
  if (status === "approved") return <CircleCheck className="mt-0.5 size-4 shrink-0 text-foreground/80" aria-label="Approved" />;
  if (status === "rejected") return <CircleX className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Rejected" />;
  return <CircleDashed className="mt-0.5 size-4 shrink-0 text-faint" aria-label="Proposed" />;
}
