import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IngestProgress } from '@keystone/shared';
import { GraphService } from '../graph/graph.service';
import { readArtifacts } from '../ingest/artifact-record';
import { TEXT_STORE } from '../ingest/ingest.constants';
import { GRAPH_COUNTS } from '../ingest/queries/ingest.queries';
import type { TextStore } from '../ingest/text-store';
import { LlmService } from '../llm/llm.service';
import { NO_TOKENS, type LlmTokenUsage } from '../llm/llm.types';
import type { ExtractCacheService } from './extract-cache.service';
import {
  ESTIMATED_OUTPUT_TOKENS_PER_CALL,
  EXTRACT_CACHE,
  EXTRACT_SETTINGS,
  type ExtractSettings,
  MAX_LINK_CLAIMS,
  MAX_LINK_DECISIONS,
} from './extract.constants';
import {
  ARTIFACT_SYSTEM_PROMPT,
  artifactPrompt,
  LINKS_PROMPT_VERSION,
  LINKS_SYSTEM_PROMPT,
  linksPrompt,
  type LinksPromptInput,
  MAX_BODY_CHARS,
  PROMPT_VERSION,
} from './extract.prompts';
import {
  type ArtifactExtraction,
  ArtifactExtractionSchema,
  MIN_DECISION_CONFIDENCE,
  MIN_SYSTEM_RELEVANCE,
  SystemLinksSchema,
} from './extract.schema';
import { Canonicalizer } from './names';
import * as Q from './queries/extract.queries';
import { writeExtractionStats } from './extract-stats';
import { buildVocabulary } from './vocabulary';

/** Receives progress events; the BullMQ worker forwards them to job.updateProgress. */
export type ExtractReporter = (progress: IngestProgress) => Promise<void>;

export interface ExtractRunOptions {
  graph: string;
  /** Run even if more LLM calls are planned than EXTRACT_MAX_CALLS. */
  force: boolean;
  /** Ignore the extraction cache and ask the LLM again. */
  refresh: boolean;
  /** Plan and estimate only: no LLM calls, no graph writes. */
  dryRun: boolean;
  /** Only the first N selected artifacts (spread evenly), for trial runs. */
  limit?: number;
  /** Overrides EXTRACT_DEPTS for this run. */
  depts?: string[];
}

/** One selected artifact, with everything the prompt needs. */
export interface PlannedItem {
  id: string;
  label: string;
  title: string;
  day: number | null;
  authors: string[];
  body: string;
  fingerprint: string;
  cached: ArtifactExtraction | null;
}

/** One artifact's result after the LLM (or cache) answered. */
export interface ExtractedItem {
  item: PlannedItem;
  value: ArtifactExtraction | null;
  fromCache: boolean;
  error: string | null;
}

export interface ExtractSummary {
  graph: string;
  provider: string;
  model: string;
  promptVersion: string;
  candidates: number;
  selected: number;
  fromCache: number;
  plannedCalls: number;
  llmCalls: number;
  failures: { id: string; error: string }[];
  tokens: LlmTokenUsage;
  linkCalls: number;
  linkSystems: number;
  vocabulary: string[];
  dryRun: boolean;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  extracted: ExtractedItem[];
  rawSystemNames: Map<string, number>;
  canonicalizer: Canonicalizer | null;
  rejectedLinks: number;
}

export class ExtractBudgetError extends Error {
  override name = 'ExtractBudgetError';
}

/** One row of SELECT_CANDIDATES. */
type CandidateRow = { id: string; label: string; title: string | null; day: number | null; authors: string[] };

/**
 * LLM extraction: Artifact text -> System, Decision, MENTIONS, DECIDED_IN, ABOUT,
 * then a second pass per system for SUPERSEDES and ASSERTS.
 * Every LLM answer is cached; a rerun with the same prompt and model makes zero LLM calls.
 */
@Injectable()
export class ExtractService {
  private readonly logger = new Logger(ExtractService.name);

