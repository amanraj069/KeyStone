import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { MemoryReport, SearchHit, SearchQuery, SearchResponse } from '@keystone/shared';
import { GraphService } from '../graph/graph.service';
import { SchemaService } from '../graph/schema.service';
import { TEXT_STORE } from '../ingest/ingest.constants';
import type { TextStore } from '../ingest/text-store';
import { LlmService } from '../llm/llm.service';
import { chooseMaxChunks, chunkId, chunkText, DEFAULT_MAX_CHUNKS_PER_ARTIFACT, estimateVectorMb } from './chunker';
import * as Q from './queries/retrieval.queries';

/** Injection token for retrieval settings. */
export const RETRIEVAL_SETTINGS = Symbol('RETRIEVAL_SETTINGS');

export interface RetrievalSettings {
  embedDim: number;
  memoryWarnMb: number;
  /** The embedding model in use, recorded on every Chunk ("openai/text-embedding-3-small"). */
  embedModel: string;
}

/**
 * With a day filter, the vector index is asked for this many times k neighbours
 * (at most DAY_FILTER_MAX_K), because the filter can only run after the vector
 * lookup and would otherwise leave few or no hits.
 */
const DAY_FILTER_OVERFETCH = 15;
const DAY_FILTER_MAX_K = 400;

/** Chunks per CREATE batch: each row carries a 768-number vector, so batches stay small. */
const CHUNK_WRITE_BATCH = 200;

export interface IndexOptions {
  graph: string;
  maxChunksPerArtifact?: number;
  dryRun?: boolean;
}

export interface IndexSummary {
  graph: string;
  artifacts: number;
  chunks: number;
  requestedMaxChunks: number;
  maxChunks: number;
  lowered: boolean;
  estimateMb: number;
  memoryBefore: MemoryReport;
  memoryAfter: MemoryReport | null;
  embedCalls: number;
  embedCacheHits: number;
  embedTokens: number;
  textChars: number;
  dryRun: boolean;
  seconds: number;
}

/** What planChunks found: the chunks indexAll would embed, and how the per-artifact cap was chosen. */
export interface ChunkPlan {
  artifacts: number;
  rows: { id: string; artifactId: string; text: string }[];
  requested: number;
  choice: ReturnType<typeof chooseMaxChunks>;
  memoryBefore: MemoryReport;
}

type HybridRow = {
  chunkId: string;
  id: string;
  title: string | null;
  type: string | null;
  day: number | null;
  score: number;
  related: string[];
  authors: string[];
};
type VectorRow = { chunkId: string; id: string; score: number };

/**
 * Stage 6 retrieval:
 *   indexAll()        Artifact bodies (TextStore) -> chunks -> embeddings -> (:Chunk)-[:PART_OF]->(:Artifact)
 *   search()          hybrid: vector index + graph context (related artifacts, authors)
 *   vectorOnlySearch  the benchmark baseline: same vectors, no graph
 * Chunk text is stored in the TextStore under chunks/<chunkId>, never in the graph.
 */
