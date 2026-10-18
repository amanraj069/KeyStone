import { countMentions, passageNaming } from './text-match';

describe('countMentions', () => {
  it('counts whole-word mentions of a name and its aliases, ignoring case', () => {
    expect(countMentions('TitanDB is slow. titandb pool. Titan DB too. TitanDBs no.', ['TitanDB', 'Titan DB'])).toBe(3);
  });

  it('skips names too short to match safely', () => {
    expect(countMentions('Go go GO', ['Go'])).toBe(0);
  });
});

describe('passageNaming', () => {
  const body = [
    '# Design: Request budget status from Finance',
    '**Author:** Priya',
    '',
    'We need the budget numbers by Friday. The TitanDB migration needs two more RDS instances. Thanks.',
  ].join('\n');

  it('returns the sentence that names the subject, not the title or metadata', () => {
    expect(passageNaming(body, ['TitanDB'])).toBe('The TitanDB migration needs two more RDS instances.');
  });

  it('does not end a sentence at a dot inside a word', () => {
    expect(passageNaming('A misconfigured max.poll.interval.ms in Kafka throttled commits. Next.', ['Kafka'])).toBe(
      'A misconfigured max.poll.interval.ms in Kafka throttled commits.',
    );
  });

  it('skips email and ticket header lines that only repeat the title', () => {
    const email = 'title: Urgent: TitanDB schema change\nfrom: vendor\n\nPlease plan the TitanDB upgrade before Friday.';
    expect(passageNaming(email, ['TitanDB'])).toBe('Please plan the TitanDB upgrade before Friday.');
  });

  it('tries names in order and returns null when none appears', () => {
    expect(passageNaming(body, ['Kafka', 'budget'])).toBe('We need the budget numbers by Friday.');
    expect(passageNaming(body, ['Kafka'])).toBeNull();
  });

  it('cuts a long sentence around the name', () => {
    const long = `${'word '.repeat(80)}TitanDB ${'tail '.repeat(80)}.`;
    const passage = passageNaming(long, ['TitanDB']) ?? '';
    expect(passage).toContain('TitanDB');
    expect(passage.length).toBeLessThanOrEqual(242);
    expect(passage.startsWith('…')).toBe(true);
  });
});
