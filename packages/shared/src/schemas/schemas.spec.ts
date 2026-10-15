import { ActionSchema, ApiErrorSchema, ArtifactSchema, PersonSchema } from '../index';

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
});
