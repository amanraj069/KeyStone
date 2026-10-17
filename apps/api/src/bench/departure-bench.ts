import type { B1Results, DepartureScore, GenesisScore, MatchVia, NameMatch, Prf } from '@keystone/shared';
import { z } from 'zod';
import { EXPERT_SHARE_OF_TOP, MIN_EXPERT_SCORE, PROJECTION_GRAPH } from '../analytics/analytics.constants';
import type { AnalyticsService } from '../analytics/analytics.service';
import { closestNames } from '../analytics/closest-names';
import type { GraphService } from '../graph/graph.service';
import type { LlmService } from '../llm/llm.service';
import type { ProjectionService } from '../projection/projection.service';
import type { Departure } from './answer-key';
import { APEX_GRAPH } from '../graph/graph.constants';
import {
  BENCH_PROJECTION_PREFIX,
  LLM_SHORTLIST,
  SAME_SYSTEM_PROMPT,
  SAME_SYSTEM_TASK,
  SHARE_LIMIT,
  SHARE_MIN,
  SHARE_MIN_MENTIONS,
} from './bench.constants';
import { KNOWLEDGE_SHARE_AS_OF } from './queries/bench.queries';
import { matchNames, matchWithoutLlm, prf, scoreMatches } from './name-match';

const SameSystemSchema = z.object({ same: z.enum(['yes', 'no']) });

/** What K5 predicted for one in-simulation departure, before any LLM call. */
export interface PlannedDeparture {
  departure: Departure;
  asOfDay: number;
  projection: string;
  predicted: string[];
  orphaned: string[];
  matches: NameMatch[];
  leftovers: { gold: string; predicted: string }[];
  /** The knowledge-share predictor, matched the same way. */
  share: { predicted: string[]; matches: NameMatch[]; leftovers: { gold: string; predicted: string }[] };
  error: string | null;
}

/** A departure before day 1, with the at-risk systems it is checked against. */
export interface PlannedGenesis {
  departure: Departure;
  found: GenesisScore['found'];
  /** Unmatched domains and the closest at-risk names the LLM will be asked about. */
  shortlists: { domain: string; candidates: string[] }[];
}

export interface B1Plan {
  departures: PlannedDeparture[];
  genesis: PlannedGenesis[];
  /** At-risk (orphaned or critical) systems on apex_proj, with their risk level. */
  atRisk: Map<string, string>;
}

export interface DepartureBenchDeps {
  graph: GraphService;
  projection: ProjectionService;
  analytics: AnalyticsService;
  /** The checker (the judge's model) for "same system?" questions. */
  checker: Pick<LlmService, 'generateObject'>;
}

/**
 * Part B1: does departure impact (K5) predict the domains a person's departure
 * actually left uncovered? plan() does all graph work and no LLM calls (so the
 * cost is known before anything is spent); score() asks the LLM about leftovers.
 */
export class DepartureBench {
  constructor(
    private readonly deps: DepartureBenchDeps,
    private readonly log: (line: string) => void = () => undefined,
  ) {}

  async plan(departures: readonly Departure[]): Promise<B1Plan> {
    await this.deleteLeftoverProjections();
    const planned: PlannedDeparture[] = [];
    // One at a time: only one bench projection exists at once.
    for (const departure of departures.filter((d) => !d.before_day_1)) planned.push(await this.predict(departure));

    const atRisk = await this.atRiskSystems();
    const genesis = departures.filter((d) => d.before_day_1).map((departure) => planGenesis(departure, atRisk));
    return { departures: planned, genesis, atRisk };
  }

  /** LLM calls score() will make at most (one per leftover pair / shortlist name; cached ones cost nothing). */
  static plannedCalls(plan: B1Plan): number {
    return (
      plan.departures.reduce((sum, d) => sum + d.leftovers.length + d.share.leftovers.length, 0) +
      plan.genesis.reduce((sum, g) => sum + g.shortlists.reduce((n, s) => n + s.candidates.length, 0), 0)
    );
  }