  constructor(
    private readonly graph: GraphService,
    private readonly llm: LlmService,
    @Inject(TEXT_STORE) private readonly textStore: TextStore,
    @Inject(EXTRACT_SETTINGS) private readonly settings: ExtractSettings,
    @Inject(EXTRACT_CACHE) private readonly cache: ExtractCacheService,
  ) {}

  async run(options: ExtractRunOptions, report: ExtractReporter = async () => undefined): Promise<ExtractSummary> {
    const send = this.sender(options.graph, report);
    const usage = this.llm.usage();

    // 1. Plan: which artifacts, and how many of them really need an LLM call.
    const { candidates, items } = await this.plan(options);
    const plannedCalls = options.refresh ? items.length : items.filter((i) => !i.cached).length;
    const vocabulary = await this.buildVocabulary(options.graph);
    const estimate = estimateTokens(items, vocabulary, plannedCalls);
    const summary: ExtractSummary = {
      graph: options.graph,
      provider: usage.provider,
      model: usage.model,
      promptVersion: PROMPT_VERSION,
      candidates,
      selected: items.length,
      fromCache: 0,
      plannedCalls,
      llmCalls: 0,
      failures: [],
      tokens: { ...NO_TOKENS },
      linkCalls: 0,
      linkSystems: 0,
      vocabulary,
      dryRun: options.dryRun,
      estimatedInputTokens: estimate.input,
      estimatedOutputTokens: estimate.output,
      extracted: [],
      rawSystemNames: new Map(),
      canonicalizer: null,
      rejectedLinks: 0,
    };
    await send('plan', 2, { candidates, selected: items.length, plannedCalls }, `Planned ${plannedCalls} LLM calls for ${items.length} artifacts`);

    if (plannedCalls > this.settings.maxCalls && !options.force) {
      throw new ExtractBudgetError(
        `${plannedCalls} LLM calls planned, above EXTRACT_MAX_CALLS=${this.settings.maxCalls}; pass force to run anyway`,
      );
    }
    if (options.dryRun) return summary;

    // 2. Extract every artifact (cache first, LLM otherwise).
    summary.extracted = await this.extractAll(items, vocabulary, options.refresh, summary, send);
    // Real provider calls, validation retries included (exact, from LlmService's counters).
    const afterExtract = this.llm.usage();
    summary.llmCalls = afterExtract.jsonCalls - usage.jsonCalls;

    // 3. Write systems, mentions, decisions and claims.
    const canonicalizer = new Canonicalizer(vocabulary);
    summary.canonicalizer = canonicalizer;
    const written = await this.writeExtractions(options.graph, summary.extracted, canonicalizer, summary);
    await send('write', 80, written, `Wrote ${written.systems} systems, ${written.decisions} decisions, ${written.claims} claims`);

    // 4. Second pass: SUPERSEDES and ASSERTS per system, then drop the temporary claims.
    const links = await this.linkDecisions(options.graph, summary);
    await send('links', 95, links, `Linked ${links.supersedes} supersedes and ${links.asserts} asserts`);

    const after = this.llm.usage();
    summary.linkCalls = after.jsonCalls - afterExtract.jsonCalls;
    summary.tokens = subtractUsage(after.tokens, usage.tokens);
    await this.graph.assertMemoryBudget(`extract:${options.graph}`);
    await writeExtractionStats(this.settings.dataDir, this.graph, summary);
    await send('done', 100, { llmCalls: summary.llmCalls + summary.linkCalls }, `Extraction complete: ${summary.llmCalls + summary.linkCalls} LLM calls`);
    return summary;
  }