@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private checkedModel = false;

  constructor(
    private readonly graph: GraphService,
    private readonly schema: SchemaService,
    private readonly llm: LlmService,
    @Inject(TEXT_STORE) private readonly textStore: TextStore,
    @Inject(RETRIEVAL_SETTINGS) private readonly settings: RetrievalSettings,
  ) {}

  /** Chunk, estimate memory, embed (cached) and write every artifact's chunks. */
  async indexAll(options: IndexOptions): Promise<IndexSummary> {
    const started = performance.now();
    const { artifacts, rows, requested, choice, memoryBefore } = await this.planChunks(options.graph, options.maxChunksPerArtifact);
    const summary: IndexSummary = {
      graph: options.graph,
      artifacts,
      chunks: rows.length,
      requestedMaxChunks: requested,
      maxChunks: choice.maxChunks,
      lowered: choice.lowered,
      estimateMb: estimateVectorMb(rows.length, this.settings.embedDim),
      memoryBefore,
      memoryAfter: null,
      embedCalls: 0,
      embedCacheHits: 0,
      embedTokens: 0,
      textChars: rows.reduce((sum, row) => sum + row.text.length, 0),
      dryRun: !!options.dryRun,
      seconds: 0,
    };
    if (options.dryRun) return { ...summary, seconds: (performance.now() - started) / 1000 };

    // 3. The vector index must exist with the right dimension before any vector is written.
    await this.ensureVectorIndex(options.graph);

    // 4. Chunk text goes to the TextStore; vectors come from the (cached) embedding call.
    await Promise.all(rows.map((row) => this.textStore.put('chunks', row.id, row.text)));
    const before = this.llm.usage();
    const vectors = await this.llm.embed(rows.map((row) => row.text));
    const after = this.llm.usage();
    summary.embedCalls = after.embedCalls - before.embedCalls;
    summary.embedCacheHits = after.embedCacheHits - before.embedCacheHits;
    summary.embedTokens = after.embedTokens - before.embedTokens;

    // 5. Rebuild the Chunk nodes: delete, then create with PART_OF. No text in the graph.
    await this.graph.query(options.graph, Q.DELETE_CHUNKS);
    await this.graph.batchWrite(
      options.graph,
      Q.CREATE_CHUNKS,
      rows.map((row, i) => ({ id: row.id, artifactId: row.artifactId, model: this.settings.embedModel, vector: vectors[i] })),
      CHUNK_WRITE_BATCH,
    );
    summary.memoryAfter = await this.graph.assertMemoryBudget('embeddings');
    summary.seconds = (performance.now() - started) / 1000;
    return summary;
  }

  /**
   * Steps 1-2 of indexAll, with no writes and no embedding calls: every artifact's
   * chunks, capped per artifact (the cap is lowered if the vectors would pass
   * MEMORY_WARN_MB). The seed command uses it to check the embedding cache first.
   */
  async planChunks(graphName: string, maxChunksPerArtifact?: number): Promise<ChunkPlan> {
    const requested = maxChunksPerArtifact ?? DEFAULT_MAX_CHUNKS_PER_ARTIFACT;

    // 1. Chunk every artifact without a cap first, to know how many chunks each would make.
    const artifacts = await this.graph.roQuery<{ id: string; title: string }>(graphName, Q.ARTIFACTS_TO_CHUNK);
    const bodies = await this.textStore.getMany('artifacts', artifacts.map((a) => a.id));
    const allChunks = artifacts.map((a) => chunkText(a.title, bodies.get(a.id) ?? '', { maxChunks: Number.MAX_SAFE_INTEGER }));

    // 2. Memory estimate; lower the per-artifact cap if the vectors would pass MEMORY_WARN_MB.
    const memoryBefore = await this.graph.memoryReport();
    const choice = chooseMaxChunks(
      allChunks.map((chunks) => chunks.length),
      requested,
      this.settings.embedDim,
      memoryBefore.usedMemoryMb ?? 0,
      this.settings.memoryWarnMb,
    );
    this.logger.log(
      `Memory estimate: ${choice.chunks} chunks x ${this.settings.embedDim} dims x 4 bytes x 2 = ${choice.estimateMb.toFixed(1)} MB; ` +
        `FalkorDB uses ${memoryBefore.usedMemoryHuman}; warn at ${this.settings.memoryWarnMb} MB; ` +
        `max chunks per artifact ${choice.maxChunks}${choice.lowered ? ` (lowered from ${requested})` : ''}`,
    );

    const rows = artifacts.flatMap((artifact, i) =>
      allChunks[i].slice(0, choice.maxChunks).map((text, n) => ({ id: chunkId(artifact.id, n), artifactId: artifact.id, text })),
    );
    return { artifacts: artifacts.length, rows, requested, choice, memoryBefore };
  }

  /** Hybrid search: nearest chunks, then the graph adds related artifacts and authors. */
  async search(graphName: string, query: SearchQuery): Promise<SearchResponse> {
    const { vector, embedMs } = await this.embedQuery(graphName, query.q);
    const started = performance.now();
    const dayFilter = query.asOfDay !== undefined || query.fromDay !== undefined;
    const rows = await this.graph.roQuery<HybridRow>(graphName, Q.HYBRID_SEARCH, {
      k: dayFilter ? Math.min(query.k * DAY_FILTER_OVERFETCH, DAY_FILTER_MAX_K) : query.k,
      limit: query.k,
      q: vector,
      asOfDay: query.asOfDay ?? null,
      fromDay: query.fromDay ?? null,
    });
    // The graph decided what is relevant; the TextStore supplies the words in one call.
    const texts = await this.textStore.getMany('chunks', rows.map((r) => r.chunkId));
    const hits = rows.map(
      (r): SearchHit => ({
        chunkId: r.chunkId,
        artifactId: r.id,
        title: r.title,
        type: r.type,
        day: r.day,
        distance: r.score,
        similarity: 1 - r.score,
        text: texts.get(r.chunkId) ?? '',
        related: r.related,
        authors: r.authors,
      }),
    );
    return { query: query.q, mode: 'hybrid', k: query.k, embedMs, searchMs: Math.round(performance.now() - started), hits };
  }

  /** Benchmark baseline: same embedding and k, chunk texts and artifact ids only, no graph expansion. */
  async vectorOnlySearch(graphName: string, query: SearchQuery): Promise<SearchResponse> {
    const { vector, embedMs } = await this.embedQuery(graphName, query.q);
    const started = performance.now();
    const rows = await this.graph.roQuery<VectorRow>(graphName, Q.VECTOR_ONLY_SEARCH, { k: query.k, q: vector });
    const texts = await this.textStore.getMany('chunks', rows.map((r) => r.chunkId));
    const hits = rows.map(
      (r): SearchHit => ({
        chunkId: r.chunkId,
        artifactId: r.id,
        title: null,
        type: null,
        day: null,
        distance: r.score,
        similarity: 1 - r.score,
        text: texts.get(r.chunkId) ?? '',
        related: [],
        authors: [],
      }),
    );
    return { query: query.q, mode: 'vector-only', k: query.k, embedMs, searchMs: Math.round(performance.now() - started), hits };
  }

  /** Creates the vector index if missing; refuses a dimension that differs from EMBED_DIM. */
  async ensureVectorIndex(graphName: string): Promise<void> {
    const dimension = await this.vectorIndexDimension(graphName);
    if (dimension === null) {
      this.logger.log(`No vector index on Chunk.embedding in ${graphName}; creating it`);
      await this.schema.ensureSchema(graphName);
    } else if (dimension !== this.settings.embedDim) {
      throw new Error(`Chunk vector index has ${dimension} dims but EMBED_DIM is ${this.settings.embedDim}`);
    }
  }

  private async vectorIndexDimension(graphName: string): Promise<number | null> {
    const rows = await this.graph.roQuery<{ properties: string[]; types: Record<string, string[]>; options: Record<string, { dimension?: number }> }>(
      graphName,
      Q.CHUNK_VECTOR_INDEX,
    );
    for (const row of rows) {
      if (row.types?.embedding?.includes('VECTOR')) return row.options?.embedding?.dimension ?? null;
    }
    return null;
  }

  /**
   * Embeds the question (cached by text). Before the first search it checks the
   * stored chunks were made with the same embedding model: vectors from two
   * different models are not comparable.
   */
  private async embedQuery(graphName: string, q: string): Promise<{ vector: number[]; embedMs: number }> {
    if (!this.checkedModel) {
      const models = await this.graph.roQuery<{ model: string | null; chunks: number }>(graphName, Q.CHUNK_MODELS);
      if (models.length === 0) throw new ServiceUnavailableException('No chunks indexed yet; run `pnpm embed` first');
      const other = models.find((m) => m.model !== this.settings.embedModel);
      if (other) {
        throw new BadRequestException(
          `Chunks were embedded with ${other.model}, but the active model is ${this.settings.embedModel}; re-run \`pnpm embed\``,
        );
      }
      this.checkedModel = true;
    }
    const started = performance.now();
    const [vector] = await this.llm.embed([q]);
    return { vector, embedMs: Math.round(performance.now() - started) };
  }
}
