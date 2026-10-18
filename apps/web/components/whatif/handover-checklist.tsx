"use client";

import { useState } from "react";
import type { ActionKind, ActionRow, HandoverPlan } from "@keystone/shared";
import { CheckCheck, CircleCheck, CircleDashed, CircleX, LoaderCircle } from "lucide-react";
import { ActionDecision } from "@/components/actions/action-decision";
import { ActionLine } from "@/components/actions/action-line";
import { KIND_LABEL } from "@/components/actions/action-copy";
import { EvidenceChip } from "@/components/evidence-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminToken } from "@/hooks/use-admin-token";
import { api, ApiError } from "@/lib/api";

interface HandoverChecklistProps {
  plan: HandoverPlan;
  onChange: (action: ActionRow) => void;
  onOpenArtifact: (id: string) => void;
}

const ORDER: ActionKind[] = ["reassign", "review_doc", "runbook"];
/** Approvals in flight at once for Approve all: each is one graph write. */
const APPROVE_ALL_AT_ONCE = 4;

/** The handover plan as a checklist: one row per proposed action, each approved or rejected by a person. */
export function HandoverChecklist({ plan, onChange, onOpenArtifact }: HandoverChecklistProps) {
  const done = plan.children.filter((c) => c.status !== "proposed").length;
  return (
    <div className="space-y-5">
      <div className="rounded-xl bg-surface p-4">
        <p className="text-xs font-semibold text-muted-foreground">
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
            <h3 className="mb-2.5 text-sm font-semibold">
              {KIND_LABEL[kind]} <span className="text-xs font-semibold text-muted-foreground tabular-nums">{items.length}</span>
            </h3>
            <ul className="divide-y overflow-hidden rounded-lg border">
              {items.map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-surface">
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

/**
 * Approves every item still proposed, a few at a time, after an inline confirm (approving
 * a reassignment moves its ticket in the graph). A 401 stops it and asks for the admin
 * token; any other failure is left for its row to decide. Full width: it is the plan panel's footer.
 */
export function ApproveAll({ items, onChange }: { items: ActionRow[]; onChange: (action: ActionRow) => void }) {
  const { token, setToken, needed, setNeeded } = useAdminToken();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = items.filter((c) => c.status === "proposed");
  if (open.length === 0 && !busy) return null;

  const approveAll = async () => {
    setConfirming(false);
    setBusy(true);
    setError(null);
    const queue = [...open];
    let unauthorized = null as Error | null;
    let failed = 0;
    const worker = async () => {
      for (let item = queue.shift(); item && !unauthorized; item = queue.shift()) {
        try {
          onChange(await api.approveAction(item.id, token || undefined));
        } catch (reason) {
          if (reason instanceof ApiError && reason.status === 401) unauthorized = reason;
          else failed += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: APPROVE_ALL_AT_ONCE }, worker));
    setNeeded(unauthorized !== null);
    if (unauthorized) setError(unauthorized.message);
    else if (failed > 0) setError(`${failed} could not be approved; decide them below.`);
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-2">
      {confirming ? (
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => void approveAll()}>
            <CheckCheck data-icon="inline-start" />
            Confirm: approve {open.length}
          </Button>
          <Button variant="outline" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button className="w-full" disabled={busy} onClick={() => setConfirming(true)} title="Approves every open item; reassignments move their tickets">
          {busy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <CheckCheck data-icon="inline-start" />}
          {busy ? "Approving…" : `Approve all ${open.length}`}
        </Button>
      )}
      {needed && (
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Admin token"
          autoComplete="off"
          className="h-8 w-full text-xs"
          aria-label="Admin token"
        />
      )}
      {error && <p className="text-[0.7rem] text-muted-foreground">{error}</p>}
    </div>
  );
}

function StatusIcon({ status }: { status: ActionRow["status"] }) {
  if (status === "approved") return <CircleCheck className="mt-0.5 size-4 shrink-0 text-foreground/80" aria-label="Approved" />;
  if (status === "rejected") return <CircleX className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Rejected" />;
  return <CircleDashed className="mt-0.5 size-4 shrink-0 text-faint" aria-label="Proposed" />;
}
