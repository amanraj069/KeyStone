import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { FalkorDB, type FalkorDBOptions, type Graph } from 'falkordb';
import type { MemoryReport } from '@keystone/shared';
import { backoffDelay, sleep } from './backoff';
import { FALKOR_SETTINGS, type FalkorSettings, SLOW_QUERY_MS } from './graph.constants';

/**
 * Parameter map for a Cypher query, e.g. { name: 'Ada' } for `$name`.
 * The falkordb package does not export this type, so we read it off Graph.query.
 */
export type QueryParams = NonNullable<NonNullable<Parameters<Graph['query']>[1]>['params']>;

/** The raw node-redis connection underneath the falkordb client. */
type RawConnection = Awaited<FalkorDB['connection']>;

/**
 * node-redis options that the falkordb client passes through to node-redis
 * but does not declare in its own FalkorDBOptions type.
 */
interface PassThroughOptions {
  /** Reject commands immediately while disconnected instead of queueing them. */
  disableOfflineQueue: boolean;
  socket: { reconnectStrategy: (retries: number, cause: Error) => number };
}

/**
 * The only way the API talks to FalkorDB.
 *
 * - Connects once at startup. If FalkorDB is not up yet it keeps retrying with
 *   exponential backoff in the background, so the API still starts and
 *   /health can report "down".
 * - If an established connection drops (e.g. the container restarts), the
 *   underlying node-redis client reconnects using the same backoff.
 * - Never logs the password.
 */
