"use client";

import { useEffect, useMemo, useState } from "react";
import type { Citation, QuestionLabel } from "@keystone/shared";
import { ChevronDown, ChevronRight, CircleAlert, History } from "lucide-react";
import { KeystoneIcon } from "@/components/shell/brand-mark";
import type { AgentTurn, TurnMessage } from "@/hooks/use-ask";
import { cn } from "@/lib/utils";
import { type RateAnswer, useAnswerFeedback } from "./answer-feedback";
import { AnswerText, citationNumbers } from "./answer-text";
import { StepList } from "./step-list";
import { MessageActions } from "./message-actions";
import { TurnGraph } from "./turn-graph";

interface TurnViewProps {
  turn: AgentTurn;
  active: boolean;
  activeCitation: string | null;
  onCite: (turnId: string, id: string) => void;
  onSelect: (turnId: string) => void;
  onClearCitation: () => void;
  /** Deletes one message of this turn; offered once its answer has stopped streaming. */
  onDelete: (turnId: string, message: TurnMessage) => void;
  /** Rates the answer (offered once the API stored it); a thumbs-down may carry a correction. */
  onRate: (turnId: string, rating: "up" | "down", correction?: string) => Promise<string | null>;
}

/** The question classifier's labels, in words. */
const LABEL_NAME: Record<QuestionLabel, string> = {
  who_knows: "Expertise",
  why: "Why",
  what_if: "What-if",
  freshness: "Freshness",
  event: "Event",
  visibility: "Visibility",
  counterfactual: "Counterfactual",
  general: "General",
};

/**
 * One exchange: the question as your bubble, the answer as Keystone's. While it streams,
 * the tool steps show in full; once done they fold into one line, so the answer leads.
 * Under it come the graph the agent walked (drawn for the selected answer) and the
 * cited sources, which single themselves out in that graph.
 */
export function TurnView({ turn, active, activeCitation, onCite, onSelect, onClearCitation, onDelete, onRate }: TurnViewProps) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const streaming = turn.status === "streaming";
  const thinking = streaming && turn.answer === "";
  const sources = turn.steps.reduce((sum, step) => sum + (step.result?.evidenceCount ?? 0), 0);
  // Until "done", any id-shaped token counts as cited; after it, only what the API confirmed.
  const cited = useMemo(() => (turn.status === "done" ? new Set(turn.citations.map((c) => c.id)) : null), [turn.status, turn.citations]);
  const numbers = useMemo(() => citationNumbers(turn.answer, cited), [turn.answer, cited]);
  const sourcesById = useMemo(() => new Map(turn.citations.map((c) => [c.id, c])), [turn.citations]);

  return (
    <article className="space-y-3">
      {/* Yours on the right, Keystone's on the left, each stopping short of the other's edge. */}
      {!turn.questionDeleted && (
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground">You</span>
          {/* Fixed room on the right for the menu, so the text never rewraps on hover. */}
          <div className="group relative max-w-[88%] rounded-2xl rounded-tr-md bg-primary py-2.5 pr-10 pl-4 text-sm leading-relaxed break-words sm:max-w-[75%] sm:text-[15px] whitespace-pre-wrap text-primary-foreground shadow-card">
            {turn.question}
            {!streaming && (
              <MessageActions text={turn.question} variant="primary" onDelete={() => onDelete(turn.id, "question")} className="top-1.5 right-1.5" />
            )}
          </div>
        </div>
      )}

      {!turn.answerDeleted && (
      // The answer starts at the composer's left edge; the avatar hangs outside the column
      // when the thread is wide enough for it (see @container on the thread), else it sits by the name.
      <div className="relative sm:pr-[8%]">
        <span className="absolute top-[-8px] right-full mr-3.5 hidden size-9 items-center justify-center text-foreground @min-[76rem]:flex">
          <KeystoneIcon className="size-8" />
        </span>
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <KeystoneIcon className="size-5 @min-[76rem]:hidden" />
            <span className="text-[13px] font-semibold">Keystone</span>
            {turn.label && <span className="rounded-full border border-foreground/10 px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{LABEL_NAME[turn.label]}</span>}
          </div>
          <div
            onClick={() => onSelect(turn.id)}
            className={cn(
              "group relative w-full space-y-4 rounded-2xl rounded-tl-md border bg-card p-4 shadow-card transition-colors sm:px-6 sm:py-5",
              active ? "border-foreground/[0.16]" : "cursor-pointer border-foreground/[0.08] hover:border-foreground/[0.16]",
            )}
          >
            {!streaming && (
              <MessageActions text={turn.answer} onDelete={() => onDelete(turn.id, "answer")} className="top-2 right-2 sm:top-3 sm:right-3" />
            )}
            {turn.memory && <MemoryLine memory={turn.memory} />}
            {turn.steps.length > 0 && !streaming && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setStepsOpen((open) => !open);
                }}
                aria-expanded={stepsOpen}
                className="flex items-center gap-1.5 text-left text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className={cn("size-3.5 transition-transform duration-200", stepsOpen && "rotate-90")} />
                Walked the graph with {turn.steps.length} tool{turn.steps.length === 1 ? "" : "s"} · {sources} source{sources === 1 ? "" : "s"}
              </button>
            )}
            {(streaming || stepsOpen) && <StepList steps={turn.steps} />}

            {thinking && (
              <div className="flex items-center gap-2">
                <TypingDots label={turn.steps.length === 0 ? "Reading the question" : "Walking the graph"} />
                <Elapsed />
              </div>
            )}
            {turn.answer && (
              <AnswerText
                text={turn.answer}
                cited={cited}
                numbers={numbers}
                sources={sourcesById}
                activeId={active ? activeCitation : null}
                onCite={(id) => onCite(turn.id, id)}
              />
            )}
            {turn.status === "error" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CircleAlert className="size-4" /> {turn.error ?? "Something went wrong."}
              </p>
            )}
            <TurnGraph
              turn={turn}
              active={active}
              citation={active ? activeCitation : null}
              onSelect={() => onSelect(turn.id)}
              onClearCitation={onClearCitation}
            />
            {turn.status === "done" && (turn.citations.length > 0 || turn.turnId) && (
              <Sources
                citations={turn.citations}
                numbers={numbers}
                activeId={active ? activeCitation : null}
                onCite={(id) => onCite(turn.id, id)}
                feedback={turn.turnId ? { rating: turn.rating, onRate: (rating, correction) => onRate(turn.id, rating, correction) } : null}
              />
            )}
          </div>
        </div>
      </div>
      )}
    </article>
  );
}

