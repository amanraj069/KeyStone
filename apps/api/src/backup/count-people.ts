import type { GraphService } from '../graph/graph.service';
import { PERSON_COUNT } from './queries/backup.queries';

/** Person nodes in `graphName`; 0 when the graph does not exist (a read on a missing graph fails). */
export async function countPeople(graph: GraphService, graphName: string): Promise<number> {
  if (!(await graph.graphExists(graphName))) return 0;
  const [row] = await graph.roQuery<{ people: number }>(graphName, PERSON_COUNT);
  return row?.people ?? 0;
}
