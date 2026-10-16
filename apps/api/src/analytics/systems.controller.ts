import { Controller, Get, Param } from '@nestjs/common';
import { AnalyticsService, type DecisionTraceRow, type ExpertsResponse } from './analytics.service';
import { NameParamSchema } from './analytics.schemas';

/**
 * GET /systems/:name/experts    K3a experts + K3b evidence graph of the top one ({ nodes, edges })
 * GET /systems/:name/decisions  K10a decision trace, newest first
 */
@Controller('systems')
export class SystemsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get(':name/experts')
  experts(@Param('name') name: string): Promise<ExpertsResponse> {
    return this.analytics.experts(NameParamSchema.parse(name));
  }

  @Get(':name/decisions')
  decisions(@Param('name') name: string): Promise<DecisionTraceRow[]> {
    return this.analytics.decisions(NameParamSchema.parse(name));
  }
}
