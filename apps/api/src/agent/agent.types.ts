import type { QuestionLabel } from './agent.constants';

/** A tool as the MCP server lists it: name, description and JSON Schema of its input. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  /** Provider call id (OpenAI) or a generated one (Gemini), echoed back with the result. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** The conversation in a provider-neutral form; each model adapter maps it to its own API. */
export type AgentMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string | null; toolCalls: ToolCall[]; raw?: unknown }
  | { role: 'tool'; callId: string; name: string; content: string };

export interface ModelTurn {
  text: string | null;
  toolCalls: ToolCall[];
  /** The provider's own message, so it can be sent back unchanged (e.g. Gemini thought signatures). */
  raw?: unknown;
}

/** A chat model with function calling (OpenAI or Gemini). */
export interface AgentModel {
  readonly provider: string;
  readonly model: string;
  /** One model call. With allowTools false the model must answer in text. */
  step(input: { system: string; messages: AgentMessage[]; tools: ToolSpec[]; allowTools: boolean; signal?: AbortSignal }): Promise<ModelTurn>;
}

/** The tool envelope every Keystone MCP tool returns. */
export interface ToolEnvelope {
  data: unknown;
  evidence: string[];
  graphPath?: GraphPath;
  error?: string;
}

export interface GraphPath {
  nodes: unknown[];
  edges: unknown[];
}

/** The tools the agent can call (an MCP client in the app; a fake in tests). */
export interface AgentTools {
  list(): Promise<ToolSpec[]>;
  call(name: string, args: Record<string, unknown>): Promise<{ envelope: ToolEnvelope; isError: boolean }>;
}

export interface Citation {
  id: string;
  title: string | null;
  type: string | null;
  day: number | null;
}

/** The events POST /agent/ask streams (Server-Sent Events). */
export type AgentEvent =
  | { type: 'classified'; label: QuestionLabel }
  | { type: 'tool_call'; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; name: string; summary: string; evidenceCount: number; graphPath: GraphPath | null }
  | { type: 'answer_delta'; text: string }
  | { type: 'done'; citations: Citation[]; graphPath: GraphPath; timings: Record<string, number> }
  | { type: 'error'; message: string };
