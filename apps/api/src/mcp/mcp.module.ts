import { Module } from '@nestjs/common';
import { McpController } from './mcp.controller';
import { McpServicesModule } from './mcp-services.module';

/** The Keystone MCP server at /mcp (Streamable HTTP, stateless). The stdio entry is stdio.ts. */
@Module({
  imports: [McpServicesModule],
  controllers: [McpController],
})
export class McpModule {}
