import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { APEX_GRAPH } from '../graph/graph.constants';
import { type BatchRow, GraphService } from '../graph/graph.service';
import { fileStamp } from './actions-export.service';
import { EXPORT_PAGE, EXPORT_STORE, EXPORTS_DIR, LATEST_MEMORY_EXPORT, RESTORE_BATCH } from './backup.constants';
import { countPeople } from './count-people';
import type { ExportStore } from './export-store';
import { GraphLock } from './graph-lock';
import * as Q from './queries/backup.queries';

const MEMORY_LABELS = ['User', 'Session', 'Turn', 'Feedback', 'Note'] as const;

/** One line of memory-*.jsonl: a memory node and its outgoing edges (EXPORT_MEMORY). */
export const ExportedMemorySchema = z.object({
  label: z.enum(MEMORY_LABELS),
  id: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  edges: z.array(z.object({ type: z.string(), toKind: z.string(), to: z.string() })),
});
export type ExportedMemory = z.infer<typeof ExportedMemorySchema>;

export type MemoryExportResult = { status: 'done'; nodes: number; files: string[] } | { status: 'skipped'; reason: string };

export interface MemoryRestoreSummary {
  source: string | null;
  nodes: number;
  edges: number;
  /** Edges of a kind this version does not know (left out). */
  unknownEdges: number;
}

/**
 * The agent's memory (chats, feedback, notes) is made by people, like Actions, so
 * it cannot be rebuilt from artifacts.jsonl. Same scheme as ActionsExportService:
 * exports/memory-<timestamp>.jsonl plus memory-latest.jsonl every 6 hours, and the
 * seed and a restore put them back once the rebuilt graph has its artifacts,
 * systems and people (edges to ends that no longer exist are skipped).
 */
@Injectable()
export class MemoryExportService {
  private readonly logger = new Logger(MemoryExportService.name);

  constructor(
    private readonly graph: GraphService,
    @Inject(EXPORT_STORE) private readonly store: ExportStore,
    private readonly lock: GraphLock,
  ) {}

  /** Exports apex's memory; skipped while a seed or restore runs, or when apex has no people (half-built). */
  async exportNow(graphName = APEX_GRAPH): Promise<MemoryExportResult> {
    const holder = await this.lock.holder();
    if (holder && holder.op !== 'backup') return this.skip(`a ${holder.op} is running`);
    if ((await countPeople(this.graph, graphName)) === 0) return this.skip(`${graphName} has no Person nodes`);
    const nodes = await this.readMemory(graphName);
    const files = await this.save(nodes, [`${EXPORTS_DIR}/memory-${fileStamp(new Date())}.jsonl`, LATEST_MEMORY_EXPORT]);
    return { status: 'done', nodes: nodes.length, files };
  }

  /**
   * The memory of `graphName` just before it is replaced, saved beside the exports
   * (never over memory-latest.jsonl, see ActionsExportService.snapshotActions).
   */
  async snapshotMemory(graphName: string): Promise<ExportedMemory[]> {
    if ((await countPeople(this.graph, graphName)) === 0) return [];
    const nodes = await this.readMemory(graphName);
    await this.save(nodes, [`${EXPORTS_DIR}/memory-${fileStamp(new Date())}-before-replace.jsonl`]);
    return nodes;
  }

  /** Every memory node with its edges, page by page. */
  async readMemory(graphName: string): Promise<ExportedMemory[]> {
    const nodes: ExportedMemory[] = [];
    for (let skip = 0; ; skip += EXPORT_PAGE) {
      const page = await this.graph.roQuery<ExportedMemory>(graphName, Q.EXPORT_MEMORY, { skip, limit: EXPORT_PAGE });
      nodes.push(...page.map((row) => ExportedMemorySchema.parse(row)));
      if (page.length < EXPORT_PAGE) return nodes;
    }
  }

  /** The nodes in memory-latest.jsonl, or null if there is no export yet. */
  async readLatest(): Promise<ExportedMemory[] | null> {
    const text = await this.store.get(LATEST_MEMORY_EXPORT);
    if (text === null) return null;
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line, index) => {
        const parsed = ExportedMemorySchema.safeParse(JSON.parse(line));
        if (!parsed.success) throw new Error(`${LATEST_MEMORY_EXPORT} line ${index + 1} is not valid memory: ${parsed.error.message}`);
        return parsed.data;
      });
  }

  /** Restores memory-latest.jsonl, then `extra` (a snapshot of the graph just replaced). */
  async restoreLatestInto(graphName: string, extra: ExportedMemory[] = []): Promise<MemoryRestoreSummary> {
    const latest = await this.readLatest();
    if (latest === null && extra.length === 0) {
      this.logger.log(`No ${LATEST_MEMORY_EXPORT} yet; no memory to restore`);
      return { source: null, nodes: 0, edges: 0, unknownEdges: 0 };
    }
    const a = await this.restoreInto(graphName, latest ?? []);
    const b = await this.restoreInto(graphName, extra);
    return {
      source: latest === null ? null : this.store.locate(LATEST_MEMORY_EXPORT),
      nodes: new Set([...(latest ?? []), ...extra].map((n) => n.id)).size,
      edges: a.edges + b.edges,
      unknownEdges: a.unknownEdges + b.unknownEdges,
    };
  }

  /** Writes memory into `graphName`: every node first (by label), then every edge (by kind). */
  async restoreInto(graphName: string, nodes: ExportedMemory[]): Promise<MemoryRestoreSummary> {
    if (nodes.length === 0) return { source: null, nodes: 0, edges: 0, unknownEdges: 0 };
    for (const label of MEMORY_LABELS) {
      const rows = nodes.filter((n) => n.label === label).map((n) => ({ id: n.id, props: n.props as BatchRow }));
      if (rows.length > 0) await this.graph.batchWrite(graphName, Q.RESTORE_MEMORY_NODES[label], rows);
    }

    const byKind = new Map<string, { from: string; to: string }[]>();
    let unknownEdges = 0;
    for (const node of nodes) {
      for (const edge of node.edges) {
        const key = `${node.label}|${edge.type}|${edge.toKind}`;
        if (!(key in Q.RESTORE_MEMORY_EDGES)) {
          unknownEdges++;
          continue;
        }
        byKind.set(key, [...(byKind.get(key) ?? []), { from: node.id, to: edge.to }]);
      }
    }
    let edges = 0;
    for (const [key, rows] of byKind) {
      for (let start = 0; start < rows.length; start += RESTORE_BATCH) {
        await this.graph.query(graphName, Q.RESTORE_MEMORY_EDGES[key], { rows: rows.slice(start, start + RESTORE_BATCH) });
      }
      edges += rows.length;
    }
    if (unknownEdges > 0) this.logger.warn(`${unknownEdges} memory edges of unknown kinds were left out`);
    this.logger.log(`Restored ${nodes.length} memory nodes and ${edges} edges into ${graphName}`);
    return { source: null, nodes: nodes.length, edges, unknownEdges };
  }

  private async save(nodes: ExportedMemory[], keys: string[]): Promise<string[]> {
    const body = nodes.map((node) => JSON.stringify(node)).join('\n') + (nodes.length > 0 ? '\n' : '');
    for (const key of keys) await this.store.put(key, body);
    const files = keys.map((key) => this.store.locate(key));
    this.logger.log(`Exported ${nodes.length} memory nodes to ${files.join(' and ')}`);
    return files;
  }

  private skip(reason: string): MemoryExportResult {
    this.logger.warn(`Memory export skipped: ${reason}`);
    return { status: 'skipped', reason };
  }
}