  async score(plan: B1Plan): Promise<B1Results> {
    const departures: DepartureScore[] = [];
    for (const d of plan.departures) {
      const llmMatches = await this.askLeftovers(d.leftovers);
      const matches = [...d.matches, ...llmMatches];
      const score = scoreMatches(d.departure.domains, d.predicted, matches);
      const orphanedOnly = scoreMatches(d.departure.domains, d.orphaned, matches.filter((m) => d.orphaned.includes(m.predicted)));
      const shareMatches = [...d.share.matches, ...(await this.askLeftovers(d.share.leftovers))];
      const knowledgeShare = {
        predicted: d.share.predicted,
        matches: shareMatches,
        ...scoreMatches(d.departure.domains, d.share.predicted, shareMatches),
      };
      departures.push({
        person: d.departure.name,
        day: d.departure.day,
        asOfDay: d.asOfDay,
        projection: d.projection,
        domains: d.departure.domains,
        predicted: d.predicted,
        orphaned: d.orphaned,
        matches,
        orphanedOnly,
        knowledgeShare,
        error: d.error,
        ...score,
      });
    }

    const genesis: GenesisScore[] = [];
    for (const g of plan.genesis) {
      const found = [...g.found];
      for (const { domain, candidates } of g.shortlists) {
        const same = await this.askLeftovers(candidates.map((predicted) => ({ gold: domain, predicted })));
        const first = same[0];
        if (first) found.push({ domain, system: first.predicted, riskLevel: plan.atRisk.get(first.predicted) ?? 'unknown', via: 'llm' });
      }
      const foundDomains = new Set(found.map((f) => f.domain));
      genesis.push({
        person: g.departure.name,
        day: g.departure.day,
        domains: g.departure.domains,
        found,
        missing: g.departure.domains.filter((domain) => !foundDomains.has(domain)),
        recall: g.departure.domains.length === 0 ? null : foundDomains.size / g.departure.domains.length,
      });
    }
    const genesisFound = genesis.reduce((n, g) => n + (g.domains.length - g.missing.length), 0);
    const genesisTotal = genesis.reduce((n, g) => n + g.domains.length, 0);

    return {
      minScore: MIN_EXPERT_SCORE,
      departures,
      overall: microAverage(departures.map((d) => ({ score: d, gold: d.domains.length }))),
      overallOrphanedOnly: microAverage(departures.map((d) => ({ score: d.orphanedOnly, gold: d.domains.length }))),
      overallKnowledgeShare: microAverage(departures.map((d) => ({ score: d.knowledgeShare, gold: d.domains.length }))),
      genesis,
      genesisOverall: { found: genesisFound, total: genesisTotal, recall: genesisTotal === 0 ? null : genesisFound / genesisTotal },
    };
  }

