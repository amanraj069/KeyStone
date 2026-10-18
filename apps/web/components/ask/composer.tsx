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
    <form onSubmit={submit} className="rounded-2xl border bg-card shadow-card transition-[border-color,box-shadow] duration-200 focus-within:border-ring/50 focus-within:shadow-raised focus-within:ring-3 focus-within:ring-ring/10">
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
        className="block min-h-12 w-full resize-none bg-transparent px-5 pt-4 pb-1 text-[15px] leading-relaxed placeholder:text-faint focus:outline-none focus-visible:outline-none"
      />
      <div className="flex items-center justify-end gap-3 px-3 pt-1 pb-3">
        <span className="hidden text-[11px] text-muted-foreground md:inline">
          <kbd className="kbd">Enter</kbd> to send · <kbd className="kbd">Shift</kbd> <kbd className="kbd">Enter</kbd> for a new line
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
              "flex size-9 items-center justify-center rounded-full transition-all duration-300 ease-spring active:scale-90",
              text.trim() ? "scale-100 bg-primary text-primary-foreground shadow-raised hover:bg-primary-hover" : "scale-95 bg-foreground/[0.07] text-faint",
            )}
          >
            <ArrowUp className="size-4" />
          </button>
        )}
      </div>
    </form>
  );
}
