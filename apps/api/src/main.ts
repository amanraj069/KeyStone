import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { Env } from './config/env.schema';

/** 4000, because the FalkorDB Browser already uses 3000 and the web app 3001. */
const API_PORT = 4000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // Only the Keystone web app may call this API from a browser.
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }) });

  // Runs onModuleDestroy (closes FalkorDB and Redis) on Ctrl+C / docker stop.
  app.enableShutdownHooks();

  await app.listen(API_PORT);
  new Logger('Bootstrap').log(`Keystone API listening on http://localhost:${API_PORT}`);
}

void bootstrap();
