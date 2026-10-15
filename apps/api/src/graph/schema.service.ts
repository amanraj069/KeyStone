import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { APEX_GRAPH, EMBED_DIM } from './graph.constants';
import { GraphService } from './graph.service';
import { schemaStatements } from './queries/schema.queries';

/** What ensureSchema did, for logs and tests. */
export interface SchemaResult {
  created: number;
  alreadyExisted: number;
}

/**
 * FalkorDB says "Attribute 'x' is already indexed" when an index exists.
 * That is the only error ensureSchema may ignore.
 */
export function isIndexAlreadyExistsError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /already indexed|already exists/i.test(message);
}

/** Creates the indexes every Keystone graph needs (schema.queries.ts). */
@Injectable()
export class SchemaService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchemaService.name);

  constructor(
    private readonly graph: GraphService,
    @Inject(EMBED_DIM) private readonly embedDim: number,
  ) {}

  /**
   * At startup, make sure "apex" exists and has its indexes. Creating an index
   * on a graph that does not exist yet creates the graph. Runs in the background
   * after the first FalkorDB connection, so a slow database never blocks startup.
   */
  onApplicationBootstrap(): void {
    void this.graph
      .whenConnected()
      .then(() => this.ensureSchema(APEX_GRAPH))
      .catch((error: unknown) => this.logger.error(`ensureSchema(${APEX_GRAPH}) failed: ${String(error)}`));
  }

  /** Runs every schema statement; "already indexed" is fine, any other error is thrown. */
  async ensureSchema(graphName: string): Promise<SchemaResult> {
    const result: SchemaResult = { created: 0, alreadyExisted: 0 };
    for (const statement of schemaStatements(this.embedDim)) {
      try {
        await this.graph.query(graphName, statement);
        result.created++;
      } catch (error) {
        if (!isIndexAlreadyExistsError(error)) throw error;
        result.alreadyExisted++;
      }
    }
    this.logger.log(`Schema for "${graphName}": ${result.created} indexes created, ${result.alreadyExisted} already existed`);
    return result;
  }
}
