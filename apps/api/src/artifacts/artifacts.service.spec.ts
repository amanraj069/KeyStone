import { descriptionWords, looksBroadcast, rarity, snippet } from './artifacts.service';

describe('artifact helpers', () => {
  it('looksBroadcast: incidents, outages, postmortems and knowledge gaps are broadcast; private documents are not', () => {
    expect(looksBroadcast('P1 incident Redis cache TTL misconfiguration')).toBe(true);
    expect(looksBroadcast('the incident resolved event')).toBe(true);
    expect(looksBroadcast('a postmortem being written')).toBe(true);
    expect(looksBroadcast('a knowledge gap in auth-service')).toBe(true);
    expect(looksBroadcast('vendor email routed')).toBe(false);
    expect(looksBroadcast('a PR review')).toBe(false);
    expect(looksBroadcast('a Confluence page was created')).toBe(false);
    expect(looksBroadcast('a watercooler chat')).toBe(false);
  });

  it("descriptionWords keeps the words that can identify a document, not stopwords, numbers or the people's names", () => {
    expect(descriptionWords('Was a postmortem created for the incident on Day 13 involving Yusuf?', ['Yusuf'])).toEqual(['postmortem', 'incident']);
    expect(descriptionWords('Metro United FC email email')).toEqual(['metro', 'united', 'email']);
    expect(descriptionWords('')).toEqual([]);
  });

  it('snippet shows the text around a match, marking cuts', () => {
    const body = `${'a'.repeat(300)} Metro United ${'b'.repeat(300)}`;
    const cut = snippet(body, body.indexOf('Metro'), 'metro united'.length);
    expect(cut.startsWith('…')).toBe(true);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).toContain('Metro United');
    expect(snippet('short Metro text', 6, 5)).toBe('short Metro text');
  });

  it('rarity: a word in every text weighs 0, a word in one of many weighs close to 1', () => {
    const texts = ['incident on kafka', 'incident on redis', 'incident on metro united', 'incident report'];
    const weight = rarity(['incident', 'metro', 'absent'], texts);
    expect(weight.get('incident')).toBeCloseTo(0);
    expect(weight.get('metro')!).toBeGreaterThan(0.5);
    expect(weight.get('absent')).toBeCloseTo(1);
  });
});
