import { Inject, Injectable, Logger } from '@nestjs/common';
import { GraphService } from '../graph/graph.service';
import { CATALOG_SETTINGS, type CatalogSettings } from './catalog.constants';
import { type MergeGroup, planMerges, type SystemRow } from './merge-key';
import * as Q from './queries/catalog.queries';

export interface Bucket {
  bucket: string;
  systems: number;
}

export interface TopSystem extends SystemRow {
  core: boolean | null;
  aliases: string[];
}

export interface CatalogReport {
  systems: number;
  core: number;
  byMentions: Bucket[];
  byAuthors: Bucket[];
  top: TopSystem[];
}

/**
 * The System catalog: usage statistics, the core flag and specificity (idf),
 * all computed by FalkorDB and written onto System nodes, plus merging
 * duplicate System nodes.
 */
@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    private readonly graph: GraphService,
    @Inject(CATALOG_SETTINGS) private readonly settings: CatalogSettings,
  ) {}

  /** mentionCount, authorCount, core and idf on every System. Run before K2 (expertise refresh). */
  async refreshStats(graphName: string): Promise<{ systems: number; core: number }> {
    await this.graph.query(graphName, Q.SET_SYSTEM_STATS);
    await this.graph.query(graphName, Q.MARK_CORE_SYSTEMS, {
      minMentions: this.settings.coreMinMentions,
      minAuthors: this.settings.coreMinAuthors,
    });
    await this.graph.query(graphName, Q.SET_SYSTEM_IDF);
    const [totals] = await this.graph.roQuery<{ systems: number; core: number }>(graphName, Q.SYSTEM_TOTALS);
    return totals ?? { systems: 0, core: 0 };
  }

  /** Distribution by mentions and authors, plus the most mentioned systems. */
  async report(graphName: string, topN = 50): Promise<CatalogReport> {
    const [totals] = await this.graph.roQuery<{ systems: number; core: number }>(graphName, Q.SYSTEM_TOTALS);
    return {
      systems: totals?.systems ?? 0,
      core: totals?.core ?? 0,
      byMentions: await this.graph.roQuery<Bucket>(graphName, Q.MENTION_BUCKETS),
      byAuthors: await this.graph.roQuery<Bucket>(graphName, Q.AUTHOR_BUCKETS),
      top: await this.graph.roQuery<TopSystem>(graphName, Q.TOP_SYSTEMS, { limit: topN }),
    };
  }

  /** How many systems would be core for each minimum mention count (authors fixed). */
  async coreCountsAt(graphName: string, minMentions: readonly number[]): Promise<{ minMentions: number; core: number }[]> {
    const counts = [];
    for (const min of minMentions) {
      const [row] = await this.graph.roQuery<{ core: number }>(graphName, Q.CORE_COUNT_AT, {
        minMentions: min,
        minAuthors: this.settings.coreMinAuthors,
      });
      counts.push({ minMentions: min, core: row?.core ?? 0 });
    }
    return counts;
  }

  /** Every system with its counts (stats must be fresh). */
  async systems(graphName: string): Promise<SystemRow[]> {
    return this.graph.roQuery<SystemRow>(graphName, Q.ALL_SYSTEM_COUNTS);
  }

  /** Groups of systems whose names only differ by case, punctuation, versions or a generic last word. */
  async planAutomaticMerges(graphName: string): Promise<MergeGroup[]> {
    await this.refreshStats(graphName);
    return planMerges(await this.systems(graphName));
  }

  /**
   * Folds every merged System into its survivor (aliases, MENTIONS, ABOUT), deletes
   * it, and recomputes the statistics. KNOWS must be refreshed afterwards (K2).
   */
  async applyMerges(graphName: string, groups: readonly MergeGroup[]): Promise<{ merged: number; systems: number; core: number }> {
    const rows = groups.flatMap((group) => group.merge.map((dup) => ({ keep: group.keep, dup })));
    await this.graph.batchWrite(graphName, Q.MERGE_SYSTEM_ALIASES, rows);
    await this.graph.batchWrite(graphName, Q.MOVE_SYSTEM_MENTIONS, rows);
    await this.graph.batchWrite(graphName, Q.MOVE_SYSTEM_ABOUT, rows);
    await this.graph.batchWrite(graphName, Q.DELETE_MERGED_SYSTEMS, rows);
    const totals = await this.refreshStats(graphName);
    this.logger.log(`Merged ${rows.length} systems into ${groups.length} survivors on ${graphName}: ${totals.systems} systems left`);
    return { merged: rows.length, ...totals };
  }
}
