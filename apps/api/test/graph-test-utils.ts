import { randomBytes } from 'node:crypto';
import { validateEnv } from '../src/config/env.schema';
import { GraphService } from '../src/graph/graph.service';

/** Graph names for tests always start with "test_" (see AGENTS.md section 5). */
export function testGraphName(): string {
  return `test_${randomBytes(4).toString('hex')}`;
}

/** A connected GraphService built from the same env vars the API uses. */
export async function connectTestGraphService(): Promise<GraphService> {
  const env = validateEnv(process.env);
  const service = new GraphService({ host: env.FALKOR_HOST, port: env.FALKOR_PORT, password: env.FALKOR_PASSWORD });
  await service.connect(3);
  return service;
}