  /**
   * K5 for one person on a projection as of the day before they left. The
   * projection is deleted in `finally`, whatever happens.
   */
  private async predict(departure: Departure): Promise<PlannedDeparture> {
    const asOfDay = departure.day - 1;
    const projection = `${BENCH_PROJECTION_PREFIX}${departure.day}`;
    const noShare = { predicted: [], matches: [], leftovers: [] };
    const base = { departure, asOfDay, projection, predicted: [], orphaned: [], matches: [], leftovers: [], share: noShare };
    try {
      await this.deps.projection.rebuild(projection, { asOfDay });
      const impact = await this.deps.analytics.departureImpact(departure.name, MIN_EXPERT_SCORE, projection, EXPERT_SHARE_OF_TOP);
      const predicted = impact.systems.map((s) => s.system);
      const { matches, leftovers } = matchNames(departure.domains, predicted);
      const share = await this.knowledgeShare(departure, asOfDay);
      this.log(
        `B1 ${departure.name} (left day ${departure.day}): K5 on ${projection} lists ${predicted.length} systems, ` +
          `${impact.orphanedSystems.length} orphaned; knowledge share lists ${share.predicted.length}`,
      );
      return { ...base, predicted, orphaned: impact.orphanedSystems, matches, leftovers, share, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log(`B1 ${departure.name}: ${message}`);
      return { ...base, error: message };
    } finally {
      if ((await this.deps.graph.listGraphs()).includes(projection)) await this.deps.graph.deleteGraph(projection);
    }
  }

  /** The knowledge-share predictor on apex as of a day (read-only), with its systems matched to the gold domains. */
  private async knowledgeShare(departure: Departure, asOfDay: number): Promise<PlannedDeparture['share']> {
    const rows = await this.deps.graph.roQuery<{ system: string }>(APEX_GRAPH, KNOWLEDGE_SHARE_AS_OF, {
      person: departure.name,
      asOfDay,
      minShare: SHARE_MIN,
      minScore: MIN_EXPERT_SCORE,
      minMentions: SHARE_MIN_MENTIONS,
      limit: SHARE_LIMIT,
    });
    const predicted = rows.map((r) => r.system);
    return { predicted, ...matchNames(departure.domains, predicted) };
  }

  /** Orphaned and critical core systems (K4) on apex_proj, rebuilt first if it is stale. */
  private async atRiskSystems(): Promise<Map<string, string>> {
    if (!(await this.deps.projection.isFresh(PROJECTION_GRAPH))) {
      this.log(`B1: ${PROJECTION_GRAPH} is missing or stale; rebuilding it`);
      await this.deps.projection.rebuild(PROJECTION_GRAPH);
    }
    const rows = await this.deps.analytics.busFactor(MIN_EXPERT_SCORE, PROJECTION_GRAPH, EXPERT_SHARE_OF_TOP);
    return new Map(rows.filter((r) => r.riskLevel === 'orphaned' || r.riskLevel === 'critical').map((r) => [r.system, r.riskLevel]));
  }

  /** Pairs the LLM says name the same system ("yes"); a failed call counts as "no" and is logged. */
  private async askLeftovers(pairs: readonly { gold: string; predicted: string }[]): Promise<NameMatch[]> {
    const answers = await Promise.all(
      pairs.map(async (pair) => {
        try {
          // Names in a fixed order, so (a, b) and (b, a) share one cached answer.
          const [a, b] = [pair.gold, pair.predicted].sort((x, y) => x.localeCompare(y));
          const { same } = await this.deps.checker.generateObject(SameSystemSchema, {
            task: SAME_SYSTEM_TASK,
            system: SAME_SYSTEM_PROMPT,
            prompt: `Name A: ${a}\nName B: ${b}`,
          });
          return same === 'yes';
        } catch (error) {
          this.log(`B1 same-system check failed for "${pair.gold}" / "${pair.predicted}": ${String(error)}`);
          return false;
        }
      }),
    );
    return pairs.filter((_, i) => answers[i]).map((pair) => ({ ...pair, via: 'llm' as MatchVia }));
  }

  /** A crashed run can leave a bench projection behind; delete it so only one ever exists. */
  private async deleteLeftoverProjections(): Promise<void> {
    for (const name of (await this.deps.graph.listGraphs()).filter((g) => g.startsWith(BENCH_PROJECTION_PREFIX))) {
      this.log(`B1: deleting leftover ${name}`);
      await this.deps.graph.deleteGraph(name);
    }
  }
}

/** P/R/F1 over several departures: tp, fp and fn summed (found gold names = gold - fn). */
export function microAverage(items: readonly { score: Prf; gold: number }[]): Prf {
  const sum = (pick: (item: { score: Prf; gold: number }) => number) => items.reduce((n, item) => n + pick(item), 0);
  return prf(sum((i) => i.score.tp), sum((i) => i.score.fp), sum((i) => i.score.fn), sum((i) => i.gold - i.score.fn));
}

/** Matches a genesis departure's domains to at-risk systems without the LLM; shortlists the rest. */
export function planGenesis(departure: Departure, atRisk: ReadonlyMap<string, string>): PlannedGenesis {
  const systems = [...atRisk.keys()];
  const found: GenesisScore['found'] = [];
  const shortlists: PlannedGenesis['shortlists'] = [];
  for (const domain of departure.domains) {
    const hit = systems.map((system) => ({ system, via: matchWithoutLlm(domain, system) })).find((m) => m.via !== null);
    if (hit?.via) found.push({ domain, system: hit.system, riskLevel: atRisk.get(hit.system)!, via: hit.via });
    else if (systems.length > 0) shortlists.push({ domain, candidates: closestNames(domain, systems.map((name) => ({ name })), LLM_SHORTLIST) });
  }
  return { departure, found, shortlists };
}
