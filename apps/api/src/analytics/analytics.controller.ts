import { Controller, Get, Query } from '@nestjs/common';
import {
  type AnalyticsSummary,
  AnalyticsService,
  type Bridge,
  type BusFactorRow,
  type StaleDoc,
} from './analytics.service';
import { MinScoreQuerySchema } from './analytics.schemas';

/**
 * GET /analytics/bus-factor?minScore=  K4 on apex_proj with riskLevel
 * GET /analytics/bridges               K8b betweenness on COLLAB (apex_proj), top 10
 * GET /analytics/stale-docs            K10b
 * GET /analytics/summary?minScore=     dashboard counts + memory report
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('bus-factor')
  busFactor(@Query() query: unknown): Promise<BusFactorRow[]> {
    return this.analytics.busFactor(MinScoreQuerySchema.parse(query).minScore);
  }

  @Get('bridges')
  bridges(): Promise<Bridge[]> {
    return this.analytics.bridges();
  }

  @Get('stale-docs')
  staleDocs(): Promise<StaleDoc[]> {
    return this.analytics.staleDocs();
  }

  @Get('summary')
  summary(@Query() query: unknown): Promise<AnalyticsSummary> {
    return this.analytics.summary(MinScoreQuerySchema.parse(query).minScore);
  }
}
