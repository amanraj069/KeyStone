import { Injectable, Logger } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { APEX_GRAPH } from '../graph/graph.constants';
import { GraphService } from '../graph/graph.service';
import { MIN_KNOWS_SCORE } from './analytics.constants';
import * as Q from './queries/analytics.queries';

export interface ScoreDistribution {
  n: number;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p90: number | null;
  max: number | null;
}

export interface RefreshSummary {
  graph: string;
  asOfDay: number;
  knows: number;
  collab: number;
  systems: number;
  coreSystems: number;
  distribution: ScoreDistribution;
  ms: number;
}

/**
 * Materialises expertise in the graph: KNOWS (K2, recency-weighted) and COLLAB
 * (K8a). Everything is computed by FalkorDB; this class only runs the queries in order.
 */
@Injectable()
export class ExpertiseService {
  private readonly logger = new Logger(ExpertiseService.name);

  constructor(
    private readonly graph: GraphService,
    private readonly catalog: CatalogService,
  ) {}

  async refresh(options: { graph?: string; asOfDay?: number } = {}): Promise<RefreshSummary> {
    const started = performance.now();
    const graphName = options.graph ?? APEX_GRAPH;
    const asOfDay = options.asOfDay ?? (await this.lastDay(graphName));

    // KNOWS: rebuild from scratch so a refresh "as of" an earlier day leaves no newer pairs behind.
    await this.graph.query(graphName, Q.DELETE_ALL_KNOWS);
    await this.graph.query(graphName, Q.K2_MATERIALISE_KNOWS, { asOfDay });
    await this.graph.query(graphName, Q.DELETE_WEAK_KNOWS, { minScore: MIN_KNOWS_SCORE });
    // COLLAB: delete, then recreate (K8a).
    await this.graph.query(graphName, Q.DELETE_COLLAB);
    await this.graph.query(graphName, Q.K8A_MATERIALISE_COLLAB);

    const [counts] = await this.graph.roQuery<{ knows: number; collab: number }>(graphName, Q.EXPERTISE_COUNTS);
    const [distribution] = await this.graph.roQuery<ScoreDistribution>(graphName, Q.KNOWS_SCORE_DISTRIBUTION);
    const summary: RefreshSummary = {
      graph: graphName,
      asOfDay,
      knows: counts?.knows ?? 0,
      collab: counts?.collab ?? 0,
      systems: catalog.systems,
      coreSystems: catalog.core,
      distribution: distribution ?? { n: 0, min: null, p25: null, median: null, p75: null, p90: null, max: null },
      ms: Math.round(performance.now() - started),
    };
    this.logger.log(`Expertise on ${graphName} as of day ${asOfDay}: ${summary.knows} KNOWS, ${summary.collab} COLLAB in ${summary.ms} ms`);
    return summary;
  }

  /** The last simulation day with an artifact (the default "as of" day). */
  async lastDay(graphName: string = APEX_GRAPH): Promise<number> {
    const [row] = await this.graph.roQuery<{ day: number | null }>(graphName, Q.LAST_ARTIFACT_DAY);
    return row?.day ?? 0;
  }
}
