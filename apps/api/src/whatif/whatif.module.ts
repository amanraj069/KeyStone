import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PROJECTION_GRAPH } from '../analytics/analytics.constants';
import type { Env } from '../config/env.schema';
import { APEX_GRAPH } from '../graph/graph.constants';
import { ProjectionModule } from '../projection/projection.module';
import { SCRATCH_PREFIX, WHATIF_SETTINGS, type WhatIfSettings } from './whatif.constants';
import { WhatIfController } from './whatif.controller';
import { WhatIfService } from './whatif.service';

/** Departure simulations on scratch copies of apex_proj (Stage 8). */
@Module({
  imports: [AnalyticsModule, ProjectionModule],
  controllers: [WhatIfController],
  providers: [
    {
      provide: WHATIF_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): WhatIfSettings => ({
        maxConcurrent: config.get('WHATIF_MAX_CONCURRENT', { infer: true }),
        sourceGraph: APEX_GRAPH,
        projectionGraph: PROJECTION_GRAPH,
        scratchPrefix: SCRATCH_PREFIX,
      }),
    },
    WhatIfService,
  ],
  exports: [WhatIfService],
})
export class WhatIfModule {}
