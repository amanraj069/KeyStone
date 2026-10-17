import OpenAI from 'openai';
import type { ReasoningEffort } from '../../llm/llm.types';
import { isReasoningModel } from '../../llm/openai.provider';
import type { AgentMessage, AgentModel, ModelTurn, ToolCall, ToolSpec } from '../agent.types';
import { toOpenAiTools } from '../tool-specs';

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** OpenAI Chat Completions with function calling. */
export class OpenAiAgentModel implements AgentModel {
  readonly provider = 'openai';
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    readonly model: string,
    private readonly reasoningEffort: ReasoningEffort,
    client?: OpenAI,
  ) {
    this.client = client ?? new OpenAI({ apiKey, maxRetries: 1, timeout: 60_000 });
  }

  async step(input: { system: string; messages: AgentMessage[]; tools: ToolSpec[]; allowTools: boolean; signal?: AbortSignal }): Promise<ModelTurn> {
    const completion = await this.client.chat.completions.create(
      {
        model: this.model,
        ...(isReasoningModel(this.model) ? { reasoning_effort: this.reasoningEffort } : {}),
        messages: [{ role: 'system', content: input.system }, ...input.messages.map(toOpenAi)],
        // With allowTools false the tools stay listed (earlier turns refer to them) but cannot be called.
        ...(input.tools.length > 0 ? { tools: toOpenAiTools(input.tools), tool_choice: input.allowTools ? 'auto' : 'none' } : {}),
      },
      { signal: input.signal },
    );
    const message = completion.choices[0]?.message;
    const toolCalls: ToolCall[] = (message?.tool_calls ?? []).flatMap((call) =>
      call.type === 'function' ? [{ id: call.id, name: call.function.name, args: parseArgs(call.function.arguments) }] : [],
    );
    const usage = completion.usage;
    return {
      text: message?.content ?? null,
      toolCalls,
      usage: {
        inputTokens: usage?.prompt_tokens ?? 0,
        cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
        reasoningTokens: usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      },
    };
  }
}

function toOpenAi(message: AgentMessage): ChatMessage {
  if (message.role === 'user') return { role: 'user', content: message.text };
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.callId, content: message.content };
  return {
    role: 'assistant',
    content: message.text,
    ...(message.toolCalls.length > 0
      ? {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: JSON.stringify(call.args) },
          })),
        }
      : {}),
  };
}

/** Tool arguments arrive as a JSON string; a malformed one becomes {} and the MCP schema check reports it. */
function parseArgs(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