  /** Selects artifacts: right type, body over minBodyChars (read from the TextStore), optional departments. */
  async plan(options: Pick<ExtractRunOptions, 'graph' | 'limit' | 'depts' | 'refresh'>): Promise<{ candidates: number; items: PlannedItem[] }> {
    const depts = options.depts ?? this.settings.depts;
    const rows = await this.graph.roQuery<CandidateRow>(options.graph, Q.SELECT_CANDIDATES, { depts });
    const provider = this.llm.usage();

    const items: PlannedItem[] = [];
    for (const row of rows) {
      const body = (await this.textStore.get('artifacts', row.id)) ?? '';
      if (body.length <= this.settings.minBodyChars) continue;
      const title = row.title ?? '';
      const fingerprint = sha256(
        JSON.stringify([PROMPT_VERSION, provider.provider, provider.model, sha256(body), title, row.day, row.authors]),
      );
      items.push({ id: row.id, label: row.label, title, day: row.day, authors: row.authors, body, fingerprint, cached: null });
    }
    const chosen = options.limit ? spreadEvenly(items, options.limit) : items;
    for (const item of chosen) item.cached = options.refresh ? null : await this.cache.get(item.id, item.fingerprint);
    this.logger.log(`Plan: ${rows.length} candidates, ${items.length} over ${this.settings.minBodyChars} chars, ${chosen.length} selected`);
    return { candidates: rows.length, items: chosen };
  }

  /**
   * Seed vocabulary from all artifact bodies (TextStore), Page titles (graph)
   * and aliases.json, excluding every actor's name (artifacts.jsonl).
   */
  async buildVocabulary(graphName: string): Promise<string[]> {
    const ids = await this.graph.roQuery<{ id: string }>(graphName, Q.ALL_ARTIFACT_IDS);
    const texts = await Promise.all(ids.map(async ({ id }) => (await this.textStore.get('artifacts', id)) ?? ''));
    const titles = (await this.graph.roQuery<{ title: string | null }>(graphName, Q.PAGE_TITLES)).map((r) => r.title ?? '');
    const actorNames = [...new Set((await readArtifacts(this.settings.dataDir)).flatMap((r) => r.actors))];
    return buildVocabulary({ texts, pageTitles: titles, actorNames });
  }

  private async extractAll(
    items: PlannedItem[],
    vocabulary: string[],
    refresh: boolean,
    summary: ExtractSummary,
    send: ReturnType<ExtractService['sender']>,
  ): Promise<ExtractedItem[]> {
    let done = 0;
    const results = await Promise.all(
      items.map(async (item): Promise<ExtractedItem> => {
        let result: ExtractedItem;
        if (item.cached && !refresh) {
          summary.fromCache++;
          result = { item, value: item.cached, fromCache: true, error: null };
        } else {
          try {
            const answer = await this.llm.generateObjectWithUsage(ArtifactExtractionSchema, {
              task: PROMPT_VERSION,
              system: ARTIFACT_SYSTEM_PROMPT,
              prompt: artifactPrompt({ type: item.label, title: item.title, day: item.day, authors: item.authors, body: item.body, vocabulary }),
            });
            if (answer.cached) summary.fromCache++; // answered by the LLM cache
            await this.cache.set(item.id, item.fingerprint, answer.value);
            result = { item, value: answer.value, fromCache: answer.cached, error: null };
          } catch (error) {
            const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
            summary.failures.push({ id: item.id, error: message });
            result = { item, value: null, fromCache: false, error: message };
          }
        }
        done++;
        if (done % 50 === 0 || done === items.length) {
          const calls = this.llm.usage().jsonCalls;
          await send('extract', 5 + Math.round((done / items.length) * 70), { done, llmCalls: calls, fromCache: summary.fromCache, failed: summary.failures.length }, `Extracted ${done}/${items.length}`);
        }
        return result;
      }),
    );
    return results;
  }

