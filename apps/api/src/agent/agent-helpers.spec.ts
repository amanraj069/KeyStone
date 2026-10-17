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
