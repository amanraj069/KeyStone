/**
 * The Keystone MCP server over stdio, for desktop clients (Claude Desktop, the MCP
 * Inspector): `pnpm --silent mcp:stdio`. It starts a Nest application context (no
 * HTTP server) with the same services the API uses, and speaks MCP on stdin/stdout.
 * stdout carries protocol messages only, so every log line goes to stderr.
 * It runs compiled (node dist/mcp/stdio.js): Nest's dependency injection needs the
 * decorator metadata that tsc emits and tsx (esbuild) does not.
 */
import 'reflect-metadata';
import { ConsoleLogger, type LogLevel, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AppConfigModule } from '../config/app-config.module';
import { GraphModule } from '../graph/graph.module';
import { TextStoreModule } from '../ingest/text-store.module';
import { LlmModule } from '../llm/llm.module';
import { createKeystoneMcpServer, type KeystoneServices } from './keystone-mcp-server';
import { KEYSTONE_SERVICES, McpServicesModule } from './mcp-services.module';

/** Nest's console logger, but every level written to stderr. */
class StderrLogger extends ConsoleLogger {
  protected override printMessages(messages: unknown[], context?: string, logLevel?: LogLevel, _stream?: 'stdout' | 'stderr', errorStack?: unknown): void {
    super.printMessages(messages, context, logLevel, 'stderr', errorStack);
  }
}

/** Only what the tools need: config, FalkorDB, the LLM (query embeddings), the TextStore and the services. */
@Module({ imports: [AppConfigModule, GraphModule, LlmModule, TextStoreModule, McpServicesModule] })
class McpStdioModule {}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(McpStdioModule, {
    logger: new StderrLogger('Keystone MCP', { logLevels: ['log', 'warn', 'error'] }),
  });
  app.enableShutdownHooks();
  const server = createKeystoneMcpServer(app.get<KeystoneServices>(KEYSTONE_SERVICES));
  const transport = new StdioServerTransport();
  // The client closing stdin is the end of the session: close FalkorDB and exit.
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close().catch(() => undefined);
    await app.close();
    process.exit(0);
  };
  transport.onclose = () => void shutdown();
  process.stdin.on('end', () => void shutdown());
  process.stdin.on('close', () => void shutdown());
  await server.connect(transport);
}

main().catch((error: unknown) => {
  process.stderr.write(`Keystone MCP (stdio) failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
