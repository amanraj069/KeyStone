import { Injectable, Logger } from '@nestjs/common';
import type { MemoryReport } from '@keystone/shared';
import { COLLAB_KEEP_PERCENTILE, MIN_KNOWS_SCORE, PROJECTION_GRAPH, PROJECTION_TARGET } from '../analytics/analytics.constants';
import { APEX_GRAPH } from '../graph/graph.constants';
import { type BatchRow, GraphService } from '../graph/graph.service';
import { PERSON_NAME_INDEX, SYSTEM_NAME_INDEX } from '../graph/queries/schema.queries';
import * as Q from './queries/projection.queries';

export interface ProjectionOptions {
  /** Graph to read from (default apex). */
  sourceGraph?: string;
  /** Build the projection as it was on this day (KNOWS/COLLAB recomputed, nothing written to apex). */
  asOfDay?: number;
  /** Keep COLLAB pairs at or above this weight percentile (default COLLAB_KEEP_PERCENTILE). */
  collabPercentile?: number;
  /** Rows per read page (default READ_PAGE; tests use a small one to exercise paging). */
  pageSize?: number;
}

export interface ProjectionSummary {
  sourceGraph: string;
  targetGraph: string;
  asOfDay: number | null;
  people: number;
  systems: number;
  knows: number;
  collab: number;
  /** COLLAB pairs lighter than this were left out (see COLLAB_KEEP_PERCENTILE). */
  collabMinWeight: number;
  sourceMb: number | null;
  targetMb: number | null;
  ms: number;
}

/** Rows read from the source graph are written as-is into the target (same keys). */
type Row = BatchRow;

/** Rows per page when reading from the source graph (well under FalkorDB's RESULTSET_SIZE). */
const READ_PAGE = 5000;

/**
 * Builds the small people-and-systems graph (Person, core System, KNOWS, COLLAB) that
 * what-if simulations and benchmarks copy, so they copy a few thousand nodes
 * instead of the whole company. FalkorDB does every aggregation; TypeScript only
 * moves the result rows from one graph to the other.
 */
@Injectable()
export class ProjectionService {
  private readonly logger = new Logger(ProjectionService.name);

  constructor(private readonly graph: GraphService) {}

  async rebuild(targetGraph = PROJECTION_GRAPH, options: ProjectionOptions = {}): Promise<ProjectionSummary> {
    if (!PROJECTION_TARGET.test(targetGraph)) {
      throw new Error(`Refusing to write a projection into "${targetGraph}" (allowed: apex_proj*, bench_proj_*, test_*)`);
    }
    const started = performance.now();
    const source = options.sourceGraph ?? APEX_GRAPH;
    const asOfDay = options.asOfDay ?? null;
    const pageSize = options.pageSize ?? READ_PAGE;

    // 1. Read from the source graph. "As of" projections recompute KNOWS and COLLAB read-only.
    const people = await this.readAll(pageSize, source, asOfDay === null ? Q.ACTIVE_PEOPLE : Q.ACTIVE_PEOPLE_AS_OF, { asOfDay });
    const systems = await this.readAll(pageSize, source, Q.CORE_SYSTEMS);
    const knows =
      asOfDay === null
        ? await this.readAll(pageSize, source, Q.ACTIVE_KNOWS)
        : await this.readAll(pageSize, source, Q.KNOWS_AS_OF, { asOfDay, minScore: MIN_KNOWS_SCORE });
    // COLLAB: only pairs at or above the weight percentile, so betweenness has structure to measure.
    const percentile = options.collabPercentile ?? COLLAB_KEEP_PERCENTILE;
    const [cut] = await this.graph.roQuery<{ weight: number | null }>(
      source,
      asOfDay === null ? Q.ACTIVE_COLLAB_WEIGHT_PERCENTILE : Q.COLLAB_AS_OF_WEIGHT_PERCENTILE,
      { asOfDay, percentile },
    );
    const minWeight = cut?.weight ?? 0;
    const collab =
      asOfDay === null
        ? await this.readAll(pageSize, source, Q.ACTIVE_COLLAB, { minWeight })
        : await this.readAll(pageSize, source, Q.COLLAB_AS_OF, { asOfDay, minWeight });

    // 2. Rebuild the target from scratch: delete, indexes first (edge writes MATCH by name), then nodes, then edges.
    if ((await this.graph.listGraphs()).includes(targetGraph)) await this.graph.deleteGraph(targetGraph);
    await this.graph.query(targetGraph, PERSON_NAME_INDEX);
    await this.graph.query(targetGraph, SYSTEM_NAME_INDEX);
    await this.graph.batchWrite(targetGraph, Q.WRITE_PEOPLE, people);
    await this.graph.batchWrite(targetGraph, Q.WRITE_SYSTEMS, systems);
    await this.graph.batchWrite(targetGraph, Q.WRITE_KNOWS, knows);
    await this.graph.batchWrite(targetGraph, Q.WRITE_COLLAB, collab);

    // 3. Report: counts and memory, which should be a tiny fraction of the source.
    const [counts] = await this.graph.roQuery<{ people: number; systems: number; knows: number; collab: number }>(
      targetGraph,
      Q.PROJECTION_COUNTS,
    );
    const memory = await this.graph.memoryReport();
    const summary: ProjectionSummary = {
      sourceGraph: source,
      targetGraph,
      asOfDay,
      ...counts,
      collabMinWeight: minWeight,
      sourceMb: graphMb(memory, source),
      targetMb: graphMb(memory, targetGraph),
      ms: Math.round(performance.now() - started),
    };
    this.logger.log(
      `Projection ${targetGraph}${asOfDay === null ? '' : ` as of day ${asOfDay}`}: ${summary.people} people, ` +
        `${summary.systems} systems, ${summary.knows} KNOWS, ${summary.collab} COLLAB (weight >= ${minWeight}, both directions); ` +
        `${summary.targetMb ?? '?'} MB vs ${source} ${summary.sourceMb ?? '?'} MB; ${summary.ms} ms`,
    );
    return summary;
  }

  /** Reads every row of a paged query (one with SKIP $skip LIMIT $limit), page by page. */
  private async readAll(pageSize: number, graphName: string, cypher: string, params: BatchRow = {}): Promise<Row[]> {
    const rows: Row[] = [];
    for (let skip = 0; ; skip += pageSize) {
      const page = await this.graph.roQuery<Row>(graphName, cypher, { ...params, skip, limit: pageSize });
      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }
}

function graphMb(memory: MemoryReport, graph: string): number | null {
  return memory.graphs.find((g) => g.graph === graph)?.totalMb ?? null;
}
