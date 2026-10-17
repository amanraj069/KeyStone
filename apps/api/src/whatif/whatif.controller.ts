import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { type DepartureCandidate, type DepartureSimulation, WhatIfService } from './whatif.service';

const DepartureRequestSchema = z.object({ person: z.string().trim().min(1).max(200) });

/**
 * POST /whatif/departure { person }  simulate one departure on a scratch copy of apex_proj
 * GET  /whatif/candidates            the 10 people whose departure orphans the most systems
 * GET  /whatif/subgraph?person=      the graph around a person before simulating (same node ids)
 */
@Controller('whatif')
export class WhatIfController {
  constructor(private readonly whatIf: WhatIfService) {}

  @Post('departure')
  @HttpCode(200)
  departure(@Body() body: unknown): Promise<DepartureSimulation> {
    return this.whatIf.simulateDeparture(DepartureRequestSchema.parse(body).person);
  }

  @Get('subgraph')
  subgraph(@Query() query: unknown): ReturnType<WhatIfService['beforeGraph']> {
    return this.whatIf.beforeGraph(DepartureRequestSchema.parse(query).person);
  }

  @Get('candidates')
  candidates(): Promise<DepartureCandidate[]> {
    return this.whatIf.departureCandidates();
  }
}
