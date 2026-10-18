"use client";

import { type FormEvent, useState } from "react";
import type { ActionRow } from "@keystone/shared";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminToken } from "@/hooks/use-admin-token";
import { api, ApiError } from "@/lib/api";

interface ActionDecisionProps {
  action: ActionRow;
  /** Called with the updated action after an approve or reject. */
  onDecided: (action: ActionRow) => void;
}

/**
 * Approve and Reject for one proposed action. Rejecting asks for a reason. Approving a
 * reassignment moves the ticket in the graph, so the button says so. The admin token
 * field only appears when the API answers 401.
 */
export function ActionDecision({ action, onDecided }: ActionDecisionProps) {
  const { token, setToken, needed, setNeeded } = useAdminToken();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (action.status !== "proposed") return <DecidedNote action={action} />;

  const run = async (work: () => Promise<ActionRow>) => {
    setBusy(true);
    setError(null);
    try {
      onDecided(await work());
      setNeeded(false);
    } catch (reasonError) {
      if (reasonError instanceof ApiError && reasonError.status === 401) setNeeded(true);
      setError(reasonError instanceof Error ? reasonError.message : String(reasonError));
    } finally {
      setBusy(false);
    }
  };

  const submitReject = (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim()) void run(() => api.rejectAction(action.id, reason.trim(), token || undefined));
  };

  return (
    <div className="flex max-w-full flex-col items-end gap-1.5">
      {rejecting ? (
        <form onSubmit={submitReject} className="flex w-full flex-wrap items-center justify-end gap-1.5">
          <Input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why not?"
            maxLength={1000}
            className="h-7 min-w-0 flex-1 text-xs sm:w-44 sm:flex-none"
            aria-label="Reason for rejecting"
          />
          <Button type="submit" size="xs" variant="secondary" disabled={busy || !reason.trim()}>
            Reject
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            disabled={busy}
            onClick={() => void run(() => api.approveAction(action.id, token || undefined))}
            title={action.kind === "reassign" ? `Approving moves ${action.target} to ${action.assignee}` : "Approve"}
          >
            <Check data-icon="inline-start" />
            Approve
          </Button>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>
            <X data-icon="inline-start" />
            Reject
          </Button>
        </div>
      )}
      {needed && (
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Admin token"
          autoComplete="off"
          className="h-7 w-full text-xs sm:w-44"
          aria-label="Admin token"
        />
      )}
      {error && <p className="max-w-60 text-right text-[0.7rem] text-muted-foreground">{error}</p>}
    </div>
  );
}

/** What happened to an action that is no longer open. */
function DecidedNote({ action }: { action: ActionRow }) {
  if (action.status === "approved") return <span className="text-xs text-foreground/80">Approved</span>;
  return (
    <span className="max-w-60 text-right text-xs text-muted-foreground" title={action.rejectReason ?? undefined}>
      Rejected{action.rejectReason ? `: ${action.rejectReason}` : ""}
    </span>
  );
}
