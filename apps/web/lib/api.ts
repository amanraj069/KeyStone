import {
  type ActionRow,
  ActionRowSchema,
  type ActionStatus,
  type AgentEvent,
  AgentEventSchema,
  type AnalyticsSummary,
  AnalyticsSummarySchema,
  ApiErrorSchema,
  type ArtifactDetail,
  ArtifactDetailSchema,
  type AskRequest,
  type ApprovedAction,
  ApprovedActionSchema,
  type BeforeGraph,
  BeforeGraphSchema,
  type BenchResults,
  BenchResultsSchema,
  type Bridge,
  BridgeSchema,
  type BusFactorRow,
  BusFactorRowSchema,
  type DecisionTraceRow,
  DecisionTraceRowSchema,
  type DepartureCandidate,
  DepartureCandidateSchema,
  type DepartureSimulation,
  DepartureSimulationSchema,
  type GraphView,
  GraphViewSchema,
  type HandoverPlan,
  HandoverPlanSchema,
  type ExpertsResponse,
  ExpertsResponseSchema,
  type FeedbackRequest,
  type FeedbackResponse,
  FeedbackResponseSchema,
  type Note,
  NoteSchema,
  type NoteStatus,
  type HealthResponse,
  HealthResponseSchema,
  type LiveArtifact,
  LiveArtifactSchema,
  type LiveEvent,
  LiveEventSchema,
  type LivePost,
  type IngestEvent,
  IngestEventSchema,
  type IngestJob,
  IngestJobSchema,
  type PersonListItem,
  PersonListItemSchema,
  type ReplayRequest,
  type StaleDoc,
  StaleDocSchema,
  type SystemWithDecisions,
  SystemWithDecisionsSchema,
} from "@keystone/shared";
import { z } from "zod";
import { env } from "./env";

const QueryEntrySchema = z.object({ id: z.string(), title: z.string(), file: z.string(), cypher: z.string() });
const QueryRegistrySchema = z.object({ tools: z.record(z.string(), z.array(z.string())), queries: z.record(z.string(), QueryEntrySchema) });
export type QueryEntry = z.infer<typeof QueryEntrySchema>;
export type QueryRegistry = z.infer<typeof QueryRegistrySchema>;

/** Base URL of the Keystone API (NEXT_PUBLIC_API_BASE_URL, see apps/web/.env.example). */
export const API_BASE_URL = env.apiBaseUrl;

/** The graphs the UI can show: the full company, or the day-by-day replay. */
export type ViewGraph = "apex" | "apex_replay";

/** An error from the API, with its HTTP status (so a page can tell 401 from 503). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Reads a JSON response and validates it with a shared Zod schema: anything that
 * crosses the network is untrusted until parsed. A non-2xx response becomes ApiError.
 */
async function parseResponse<S extends z.ZodType>(response: Response, schema: S): Promise<z.infer<S>> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const apiError = ApiErrorSchema.safeParse(body);
    throw new ApiError(apiError.success ? apiError.data.message : `API returned ${response.status}`, response.status);
  }
  return schema.parse(body);
}

/**
 * fetch, with a network failure ("Failed to fetch") turned into a sentence a person
 * can act on. Aborts are passed through untouched.
 */
