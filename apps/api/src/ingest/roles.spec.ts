import { rolesFor } from './roles';
import { buildRoster } from './roster';
import { MINI_RECORDS } from '../../test/ingest-records';

describe('rolesFor', () => {
  const roster = buildRoster(MINI_RECORDS);
  const rolesOf = (id: string) =>
    rolesFor(MINI_RECORDS.find((r) => r.doc_id === id)!, roster).map((r) => `${r.rel}:${r.person}`);

  it('slack: every employee speaker authored; bots and mentioned people do not', () => {
    expect(rolesOf('slack_product_2026-01-02T09:00:00')).toEqual(['AUTHORED:Bo', 'AUTHORED:Cy']);
  });

  it('zoom: every speaker authored', () => {
    expect(rolesOf('zoom_1')).toEqual(['AUTHORED:Bo', 'AUTHORED:Ada']);
  });

  it('confluence: the **Author:** line wins over the actors list', () => {
    expect(rolesOf('CONF-1')).toEqual(['AUTHORED:Ada']);
  });

  it('pr: author and reviewer', () => {
    expect(rolesOf('PR-1')).toEqual(['AUTHORED:Ada', 'REVIEWED:Bo']);
  });

  it('sprint jira: owners are ASSIGNED with the ticket status', () => {
    const [role] = rolesFor(MINI_RECORDS[0], roster);
    expect(role).toEqual({ rel: 'ASSIGNED', person: 'Ada', artifactId: 'ENG-1', day: 1, status: 'To Do' });
  });

  it('email: only an employee sender gets an edge', () => {
    expect(rolesOf('email_in')).toEqual([]);
    expect(rolesOf('email_out')).toEqual(['AUTHORED:Ada']);
  });

  it('alerts involve no people', () => {
    expect(rolesOf('DD-1')).toEqual([]);
  });
});
