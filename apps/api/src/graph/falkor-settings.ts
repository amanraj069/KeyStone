import type { Env } from '../config/env.schema';
import type { FalkorSettings } from './graph.constants';

/** The env fields GraphService needs. */
export type FalkorEnv = Pick<Env, 'FALKOR_HOST' | 'FALKOR_PORT' | 'FALKOR_PASSWORD' | 'MEMORY_WARN_MB' | 'MEMORY_MAX_MB'>;

/** The GraphService settings from validated env. Used by GraphModule, tests and scripts alike. */
export function falkorSettingsFromEnv(env: FalkorEnv): FalkorSettings {
  return {
    host: env.FALKOR_HOST,
    port: env.FALKOR_PORT,
    password: env.FALKOR_PASSWORD,
    memoryWarnMb: env.MEMORY_WARN_MB,
    memoryMaxMb: env.MEMORY_MAX_MB,
  };
}
