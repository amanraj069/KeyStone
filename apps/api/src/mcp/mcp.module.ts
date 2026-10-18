import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpServicesModule } from './mcp-services.module';
import { QueriesController } from './queries.controller';

/** The Keystone MCP server at /mcp (Streamable HTTP, stateless), and GET /queries: the Cypher behind each tool. The stdio entry is stdio.ts. */
@Module({
  imports: [McpServicesModule],
  controllers: [McpController, QueriesController],
})
export class McpModule {}