async function request(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_BASE_URL}${path}`, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(`Cannot reach the Keystone API at ${API_BASE_URL}. Is it running?`, 0);
  }
}

async function getJson<S extends z.ZodType>(path: string, schema: S, signal?: AbortSignal): Promise<z.infer<S>> {
  const response = await request(path, { signal, cache: "no-store" });
  return parseResponse(response, schema);
}

async function postJson<S extends z.ZodType>(
  path: string,
  body: object,
  schema: S,
  headers: Record<string, string> = {},
): Promise<z.infer<S>> {
  const response = await request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return parseResponse(response, schema);
}

const query = (params: Record<string, string>) => `?${new URLSearchParams(params).toString()}`;
const adminHeaders = (adminToken?: string): Record<string, string> => (adminToken ? { "x-admin-token": adminToken } : {});

// ------------------------------------------------------------------ endpoints

export const api = {
  health: (signal?: AbortSignal): Promise<HealthResponse> => getJson("/health", HealthResponseSchema, signal),

  summary: (graph: ViewGraph, signal?: AbortSignal): Promise<AnalyticsSummary> =>
    getJson(`/analytics/summary${query({ graph })}`, AnalyticsSummarySchema, signal),

  busFactor: (graph: ViewGraph, signal?: AbortSignal): Promise<BusFactorRow[]> =>
    getJson(`/analytics/bus-factor${query({ graph })}`, z.array(BusFactorRowSchema), signal),

  bridges: (graph: ViewGraph, signal?: AbortSignal): Promise<Bridge[]> =>
    getJson(`/analytics/bridges${query({ graph })}`, z.array(BridgeSchema), signal),
  centralPeople: (graph: ViewGraph, signal?: AbortSignal): Promise<Bridge[]> =>
    getJson(`/analytics/central-people${query({ graph })}`, z.array(BridgeSchema), signal),

  experts: (system: string, graph: ViewGraph, signal?: AbortSignal): Promise<ExpertsResponse> =>
    getJson(`/systems/${encodeURIComponent(system)}/experts${query({ graph })}`, ExpertsResponseSchema, signal),

  artifact: (id: string, signal?: AbortSignal): Promise<ArtifactDetail> =>
    getJson(`/artifacts/${encodeURIComponent(id)}`, ArtifactDetailSchema, signal),

  activeJobs: (signal?: AbortSignal): Promise<IngestJob[]> => getJson("/ingest/active", z.array(IngestJobSchema), signal),

  /** POST /ingest/replay. The admin token is only needed when the API sets ADMIN_TOKEN. */
  startReplay: (request: Partial<ReplayRequest>, adminToken?: string): Promise<IngestJob> =>
    postJson("/ingest/replay", request, IngestJobSchema, adminHeaders(adminToken)),

  startFull: (adminToken?: string): Promise<IngestJob> => postJson("/ingest/full", {}, IngestJobSchema, adminHeaders(adminToken)),

  // Directories for pickers.
  people: (signal?: AbortSignal): Promise<PersonListItem[]> => getJson("/people", z.array(PersonListItemSchema), signal),
  systems: (signal?: AbortSignal): Promise<SystemWithDecisions[]> => getJson("/systems", z.array(SystemWithDecisionsSchema), signal),

  // What-if.
  candidates: (signal?: AbortSignal): Promise<DepartureCandidate[]> =>
    getJson("/whatif/candidates", z.array(DepartureCandidateSchema), signal),
  beforeGraph: (person: string, signal?: AbortSignal): Promise<BeforeGraph> =>
    getJson(`/whatif/subgraph${query({ person })}`, BeforeGraphSchema, signal),
  simulateDeparture: (person: string): Promise<DepartureSimulation> =>
    postJson("/whatif/departure", { person }, DepartureSimulationSchema),

  // Decisions.
  decisions: (system: string, signal?: AbortSignal): Promise<DecisionTraceRow[]> =>
    getJson(`/systems/${encodeURIComponent(system)}/decisions`, z.array(DecisionTraceRowSchema), signal),
  staleDocs: (signal?: AbortSignal): Promise<StaleDoc[]> => getJson("/analytics/stale-docs", z.array(StaleDocSchema), signal),

  // Actions. Proposing needs no token; approving and rejecting are a person's decision (admin token when set).
  actions: (status: ActionStatus | null, signal?: AbortSignal): Promise<ActionRow[]> =>
    getJson(`/actions${status ? query({ status }) : ""}`, z.array(ActionRowSchema), signal),
  actionGraph: (id: string, signal?: AbortSignal): Promise<GraphView> => getJson(`/actions/${id}/graph`, GraphViewSchema, signal),
  draftHandover: (person: string): Promise<HandoverPlan> => postJson("/actions/handover", { person }, HandoverPlanSchema),
  approveAction: (id: string, adminToken?: string): Promise<ApprovedAction> =>
    postJson(`/actions/${id}/approve`, {}, ApprovedActionSchema, adminHeaders(adminToken)),
  rejectAction: (id: string, reason: string, adminToken?: string): Promise<ActionRow> =>
    postJson(`/actions/${id}/reject`, { reason }, ActionRowSchema, adminHeaders(adminToken)),

  // Memory: rate an answer (a thumbs-down with a correction proposes a Note); a person approves notes.
  feedback: (turnId: string, body: FeedbackRequest): Promise<FeedbackResponse> =>
    postJson(`/memory/turns/${turnId}/feedback`, { ...body, userId: body.userId ?? userId() }, FeedbackResponseSchema),
  notes: (status: NoteStatus | null, signal?: AbortSignal): Promise<Note[]> =>
    getJson(`/memory/notes${status ? query({ status }) : ""}`, z.array(NoteSchema), signal),
  approveNote: (id: string, adminToken?: string): Promise<Note> =>
    postJson(`/memory/notes/${id}/approve`, {}, NoteSchema, adminHeaders(adminToken)),
  rejectNote: (id: string, reason: string, adminToken?: string): Promise<Note> =>
    postJson(`/memory/notes/${id}/reject`, { reason }, NoteSchema, adminHeaders(adminToken)),

  // Show Cypher: the queries behind every MCP tool, exactly as the API runs them.
  queries: (signal?: AbortSignal): Promise<QueryRegistry> => getJson("/queries", QueryRegistrySchema, signal),

  // Live documents: post one now and see the graph change; reset removes them all (admin token when set).
  liveArtifacts: (signal?: AbortSignal): Promise<LiveArtifact[]> => getJson("/live/artifacts", z.array(LiveArtifactSchema), signal),
  resetLive: (adminToken?: string): Promise<{ deleted: number; reactivated: number; departuresUndone: string[] }> =>
    postJson("/live/reset", {}, z.object({ deleted: z.number(), reactivated: z.number(), departuresUndone: z.array(z.string()) }), adminHeaders(adminToken)),

  // Benchmark: the last `pnpm bench` run; null until it has run (the API answers 404).
  benchResults: (signal?: AbortSignal): Promise<BenchResults | null> =>
    getJson("/bench/results", BenchResultsSchema, signal).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
};

// ------------------------------------------------------------------ Server-Sent Events

/**
 * Subscribes to a GET event stream with EventSource. Every event of the given
 * types is parsed with `schema`; invalid ones are skipped. EventSource reconnects
 * by itself. Returns a function that closes the stream.
 */
export function subscribe<S extends z.ZodType>(
  path: string,
  eventTypes: readonly string[],
  schema: S,
  onEvent: (event: z.infer<S>) => void,
): () => void {
  const source = new EventSource(`${API_BASE_URL}${path}`);
  const handle = (message: MessageEvent<string>) => {
    const parsed = schema.safeParse(safeJson(message.data));
    if (parsed.success) onEvent(parsed.data);
  };
  for (const type of eventTypes) source.addEventListener(type, handle as EventListener);
  return () => source.close();
}

/** GET /ingest/events: progress, completion and failure of every ingest job. */
export function subscribeIngest(onEvent: (event: IngestEvent) => void): () => void {
  return subscribe("/ingest/events", ["progress", "completed", "failed"], IngestEventSchema, onEvent);
}

/**
 * POSTs and reads a Server-Sent Events response. EventSource can only GET, so this
 * uses fetch and a ReadableStream reader: bytes are decoded, split into lines, and
 * every "data:" line is parsed as one JSON event. Resolves when the stream ends.
 */
export async function streamPost<S extends z.ZodType>(
  path: string,
  body: object,
  schema: S,
  onEvent: (event: z.infer<S>) => void,
  signal?: AbortSignal,
  headers: Record<string, string> = {},
): Promise<void> {
  const response = await request(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream", ...headers },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok || !response.body) {
    await parseResponse(response, z.unknown());
    throw new ApiError(`API returned ${response.status}`, response.status);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    // Keep the last, possibly incomplete line for the next chunk.
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) emitDataLine(line, schema, onEvent);
  }
  emitDataLine(buffer, schema, onEvent);
}

function emitDataLine<S extends z.ZodType>(line: string, schema: S, onEvent: (event: z.infer<S>) => void): void {
  if (!line.startsWith("data:")) return;
  const parsed = schema.safeParse(safeJson(line.slice("data:".length).trim()));
  if (parsed.success) onEvent(parsed.data);
}

/** POST /live/artifacts: streams each step (ingest, extract, embed, refresh, diff), then done with what changed (or error). */
export function postLive(post: LivePost, onEvent: (event: LiveEvent) => void, adminToken?: string): Promise<void> {
  return streamPost("/live/artifacts", post, LiveEventSchema, onEvent, undefined, adminHeaders(adminToken));
}

/** POST /agent/ask: streams classified, memory, tool_call, tool_result, answer_delta and done (or error). */
export function askAgent(request: AskRequest, onEvent: (event: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
  return streamPost("/agent/ask", { ...request, userId: request.userId ?? userId() }, AgentEventSchema, onEvent, signal);
}

const USER_ID_KEY = "keystone.userId";
let memoryUserId: string | null = null;

/**
 * This browser's anonymous user id, sent with questions and feedback so the API
 * keeps each person's chats apart. Kept in localStorage; when that is unavailable
 * (private mode, blocked storage) it lasts for this page only.
 */
export function userId(): string {
  if (memoryUserId) return memoryUserId;
  try {
    memoryUserId = window.localStorage.getItem(USER_ID_KEY);
    if (!memoryUserId) {
      memoryUserId = crypto.randomUUID();
      window.localStorage.setItem(USER_ID_KEY, memoryUserId);
    }
  } catch {
    memoryUserId = memoryUserId ?? crypto.randomUUID();
  }
  return memoryUserId;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