  /** Turns LLM answers into graph rows (filtered, canonicalised) and writes them. */
  private async writeExtractions(
    graphName: string,
    extracted: ExtractedItem[],
    canon: Canonicalizer,
    summary: ExtractSummary,
  ): Promise<Record<string, number>> {
    const mentions = new Map<string, { artifactId: string; system: string; weight: number }>();
    const decisions: { id: string; artifactId: string; summary: string; day: number | null; kind: string; confidence: number }[] = [];
    const about: { decisionId: string; system: string }[] = [];
    const claims: { id: string; pageId: string; claim: string; system: string }[] = [];
    const systems = new Set<string>();

    for (const { item, value } of extracted) {
      if (!value) continue;
      for (const system of value.systems) {
        summary.rawSystemNames.set(system.name, (summary.rawSystemNames.get(system.name) ?? 0) + 1);
        const name = canon.canonical(system.name);
        if (!name || system.relevance < MIN_SYSTEM_RELEVANCE) continue;
        systems.add(name);
        const key = `${item.id}|${name}`;
        // The same system named twice in one document keeps its highest relevance.
        if ((mentions.get(key)?.weight ?? -1) < system.relevance) mentions.set(key, { artifactId: item.id, system: name, weight: system.relevance });
      }
      value.decisions.forEach((decision, index) => {
        if (decision.confidence < MIN_DECISION_CONFIDENCE) return;
        // Stable id: same document + same cached answer -> same id on every rerun.
        const id = `D:${item.id}:${index}`;
        decisions.push({ id, artifactId: item.id, summary: decision.summary, day: item.day, kind: decision.kind, confidence: decision.confidence });
        for (const raw of decision.systems) {
          const name = canon.canonical(raw);
          if (!name) continue;
          systems.add(name);
          about.push({ decisionId: id, system: name });
        }
      });
      // Claims are only kept for Pages: they feed the ASSERTS links of the second pass.
      if (item.label === 'Page') {
        value.asserts.forEach((claim, index) => {
          const name = canon.canonical(claim.system);
          if (!name) return;
          systems.add(name);
          claims.push({ id: `C:${item.id}:${index}`, pageId: item.id, claim: claim.claim, system: name });
        });
      }
    }

    // Start from a clean slate so removed or changed answers leave nothing behind.
    await this.graph.query(graphName, Q.CLEAR_EXTRACTION);
    await this.graph.batchWrite(graphName, Q.MERGE_SYSTEMS, [...systems].sort().map((name) => ({ name, aliases: canon.aliasesOf(name) })));
    await this.graph.batchWrite(graphName, Q.MERGE_MENTIONS, [...mentions.values()].map((m) => ({ ...m })));
    await this.graph.batchWrite(graphName, Q.MERGE_DECISIONS, decisions.map((d) => ({ ...d })));
    await this.graph.batchWrite(graphName, Q.MERGE_ABOUT, dedupe(about, (a) => `${a.decisionId}|${a.system}`).map((a) => ({ ...a })));
    await this.graph.batchWrite(graphName, Q.MERGE_CLAIMS, claims.map((c) => ({ ...c })));
    return { systems: systems.size, mentions: mentions.size, decisions: decisions.length, about: about.length, claims: claims.length };
  }

