import { z } from "zod";
import { CitationSchema, GraphPathSchema, QuestionLabelSchema } from "@keystone/shared";
import type { AgentTurn } from "@/hooks/use-ask";

/**
 * The Ask history, kept in this browser's localStorage. The API answers each
 * question on its own and stores no conversations, so the browser is the only
 * place a past chat can come back from. Nothing here reaches the graph.
 */
const STORAGE_KEY = "keystone.ask.history.v1";

/** Only the newest turns are kept: graph paths are large and localStorage holds about 5 MB. */
const MAX_STORED_TURNS = 40;

const StoredTurnSchema = z.object({
  id: z.string(),
  chatId: z.string(),
  askedAt: z.string(),
  question: z.string(),
  label: QuestionLabelSchema.nullable(),
  steps: z.array(
    z.object({
      name: z.string(),
      args: z.record(z.string(), z.unknown()),
      result: z.object({ summary: z.string(), evidenceCount: z.number() }).nullable(),
    }),
  ),
  answer: z.string(),
  citations: z.array(CitationSchema),
  paths: z.array(GraphPathSchema),
  finalPath: GraphPathSchema.nullable(),
  status: z.enum(["streaming", "done", "error"]),
  error: z.string().nullable(),
});

/**
 * The stored turns, oldest first. A turn saved mid-answer lost its stream when the
 * page closed, so it comes back as interrupted. Anything unreadable is dropped.
 */
export function loadTurns(): AgentTurn[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = z.array(z.unknown()).safeParse(JSON.parse(raw));
    if (!parsed.success) return [];
    return parsed.data.flatMap((item) => {
      const turn = StoredTurnSchema.safeParse(item);
      if (!turn.success) return [];
      return turn.data.status === "streaming"
        ? [{ ...turn.data, status: "error" as const, error: "The page closed before this answer finished." }]
        : [turn.data];
    });
  } catch {
    return [];
  }
}

/** Saves the newest turns. When storage is full, the oldest half is dropped until the rest fits. */
export function saveTurns(turns: readonly AgentTurn[]): void {
  let kept = turns.slice(-MAX_STORED_TURNS);
  while (kept.length > 0) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
      return;
    } catch {
      // Quota exceeded or storage blocked (private mode): try again with fewer turns.
      kept = kept.slice(Math.ceil(kept.length / 2));
    }
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is unavailable: history just won't survive a reload.
  }
}
