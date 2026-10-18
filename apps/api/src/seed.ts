import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { GraphLock } from './backup/graph-lock';
import { GraphService } from './graph/graph.service';
import { SchemaService } from './graph/schema.service';
import { withTimeout } from './health/with-timeout';
import { SeedCliModule } from './seed-cli.module';
import { WAIT_POLL_MS } from './seed/seed.constants';
import { type SeedResult, SeedCacheMissError, SeedService } from './seed/seed.service';

/**
 * pnpm seed           rebuild apex from files if it is missing or has no people
 * pnpm seed --force   rebuild apex from files even if it has data
 *
 * Zero LLM or embedding API calls: a missing cache entry ends the seed with the list
 * of missing ids (exit code 1). Runs compiled (node dist/seed.js), like the worker:
 * Nest's dependency injection needs decorator metadata, which tsx does not emit.
 * If the API is already seeding (startup auto-seed), this waits for it to finish.
 */
const CONNECT_TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  const logger = new Logger('Seed');
  const app = await NestFactory.createApplicationContext(SeedCliModule, { logger: ['log', 'warn', 'error'] });
  app.enableShutdownHooks();
  let exitCode = 0;
  try {
    await withTimeout(app.get(GraphService).whenConnected(), CONNECT_TIMEOUT_MS);
    // SchemaService checks apex's indexes at startup; let it finish before we start (or exit).
    await app.get(SchemaService).whenBootstrapped();
    const lock = app.get(GraphLock);
    for (let holder = await lock.holder(); holder; holder = await lock.holder()) {
      logger.log(`Waiting: a ${holder.op} started by ${holder.owner} is running`);
      await new Promise((resolve) => setTimeout(resolve, WAIT_POLL_MS));
    }
    const seed = app.get(SeedService);
    const result: SeedResult = process.argv.includes('--force') ? await seed.seed() : await seed.seedIfMissing();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    exitCode = 1;
    if (error instanceof SeedCacheMissError) {
      console.error(`\nSeed failed: ${error.missing.length} cache entries are missing. No API call was made.`);
      console.error('Rebuild them where API keys are available (pnpm extract, pnpm extract --relink-stale, pnpm embed),');
      console.error('then copy data/cache and data/llm-cache to this machine again. Missing:');
      for (const id of error.missing) console.error(`  ${id}`);
    } else {
      console.error(`\nSeed failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    await app.close();
  }
  process.exit(exitCode);
}

void main();
