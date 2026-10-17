import { Module } from '@nestjs/common';
import { ActionsModule } from '../actions/actions.module';
import { ActionsService } from '../actions/actions.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { ArtifactsModule } from '../artifacts/artifacts.module';
import { ArtifactsService } from '../artifacts/artifacts.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { RetrievalService } from '../retrieval/retrieval.service';
import { WhatIfModule } from '../whatif/whatif.module';
import { WhatIfService } from '../whatif/whatif.service';
import type { KeystoneServices } from './keystone-mcp-server';

/** Injection token for the services the MCP tools call. */
export const KEYSTONE_SERVICES = Symbol('KEYSTONE_SERVICES');

/** The Nest services behind the MCP tools, shared by the HTTP (/mcp) and stdio transports. */
@Module({
  imports: [AnalyticsModule, RetrievalModule, WhatIfModule, ActionsModule, ArtifactsModule],
  providers: [
    {
      provide: KEYSTONE_SERVICES,
      inject: [AnalyticsService, RetrievalService, WhatIfService, ActionsService, ArtifactsService],
      useFactory: (
        analytics: AnalyticsService,
        retrieval: RetrievalService,
        whatIf: WhatIfService,
        actions: ActionsService,
        artifacts: ArtifactsService,
      ): KeystoneServices => ({
        analytics,
        retrieval,
        whatIf,
        artifacts,
        // Only the proposing methods: approve and reject stay out of the MCP layer.
        actions: {
          draftHandover: (person) => actions.draftHandover(person),
          proposeReassignment: (ticketId, person, reason) => actions.proposeReassignment(ticketId, person, reason),
          createRunbookTask: (system) => actions.createRunbookTask(system),
        },
      }),
    },
  ],
  exports: [KEYSTONE_SERVICES],
})
export class McpServicesModule {}
