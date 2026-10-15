import { Controller, Get, Query } from '@nestjs/common';
import { type SearchResponse, SearchQuerySchema } from '@keystone/shared';
import { APEX_GRAPH } from '../graph/graph.constants';
import { RetrievalService } from './retrieval.service';

/**
 * GET /search?q=&k=[&asOfDay=]   hybrid: vector index + graph context
 * GET /search/vector-only?q=&k=  baseline: vector index only (for benchmarks)
 * Query strings are validated with Zod; a bad one becomes a 400 ApiError.
 */
@Controller('search')
export class SearchController {
  constructor(private readonly retrieval: RetrievalService) {}

  @Get()
  search(@Query() query: unknown): Promise<SearchResponse> {
    return this.retrieval.search(APEX_GRAPH, SearchQuerySchema.parse(query));
  }

  @Get('vector-only')
  vectorOnly(@Query() query: unknown): Promise<SearchResponse> {
    return this.retrieval.vectorOnlySearch(APEX_GRAPH, SearchQuerySchema.parse(query));
  }
}
