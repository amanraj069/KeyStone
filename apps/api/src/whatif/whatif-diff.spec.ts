import type { DepartureImpact } from '../analytics/analytics.service';
import { bridgeShift, diffBusFactor, newIslands, simulationGraph } from './whatif-diff';

const row = (system: string, names: string[], evidence: string[][]) => ({
  system,
  experts: names.length,
  riskLevel: 'ok' as const,
  names,
  evidence,
});

describe('diffBusFactor', () => {
  const before = [
    row('Payments', ['Ada'], [['P-1']]),
    row('Titan', ['Ada', 'Ben'], [['T-1'], ['PR-1']]),
    row('Mobile', ['Ada', 'Dev', 'Eve'], [['T-4'], ['M-1'], ['T-3']]),
  ];
  const after = [row('Payments', [], []), row('Titan', ['Ben'], [['PR-1']]), row('Mobile', ['Dev', 'Eve'], [['M-1'], ['T-3']])];

  it('finds systems that lose their last expert and systems left with one, with evidence', () => {
    expect(diffBusFactor(before, after, 'Ada')).toEqual({
      newlyOrphaned: [{ system: 'Payments', expertsBefore: ['Ada'], expertsAfter: [], evidence: ['P-1'] }],
      newlyCritical: [{ system: 'Titan', expertsBefore: ['Ada', 'Ben'], expertsAfter: ['Ben'], evidence: ['T-1', 'PR-1'] }],
    });
  });
});

describe('newIslands and bridgeShift', () => {
  it('keeps only islands that are new', () => {
    expect(newIslands(['Legacy'], ['Payments', 'Legacy'])).toEqual(['Payments']);
  });

  it('lists everyone in either top 10, biggest change first, the leaver with after = null', () => {
    const shift = bridgeShift(
      [
        { person: 'Dev', score: 4, dept: null, evidence: ['T-4'] },
        { person: 'Ada', score: 1, dept: null, evidence: ['T-1'] },
      ],
      [
        { person: 'Dev', score: 2, dept: null, evidence: ['T-4'] },
        { person: 'Eve', score: 0.5, dept: null, evidence: ['T-3'] },
      ],
    );
    expect(shift).toEqual([
      { person: 'Dev', before: 4, after: 2, evidence: ['T-4'] },
      { person: 'Ada', before: 1, after: null, evidence: ['T-1'] },
      { person: 'Eve', before: null, after: 0.5, evidence: ['T-3'] },
    ]);
  });
});

describe('simulationGraph', () => {
  const impact: DepartureImpact = {
    person: 'Ada',
    dept: 'Eng',
    minScore: 0.4,
    systems: [
      { system: 'Payments', leaverScore: 3, backups: 0, backupNames: [], evidence: ['P-1'] },
      { system: 'Titan', leaverScore: 9, backups: 1, backupNames: ['Ben'], evidence: ['T-1'] },
      { system: 'Mobile', leaverScore: 2, backups: 2, backupNames: ['Dev', 'Eve'], evidence: ['T-4'] },
    ],
    orphanedSystems: ['Payments'],
    openTickets: [{ ticket: 'T-9', title: 'Fix refunds', suggestedOwners: ['Ben'], ownerEvidence: [['PR-1']] }],
    unsharedPages: [],
  };

  it('flags the leaver, broken systems and orphaned tickets, and links the other experts', () => {
    const graph = simulationGraph({
      person: 'Ada',
      impact,
      busFactorBefore: [row('Payments', ['Ada'], [['P-1']]), row('Titan', ['Ada', 'Ben'], [['T-1'], ['PR-1']])],
      newlyOrphaned: [{ system: 'Payments', expertsBefore: ['Ada'], expertsAfter: [], evidence: ['P-1'] }],
      newlyCritical: [{ system: 'Titan', expertsBefore: ['Ada', 'Ben'], expertsAfter: ['Ben'], evidence: ['T-1'] }],
      islands: [{ system: 'Payments', evidence: ['P-1'] }],
      leaverScores: new Map(),
      maxSystems: 2,
    });
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(byId.get('person:Ada')).toMatchObject({ leaving: true });
    expect(byId.get('system:Payments')).toMatchObject({ orphaned: true, island: true, critical: false });
    expect(byId.get('system:Titan')).toMatchObject({ critical: true, orphaned: false });
    expect(byId.get('ticket:T-9')).toMatchObject({ kind: 'ticket', artifactId: 'T-9', orphaned: true });
    expect(byId.has('system:Mobile')).toBe(false); // maxSystems 2: changed systems first
    expect(graph.truncated).toBe(true);
    expect(graph.edges).toContainEqual({ source: 'person:Ben', target: 'system:Titan', type: 'KNOWS', score: null });
    expect(graph.edges).toContainEqual({ source: 'person:Ada', target: 'system:Titan', type: 'KNOWS', score: 9 });
  });
});
