import { samplePerType, seededRandom } from './sampling';

const items = [
  ...Array.from({ length: 20 }, (_, i) => ({ id: `a-${String(i).padStart(2, '0')}`, type: 'A' })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `b-${i}`, type: 'B' })),
];
const pick = (list: typeof items, perType: number, seed: number) =>
  samplePerType(list, (x) => x.type, (x) => x.id, perType, seed).map((x) => x.id);

describe('sampling', () => {
  it('the same seed gives the same numbers', () => {
    const a = seededRandom(13);
    const b = seededRandom(13);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('takes up to perType per type, grouped by type, and is stable across runs and file order', () => {
    const first = pick(items, 5, 13);
    expect(first.filter((id) => id.startsWith('a-'))).toHaveLength(5);
    expect(first.filter((id) => id.startsWith('b-'))).toEqual(['b-0', 'b-1', 'b-2', 'b-3']);
    expect(pick([...items].reverse(), 5, 13)).toEqual(first);
    expect(pick(items, 5, 14)).not.toEqual(first);
  });

  it("adding questions of one type does not change another type's sample", () => {
    const more = [...items, { id: 'b-9', type: 'B' }];
    expect(pick(more, 5, 13).filter((id) => id.startsWith('a-'))).toEqual(pick(items, 5, 13).filter((id) => id.startsWith('a-')));
  });
});
