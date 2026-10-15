import {
  ACTIVE_EXPERTS_BY_SYSTEM,
  ARTIFACTS_AS_OF_DAY,
  COUNT_NODES_BY_LABEL,
  CROSS_DEPT_COLLABORATORS,
} from './queries/test.queries';
import { useFixtureGraph } from './graph-test-utils';

describe('mini-company fixture', () => {
  const fx = useFixtureGraph();

  it('loads the expected number of nodes per label', async () => {
    const rows = await fx.graph.roQuery<{ label: string; count: number }>(fx.name, COUNT_NODES_BY_LABEL);
    expect(Object.fromEntries(rows.map((r) => [r.label, r.count]))).toEqual({
      Person: 5,
      Dept: 2,
      System: 4,
      Artifact: 13,
      Ticket: 4,
      PR: 3,
      Page: 3,
      Thread: 2,
      Meeting: 1,
      Decision: 2,
    });
  });

  it('skips the day: null artifact in "as of day N" filters', async () => {
    const rows = await fx.graph.roQuery<{ id: string }>(fx.name, ARTIFACTS_AS_OF_DAY, { day: 60 });
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.id)).not.toContain('P-2');
  });

  it('has exactly one system with a single active expert and one with none', async () => {
    const rows = await fx.graph.roQuery<{ system: string; experts: string[] }>(fx.name, ACTIVE_EXPERTS_BY_SYSTEM);
    const experts = Object.fromEntries(rows.map((r) => [r.system, [...r.experts].sort()]));
    expect(experts).toEqual({
      LegacyAuth: [],
      MobileApp: ['Ada', 'Ben', 'Dev', 'Eve'],
      PaymentsAPI: ['Ada'],
      TitanDB: ['Ada', 'Ben', 'Dev'],
    });
  });

  it('routes every cross-department collaboration through Dev', async () => {
    const rows = await fx.graph.roQuery<{ person: string; partners: string[] }>(fx.name, CROSS_DEPT_COLLABORATORS);
    const partners = Object.fromEntries(rows.map((r) => [r.person, [...r.partners].sort()]));
    expect(partners).toEqual({ Ada: ['Dev'], Ben: ['Dev'], Dev: ['Ada', 'Ben'] });
  });
});

