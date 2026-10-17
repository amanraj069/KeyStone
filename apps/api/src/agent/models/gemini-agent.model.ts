// The SDK ships ESM type declarations: imported as types only, loaded with import() (see gemini.provider.ts).
import type { Content, GoogleGenAI, Part } from '@google/genai' with { 'resolution-mode': 'import' };
import { randomUUID } from 'node:crypto';
import type { AgentMessage, AgentModel, ModelTurn, ToolSpec } from '../agent.types';
import { toGeminiDeclarations } from '../tool-specs';

/** Gemini generateContent with function calling. Keys rotate per call, like GeminiProvider. */
export class GeminiAgentModel implements AgentModel {
  readonly provider = 'gemini';
  private clients: Pick<GoogleGenAI, 'models'>[] | null;
  private next = 0;

  constructor(
    private readonly apiKeys: string[],
    readonly model: string,
    clients?: Pick<GoogleGenAI, 'models'>[],
  ) {
    this.clients = clients ?? null;
  }

  async step(input: { system: string; messages: AgentMessage[]; tools: ToolSpec[]; allowTools: boolean; signal?: AbortSignal }): Promise<ModelTurn> {
    const response = await (await this.client()).models.generateContent({
      model: this.model,
      contents: toContents(input.messages),
      config: {
        systemInstruction: input.system,
        abortSignal: input.signal,
        ...(input.tools.length > 0
          ? {
              tools: [{ functionDeclarations: toGeminiDeclarations(input.tools) }],
              // With allowTools false the declarations stay (earlier turns refer to them) but cannot be called.
              toolConfig: { functionCallingConfig: { mode: (input.allowTools ? 'AUTO' : 'NONE') as never } },
            }
          : {}),
      },
    });
    const calls = response.functionCalls ?? [];
    return {
      text: calls.length > 0 ? null : (response.text ?? null),
      toolCalls: calls.map((call) => ({ id: call.id ?? randomUUID(), name: call.name ?? '', args: call.args ?? {} })),
      // Sent back as is in the next turn: Gemini 2.5 keeps its reasoning in thought signatures on these parts.
      raw: response.candidates?.[0]?.content,
    };
  }

  private async client(): Promise<Pick<GoogleGenAI, 'models'>> {
    if (!this.clients) {
      const { GoogleGenAI: Client } = await import('@google/genai');
      this.clients = this.apiKeys.map((apiKey) => new Client({ apiKey }));
    }
    if (this.clients.length === 0) throw new Error('GEMINI_API_KEYS is empty');
    return this.clients[this.next++ % this.clients.length];
  }
}

/** Neutral messages -> Gemini contents; consecutive tool results go into one user turn. */
function toContents(messages: AgentMessage[]): Content[] {
  const contents: Content[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.text }] });
    } else if (message.role === 'assistant') {
      const raw = message.raw as Content | undefined;
      const parts: Part[] = [
        ...(message.text ? [{ text: message.text }] : []),
        ...message.toolCalls.map((call) => ({ functionCall: { id: call.id, name: call.name, args: call.args } })),
      ];
      contents.push(raw?.parts?.length ? { role: 'model', parts: raw.parts } : { role: 'model', parts });
    } else {
      const part: Part = { functionResponse: { id: message.callId, name: message.name, response: { result: message.content } } };
      const last = contents.at(-1);
      if (last?.role === 'user' && last.parts?.every((p) => p.functionResponse)) last.parts.push(part);
      else contents.push({ role: 'user', parts: [part] });
    }
  }
  return contents;
}
