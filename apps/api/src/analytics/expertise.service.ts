import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { countMentions } from '../common/text-match';
import { APEX_GRAPH } from '../graph/graph.constants';
import { GraphService } from '../graph/graph.service';
import { TEXT_STORE } from '../ingest/ingest.constants';
import type { TextStore } from '../ingest/text-store';
import { MIN_KNOWS_SCORE } from './analytics.constants';
import * as Q from './queries/analytics.queries';

/** MENTIONS edges counted per page (FalkorDB returns at most 10,000 rows). */
const HITS_PAGE = 4000;

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
    /** Bodies for counting mentions; absent in CLI scripts and tests, which then keep K2's earlier ranking. */
    @Optional() @Inject(TEXT_STORE) private readonly textStore?: TextStore,
  ) {}

  async refresh(options: { graph?: string; asOfDay?: number } = {}): Promise<RefreshSummary> {
    const started = performance.now();
    const graphName = options.graph ?? APEX_GRAPH;
    const asOfDay = options.asOfDay ?? (await this.lastDay(graphName));

    // Who is active on that day (announced departures), then system statistics: mentionCount, authorCount, core and idf (used by K4-K6 and the projection).
    await this.graph.query(graphName, Q.SET_ACTIVE_AS_OF, { asOfDay });
    const catalog = await this.catalog.refreshStats(graphName);
    // KNOWS: rebuild from scratch so a refresh "as of" an earlier day leaves no newer pairs behind.
    // K2 ranks its evidence by how many systems each artifact mentions, counted first.
    await this.graph.query(graphName, Q.SET_MENTIONED_SYSTEMS);
    // ...and by how often the body names the system (counted once per MENTIONS edge, no LLM).
    await this.countMentionHits(graphName);
    await this.graph.query(graphName, Q.DELETE_ALL_KNOWS);
    await this.graph.query(graphName, Q.K2_MATERIALISE_KNOWS, { asOfDay });
    await this.graph.query(graphName, Q.DELETE_WEAK_KNOWS, { minScore: MIN_KNOWS_SCORE });
    // COLLAB: delete, then recreate (K8a).
    await this.graph.query(graphName, Q.DELETE_COLLAB);
    await this.graph.query(graphName, Q.K8A_MATERIALISE_COLLAB);

    await this.graph.query(graphName, Q.STAMP_EXPERTISE, { refreshedAt: Date.now(), asOfDay });
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

  /**
   * Sets MENTIONS.hits (how many times the body names the system or one of its
   * aliases) on every edge that has none yet, a page at a time. Edges keep their
   * count, so after the first refresh only new documents are read.
   */
  private async countMentionHits(graphName: string): Promise<void> {
    if (!this.textStore) return;
    let counted = 0;
    // Artifacts without a body in the TextStore keep no count (never a wrong 0) and are not asked for again.
    const missing: string[] = [];
    for (;;) {
      const rows = await this.graph.roQuery<{ id: string; system: string; aliases: string[] }>(graphName, Q.MENTIONS_WITHOUT_HITS, {
        limit: HITS_PAGE,
        skip: missing,
      });
      if (rows.length === 0) break;
      const bodies = await this.textStore.getMany('artifacts', [...new Set(rows.map((r) => r.id))]);
      const hits = rows.flatMap((r) => {
        const body = bodies.get(r.id);
        if (body === undefined) {
          if (!missing.includes(r.id)) missing.push(r.id);
          return [];
        }
        return [{ id: r.id, system: r.system, hits: countMentions(body, [r.system, ...r.aliases]) }];
      });
      if (hits.length > 0) await this.graph.query(graphName, Q.SET_MENTION_HITS, { rows: hits });
      counted += hits.length;
      if (rows.length < HITS_PAGE) break;
    }
    if (counted > 0 || missing.length > 0) {
      this.logger.log(`Counted mentions in the text for ${counted} MENTIONS edges on ${graphName} (${missing.length} artifacts have no body)`);
    }
  }

  /** The last simulation day with an artifact (the default "as of" day). */
  async lastDay(graphName: string = APEX_GRAPH): Promise<number> {
    const [row] = await this.graph.roQuery<{ day: number | null }>(graphName, Q.LAST_ARTIFACT_DAY);
    return row?.day ?? 0;
  }
}
