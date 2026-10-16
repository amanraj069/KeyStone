/** The people-and-systems projection that what-if and algorithms run on (AGENTS.md section 3). */
export const PROJECTION_GRAPH = 'apex_proj';

/** After K2, KNOWS edges below this score are deleted (too weak to call knowledge). */
export const MIN_KNOWS_SCORE = 0.05;

/**
 * Default minScore for "is an expert" (bus factor, departure impact).
 *
 * KNOWS score scale (K2): one artifact authored today = 3.0, reviewed today = 2.0,
 * a ticket owned today = 1.0, each decaying with a 30-day time constant.
 * Distribution on apex as of day 60 (11,716 edges, `pnpm expertise`): min 0.14,
 * p25 0.82, median 1.54, p75 2.90, p90 12.4, max 968.
 *
 * 1.0 = "authored something about it in the last ~33 days, reviewed something in
 * the last ~21 days, or owns a current ticket on it". It keeps the stronger ~2/3
 * of KNOWS edges and drops one-off mentions from months ago (below p25 0.85 sits
 * mostly a single old message). 0.5 would count people who touched a system once
 * two months ago; 2.0 would drop half of all real expertise.
 */
export const DEFAULT_MIN_SCORE = 1.0;

/**
 * Ticket statuses that mean "done", compared lower-case (K6). The corpus only has
 * "To Do" on sprint tickets and no status on 29 assignments, so today no ticket is
 * done; these are the usual Jira closing states, plus the fixture's "done".
 */
export const DONE_STATUSES = ['done', 'closed', 'resolved', "won't do", 'cancelled', 'canceled'];

/** Bus factor risk levels by number of active experts. */
export type RiskLevel = 'orphaned' | 'critical' | 'watch' | 'ok';

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
