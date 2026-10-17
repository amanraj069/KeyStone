import { Logger } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { AgentTools, ToolEnvelope, ToolSpec } from './agent.types';

/**
 * The agent's tools, read from the Keystone MCP server: listed once (the first
 * time they are needed, then kept), and called through the same MCP client. The
 * tool definitions exist only in the MCP server; nothing here repeats them.
 */
export class McpToolClient implements AgentTools {
  private readonly logger = new Logger(McpToolClient.name);
  private ready: Promise<{ client: Client; tools: ToolSpec[] }> | null = null;

  /** `connectTransport` makes the transport: Streamable HTTP to /mcp in the app, in-memory in tests. */
  constructor(private readonly connectTransport: () => Transport) {}

  async list(): Promise<ToolSpec[]> {
    return (await this.connection()).tools;
  }

  async call(name: string, args: Record<string, unknown>): Promise<{ envelope: ToolEnvelope; isError: boolean }> {
    const { client } = await this.connection();
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text?: string }[]).find((c) => c.type === 'text')?.text ?? '';
    return { envelope: parseEnvelope(text), isError: result.isError === true };
  }

  async close(): Promise<void> {
    if (this.ready) await (await this.ready.catch(() => null))?.client.close();
    this.ready = null;
  }

  /** Connects and lists the tools once; a failed attempt is forgotten so the next call retries. */
  private connection(): Promise<{ client: Client; tools: ToolSpec[] }> {
    this.ready ??= (async () => {
      const client = new Client({ name: 'keystone-agent', version: '0.1.0' });
      await client.connect(this.connectTransport());
      const { tools } = await client.listTools();
      this.logger.log(`MCP tools: ${tools.map((t) => t.name).join(', ')}`);
      return {
        client,
        tools: tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema as Record<string, unknown> })),
      };
    })().catch((error: unknown) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }
}

/** A tool's text block as the envelope; text that is not one (or not JSON) becomes an error envelope. */
export function parseEnvelope(text: string): ToolEnvelope {
  try {
    const value = JSON.parse(text) as Partial<ToolEnvelope>;
    if (value && typeof value === 'object' && Array.isArray(value.evidence)) {
      return { data: value.data ?? null, evidence: value.evidence, ...(value.graphPath ? { graphPath: value.graphPath } : {}), ...(value.error ? { error: value.error } : {}) };
    }
  } catch {
    // MCP errors raised before the tool runs (e.g. invalid arguments) are plain text.
  }
  return { data: null, evidence: [], error: text || 'empty tool result' };
}
