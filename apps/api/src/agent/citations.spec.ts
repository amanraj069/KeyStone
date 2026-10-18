import { compactCitations, tidy } from './citations';

describe('tidy', () => {
  it('collapses the full stop a dropped citation leaves doubled, but keeps an ellipsis', () => {
    expect(tidy('He leaves.. Done')).toBe('He leaves. Done');
    expect(tidy('Wait... then go .')).toBe('Wait... then go.');
    expect(tidy('Really?. Yes')).toBe('Really? Yes');
  });
});

describe('compactCitations', () => {
  it('merges neighbouring groups and shows at most three ids in one place', () => {
    expect(compactCitations('Priya leads it [A] [B] [C] [D] [E].')).toBe('Priya leads it [A, B, C].');
  });

  it('drops a group that only repeats what was just cited', () => {
    expect(compactCitations('Priya leads it [A, B]. [A, B]')).toBe('Priya leads it [A, B].');
    expect(compactCitations('Jax [A] [B]; Deepa [C]. [A, B, C]')).toBe('Jax [A, B]; Deepa [C].');
  });

  it('keeps a later citation of the same id after new text', () => {
    expect(compactCitations('She wrote it [A]. She reviewed it [A].')).toBe('She wrote it [A]. She reviewed it [A].');
  });

  it('drops a line that only lists sources', () => {
    const text = 'Priya leads it [A].\n- The evidence includes the following artifacts: [A] [B] [C] [D]\nDone.';
    expect(compactCitations(text)).toBe('Priya leads it [A].\nDone.');
  });

  it('leaves Markdown links and text without citations alone', () => {
    expect(compactCitations('See [the docs](https://x.y) for more.')).toBe('See [the docs](https://x.y) for more.');
  });
});
