import { APEX_GRAPH } from '../src/graph/graph.constants';
import type { GraphService } from '../src/graph/graph.service';
import { LIST_INDEXES } from '../src/graph/queries/schema.queries';
import { SchemaService } from '../src/graph/schema.service';
import { connectTestGraphService, testGraphName } from './graph-test-utils';

type IndexRow = { label: string; properties: string[]; types: Record<string, string[]> };

describe('SchemaService.ensureSchema on a fresh graph', () => {
  let graph: GraphService;
  const name = testGraphName();

  beforeAll(async () => {
    graph = await connectTestGraphService();
  });

  afterAll(async () => {
    await graph.deleteGraph(name).catch(() => undefined);
    await graph.onModuleDestroy();
  });

  it('creates all 7 indexes, and a second run changes nothing', async () => {
    const schema = new SchemaService(graph, 768);

    await expect(schema.ensureSchema(name)).resolves.toEqual({ created: 7, alreadyExisted: 0 });
    await expect(schema.ensureSchema(name)).resolves.toEqual({ created: 0, alreadyExisted: 7 });

    const rows = await graph.roQuery<IndexRow>(name, LIST_INDEXES);
    const indexes = rows
      .flatMap((row) => row.properties.map((property) => `${row.label}.${property}:${row.types[property].join('+')}`))
      .sort();
    expect(indexes).toEqual([
      'Action.id:RANGE',
      'Artifact.day:RANGE',
      'Artifact.id:RANGE',
      'Chunk.embedding:VECTOR',
      'Decision.id:RANGE',
      'Person.name:RANGE',
      'System.name:RANGE',
    ]);
  });

  it('never touches the real apex graph', () => {
    expect(name).not.toBe(APEX_GRAPH);
  });
});
