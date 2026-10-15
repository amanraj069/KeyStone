import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { FALKOR_SETTINGS, type FalkorSettings } from './graph.constants';
import { GraphService } from './graph.service';

/**
 * Provides the single GraphService (one FalkorDB connection) to the whole app.
 * Global so feature modules can inject GraphService without re-importing this.
 */
@Global()
@Module({
  providers: [
    {
      provide: FALKOR_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): FalkorSettings => ({
        host: config.get('FALKOR_HOST', { infer: true }),
        port: config.get('FALKOR_PORT', { infer: true }),
        password: config.get('FALKOR_PASSWORD', { infer: true }),
      }),
    },
    GraphService,
  ],
  exports: [GraphService],
})
export class GraphModule {}
