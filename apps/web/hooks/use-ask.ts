"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, Citation, GraphPath, QuestionLabel } from "@keystone/shared";
import { askAgent } from "@/lib/api";

/** One tool the agent used: the call, then its result once it arrives. */
export interface AgentStep {
  name: string;
  args: Record<string, unknown>;
  result: { summary: string; evidenceCount: number } | null;
}

export interface AgentTurn {
  id: string;
  question: string;
  label: QuestionLabel | null;
  steps: AgentStep[];
  answer: string;
  citations: Citation[];
  /** Graph paths of the tool results, in order (drawn while the answer streams). */
  paths: GraphPath[];
  /** The union of every path, sent with "done": highlighted when the answer is complete. */
  finalPath: GraphPath | null;
  status: "streaming" | "done" | "error";
  error: string | null;
}

/** Applies one streamed event to a turn. Pure, so it is easy to follow and test. */
export function applyEvent(turn: AgentTurn, event: AgentEvent): AgentTurn {
  switch (event.type) {
    case "classified":
      return { ...turn, label: event.label };
    case "tool_call":
      return { ...turn, steps: [...turn.steps, { name: event.name, args: event.args, result: null }] };
    case "tool_result": {
      // The result belongs to the latest call of that tool still waiting for one.
      const index = turn.steps.findLastIndex((step) => step.name === event.name && step.result === null);
      const steps = turn.steps.map((step, i) =>
        i === index ? { ...step, result: { summary: event.summary, evidenceCount: event.evidenceCount } } : step,
      );
      return { ...turn, steps, paths: event.graphPath ? [...turn.paths, event.graphPath] : turn.paths };
    }
    case "answer_delta":
      return { ...turn, answer: turn.answer + event.text };
    case "done":
      return { ...turn, citations: event.citations, finalPath: event.graphPath, status: "done" };
    case "error":
      return { ...turn, status: "error", error: event.message };
  }
}

/**
 * The Ask conversation: sends a question to POST /agent/ask and folds the streamed
 * events into turns. One session id per page visit, so follow-ups have context.
 */
export function useAsk() {
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const sessionId = useRef<string>("");
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    sessionId.current = crypto.randomUUID();
    return () => controller.current?.abort();
  }, []);

  const update = useCallback((id: string, change: (turn: AgentTurn) => AgentTurn) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? change(turn) : turn)));
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const id = crypto.randomUUID();
      const turn: AgentTurn = {
        id,
        question,
        label: null,
        steps: [],
        answer: "",
        citations: [],
        paths: [],
        finalPath: null,
        status: "streaming",
        error: null,
      };
      setTurns((current) => [...current, turn]);
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      try {
        await askAgent({ question, sessionId: sessionId.current }, (event) => update(id, (t) => applyEvent(t, event)), abort.signal);
        // A stream that ends without "done" (a dropped connection) still has to stop spinning.
        update(id, (t) => (t.status === "streaming" ? { ...t, status: "error", error: "The answer stream ended early." } : t));
      } catch (reason) {
        const stopped = abort.signal.aborted;
        update(id, (t) =>
          t.status === "streaming"
            ? { ...t, status: stopped ? "done" : "error", error: stopped ? null : reason instanceof Error ? reason.message : String(reason) }
            : t,
        );
      }
    },
    [update],
  );

  const stop = useCallback(() => controller.current?.abort(), []);
  const busy = turns.some((turn) => turn.status === "streaming");

  return { turns, ask, stop, busy };
}