@Injectable()
export class GraphService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphService.name);
  private db: FalkorDB | null = null;
  private shuttingDown = false;

  constructor(@Inject(FALKOR_SETTINGS) private readonly settings: FalkorSettings) {}

  onModuleInit(): void {
    // Not awaited on purpose: a missing database must not block API startup.
    void this.connect().catch((error: unknown) => {
      this.logger.error(`Gave up connecting to FalkorDB: ${describeError(error)}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.logger.log('FalkorDB connection closed');
    }
  }

  /**
   * Opens the connection, retrying with exponential backoff.
   * The app retries forever; one-off scripts pass a small `maxAttempts`.
   */
  async connect(maxAttempts = Number.POSITIVE_INFINITY): Promise<void> {
    for (let attempt = 0; attempt < maxAttempts && !this.shuttingDown; attempt++) {
      try {
        this.db = await this.openConnection();
        this.logger.log(`Connected to FalkorDB at ${this.settings.host}:${this.settings.port}`);
        return;
      } catch (error) {
        const delay = backoffDelay(attempt);
        this.logger.warn(
          `FalkorDB connect attempt ${attempt + 1} failed (${describeError(error)}); retrying in ${delay} ms`,
        );
        await sleep(delay);
      }
    }
    throw new Error(`Could not connect to FalkorDB at ${this.settings.host}:${this.settings.port}`);
  }

  /** Runs a read-write Cypher query and returns its rows. */
  async query<T>(graphName: string, cypher: string, params: QueryParams = {}): Promise<T[]> {
    const graph = (await this.requireDb()).selectGraph(graphName);
    return this.timed('query', graphName, cypher, async () => (await graph.query<T>(cypher, { params })).data ?? []);
  }

  /** Runs a read-only Cypher query (GRAPH.RO_QUERY); FalkorDB rejects any write. */
  async roQuery<T>(graphName: string, cypher: string, params: QueryParams = {}): Promise<T[]> {
    const graph = (await this.requireDb()).selectGraph(graphName);
    return this.timed('roQuery', graphName, cypher, async () => (await graph.roQuery<T>(cypher, { params })).data ?? []);
  }

  /** GRAPH.COPY: duplicates `src` into a new graph `dst` inside FalkorDB. */
  async copyGraph(src: string, dst: string): Promise<void> {
    const db = await this.requireDb();
    await this.timed('copy', src, `GRAPH.COPY ${src} ${dst}`, () => db.selectGraph(src).copy(dst));
  }

  /** GRAPH.DELETE: removes a graph and everything in it. */
  async deleteGraph(name: string): Promise<void> {
    const db = await this.requireDb();
    await this.timed('delete', name, `GRAPH.DELETE ${name}`, () => db.selectGraph(name).delete());
  }

  /** GRAPH.LIST: names of every graph in the database. */
  async listGraphs(): Promise<string[]> {
    return (await this.requireDb()).list();
  }

  /**
   * Memory figures for dashboards and /health:
   * - used_memory_human from Redis `INFO memory` (whole server)
   * - total_graph_sz_mb from `GRAPH.MEMORY USAGE <graph>` per graph,
   *   or null if this FalkorDB version does not support it.
   * Both are raw commands sent through the client's node-redis connection.
   */
  async memoryReport(): Promise<MemoryReport> {
    const db = await this.requireDb();
    const connection = await db.connection;

    const info = String(await connection.sendCommand(['INFO', 'memory']));
    const usedMemoryHuman = readInfoField(info, 'used_memory_human');

    const graphNames = await db.list();
    const graphs = await Promise.all(
      graphNames.map(async (graph) => ({ graph, totalMb: await graphMemoryMb(connection, graph) })),
    );
    return { usedMemoryHuman, graphs };
  }

  /** Creates the falkordb client. Throws if the first connection attempt fails. */
  private async openConnection(): Promise<FalkorDB> {
    const options: FalkorDBOptions & PassThroughOptions = {
      socket: {
        host: this.settings.host,
        port: this.settings.port,
        // Called by node-redis whenever the socket fails, e.g. the container restarts.
        reconnectStrategy: (retries, cause) => {
          const delay = backoffDelay(retries);
          this.logger.warn(`FalkorDB socket error (${describeError(cause)}); node-redis retries in ${delay} ms`);
          return delay;
        },
      },
      password: this.settings.password,
      disableOfflineQueue: true,
    };
    const db = await FalkorDB.connect(options);

    // Without an 'error' listener Node would crash on the first dropped socket.
    db.on('error', (error: unknown) => this.logger.warn(`FalkorDB client error: ${describeError(error)}`));
    (await db.connection).on('ready', () => this.logger.log('FalkorDB connection ready'));
    return db;
  }

  /** Returns the client, or a 503 if we are not currently connected. */
  private async requireDb(): Promise<FalkorDB> {
    if (!this.db) {
      throw new ServiceUnavailableException('FalkorDB is not connected yet');
    }
    if (!(await this.db.connection).isReady) {
      throw new ServiceUnavailableException('FalkorDB connection is reconnecting');
    }
    return this.db;
  }

  /** Runs `work`, logging how long it took. Logs the query text, never params. */
  private async timed<T>(kind: string, graphName: string, cypher: string, work: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await work();
    } finally {
      const ms = Math.round(performance.now() - started);
      const line = `${kind} [${graphName}] ${ms} ms: ${oneLine(cypher)}`;
      if (ms >= SLOW_QUERY_MS) this.logger.warn(`SLOW ${line}`);
      else this.logger.debug(line);
    }
  }
}

/** Reads `field:value` out of a Redis INFO reply. */
export function readInfoField(info: string, field: string): string | null {
  const line = info.split(/\r?\n/).find((row) => row.startsWith(`${field}:`));
  return line ? line.slice(field.length + 1).trim() : null;
}

/**
 * GRAPH.MEMORY USAGE replies with a flat list: [name, value, name, value, ...].
 * Returns the value after "total_graph_sz_mb", or null if the command fails.
 */
async function graphMemoryMb(connection: RawConnection, graph: string): Promise<number | null> {
  try {
    const reply = (await connection.sendCommand(['GRAPH.MEMORY', 'USAGE', graph])) as unknown[];
    const index = reply.indexOf('total_graph_sz_mb');
    return index >= 0 ? Number(reply[index + 1]) : null;
  } catch {
    return null;
  }
}

/** Collapses a multi-line query into one short log line. */
function oneLine(cypher: string, maxLength = 160): string {
  const flat = cypher.replace(/\s+/g, ' ').trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength)}...` : flat;
}

/** Some socket errors have an empty message; fall back to their code or name. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    return error.message || code || error.name;
  }
  return String(error);
}
