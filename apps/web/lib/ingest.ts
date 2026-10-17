import { type IngestEvent, IngestEventSchema, type IngestJob } from "@keystone/shared";
import { api, subscribe } from "./api";

/** POST /ingest/full or /ingest/replay and return the queued job (validated with Zod). */
export function startIngest(kind: "full" | "replay", body: object): Promise<IngestJob> {
  return kind === "full" ? api.startFull() : api.startReplay(body);
}

/**
 * Subscribes to GET /ingest/jobs/:id/events (Server-Sent Events). Calls onEvent
 * for every valid event and closes after "completed" or "failed".
 * Returns a function that stops listening.
 */
export function watchIngest(jobId: string, onEvent: (event: IngestEvent) => void): () => void {
  const close = subscribe(`/ingest/jobs/${jobId}/events`, ["progress", "completed", "failed"], IngestEventSchema, (event) => {
    onEvent(event);
    if (event.type !== "progress") close();
  });
  return close;
}
