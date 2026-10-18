import { Controller, Get } from '@nestjs/common';
import { QUERIES, type QueryEntry, TOOL_QUERIES } from './tool-queries';

/**
 * GET /queries: the Cypher behind every MCP tool, as the code runs it, so the Ask
 * page can show what each step of an answer did in FalkorDB ("Show Cypher").
 */
@Controller('queries')
export class QueriesController {
  @Get()
  list(): { tools: Record<string, string[]>; queries: Record<string, QueryEntry> } {
    return { tools: TOOL_QUERIES, queries: QUERIES };
  }
}
