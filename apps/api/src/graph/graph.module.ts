import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { falkorSettingsFromEnv } from './falkor-settings';
import { EMBED_DIM, FALKOR_SETTINGS, type FalkorSettings } from './graph.constants';
import { GraphService } from './graph.service';
import { SchemaService } from './schema.service';

/**
 * Provides the single GraphService (one FalkorDB connection) and SchemaService
 * to the whole app. Global so feature modules can inject them without re-importing.
 */
@Global()
@Module({
  providers: [
    {
      provide: FALKOR_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): FalkorSettings =>
        falkorSettingsFromEnv({
          FALKOR_HOST: config.get('FALKOR_HOST', { infer: true }),
          FALKOR_PORT: config.get('FALKOR_PORT', { infer: true }),
          FALKOR_PASSWORD: config.get('FALKOR_PASSWORD', { infer: true }),
          MEMORY_WARN_MB: config.get('MEMORY_WARN_MB', { infer: true }),
          MEMORY_MAX_MB: config.get('MEMORY_MAX_MB', { infer: true }),
        }),
    },
    {
      provide: EMBED_DIM,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): number => config.get('EMBED_DIM', { infer: true }),
    },
    GraphService,
    SchemaService,
  ],
  exports: [GraphService, SchemaService],
})
export class GraphModule {}
