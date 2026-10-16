import { mergeKey, planMerges } from './merge-key';

describe('mergeKey', () => {
  it.each([
    ['Telemetry Service', 'telemetry'],
    ['telemetry-service', 'telemetry'],
    ['Telemetry v2', 'telemetry'],
    ['Payments API', 'payments'],
    ['Java 8', 'java'],
    ['Java 17', 'java'],
    ['Terraform 1.5.7', 'terraform'],
    ['Go ingest service v2.14.3-rc1', 'goingest'],
    ['Redis cache', 'rediscache'],
  ])('%s -> %s', (name, key) => {
    expect(mergeKey(name)).toBe(key);
  });

  it('keeps digits that are part of the name', () => {
    expect(mergeKey('S3')).toBe('s3');
    expect(mergeKey('EC2')).toBe('ec2');
    expect(mergeKey('OAuth2')).toBe('oauth2');
    expect(mergeKey('HTTP 500')).toBe('http500');
  });

  it('keeps a generic word when it is the whole name, and rejects version-only names', () => {
    expect(mergeKey('API')).toBe('api');
    expect(mergeKey('PaymentsAPI')).toBe('paymentsapi');
    expect(mergeKey('v2.14.3-rc1')).toBeNull();
  });
});

describe('planMerges', () => {
  it('groups by key and keeps the most mentioned name', () => {
    const groups = planMerges([
      { name: 'Telemetry', mentionCount: 40, authorCount: 9 },
      { name: 'Telemetry service', mentionCount: 12, authorCount: 4 },
      { name: 'telemetry-service v2', mentionCount: 1, authorCount: 1 },
      { name: 'Kafka', mentionCount: 90, authorCount: 20 },
    ]);
    expect(groups).toEqual([{ keep: 'Telemetry', merge: ['Telemetry service', 'telemetry-service v2'] }]);
  });

  it('breaks ties by authors, then the shorter name', () => {
    const groups = planMerges([
      { name: 'Ledger API', mentionCount: 3, authorCount: 1 },
      { name: 'Ledger', mentionCount: 3, authorCount: 1 },
      { name: 'Ledger service', mentionCount: 3, authorCount: 2 },
    ]);
    expect(groups).toEqual([{ keep: 'Ledger service', merge: ['Ledger', 'Ledger API'] }]);
  });
});
