import { ActionSchema, ApiErrorSchema, ArtifactSchema, IngestGraphSchema, PersonSchema } from '../index';

describe('shared schemas', () => {
  it('accepts a valid person', () => {
    const person = { name: 'Ada Example', dept: 'Engineering', firstDay: 1, lastDay: null, active: true };
    expect(PersonSchema.parse(person)).toEqual(person);
  });

  it('rejects an artifact with an unknown type', () => {
    const result = ArtifactSchema.safeParse({
      id: 'a1', type: 'Spreadsheet', title: 't', day: 3, isIncident: false, bodyLength: 10,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an action with an empty reason', () => {
    const result = ActionSchema.safeParse({ id: 'x', kind: 'runbook_task', status: 'proposed', day: 1, reason: '' });
    expect(result.success).toBe(false);
  });

  it('accepts the ApiError shape', () => {
    const err = { statusCode: 404, error: 'NOT_FOUND', message: 'nope', path: '/x', timestamp: new Date().toISOString() };
    expect(ApiErrorSchema.parse(err)).toEqual(err);
  });

  it('allows ingestion only into apex or apex_replay* graphs', () => {
    for (const ok of ['apex', 'apex_replay', 'apex_replaytest', 'apex_replay_2']) {
      expect(IngestGraphSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of ['keystone_health', 'apex_proj', 'apex_backup', 'test_x', 'apex_replay; DROP', 'apex_replayX']) {
      expect(IngestGraphSchema.safeParse(bad).success).toBe(false);
    }
  });
});
