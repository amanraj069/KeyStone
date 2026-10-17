import { scratchCreatedAt, scratchId } from './whatif.service';

describe('scratch graph ids', () => {
  it('carry their creation time, so sweepers can tell leftovers from copies in use', () => {
    const id = scratchId(1_760_000_000_000);
    expect(id).toMatch(/^[0-9a-z]+_[0-9a-f]{8}$/);
    expect(scratchCreatedAt(id)).toBe(1_760_000_000_000);
  });

  it('an id without a time is treated as unknown', () => {
    expect(scratchCreatedAt('leftover')).toBeNull();
  });
});
