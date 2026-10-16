import { spreadEvenly, validateLinks, worthExtracting } from './extract.service';

describe('validateLinks', () => {
  const input = {
    system: 'TitanDB',
    decisions: [
      { id: 'D:a:0', day: 3, summary: 'old' },
      { id: 'D:b:0', day: 10, summary: 'new' },
    ],
    claims: [{ pageId: 'P-1', claim: 'x' }],
  };

  it('keeps valid links', () => {
    const result = validateLinks(input, {
      supersedes: [{ newerId: 'D:b:0', olderId: 'D:a:0' }],
      asserts: [{ pageId: 'P-1', decisionId: 'D:a:0' }],
    });
    expect(result).toMatchObject({ rejected: 0, supersedes: [{ newerId: 'D:b:0' }], asserts: [{ pageId: 'P-1' }] });
  });

  it('rejects unknown ids, self links and an older decision superseding a newer one', () => {
    const result = validateLinks(input, {
      supersedes: [
        { newerId: 'D:a:0', olderId: 'D:b:0' },
        { newerId: 'D:b:0', olderId: 'D:b:0' },
        { newerId: 'D:zzz', olderId: 'D:a:0' },
      ],
      asserts: [{ pageId: 'P-unknown', decisionId: 'D:a:0' }],
    });
    expect(result).toEqual({ supersedes: [], asserts: [], rejected: 4 });
  });
});

describe('spreadEvenly', () => {
  it('picks items spread over the whole list', () => {
    expect(spreadEvenly([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 3)).toEqual([0, 3, 6]);
  });

  it('returns everything when asked for more than there is', () => {
    expect(spreadEvenly([1, 2], 5)).toEqual([1, 2]);
  });
});

describe('worthExtracting', () => {
  it('extracts tickets whatever their length, but not empty ones', () => {
    expect(worthExtracting('Ticket', 'title: upgrade EKS networking to pod ENIs', 300)).toBe(true);
    expect(worthExtracting('Ticket', '   ', 300)).toBe(false);
  });

  it('needs more than minBodyChars for every other type', () => {
    expect(worthExtracting('Thread', 'x'.repeat(300), 300)).toBe(false);
    expect(worthExtracting('Thread', 'x'.repeat(301), 300)).toBe(true);
  });
});
