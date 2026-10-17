/**
 * Smoke check for the Keystone MCP server with a real MCP client:
 *
 *   pnpm mcp:check            Streamable HTTP at API_BASE_URL/mcp (the API must be running)
 *   pnpm mcp:check --stdio    spawns the stdio server (pnpm --silent mcp:stdio)
 *
 * Lists the tools and calls a few read tools on apex, printing a short summary of each envelope.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { findRepoRoot } from '../src/config/repo-root';

const CALLS: [string, Record<string, unknown>][] = [
  ['list_systems', {}],
  ['who_knows', { system: 'TitanDB' }],
  ['who_knows', { system: 'Titan-DB2' }],
  ['bus_factor', {}],
  ['bridge_people', {}],
  ['trace_decision', { system: 'Kafka' }],
  ['find_stale_docs', {}],
  ['search_knowledge', { question: 'Why did we change the cost tagging approach?', k: 3 }],
  ['simulate_departure', { person: 'Jax' }],
];

async function main(): Promise<void> {
  loadDotenv({ path: join(findRepoRoot(), '.env'), quiet: true });
  const stdio = process.argv.includes('--stdio');
  const transport = stdio
    ? new StdioClientTransport({ command: 'pnpm', args: ['--silent', 'mcp:stdio'], cwd: join(findRepoRoot(), 'apps/api'), stderr: 'ignore' })
    : new StreamableHTTPClientTransport(new URL('/mcp', process.env.API_BASE_URL ?? 'http://localhost:4000'));
  const client = new Client({ name: 'keystone-mcp-check', version: '0.1.0' });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    console.log(`${stdio ? 'stdio' : 'Streamable HTTP'}: ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}\n`);
    for (const [name, args] of CALLS) {
      const started = performance.now();
      const result = await client.callTool({ name, arguments: args });
      const text = (result.content as { text: string }[])[0].text;
      const envelope = JSON.parse(text) as { data: unknown; evidence: string[]; graphPath?: { nodes: unknown[] } };
      console.log(
        `${name}(${JSON.stringify(args)}) ${Math.round(performance.now() - started)} ms${result.isError ? ' ERROR' : ''}: ` +
          `${envelope.evidence.length} evidence ids, graphPath ${envelope.graphPath ? envelope.graphPath.nodes.length + ' nodes' : 'none'}, ` +
          `${text.length} chars\n  ${JSON.stringify(envelope.data).slice(0, 230)}`,
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((error: unknown) => {
  console.error('MCP check failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
