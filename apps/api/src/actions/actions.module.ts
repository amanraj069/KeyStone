import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PROJECTION_GRAPH } from '../analytics/analytics.constants';
import { APEX_GRAPH } from '../graph/graph.constants';
import { WhatIfModule } from '../whatif/whatif.module';
import { ACTIONS_SETTINGS, type ActionsSettings } from './actions.constants';
import { ActionsController } from './actions.controller';
import { ActionsService } from './actions.service';

/** Proposed actions (reassign, runbook, review_doc, handover) and their approval (Stage 11). */
@Module({
  imports: [AnalyticsModule, WhatIfModule],
  controllers: [ActionsController],
  providers: [
    { provide: ACTIONS_SETTINGS, useValue: { graph: APEX_GRAPH, projectionGraph: PROJECTION_GRAPH } satisfies ActionsSettings },
    ActionsService,
  ],
  exports: [ActionsService],
})
export class ActionsModule {}