/**
 * The cited artifacts with their titles, folded away until "Show" opens them all;
 * clicking one finds it in the graph (or opens it).
 */
interface SourcesProps {
  citations: Citation[];
  /** The numbers the answer's markers show, so each source reads as the marker it belongs to. */
  numbers: ReadonlyMap<string, number>;
  activeId: string | null;
  onCite: (id: string) => void;
  /** Thumbs up and down, shown just left of "Show" (null when the answer was not stored). */
  feedback: { rating: "up" | "down" | null; onRate: RateAnswer } | null;
}

function Sources({ citations, numbers, activeId, onCite, feedback }: SourcesProps) {
  const [open, setOpen] = useState(false);
  const rate = useAnswerFeedback(feedback?.rating ?? null, feedback?.onRate ?? (async () => null));
  // In marker order; a source the text never marks goes last.
  const ordered = [...citations].sort((a, b) => (numbers.get(a.id) ?? Infinity) - (numbers.get(b.id) ?? Infinity));
  return (
    <div className="border-t pt-3">
      <div className="flex items-center justify-between gap-3">
        <p className="section-label shrink-0">{citations.length > 0 ? `Sources · ${citations.length}` : "Was this right?"}</p>
        <div className="flex min-w-0 items-center gap-1.5">
          {feedback && rate.status}
          {feedback && rate.buttons}
          {citations.length > 0 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setOpen((value) => !value);
              }}
              aria-expanded={open}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            >
              {open ? "Hide" : "Show"}
              <ChevronDown className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")} />
            </button>
          )}
        </div>
      </div>
      {feedback && rate.panel}
      {open && (
      <ul className="mt-2 -mx-2">
        {ordered.map((citation) => (
          <li key={citation.id}>
            <button
              type="button"
              title={`Show ${citation.id} in the graph`}
              onClick={(event) => {
                event.stopPropagation();
                onCite(citation.id);
              }}
              className={cn(
                "flex w-full items-baseline gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors hover:bg-foreground/5",
                citation.id === activeId && "bg-signal-soft hover:bg-signal-soft",
              )}
            >
              <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center self-center rounded-[5px] bg-foreground/[0.08] px-1 text-[10.5px] font-semibold text-muted-foreground tabular-nums">
                {numbers.get(citation.id) ?? "•"}
              </span>
              <span className="code-id hidden max-w-[40%] shrink-0 truncate text-muted-foreground sm:inline">{citation.id}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{citation.title ?? citation.type ?? ""}</span>
                {/* The sentence that names what the answer is about: why this source backs the claim. */}
                {citation.passage && (
                  <span className="mt-0.5 line-clamp-2 block font-light text-muted-foreground" title={citation.passage}>
                    &ldquo;{citation.passage}&rdquo;
                  </span>
                )}
              </span>
              {citation.day !== null && <span className="shrink-0 font-light text-faint tabular-nums">day {citation.day}</span>}
            </button>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

/**
 * What the agent remembered before answering: the earlier questions of this chat it
 * read, and approved notes from colleagues (opened to show their text).
 */
function MemoryLine({ memory }: { memory: NonNullable<AgentTurn["memory"]> }) {
  const [open, setOpen] = useState(false);
  const parts = [
    memory.priorTurns > 0 && `${memory.priorTurns} earlier question${memory.priorTurns === 1 ? "" : "s"} in this chat`,
    memory.notes.length > 0 && `${memory.notes.length} approved note${memory.notes.length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return (
    <div className="text-xs text-muted-foreground">
      <button
        type="button"
        disabled={memory.notes.length === 0}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-expanded={open}
        className="flex items-start gap-1.5 text-left font-semibold enabled:hover:text-foreground"
      >
        <History className="mt-px size-3.5 shrink-0" />
        Remembered {parts.join(" and ")}
        {memory.subjects.length > 0 && <span className="font-normal">· about {memory.subjects.slice(0, 4).join(", ")}</span>}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1 pl-5">
          {memory.notes.map((note) => (
            <li key={note.id}>
              <span className="code-id">{note.id}</span> {note.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Seconds since the answer started, so a long wait reads as work in progress. Shown from 2 s on. */
function Elapsed() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (seconds < 2) return null;
  return <span className="text-xs text-faint tabular-nums">{seconds} s</span>;
}

function TypingDots({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground" role="status">
      {label}
      <span className="inline-flex gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 150}ms` }} />
        ))}
      </span>
    </p>
  );
}
