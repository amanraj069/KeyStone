import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
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
  imports: [AnalyticsModule, RetrievalModule, WhatIfModule],
  providers: [
    {
      provide: KEYSTONE_SERVICES,
      inject: [AnalyticsService, RetrievalService, WhatIfService],
      useFactory: (analytics: AnalyticsService, retrieval: RetrievalService, whatIf: WhatIfService): KeystoneServices => ({
        analytics,
        retrieval,
        whatIf,
      }),
    },
  ],
  exports: [KEYSTONE_SERVICES],
})
export class McpServicesModule {}
