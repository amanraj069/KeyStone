"use client";

import { type FormEvent, type KeyboardEvent, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";

interface ComposerProps {
  busy: boolean;
  onAsk: (question: string) => void;
  onStop: () => void;
}

/** The question box (Intake's composer): Enter sends, Shift+Enter adds a line, Stop ends a running answer. */
export function Composer({ busy, onAsk, onStop }: ComposerProps) {
  const [text, setText] = useState("");

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const question = text.trim();
    if (!question || busy) return;
    onAsk(question);
    setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={submit} className="rounded-3xl border bg-card shadow-sm dark:shadow-none">
      <label htmlFor="question" className="sr-only">
        Question
      </label>
      <textarea
        id="question"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask about people, systems or decisions…"
        rows={2}
        maxLength={2000}
        className="block min-h-12 w-full resize-none bg-transparent px-5 pt-4 pb-1 text-[15px] leading-relaxed placeholder:font-light placeholder:text-muted-foreground/80 focus:outline-none focus-visible:outline-none"
      />
      <div className="flex items-center justify-end gap-3 px-3 pt-1 pb-3">
        <span className="hidden text-[11px] font-light text-muted-foreground md:inline">
          <kbd className="font-sans font-semibold">Enter</kbd> to send, <kbd className="font-sans font-semibold">Shift + Enter</kbd> for a new line
        </span>
        {busy ? (
          <button type="button" onClick={onStop} aria-label="Stop" className="flex size-9 items-center justify-center rounded-full bg-foreground/10 transition-colors hover:bg-foreground/15">
            <Square className="size-3" fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!text.trim()}
            aria-label="Ask"
            className={cn(
              "flex size-9 items-center justify-center rounded-full transition-all duration-200",
              text.trim() ? "bg-primary text-primary-foreground hover:bg-primary-hover" : "bg-foreground/10 text-muted-foreground",
            )}
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
    </form>
  );
}
