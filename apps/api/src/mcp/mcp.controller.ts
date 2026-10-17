import { Controller, Delete, Get, Inject, Logger, Post, Req, Res } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { createKeystoneMcpServer, type KeystoneServices } from './keystone-mcp-server';
import { KEYSTONE_SERVICES } from './mcp-services.module';

/**
 * POST /mcp: the Keystone MCP server over Streamable HTTP, stateless: every
 * request gets a fresh server and transport (no sessions to keep or expire).
 * GET and DELETE are for session streams, which stateless mode does not have: 405.
 */
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(@Inject(KEYSTONE_SERVICES) private readonly services: KeystoneServices) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response): Promise<void> {
    const server = createKeystoneMcpServer(this.services);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      // Nest has already parsed the JSON body; hand it over instead of re-reading the stream.
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      this.logger.error(`MCP request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent) res.status(500).json(jsonRpcError(-32603, 'Internal server error'));
    }
  }

  @Get()
  stream(@Res() res: Response): void {
    res.status(405).json(jsonRpcError(-32000, 'Method not allowed: this MCP server is stateless (POST only).'));
  }

  @Delete()
  end(@Res() res: Response): void {
    res.status(405).json(jsonRpcError(-32000, 'Method not allowed: this MCP server is stateless (POST only).'));
  }
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null };
}
