import { buildVocabulary } from './vocabulary';

describe('buildVocabulary', () => {
  // Each system name appears mid-sentence (capitalised) in 3+ texts; "Thanks", "Monday",
  // "Priya" and "Metro United" also appear but must be filtered out.
  const texts = [
    'We moved the queue to Kafka today. Thanks Priya, the TitanDB migration on Monday went fine.',
    'Lag again on Kafka; the TitanDB nodes are slow. The UI team is aware. Metro United asked.',
    'Restarted Kafka and checked the Grafana board. TitanDB backups ok.',
    'Both TitanDB and Kafka are green on the Grafana board.',
    'An alert fired in Grafana. The fix is in.',
    'The service runs on Spring Boot now. **Jax:** Alright, ship it.',
    'We upgraded Spring Boot again. **Jax:** Alright then.',
    'Our Spring Boot app is fine. **Jax:** Alright.',
    'It is Terraform-managed now, and Terraform-managed later, so Terraform-managed it is.',
    'Still Terraform-managed. Also Terraform-managed. Yes Terraform-managed.',
    'Again Terraform-managed here.',
  ];

  const vocabulary = buildVocabulary({
    texts,
    pageTitles: ['Project Titan: CloudWatch rollout', 'Purpose'],
    actorNames: ['Priya', 'Metro United FC'],
    aliases: { TiDB: 'TitanDB' },
    ignore: ['UI', 'The'],
  });

  it('keeps names capitalised mid-sentence in 3+ artifacts', () => {
    expect(vocabulary).toEqual(expect.arrayContaining(['TitanDB', 'Kafka', 'Grafana']));
  });

  it('adds system-looking words from Page titles', () => {
    expect(vocabulary).toContain('CloudWatch');
  });

  it('keeps two-word names and drops words that only appear inside them', () => {
    expect(vocabulary).toContain('Spring Boot');
    expect(vocabulary).not.toContain('Boot');
    expect(vocabulary).not.toContain('Spring');
  });

  it('drops people, organisations, calendar words, ignored words and alias variants', () => {
    for (const word of ['Priya', 'Metro', 'United', 'Monday', 'UI', 'The', 'Thanks', 'TiDB', 'Purpose', 'Alright', 'Jax', 'Terraform-managed']) {
      expect(vocabulary).not.toContain(word);
    }
  });

  it('puts canonical alias targets first and never repeats a name', () => {
    expect(vocabulary[0]).toBe('TitanDB');
    expect(new Set(vocabulary.map((v) => v.toLowerCase())).size).toBe(vocabulary.length);
  });
});
