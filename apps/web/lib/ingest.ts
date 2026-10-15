import {
  ApiErrorSchema,
  type IngestEvent,
  IngestEventSchema,
  type IngestJob,
  IngestJobSchema,
} from "@keystone/shared";
import { API_BASE_URL } from "./api";

/** POST /ingest/full or /ingest/replay and return the queued job (validated with Zod). */
export async function startIngest(kind: "full" | "replay", body: object): Promise<IngestJob> {
  const response = await fetch(`${API_BASE_URL}/ingest/${kind}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: unknown = await response.json();
  if (!response.ok) {
    const apiError = ApiErrorSchema.safeParse(json);
    throw new Error(apiError.success ? apiError.data.message : `API returned ${response.status}`);
  }
  return IngestJobSchema.parse(json);
}

/**
 * Subscribes to GET /ingest/jobs/:id/events (Server-Sent Events). Calls onEvent
 * for every valid event and closes after "completed" or "failed".
 * Returns a function that stops listening.
 */
export function watchIngest(jobId: string, onEvent: (event: IngestEvent) => void): () => void {
  const source = new EventSource(`${API_BASE_URL}/ingest/jobs/${jobId}/events`);
  const handle = (message: MessageEvent<string>) => {
    const parsed = IngestEventSchema.safeParse(JSON.parse(message.data));
    if (!parsed.success) return;
    onEvent(parsed.data);
    if (parsed.data.type !== "progress") source.close();
  };
  for (const type of ["progress", "completed", "failed"]) {
    source.addEventListener(type, handle as EventListener);
  }
  return () => source.close();
}
