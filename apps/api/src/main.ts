import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';
import { SeedService } from './seed/seed.service';

/**
 * 4000, so it stays clear of the web app (3000) and the FalkorDB Browser (3100).
 * API_PORT overrides it, e.g. to run a second API next to a running one.
 */
const API_PORT = Number(process.env.API_PORT ?? 4000);

async function bootstrap(): Promise<void> {
  // forceCloseConnections: on shutdown, also close open Server-Sent Event streams
  // (a browser's EventSource reconnects on the same socket, which would keep
  // server.close() waiting forever and hang every dev restart).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { forceCloseConnections: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // In production Caddy sits in front: take the visitor's address from its X-Forwarded-For
  // (one proxy hop), so the agent's rate limit counts visitors, not the proxy.
  app.set('trust proxy', 1);

  // Only the Keystone web app may call this API from a browser.
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }) });

  // Runs onModuleDestroy (closes FalkorDB and Redis) on Ctrl+C / docker stop.
  app.enableShutdownHooks();

  await app.listen(API_PORT);
  const logger = new Logger('Bootstrap');
  logger.log(`Keystone API listening on http://localhost:${API_PORT}`);

  // If apex is missing or empty: restore apex_backup, or else seed from files, in the
  // background (GET /health says "seeding" until it is done).
  void app
    .get(SeedService)
    .ensureGraphOnStartup()
    .catch((error: unknown) => logger.error(`Startup graph check failed: ${String(error)}`));
}

void bootstrap();
