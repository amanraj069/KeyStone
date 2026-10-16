import { Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService, type DepartureImpact } from './analytics.service';
import { MinScoreQuerySchema, NameParamSchema } from './analytics.schemas';

/** GET /people/:name/departure-impact?minScore=  K5 + K6 + K7 in one response */
@Controller('people')
export class PeopleController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get(':name/departure-impact')
  departureImpact(@Param('name') name: string, @Query() query: unknown): Promise<DepartureImpact> {
    const { minScore } = MinScoreQuerySchema.parse(query);
    return this.analytics.departureImpact(NameParamSchema.parse(name), minScore);
  }
}
