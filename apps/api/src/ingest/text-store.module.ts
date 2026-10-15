import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { TEXT_STORE } from './ingest.constants';
import { LocalTextStore, type TextStore } from './text-store';

/** Provides the TextStore (artifact bodies, chunk text) to ingestion and extraction. */
@Global()
@Module({
  providers: [
    {
      provide: TEXT_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): TextStore => {
        if (config.get('TEXT_STORE', { infer: true }) === 's3') {
          throw new Error('TEXT_STORE=s3 is not implemented yet; use TEXT_STORE=local');
        }
        return new LocalTextStore(config.get('DATA_DIR', { infer: true }));
      },
    },
  ],
  exports: [TEXT_STORE],
})
export class TextStoreModule {}
