import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { GraphModule } from './graph/graph.module';
import { TextStoreModule } from './ingest/text-store.module';
import { LlmModule } from './llm/llm.module';
import { SeedModule } from './seed/seed.module';

/** What `pnpm seed` needs: config, FalkorDB, the TextStore, LLM settings (for cache keys) and the seed. No HTTP. */
@Module({
  imports: [AppConfigModule, GraphModule, LlmModule, TextStoreModule, SeedModule],
})
export class SeedCliModule {}
