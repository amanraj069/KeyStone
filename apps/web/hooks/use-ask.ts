"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, Citation, GraphPath, QuestionLabel } from "@keystone/shared";
import { askAgent } from "@/lib/api";
import { loadTurns, saveTurns } from "@/lib/ask-history";

/** One tool the agent used: the call, then its result once it arrives. */
export interface AgentStep {
  name: string;
  args: Record<string, unknown>;
  result: { summary: string; evidenceCount: number } | null;
}

export interface AgentTurn {
  id: string;
  /** The chat this turn belongs to; "New chat" starts another. */
  chatId: string;
  /** When it was asked (ISO), to date chats in the history. */
  askedAt: string;
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

/** Earlier exchanges open this many at a time: on request, then each time the thread is scrolled to the top. */
export const EARLIER_PAGE_SIZE = 5;

/**
 * The Ask conversation: sends a question to POST /agent/ask and folds the streamed
 * events into turns. Turns are saved in this browser (see ask-history.ts), grouped
 * into chats like Intake's assistant: chats from before this visit, and the ones
 * left with "New chat", stay hidden until the user opens them, five exchanges at a time.
 */
export function useAsk() {
  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Also sent as the session id, so a chat's questions share one.
  const [chatId, setChatId] = useState(() => crypto.randomUUID());
  // How many of the newest exchanges from earlier chats are shown above this chat.
  const [earlierShown, setEarlierShown] = useState(0);
  const controller = useRef<AbortController | null>(null);

  // localStorage only exists in the browser, so the history is read after the first render.
  useEffect(() => {
    setTurns(loadTurns());
    setLoaded(true);
    return () => controller.current?.abort();
  }, []);

  useEffect(() => {
    if (loaded) saveTurns(turns);
  }, [loaded, turns]);

  const update = useCallback((id: string, change: (turn: AgentTurn) => AgentTurn) => {
    setTurns((current) => current.map((turn) => (turn.id === id ? change(turn) : turn)));
  }, []);

  const ask = useCallback(
    async (question: string) => {
      const id = crypto.randomUUID();
      const turn: AgentTurn = {
        id,
        chatId,
        askedAt: new Date().toISOString(),
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
        await askAgent({ question, sessionId: chatId }, (event) => update(id, (t) => applyEvent(t, event)), abort.signal);
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
    [chatId, update],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  /** Clears the screen for a fresh chat; the one on screen joins the previous chats. */
  const startNewChat = useCallback(() => {
    setChatId(crypto.randomUUID());
    setEarlierShown(0);
  }, []);

  /** Shows the next five earlier exchanges above the ones already on screen. */
  const loadEarlier = useCallback(() => setEarlierShown((shown) => shown + EARLIER_PAGE_SIZE), []);

  const busy = turns.some((turn) => turn.status === "streaming");
  // Chats run one after another, so every earlier turn comes before this chat's turns.
  const earlierTurns = turns.filter((turn) => turn.chatId !== chatId);
  const shownEarlier = earlierShown > 0 ? earlierTurns.slice(-earlierShown) : [];
  const visibleTurns = [...shownEarlier, ...turns.filter((turn) => turn.chatId === chatId)];

  return {
    /** The turns to draw: this chat's, plus the earlier exchanges opened so far. */
    turns: visibleTurns,
    ask,
    stop,
    busy,
    /** False until the stored history has been read. */
    loaded,
    chatId,
    /** Earlier exchanges not on screen yet. */
    earlierHidden: earlierTurns.length - shownEarlier.length,
    /** Whether any earlier exchange is on screen. */
    showingPreviousChats: shownEarlier.length > 0,
    loadEarlier,
    startNewChat,
  };
}
