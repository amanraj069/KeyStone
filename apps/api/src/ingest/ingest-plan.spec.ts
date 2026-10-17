import { buildPlan, sliceFor } from './ingest-plan';
import { MINI_RECORDS } from '../../test/ingest-records';

describe('ingest plan', () => {
  const plan = buildPlan(MINI_RECORDS);

  it('lists the days that have artifacts, without the unknown day', () => {
    expect(plan.days).toEqual([1, 2, 3, 4]);
  });

  it('a full slice contains everything, grouped by label', () => {
    const slice = sliceFor(plan, () => true);
    const counts = Object.fromEntries([...slice.artifactsByLabel].map(([label, rows]) => [label, rows.length]));
    expect(counts).toEqual({ Ticket: 1, Meeting: 2, Thread: 3, Page: 1, PR: 1, Email: 3, Alert: 1 });
    expect(slice.people.map((p) => p.name)).toEqual(['Ada', 'Bo', 'Cy']);
  });

  it('a day slice holds only that day, its people and links touching it', () => {
    const day1 = sliceFor(plan, (r) => r.day === 1);
    expect([...day1.artifactsByLabel.values()].flat().map((a) => a.id).sort()).toEqual(['ENG-1', 'email_offer', 'zoom_1']);
    // Cy has no role on day 1 but RECEIVED the offer email, so Cy must exist for that edge.
    expect(day1.people.map((p) => p.name)).toEqual(['Ada', 'Bo', 'Cy']);
    expect(day1.seen).toEqual([{ rel: 'RECEIVED', person: 'Cy', artifactId: 'email_offer', day: 1 }]);
    // CONF-1 (day 2) -> ENG-1 (day 1) is in both slices; MERGE makes the repeat harmless.
    expect(day1.references).toContainEqual({ from: 'CONF-1', to: 'ENG-1', kind: 'jira' });
  });

  it('keeps long text out of the artifact rows', () => {
    const slice = sliceFor(plan, () => true);
    const zoom = slice.artifactsByLabel.get('Meeting')![0];
    expect(zoom).not.toHaveProperty('body');
    expect(zoom.bodyLength).toBeGreaterThan(0);
    expect(slice.bodies.find((b) => b.id === 'zoom_1')!.body).toContain('Bo:');
  });
});
