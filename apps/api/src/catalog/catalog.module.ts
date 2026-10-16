import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { CATALOG_SETTINGS, CORE_MIN_AUTHORS, type CatalogSettings } from './catalog.constants';
import { CatalogService } from './catalog.service';

/** System statistics, core flag, idf and duplicate merging. */
@Module({
  providers: [
    {
      provide: CATALOG_SETTINGS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): CatalogSettings => ({
        coreMinMentions: config.get('CORE_MIN_MENTIONS', { infer: true }),
        coreMinAuthors: CORE_MIN_AUTHORS,
      }),
    },
    CatalogService,
  ],
  exports: [CatalogService],
})
export class CatalogModule {}
