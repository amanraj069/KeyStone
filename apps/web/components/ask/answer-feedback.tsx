"use client";

import { type ReactNode, useState } from "react";
import { Check, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "@/lib/utils";

/** Sends the rating; a thumbs-down may carry a correction, which becomes a note for review. Resolves to its id. */
export type RateAnswer = (rating: "up" | "down", correction?: string) => Promise<string | null>;

/**
 * Thumbs up or down for an answer, in three parts for the Sources row: `status` (what
 * happened: "Thanks", "Sent for review") sits just left of the `buttons`, which sit just
 * left of "Show"; `panel` goes under the row with the correction box a thumbs-down opens.
 * A correction is stored as a proposed note: once someone approves it on the Audit page,
 * Keystone uses and cites it in later answers.
 */
export function useAnswerFeedback(rating: "up" | "down" | null, onRate: RateAnswer): { status: ReactNode; buttons: ReactNode; panel: ReactNode } {
  const [writing, setWriting] = useState(false);
  const [correction, setCorrection] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "error" } | { kind: "sent"; noteId: string | null }>({ kind: "idle" });

  const send = async (value: "up" | "down", text?: string) => {
    setState({ kind: "sending" });
    try {
      const noteId = await onRate(value, text);
      setState({ kind: "sent", noteId });
      setWriting(false);
    } catch {
      setState({ kind: "error" });
    }
  };

  const button = (value: "up" | "down") => {
    const Icon = value === "up" ? ThumbsUp : ThumbsDown;
    // When the dislike correction panel is open (writing), thumbs-up is deselected
    // so like and dislike are always mutually exclusive visually.
    const chosen =
      value === "up"
        ? rating === "up" && !writing
        : rating === "down" || writing;
    const isFilledUp = value === "up" && chosen;
    const isFilledDown = value === "down" && chosen;
    return (
      <button
        type="button"
        aria-label={value === "up" ? "Good answer" : "Something is wrong"}
        title={value === "up" ? "Good answer" : "Something is wrong or missing"}
        aria-pressed={chosen}
        disabled={state.kind === "sending"}
        onClick={(event) => {
          event.stopPropagation();
          if (value === "up") void send("up");
          else setWriting((open) => !open);
        }}
        className={cn(
          "flex size-7 items-center justify-center rounded-md transition-colors hover:bg-foreground/5",
          chosen ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon
          className="size-3.5"
          {...((isFilledUp || isFilledDown) ? { fill: "currentColor", stroke: "currentColor", strokeWidth: 1 } : {})}
        />
      </button>
    );
  };

  const buttons = (
    <span className="flex items-center gap-0.5">
      {button("up")}
      {button("down")}
    </span>
  );

  const status =
    state.kind === "sent" && !writing ? (
      <span
        className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground mr-1.5"
        role="status"
        title={state.noteId ? "Once someone approves it on the Audit page, Keystone remembers it." : undefined}
      >
        <Check className="size-3.5 shrink-0" />
        {state.noteId ? (
          <span className="truncate">
            Sent for review as <span className="code-id">{state.noteId}</span>
          </span>
        ) : (
          "Thanks"
        )}
      </span>
    ) : state.kind === "error" ? (
      <span className="text-xs text-muted-foreground mr-1.5" role="status">
        Not sent, try again
      </span>
    ) : null;

  const panel = writing ? (
    <form
      className="space-y-2 pt-2"
      onClick={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        void send("down", correction.trim() || undefined);
      }}
    >
      <textarea
        value={correction}
        onChange={(event) => setCorrection(event.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="What's wrong or missing? e.g. “Tom took over TitanDB on-call in March.” (optional)"
        className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm outline-none placeholder:text-faint focus:border-foreground/30"
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => setWriting(false)}
          className="rounded-md px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={state.kind === "sending" || (correction.trim().length > 0 && correction.trim().length < 3)}
          className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-50"
        >
          {correction.trim() ? "Send correction" : "Send"}
        </button>
      </div>
    </form>
  ) : null;

  return { status, buttons, panel };
}
