import { dropStrayVerdict, passageTerms, toolArgNames, triageHint } from './agent.service';
import { checkCitations, citedIds } from './citations';
import { unionGraphPaths } from './graph-union';
import { toGeminiDeclarations, toOpenAiTools } from './tool-specs';

describe('tool specs from MCP', () => {
  const spec = {
    name: 'who_knows',
    description: 'Who knows a system.',
    inputSchema: { $schema: 'http://json-schema.org/draft-07/schema#', type: 'object', properties: { system: { type: 'string' } }, required: ['system'] },
  };

  it('become OpenAI function tools and Gemini declarations with the same schema', () => {
    const parameters = { type: 'object', properties: { system: { type: 'string' } }, required: ['system'] };
    expect(toOpenAiTools([spec])).toEqual([{ type: 'function', function: { name: 'who_knows', description: 'Who knows a system.', parameters } }]);
    expect(toGeminiDeclarations([spec])).toEqual([{ name: 'who_knows', description: 'Who knows a system.', parametersJsonSchema: parameters }]);
  });

  it('a tool without arguments still gets an object schema', () => {
    expect(toOpenAiTools([{ name: 'find_stale_docs', description: 'x', inputSchema: {} }])[0].function.parameters).toEqual({ type: 'object', properties: {} });
  });
});

describe('citations', () => {
  const evidence = new Set(['CONF-ENG-443', 'T-1', 'slack_digital-hq_2026-03-31T14:18:22.776802']);

  it('finds ids in single and grouped brackets, ignoring Markdown links', () => {
    expect(citedIds('Priya leads [CONF-ENG-443]. Ben helps [T-1, FAKE-9]. See [docs](http://x).')).toEqual(['CONF-ENG-443', 'T-1', 'FAKE-9']);
  });

  it('drops ids that are not in the evidence and keeps the rest', () => {
    const checked = checkCitations(
      'Priya knows TitanDB best [CONF-ENG-443]. Ben reviewed it [T-1, FAKE-9]. Nobody else [FAKE-1]. Thread [slack_digital-hq_2026-03-31T14:18:22.776802].',
      evidence,
    );
    expect(checked.text).toBe(
      'Priya knows TitanDB best [CONF-ENG-443]. Ben reviewed it [T-1]. Nobody else. Thread [slack_digital-hq_2026-03-31T14:18:22.776802].',
    );
    expect(checked.valid).toEqual(['CONF-ENG-443', 'T-1', 'slack_digital-hq_2026-03-31T14:18:22.776802']);
    expect(checked.dropped).toEqual(['FAKE-9', 'FAKE-1']);
  });
});

describe('unionGraphPaths', () => {
  it('merges nodes by id and edges by source, target and type', () => {
    const merged = unionGraphPaths([
      { nodes: [{ id: 1, name: 'Ada' }, { id: 2, name: 'T-1' }], edges: [{ source: 1, target: 2, type: 'AUTHORED' }] },
      null,
      { nodes: [{ id: 'person:Ada' }, { id: 2, name: 'T-1' }], edges: [{ source: 1, target: 2, type: 'AUTHORED' }, { source: 'person:Ada', target: 2, type: 'KNOWS' }] },
    ]);
    expect(merged.nodes).toHaveLength(3);
    expect(merged.edges).toHaveLength(2);
  });
});

describe('triageHint', () => {
  it('sends who-should-handle questions about an alert to triage_incident, with the id', () => {
    expect(triageHint('The Datadog alert DD-ENG-230 just fired. Who should handle it?', 'who_knows')).toContain('triage_incident with incident "DD-ENG-230"');
    expect(triageHint('Who is on-call for this outage?', 'general')).toContain('find_artifacts');
  });

  it('leaves other questions and other question types alone', () => {
    expect(triageHint('Who knows TitanDB best?', 'who_knows')).toBeNull();
    expect(triageHint('Did anyone follow up on the ENG-186 incident?', 'event')).toBeNull();
  });
});

describe('citation passages', () => {
  it('takes subject names from tool arguments, once each, in call order', () => {
    const calls = [{ args: { system: 'TitanDB' } }, { args: { person: 'Priya', minScore: 0.4 } }, { args: { system: 'TitanDB', eventPeople: ['Jax'] } }];
    expect(toolArgNames(calls)).toEqual(['TitanDB', 'Priya', 'Jax']);
  });

  it('looks first for systems the answer talks about, then for the tool arguments', () => {
    const terms = passageTerms(['Finance', 'Shared drive', 'TitanDB', 'Go'], 'What breaks if Priya leaves?\nShared drive loses its last expert [A].', ['Priya']);
    expect(terms).toEqual(['Shared drive', 'Priya']);
  });
});

describe('dropStrayVerdict', () => {
  it('removes a "Yes." the model put before an answer to a who/what question', () => {
    expect(dropStrayVerdict('Yes. TitanDB is best known by Priya [A].', 'Who knows TitanDB best, and what breaks if they leave?')).toBe(
      'TitanDB is best known by Priya [A].',
    );
    expect(dropStrayVerdict('No, nobody owns it [A].', 'Which systems have no owner?')).toBe('Nobody owns it [A].');
  });

  it('keeps the verdict on a yes/no question', () => {
    expect(dropStrayVerdict('No: nothing followed it [A].', 'Did anyone follow up on the outage?')).toBe('No: nothing followed it [A].');
    expect(dropStrayVerdict('Yes. She was in the thread [A].', 'Could Priya have known about it by day 8?')).toBe('Yes. She was in the thread [A].');
  });

  it('leaves "No one…" alone: that is content, not a verdict', () => {
    expect(dropStrayVerdict('No one else knows it [A].', 'Who else knows TitanDB?')).toBe('No one else knows it [A].');
  });
});
