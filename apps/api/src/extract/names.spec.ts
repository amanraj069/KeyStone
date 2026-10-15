import { Canonicalizer, nameKey, normalizeName } from './names';

describe('normalizeName', () => {
  it('turns Unicode dashes and spaces into ASCII and trims edge punctuation', () => {
    expect(normalizeName('  terraform\u2011infra. ')).toBe('terraform-infra');
    expect(normalizeName('"Redis\u00a0cache",')).toBe('Redis cache');
  });

  it('compares names case-insensitively', () => {
    expect(nameKey('Redis Cache')).toBe(nameKey('redis cache'));
  });
});

describe('Canonicalizer', () => {
  const canon = new Canonicalizer(['TitanDB', 'Redis', 'Kafka'], { TiDB: 'TitanDB', 'Titan DB': 'TitanDB' });

  it('maps aliases to their canonical name', () => {
    expect(canon.canonical('TiDB')).toBe('TitanDB');
    expect(canon.canonical('titan db')).toBe('TitanDB');
  });

  it('matches the vocabulary case-insensitively', () => {
    expect(canon.canonical('kafka')).toBe('Kafka');
  });

  it('keeps unknown names as new systems, normalised', () => {
    expect(canon.canonical('Flink\u2011SQL')).toBe('Flink-SQL');
  });

  it('rejects empty or absurdly long names', () => {
    expect(canon.canonical(' ')).toBeNull();
    expect(canon.canonical('x'.repeat(100))).toBeNull();
  });

  it('merges spelling-only variants (stray spaces, hyphens, case)', () => {
    const c = new Canonicalizer(['CloudBees', 'terraform-infra'], {});
    expect(c.canonical('Cloud Be es')).toBe('CloudBees');
    expect(c.canonical('terraform-inf ra')).toBe('terraform-infra');
    expect(c.canonical('Redis cache')).toBe('Redis cache');
    expect(c.canonical('redis-cache')).toBe('Redis cache'); // first spelling seen wins for new names
  });

  it('remembers the spellings that mapped to each name', () => {
    expect(canon.aliasesOf('TitanDB')).toEqual(['TiDB', 'titan db']);
  });
});
