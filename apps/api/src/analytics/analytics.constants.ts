import type { RiskLevel } from '@keystone/shared';

/** The people-and-systems projection that what-if and algorithms run on (AGENTS.md section 3). */
export const PROJECTION_GRAPH = 'apex_proj';

/** After K2, KNOWS edges below this score are deleted (too weak to call knowledge). */
export const MIN_KNOWS_SCORE = 0.05;

/**
 * Who counts as an expert on a core system (bus factor, departure impact).
 * Rule, fixed before looking at outcomes (and never at the answer key):
 *
 *   score >= MIN_EXPERT_SCORE  AND  score >= EXPERT_SHARE_OF_TOP x the system's top score
 *
 * MIN_EXPERT_SCORE is the median (p50) KNOWS score on core systems, rounded:
 * 0.41 on apex as of day 60 (3,295 edges; p25 0.14, p75 2.38, p90 7.9, max 168),
 * so 0.4. KNOWS scale (K2): authored today 3.0, reviewed 2.0, owns a ticket 1.0,
 * took part in a conversation 0.125-0.5, each decaying with a 30-day time constant.
 * The relative part makes "expert" mean "close to the people who know it best":
 * on TitanDB (top 100) it takes 25, on a small system (top 2) it takes 0.5.
 * The ?minScore= query parameter overrides the floor only.
 */
export const MIN_EXPERT_SCORE = 0.4;
export const EXPERT_SHARE_OF_TOP = 0.25;

/**
 * Ticket statuses that mean "done", compared lower-case (K6). The corpus only has
 * "To Do" on sprint tickets and no status on 29 assignments, so today no ticket is
 * done; these are the usual Jira closing states, plus the fixture's "done".
 */
export const DONE_STATUSES = ['done', 'closed', 'resolved', "won't do", 'cancelled', 'canceled'];

/** Bus factor risk levels by number of active experts. */
export type { RiskLevel };

export function riskLevel(experts: number): RiskLevel {
  if (experts === 0) return 'orphaned';
  if (experts === 1) return 'critical';
  if (experts === 2) return 'watch';
  return 'ok';
}

/** The projection of a graph: apex -> apex_proj, apex_replay -> apex_proj_replay, test_x -> test_x_proj. */
export function projectionGraphFor(graph: string): string {
  if (graph === 'apex') return PROJECTION_GRAPH;
  if (graph.startsWith('apex_')) return `apex_proj_${graph.slice('apex_'.length)}`;
  return `${graph}_proj`;
}

/**
 * The projection keeps only COLLAB pairs at or above this percentile of weight.
 * Almost everyone at Apex shares some Slack thread with everyone else (920 of
 * 946 possible pairs), and betweenness on a near-complete graph is flat (every
 * person scored ~1.1). Keeping pairs with at least the median number of shared
 * artifacts (20 on apex) leaves 469 pairs and a clear ranking. A percentile
 * rather than a fixed weight, so early replay days and as-of projections scale.
 */
export const COLLAB_KEEP_PERCENTILE = 0.5;

/** Graphs the projection may write into: never apex itself. */
export const PROJECTION_TARGET = /^(apex_proj[a-z0-9_]*|bench_proj_[a-z0-9_]+|test_[a-z0-9_]+)$/;
