import { tidy } from './citations';

describe('tidy', () => {
  it('collapses the full stop a dropped citation leaves doubled, but keeps an ellipsis', () => {
    expect(tidy('He leaves.. Done')).toBe('He leaves. Done');
    expect(tidy('Wait... then go .')).toBe('Wait... then go.');
    expect(tidy('Really?. Yes')).toBe('Really? Yes');
  });
});