  /** Second pass: one LLM call per system with 2+ decisions/claims -> SUPERSEDES and ASSERTS. */
  private async linkDecisions(graphName: string, summary: ExtractSummary): Promise<Record<string, number>> {
    const systems = await this.graph.roQuery<LinksPromptInput>(graphName, Q.SYSTEMS_FOR_LINKING);
    summary.linkSystems = systems.length;
    const supersedes: { newerId: string; olderId: string }[] = [];
    const asserts: { pageId: string; decisionId: string }[] = [];

    await Promise.all(
      systems.map(async (row) => {
        const input: LinksPromptInput = {
          system: row.system,
          decisions: row.decisions.slice(-MAX_LINK_DECISIONS),
          claims: row.claims.slice(0, MAX_LINK_CLAIMS),
        };
        try {
          const answer = await this.llm.generateObjectWithUsage(SystemLinksSchema, {
            task: LINKS_PROMPT_VERSION,
            system: LINKS_SYSTEM_PROMPT,
            prompt: linksPrompt(input),
          });
          const valid = validateLinks(input, answer.value);
          summary.rejectedLinks += valid.rejected;
          supersedes.push(...valid.supersedes);
          asserts.push(...valid.asserts);
        } catch (error) {
          summary.failures.push({ id: `links:${row.system}`, error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
        }
      }),
    );

    await this.graph.batchWrite(graphName, Q.MERGE_SUPERSEDES, dedupe(supersedes, (s) => `${s.newerId}|${s.olderId}`).map((s) => ({ ...s })));
    await this.graph.batchWrite(graphName, Q.MERGE_ASSERTS, dedupe(asserts, (a) => `${a.pageId}|${a.decisionId}`).map((a) => ({ ...a })));
    await this.graph.query(graphName, Q.DELETE_CLAIMS);
    return { systems: systems.length, supersedes: supersedes.length, asserts: asserts.length };
  }

  /**
   * Builds progress events. Graph totals are only re-counted outside the
   * 'extract' phase: nothing is written while artifacts are being extracted, and
   * with a warm cache thousands of artifacts finish at once (one count query per
   * event would pile up in FalkorDB).
   */
  private sender(graphName: string, report: ExtractReporter) {
    let totals = { people: 0, artifacts: 0, edges: 0 };
    return async (phase: string, percent: number, added: Record<string, number>, message: string) => {
      if (phase !== 'extract') {
        const [row] = await this.graph
          .roQuery<{ people: number; artifacts: number; edges: number }>(graphName, GRAPH_COUNTS)
          .catch(() => [totals]);
        totals = row ?? totals;
      }
      this.logger.log(`[extract:${graphName}] ${message}`);
      await report({ kind: 'extract', graph: graphName, phase, percent, day: null, added, totals, message });
    };
  }
}

/**
 * Keeps only links between ids that were actually in the prompt, never a
 * decision superseding itself, and never an older decision superseding a newer one.
 */
export function validateLinks(
  input: LinksPromptInput,
  answer: { supersedes: { newerId: string; olderId: string }[]; asserts: { pageId: string; decisionId: string }[] },
): { supersedes: { newerId: string; olderId: string }[]; asserts: { pageId: string; decisionId: string }[]; rejected: number } {
  const dayById = new Map(input.decisions.map((d) => [d.id, d.day]));
  const pages = new Set(input.claims.map((c) => c.pageId));
  const supersedes = answer.supersedes.filter(({ newerId, olderId }) => {
    if (newerId === olderId || !dayById.has(newerId) || !dayById.has(olderId)) return false;
    const newer = dayById.get(newerId);
    const older = dayById.get(olderId);
    return newer === null || older === null || newer === undefined || older === undefined || newer >= older;
  });
  const asserts = answer.asserts.filter(({ pageId, decisionId }) => pages.has(pageId) && dayById.has(decisionId));
  const rejected = answer.supersedes.length - supersedes.length + answer.asserts.length - asserts.length;
  return { supersedes, asserts, rejected };
}

/** Picks `count` items spread evenly over the list (deterministic, covers all types). */
export function spreadEvenly<T>(items: T[], count: number): T[] {
  if (count >= items.length) return items;
  return Array.from({ length: count }, (_, i) => items[Math.floor((i * items.length) / count)]);
}

function estimateTokens(items: PlannedItem[], vocabulary: string[], plannedCalls: number): { input: number; output: number } {
  if (items.length === 0) return { input: 0, output: 0 };
  // ~4 characters per token; fixed part = system prompt + vocabulary list + header.
  const fixed = Math.round((ARTIFACT_SYSTEM_PROMPT.length + vocabulary.join(', ').length + 120) / 4);
  const avgBody = items.reduce((sum, i) => sum + Math.min(i.body.length, MAX_BODY_CHARS), 0) / items.length / 4;
  return { input: Math.round(plannedCalls * (fixed + avgBody)), output: plannedCalls * ESTIMATED_OUTPUT_TOKENS_PER_CALL };
}

function subtractUsage(after: LlmTokenUsage, before: LlmTokenUsage): LlmTokenUsage {
  return {
    inputTokens: after.inputTokens - before.inputTokens,
    cachedInputTokens: after.cachedInputTokens - before.cachedInputTokens,
    outputTokens: after.outputTokens - before.outputTokens,
    reasoningTokens: after.reasoningTokens - before.reasoningTokens,
  };
}

function dedupe<T>(rows: T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => !seen.has(key(row)) && seen.add(key(row)));
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}
