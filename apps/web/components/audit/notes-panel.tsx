"use client";

import { type FormEvent, useMemo, useState } from "react";
import type { Note } from "@keystone/shared";
import { Check, X } from "lucide-react";
import { EvidenceChip } from "@/components/evidence-chip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, PanelHeading } from "@/components/ui/panel";
import { useAdminToken } from "@/hooks/use-admin-token";
import { useApi } from "@/hooks/use-api";
import { api, ApiError } from "@/lib/api";

/**
 * Corrections people sent with a thumbs-down in Ask. Each is a Note in the graph,
 * about the systems and people of the answer it corrects; the agent only sees it
 * once a person approves it here, the same rule as for Keystone's own proposals.
 */
export function NotesPanel({ onOpenArtifact }: { onOpenArtifact: (id: string) => void }) {
  const list = useApi((signal) => api.notes(null, signal), []);
  const [decided, setDecided] = useState<Record<string, Note>>({});
  const notes = useMemo(() => (list.data ?? []).map((note) => decided[note.id] ?? note), [list.data, decided]);
  if (!list.data || notes.length === 0) return null;
  const waiting = notes.filter((n) => n.status === "proposed").length;

  return (
    <Panel className="mb-6 p-4 sm:p-5">
      <PanelHeading
        title="Corrections from colleagues"
        description={`${notes.length} note${notes.length === 1 ? "" : "s"}, ${waiting} waiting. Once approved, Keystone remembers a note and cites it whenever a question is about the same systems or people.`}
      />
      <ul className="mt-4 divide-y">
        {notes.map((note) => (
          <li key={note.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <p className="text-sm font-medium break-words">{note.text}</p>
              <p className="text-xs break-words text-muted-foreground">
                <span className="code-id">{note.id}</span>
                {note.subjects.length > 0 && <> · about {note.subjects.join(", ")}</>}
                {note.question && <> · corrects “{note.question}”</>}
              </p>
              {note.evidence.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {note.evidence.slice(0, 5).map((id) => (
                    <EvidenceChip key={id} id={id} onOpen={onOpenArtifact} />
                  ))}
                </div>
              )}
            </div>
            <NoteDecision note={note} onDecided={(updated) => setDecided((d) => ({ ...d, [updated.id]: updated }))} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Approve or Reject (with a reason) for one proposed note; the admin token field appears after a 401. */
function NoteDecision({ note, onDecided }: { note: Note; onDecided: (note: Note) => void }) {
  const { token, setToken, needed, setNeeded } = useAdminToken();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (note.status === "approved") return <span className="shrink-0 text-xs text-foreground/80">Approved: Keystone uses it</span>;
  if (note.status === "rejected") {
    return <span className="shrink-0 text-xs text-muted-foreground">Rejected{note.reason ? `: ${note.reason}` : ""}</span>;
  }

  const run = async (work: () => Promise<Note>) => {
    setBusy(true);
    setError(null);
    try {
      onDecided(await work());
      setNeeded(false);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) setNeeded(true);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const submitReject = (event: FormEvent) => {
    event.preventDefault();
    if (reason.trim()) void run(() => api.rejectNote(note.id, reason.trim(), token || undefined));
  };

  return (
    <div className="flex max-w-full shrink-0 flex-col items-end gap-1.5">
      {rejecting ? (
        <form onSubmit={submitReject} className="flex w-full flex-wrap items-center justify-end gap-1.5">
          <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why not?" maxLength={1000} className="h-7 min-w-0 flex-1 text-xs sm:w-44 sm:flex-none" aria-label="Reason for rejecting" />
          <Button type="submit" size="xs" variant="secondary" disabled={busy || !reason.trim()}>
            Reject
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-1.5">
          <Button size="xs" disabled={busy} onClick={() => void run(() => api.approveNote(note.id, token || undefined))}>
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
        <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Admin token" autoComplete="off" className="h-7 w-full text-xs sm:w-44" aria-label="Admin token" />
      )}
      {error && <p className="max-w-60 text-right text-[0.7rem] text-muted-foreground">{error}</p>}
    </div>
  );
}
