import { closestNames } from './closest-names';

describe('closestNames', () => {
  const systems = [
    { name: 'TitanDB', aliases: ['TiDB', 'Titan DB'] },
    { name: 'PostgreSQL', aliases: ['Postgres'] },
    { name: 'Kafka' },
    { name: 'Kafka Streams' },
    { name: 'Redis cache' },
    { name: 'Grafana' },
  ];

  it('finds near misses, case and punctuation insensitive', () => {
    expect(closestNames('titan-db', systems, 1)).toEqual(['TitanDB']);
    expect(closestNames('Titandb ', systems, 1)).toEqual(['TitanDB']);
    expect(closestNames('Grafanna', systems, 1)).toEqual(['Grafana']);
  });

  it('uses aliases, and ranks containment close', () => {
    expect(closestNames('postgres', systems, 1)).toEqual(['PostgreSQL']);
    expect(closestNames('kafka', systems, 2)).toEqual(['Kafka', 'Kafka Streams']);
  });

  it('returns at most `limit` names, and nothing for an empty query', () => {
    expect(closestNames('x', systems)).toHaveLength(5);
    expect(closestNames('  ', systems)).toEqual([]);
  });
});
