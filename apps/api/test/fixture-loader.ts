import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphService } from '../src/graph/graph.service';

/**
 * Splits a .cypher fixture into statements: drops `//` comment lines and
 * splits on semicolons at the end of a line. FalkorDB runs one statement per query.
 */
export function fixtureStatements(name: string): string[] {
  const text = readFileSync(join(__dirname, 'fixtures', `${name}.cypher`), 'utf8');
  const withoutComments = text
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
  return withoutComments
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

/** Runs every statement of a fixture file against `graphName`. */
export async function loadFixture(graph: GraphService, graphName: string, name: string): Promise<void> {
  for (const statement of fixtureStatements(name)) {
    await graph.query(graphName, statement);
  }
}
