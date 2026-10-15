import { ConfigModule } from '@nestjs/config';
import { join } from 'node:path';
import { validateEnv } from './env.schema';
import { findRepoRoot } from './repo-root';

/**
 * Validated configuration shared by the API (main.ts) and the worker (worker.ts):
 * one .env at the repo root, shared with docker compose. Real environment
 * variables win over the file (useful in production).
 */
export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: join(findRepoRoot(), '.env'),
  validate: validateEnv,
});
