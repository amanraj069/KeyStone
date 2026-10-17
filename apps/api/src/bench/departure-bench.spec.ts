import type { Departure } from './answer-key';
import { DepartureBench, planGenesis } from './departure-bench';

// Made-up people and systems; nothing here comes from the answer key.
const LEAVER: Departure = { name: 'Ada', role: null, day: 10, documentedPct: 0.5, domains: ['ledger-sync', 'payment flow'], before_day_1: false };
const EARLY: Departure = { name: 'Bo', role: null, day: -100, documentedPct: 0.2, domains: ['Ledger Sync', 'Nothing Like It'], before_day_1: true };

function fakes(options: { failImpact?: boolean; same?: (prompt: string) => boolean } = {}) {
  const graphs = new Set<string>(['apex', 'apex_proj', 'bench_proj_3']);
  const events: string[] = [];
  const graph = {
    // KNOWLEDGE_SHARE_AS_OF: the second predictor's systems.
    roQuery: jest.fn(async () => [{ system: 'Payments Service' }, { system: 'Kafka' }]),
    listGraphs: jest.fn(async () => [...graphs]),
    deleteGraph: jest.fn(async (name: string) => {
      events.push(`delete ${name}`);
      graphs.delete(name);
    }),
  };
  const projection = {
    rebuild: jest.fn(async (name: string, opts?: { asOfDay?: number }) => {
      events.push(`build ${name} as of ${opts?.asOfDay ?? 'now'}`);
      graphs.add(name);
    }),
    isFresh: jest.fn(async () => true),
  };
  const analytics = {
    departureImpact: jest.fn(async () => {
      if (options.failImpact) throw new Error('No person named "Ada"');
      return { systems: [{ system: 'Ledger Sync' }, { system: 'Billing' }, { system: 'Kafka' }], orphanedSystems: ['Billing'] };
    }),
    busFactor: jest.fn(async () => [
      { system: 'Ledger Sync', riskLevel: 'critical' },
      { system: 'Search', riskLevel: 'orphaned' },
      { system: 'Kafka', riskLevel: 'ok' },
    ]),
  };
  const llm = { generateObject: jest.fn(async (_s: unknown, r: { prompt: string }) => ({ same: options.same?.(r.prompt) ? 'yes' : 'no' })) };
  const bench = new DepartureBench({ graph, projection, analytics, checker: llm } as never);
  return { bench, events, graphs, llm };
}

describe('DepartureBench', () => {
  it('builds one projection as of the day before, runs K5 on it, deletes it, and sweeps leftovers first', async () => {
    const { bench, events, graphs } = fakes();
    const plan = await bench.plan([LEAVER, EARLY]);
    expect(events).toEqual(['delete bench_proj_3', 'build bench_proj_10 as of 9', 'delete bench_proj_10']);
    expect([...graphs].filter((g) => g.startsWith('bench_proj_'))).toEqual([]);
    expect(plan.departures[0]).toMatchObject({ asOfDay: 9, predicted: ['Ledger Sync', 'Billing', 'Kafka'], orphaned: ['Billing'] });
    expect(plan.departures[0].matches).toEqual([{ gold: 'ledger-sync', predicted: 'Ledger Sync', via: 'exact' }]);
  });

  it('deletes the projection even when K5 fails, and records the error', async () => {
    const { bench, graphs } = fakes({ failImpact: true });
    const plan = await bench.plan([LEAVER]);
    expect(plan.departures[0].error).toBe('No person named "Ada"');
    expect(graphs.has('bench_proj_10')).toBe(false);
  });

  it('asks the LLM only about leftovers and scores precision, recall and F1', async () => {
    const { bench, llm } = fakes({ same: (prompt) => prompt.includes('Billing\n') && prompt.includes('payment flow') });
    const plan = await bench.plan([LEAVER]);
    const planned = plan.departures[0].leftovers.length + plan.departures[0].share.leftovers.length;
    expect(DepartureBench.plannedCalls(plan)).toBe(planned);
    const b1 = await bench.score(plan);
    expect(llm.generateObject).toHaveBeenCalledTimes(planned);
    expect(b1.departures[0]).toMatchObject({ tp: 2, fp: 1, fn: 0, recall: 1 });
    expect(b1.departures[0].precision).toBeCloseTo(2 / 3);
    expect(b1.overall.recall).toBe(1);
    // Knowledge share: "Payments Service" is not "payment flow" by name rules; the fake LLM only says yes to Billing.
    expect(b1.departures[0].knowledgeShare).toMatchObject({ predicted: ['Payments Service', 'Kafka'], tp: 0, fn: 2 });
    // Orphaned-only: just "Billing", which the LLM matched to "payment flow".
    expect(b1.departures[0].orphanedOnly).toMatchObject({ tp: 1, fp: 0, fn: 1, precision: 1, recall: 0.5 });
    expect(b1.overallOrphanedOnly.recall).toBe(0.5);
  });

  it('genesis: domains count only when they match an orphaned or critical system', () => {
    const atRisk = new Map([
      ['Ledger Sync', 'critical'],
      ['Search', 'orphaned'],
    ]);
    const planned = planGenesis(EARLY, atRisk);
    expect(planned.found).toEqual([{ domain: 'Ledger Sync', system: 'Ledger Sync', riskLevel: 'critical', via: 'exact' }]);
    expect(planned.shortlists).toEqual([{ domain: 'Nothing Like It', candidates: expect.arrayContaining(['Search', 'Ledger Sync']) }]);
  });
});
