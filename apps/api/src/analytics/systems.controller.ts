import { Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService, type DecisionTraceRow, type ExpertsResponse } from './analytics.service';
import { DashboardQuerySchema, NameParamSchema } from './analytics.schemas';

/**
 * GET /systems/:name/experts?graph=  K3a experts + K3b evidence graph of the top one ({ nodes, edges }); graph defaults to apex
 * GET /systems/:name/decisions  K10a decision trace, newest first
 * GET /systems                  systems with decisions (core, or with a replaced decision)
 */
@Controller('systems')
export class SystemsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  list(): ReturnType<AnalyticsService['systemsWithDecisions']> {
    return this.analytics.systemsWithDecisions();
  }

  @Get(':name/experts')
  experts(@Param('name') name: string, @Query() query: unknown): Promise<ExpertsResponse> {
    return this.analytics.experts(NameParamSchema.parse(name), DashboardQuerySchema.parse(query).graph);
  }

  @Get(':name/decisions')
  decisions(@Param('name') name: string): Promise<DecisionTraceRow[]> {
    return this.analytics.decisions(NameParamSchema.parse(name));
  }
}
