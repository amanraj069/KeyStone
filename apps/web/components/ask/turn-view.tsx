"use client";

import { useState } from "react";
import type { Citation, QuestionLabel } from "@keystone/shared";
import { ChevronRight, CircleAlert, Waypoints } from "lucide-react";
import { KeystoneIcon } from "@/components/shell/brand-mark";
import type { AgentTurn } from "@/hooks/use-ask";
import { cn } from "@/lib/utils";
import { AnswerText } from "./answer-text";
import { StepList } from "./step-list";

interface TurnViewProps {
  turn: AgentTurn;
  active: boolean;
  activeCitation: string | null;
  onCite: (turnId: string, id: string) => void;
  onSelect: (turnId: string) => void;
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

/** A finished answer lists this many sources until expanded. */
const SOURCES_SHOWN = 5;

/**
 * One exchange: the question as your bubble, the answer as Keystone's. While it streams,
 * the tool steps show in full; once done they fold into one line, so the answer leads,
 * and the cited sources are listed under it.
 */
export function TurnView({ turn, active, activeCitation, onCite, onSelect }: TurnViewProps) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const streaming = turn.status === "streaming";
  const thinking = streaming && turn.answer === "";
  const sources = turn.steps.reduce((sum, step) => sum + (step.result?.evidenceCount ?? 0), 0);

  return (
    <article className="space-y-3">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-primary-foreground">{turn.question}</p>
      </div>

      <div className="flex items-end gap-2.5">
        <span className="hidden size-8 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-2xs sm:flex dark:text-foreground">
          <KeystoneIcon className="size-4" />
        </span>
        <div
          onClick={() => onSelect(turn.id)}
          className={cn(
            "w-full space-y-3 rounded-2xl rounded-bl-md border bg-card p-4 shadow-sm transition-colors sm:p-5 dark:shadow-none",
            active ? "border-foreground/20" : "cursor-pointer hover:border-foreground/15",
          )}
        >
          {(turn.label || active) && (
            <div className="flex items-center gap-2">
              {turn.label && <span className="rounded-full border px-2 py-0.5 text-[11px] font-bold text-muted-foreground">{LABEL_NAME[turn.label]}</span>}
              {active && (
                <span className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-muted-foreground">
                  <Waypoints className="size-3.5" />
                  In the graph
                </span>
              )}
            </div>
          )}

          {turn.steps.length > 0 && !streaming && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setStepsOpen((open) => !open);
              }}
              aria-expanded={stepsOpen}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={cn("size-3.5 transition-transform duration-200", stepsOpen && "rotate-90")} />
              Walked the graph with {turn.steps.length} tool{turn.steps.length === 1 ? "" : "s"} · {sources} source{sources === 1 ? "" : "s"}
            </button>
          )}
          {(streaming || stepsOpen) && <StepList steps={turn.steps} />}

          {thinking && <TypingDots label={turn.steps.length === 0 ? "Reading the question" : "Walking the graph"} />}
          {turn.answer && (
            <AnswerText
              text={turn.answer}
              cited={turn.status === "done" ? new Set(turn.citations.map((c) => c.id)) : null}
              activeId={active ? activeCitation : null}
              onCite={(id) => onCite(turn.id, id)}
            />
          )}
          {turn.status === "error" && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleAlert className="size-4" /> {turn.error ?? "Something went wrong."}
            </p>
          )}
          {turn.status === "done" && turn.citations.length > 0 && (
            <Sources citations={turn.citations} activeId={active ? activeCitation : null} onCite={(id) => onCite(turn.id, id)} />
          )}
        </div>
      </div>
    </article>
  );
}

/** The cited artifacts with their titles; clicking one finds it in the graph (or opens it). */
function Sources({ citations, activeId, onCite }: { citations: Citation[]; activeId: string | null; onCite: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? citations : citations.slice(0, SOURCES_SHOWN);
  return (
    <div className="border-t pt-3">
      <p className="section-label">Sources · {citations.length}</p>
      <ul className="mt-2 -mx-2">
        {shown.map((citation) => (
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
              <span className="code-id max-w-[45%] shrink-0 truncate text-muted-foreground">{citation.id}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{citation.title ?? citation.type ?? ""}</span>
              {citation.day !== null && <span className="shrink-0 font-light text-faint tabular-nums">day {citation.day}</span>}
            </button>
          </li>
        ))}
      </ul>
      {citations.length > SOURCES_SHOWN && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setAll((value) => !value);
          }}
          className="mt-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          {all ? "Show fewer" : `Show all ${citations.length}`}
        </button>
      )}
    </div>
  );
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
