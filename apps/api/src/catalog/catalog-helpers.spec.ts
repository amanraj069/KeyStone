import { withMergedAliases } from './alias-update';
import { validateProposals } from './merge-proposals';

describe('withMergedAliases', () => {
  const file = { _comment: 'x', aliases: { 'Telemetry svc': 'Telemetry service', TiDB: 'TitanDB' }, ignore: ['Team'] };

  it('adds merged names as aliases and redirects aliases that pointed at them', () => {
    const next = withMergedAliases(file, [{ keep: 'Telemetry', merge: ['Telemetry service', 'telemetry'] }]);
    expect(next.aliases).toEqual({
      'Telemetry svc': 'Telemetry',
      TiDB: 'TitanDB',
      'Telemetry service': 'Telemetry',
      // "telemetry" differs from "Telemetry" only in spelling: no alias needed.
    });
    expect(next.ignore).toEqual(['Team']);
    expect(file.aliases['Telemetry svc']).toBe('Telemetry service'); // input untouched
  });
});

describe('validateProposals', () => {
  const systems = [
    { name: 'Kafka', mentionCount: 90, authorCount: 20 },
    { name: 'Kafka broker cluster', mentionCount: 5, authorCount: 2 },
    { name: 'Redis cache', mentionCount: 50, authorCount: 10 },
    { name: 'Redis', mentionCount: 60, authorCount: 12 },
  ];

  it('keeps known names only, one group per name, survivor = most mentioned', () => {
    const groups = validateProposals(
      {
        groups: [
          { canonical: 'Kafka broker cluster', members: ['Kafka broker cluster', 'Kafka', 'Invented'], reason: 'same cluster' },
          { canonical: 'Kafka', members: ['Kafka', 'Redis'], reason: 'reused name' },
          { canonical: 'Nope', members: ['Nope', 'Other'], reason: 'unknown names' },
        ],
      },
      systems,
    );
    expect(groups).toEqual([{ keep: 'Kafka', merge: ['Kafka broker cluster'], reason: 'same cluster' }]);
  });
});
