import { Controller, Get, Query } from '@nestjs/common';
import {
  type AnalyticsSummary,
  AnalyticsService,
  type Bridge,
  type BusFactorRow,
  type StaleDoc,
} from './analytics.service';
import { projectionGraphFor } from './analytics.constants';
import { DashboardQuerySchema } from './analytics.schemas';

/**
 * GET /analytics/bus-factor?minScore=&graph=  K4 on the graph's projection (apex -> apex_proj) with riskLevel
 * GET /analytics/bridges?graph=        K8b betweenness on COLLAB (the graph's projection), top 10
 * GET /analytics/stale-docs            K10b
 * GET /analytics/summary?minScore=&graph=     dashboard counts, the graph's latest day, memory report
 * graph defaults to apex; a replay graph (apex_replay) shows the company as it grows day by day.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('bus-factor')
  busFactor(@Query() query: unknown): Promise<BusFactorRow[]> {
    const { minScore, graph } = DashboardQuerySchema.parse(query);
    return this.analytics.busFactor(minScore, projectionGraphFor(graph));
  }

  @Get('bridges')
  bridges(@Query() query: unknown): Promise<Bridge[]> {
    const { graph } = DashboardQuerySchema.parse(query);
    return this.analytics.bridges(projectionGraphFor(graph), graph);
  }

  @Get('stale-docs')
  staleDocs(): Promise<StaleDoc[]> {
    return this.analytics.staleDocs();
  }

  @Get('summary')
  summary(@Query() query: unknown): Promise<AnalyticsSummary> {
    const { minScore, graph } = DashboardQuerySchema.parse(query);
    return this.analytics.summary(minScore, graph, projectionGraphFor(graph));
  }
}
