import { staleLinksPrompt } from './extract.prompts';
import { claimRows, decisionSource, spreadEvenly, validateLinks, worthExtracting } from './extract.service';
import { Canonicalizer } from './names';

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

describe('claimRows', () => {
  it('canonicalises the system name and gives stable ids, skipping unusable names', () => {
    const canon = new Canonicalizer(['TitanDB'], { 'Titan DB': 'TitanDB' });
    expect(
      claimRows('P-1', [{ claim: 'Backups run nightly', system: 'Titan DB' }, { claim: 'x', system: ' ' }, { claim: 'Uses TLS', system: 'titandb' }], canon),
    ).toEqual([
      { id: 'C:P-1:0', pageId: 'P-1', claim: 'Backups run nightly', system: 'TitanDB' },
      { id: 'C:P-1:2', pageId: 'P-1', claim: 'Uses TLS', system: 'TitanDB' },
    ]);
  });
});

describe('staleLinksPrompt', () => {
  it('lists decisions oldest first and the day each page was written', () => {
    const prompt = staleLinksPrompt({
      system: 'TitanDB',
      decisions: [{ id: 'D:1', day: 3, summary: 'Weekly backups' }],
      claims: [{ pageId: 'P-3', pageDay: null, claim: 'Backups are weekly' }],
    });
    expect(prompt).toContain('- D:1 (day 3): Weekly backups');
    expect(prompt).toContain('- P-3 (page written day ?): Backups are weekly');
  });
});

describe('validateLinks id repair', () => {
  it('restores a dropped "D:" prefix when that names a given decision', () => {
    const input = {
      system: 'TitanDB',
      decisions: [
        { id: 'D:A:0', day: 1, summary: 'old' },
        { id: 'D:B:0', day: 5, summary: 'new' },
      ],
      claims: [{ pageId: 'P-1', claim: 'old way' }],
    };
    const result = validateLinks(input, {
      supersedes: [{ newerId: 'B:0', olderId: 'D:A:0' }],
      asserts: [{ pageId: 'P-1', decisionId: 'A:0' }, { pageId: 'P-1', decisionId: 'Z:9' }],
    });
    expect(result).toEqual({
      supersedes: [{ newerId: 'D:B:0', olderId: 'D:A:0' }],
      asserts: [{ pageId: 'P-1', decisionId: 'D:A:0' }],
      rejected: 1,
    });
  });
});

describe('same-artifact SUPERSEDES', () => {
  it('reads the source artifact from a decision id (ids may contain colons)', () => {
    expect(decisionSource('D:slack_eng_2026-01-15T12:18:00:2')).toBe('D:slack_eng_2026-01-15T12:18:00');
  });

  it('rejects a decision superseding another one from the same artifact', () => {
    const input = {
      system: 'CI',
      decisions: [
        { id: 'D:CONF-1:0', day: 3, summary: 'add latency tests' },
        { id: 'D:CONF-1:3', day: 3, summary: 'deploy PR builds to a namespace' },
        { id: 'D:CONF-2:0', day: 9, summary: 'drop latency tests' },
      ],
      claims: [],
    };
    const result = validateLinks(input, {
      supersedes: [
        { newerId: 'D:CONF-1:3', olderId: 'D:CONF-1:0' },
        { newerId: 'D:CONF-2:0', olderId: 'D:CONF-1:0' },
      ],
      asserts: [],
    });
    expect(result.supersedes).toEqual([{ newerId: 'D:CONF-2:0', olderId: 'D:CONF-1:0' }]);
    expect(result.rejected).toBe(1);
  });
});
