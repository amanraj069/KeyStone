import { KNOWLEDGE_SHARE_AS_OF, KNOWN_ARTIFACT_IDS, KNOWN_PERSON_OR_SYSTEM_NAMES } from '../src/bench/queries/bench.queries';
import { useFixtureGraph } from './graph-test-utils';

/** The benchmark's own Cypher (bench.queries.ts), one test per query, on the mini-company fixture. */
describe('bench queries on the fixture graph', () => {
  const fx = useFixtureGraph();

  it('KNOWN_ARTIFACT_IDS keeps artifact ids only (not decisions, not unknown ids)', async () => {
    const rows = await fx.graph.roQuery<{ id: string }>(fx.name, KNOWN_ARTIFACT_IDS, { values: ['T-1', 'PR-2', 'D-1', 'NOPE-1'] });
    expect(rows.map((r) => r.id).sort()).toEqual(['PR-2', 'T-1']);
  });

  it('KNOWN_PERSON_OR_SYSTEM_NAMES keeps people and systems (not departments, not unknown names)', async () => {
    const rows = await fx.graph.roQuery<{ name: string }>(fx.name, KNOWN_PERSON_OR_SYSTEM_NAMES, {
      values: ['Ada', 'TitanDB', 'Engineering_Backend', 'Nobody'],
    });
    expect(rows.map((r) => r.name).sort()).toEqual(['Ada', 'TitanDB']);
  });

  it('KNOWLEDGE_SHARE_AS_OF: systems where the person holds a big share of everyone\'s knowledge as of a day', async () => {
    const params = { person: 'Ada', asOfDay: 12, minShare: 0.25, minScore: 0.4, minMentions: 0, limit: 10 };
    const rows = await fx.graph.roQuery<{ system: string; score: number; share: number }>(fx.name, KNOWLEDGE_SHARE_AS_OF, params);
    // Only Ada touched PaymentsAPI, so she holds all of it; biggest share first.
    expect(rows[0]).toMatchObject({ system: 'PaymentsAPI', share: 1 });
    expect(rows.map((r) => r.system)).toContain('TitanDB');
    rows.forEach((r) => expect(r.share).toBeGreaterThanOrEqual(0.25));
    // Before Ada's first PaymentsAPI work (day 2) she holds nothing there.
    const early = await fx.graph.roQuery<{ system: string }>(fx.name, KNOWLEDGE_SHARE_AS_OF, { ...params, asOfDay: 1 });
    expect(early.map((r) => r.system)).not.toContain('PaymentsAPI');
    // Systems named in fewer documents than minMentions are left out (fixture systems carry no mentionCount).
    expect(await fx.graph.roQuery(fx.name, KNOWLEDGE_SHARE_AS_OF, { ...params, minMentions: 1 })).toEqual([]);
  });
});
