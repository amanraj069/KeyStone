import type { BusFactorRow } from '@keystone/shared';
import { closestDecisions, decisionWords } from '../extract/extract.service';
import { rolesFor } from '../ingest/roles';
import { departuresIn } from '../ingest/departures';
import { liveId, riskChanges, toRecord } from './live.service';

describe('live documents', () => {
  it('toRecord shapes a Slack message so ingestion reads one speaker (AUTHORED) and finds a departure', () => {
    const record = toRecord({ type: 'slack', author: 'Jax', channel: 'digital-hq', text: "Priya's last day is today." }, 'LIVE-1', 60);
    expect(record).toMatchObject({ doc_id: 'LIVE-1', doc_type: 'slack', title: '#digital-hq', body: "Jax: Priya's last day is today.", day: 60, actors: ['Jax'] });
    const roster = { companyDomain: null, people: [], depts: [], isEmployee: (n: string) => ['Jax', 'Priya'].includes(n) };
    expect(rolesFor(record, roster)).toEqual([expect.objectContaining({ rel: 'AUTHORED', person: 'Jax', artifactId: 'LIVE-1', day: 60 })]);
    expect(departuresIn(record, roster, null)).toEqual([{ person: 'Priya', artifactId: 'LIVE-1', departedDay: 60 }]);
  });

  it('toRecord gives a page an Author line and its title', () => {
    const record = toRecord({ type: 'confluence', author: 'Nadia', title: 'TitanDB runbook v2', text: 'Use RDS Proxy for all connections.' }, 'LIVE-2', 60);
    expect(record.title).toBe('TitanDB runbook v2');
    expect(record.body).toBe('# TitanDB runbook v2\n**Author:** Nadia\n\nUse RDS Proxy for all connections.');
  });

  it('liveId is sortable and marked LIVE', () => {
    expect(liveId(new Date('2026-10-18T09:05:07.123Z'))).toMatch(/^LIVE-20261018T090507-[0-9a-f]{4}$/);
  });

  it('closestDecisions ranks earlier decisions by shared rare words and drops unrelated ones', () => {
    const added = [{ id: 'N', day: 60, summary: 'Revert TitanDB RDS max_pool_size from 80 back to 200.' }];
    const earlier = [
      { id: 'a', day: 2, summary: 'Persist pacing recommendations in TitanDB.' },
      { id: 'b', day: 24, summary: 'Lowering max_pool_size from 200 to 80 on TitanDB RDS param group.' },
      { id: 'c', day: 9, summary: 'Use Kafka for wearables ingestion.' },
      { id: 'd', day: 12, summary: 'Add TitanDB read replicas.' },
    ];
    // b shares the rare words (max_pool_size, 200, rds); "titandb" is in three of four, so it barely counts.
    // a and d tie on it and the newer one (d) wins the second place; c shares nothing. Returned in day order.
    expect(closestDecisions(added, earlier, 2).map((d) => d.id)).toEqual(['d', 'b']);
    expect(closestDecisions(added, earlier, 10).map((d) => d.id)).toEqual(['a', 'd', 'b']);
    expect(decisionWords('Revert the TitanDB RDS max_pool_size')).toEqual(new Set(['revert', 'titandb', 'rds', 'max_pool_size']));
  });

  it('riskChanges lists only systems whose level moved, most at risk first', () => {
    const row = (system: string, riskLevel: BusFactorRow['riskLevel'], names: string[]): BusFactorRow => ({ system, experts: names.length, riskLevel, names, evidence: [] });
    const before = new Map([['TitanDB', row('TitanDB', 'watch', ['Jax', 'Priya'])], ['Kafka', row('Kafka', 'ok', ['A', 'B', 'C'])], ['Helm', row('Helm', 'critical', ['Priya'])]]);
    const after = new Map([['TitanDB', row('TitanDB', 'critical', ['Jax'])], ['Kafka', row('Kafka', 'ok', ['A', 'B', 'C'])], ['Helm', row('Helm', 'orphaned', [])]]);
    expect(riskChanges(before, after)).toEqual([
      { system: 'Helm', before: 'critical', after: 'orphaned', expertsAfter: [] },
      { system: 'TitanDB', before: 'watch', after: 'critical', expertsAfter: ['Jax'] },
    ]);
  });
});
