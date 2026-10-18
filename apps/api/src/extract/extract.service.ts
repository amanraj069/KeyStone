import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IngestProgress } from '@keystone/shared';
import { type BatchRow, GraphService } from '../graph/graph.service';
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
  LIVE_LINKS_PROMPT_VERSION,
  LIVE_LINKS_SYSTEM_PROMPT,
  liveLinksPrompt,
  LINKS_SYSTEM_PROMPT,
  linksPrompt,
  type LinksPromptInput,
  MAX_BODY_CHARS,
  PROMPT_VERSION,
  STALE_LINKS_PROMPT_VERSION,
  STALE_LINKS_SYSTEM_PROMPT,
  staleLinksPrompt,
  type StaleLinksPromptInput,
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

  /** The model extraction runs on (for cost estimates). */
  model(): string {
    return this.llm.usage().model;
  }

  /** Selects artifacts: right type, long enough body (read from the TextStore), optional departments. */
  async plan(options: Pick<ExtractRunOptions, 'graph' | 'limit' | 'depts' | 'refresh'>): Promise<{ candidates: number; items: PlannedItem[] }> {
    const depts = options.depts ?? this.settings.depts;
    const rows = await this.graph.roQuery<CandidateRow>(options.graph, Q.SELECT_CANDIDATES, { depts });
    const provider = this.llm.usage();

    const items: PlannedItem[] = [];
    for (const row of rows) {
      const body = (await this.textStore.get('artifacts', row.id)) ?? '';
      if (!worthExtracting(row.label, body, this.settings.minBodyChars)) continue;
      const title = row.title ?? '';
      const fingerprint = sha256(
        JSON.stringify([PROMPT_VERSION, provider.provider, provider.model, sha256(body), title, row.day, row.authors]),
      );
      items.push({ id: row.id, label: row.label, title, day: row.day, authors: row.authors, body, fingerprint, cached: null });
    }
    const chosen = options.limit ? spreadEvenly(items, options.limit) : items;
    for (const item of chosen) item.cached = options.refresh ? null : await this.cache.get(item.id, item.fingerprint);
    this.logger.log(`Plan: ${rows.length} candidates, ${items.length} worth extracting (tickets, or over ${this.settings.minBodyChars} chars), ${chosen.length} selected`);
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

  /** Turns LLM answers into graph rows (filtered, canonicalised) and writes them over a clean slate. */
  private async writeExtractions(
    graphName: string,
    extracted: ExtractedItem[],
    canon: Canonicalizer,
    summary: ExtractSummary,
  ): Promise<Record<string, number>> {
    return this.writeExtractionRows(graphName, extractionRows(extracted, canon, summary), { clear: true });
  }

  /**
   * Writes extraction rows. clear: true (a full run) first removes everything an
   * earlier extraction wrote, so changed answers leave nothing behind; clear: false
   * (one live document) only adds, with MERGE.
   */
  private async writeExtractionRows(graphName: string, rows: ExtractionRows, options: { clear: boolean }): Promise<Record<string, number>> {
    const { systems, mentions, decisions, about, claims, canon } = rows;
    if (options.clear) await this.graph.query(graphName, Q.CLEAR_EXTRACTION);
    await this.graph.batchWrite(graphName, Q.MERGE_SYSTEMS, [...systems].sort().map((name) => ({ name, aliases: canon.aliasesOf(name) })));
    await this.graph.batchWrite(graphName, Q.MERGE_MENTIONS, [...mentions.values()].map((m) => ({ ...m })));
    await this.graph.batchWrite(graphName, Q.MERGE_DECISIONS, decisions.map((d) => ({ ...d })));
    await this.graph.batchWrite(graphName, Q.MERGE_ABOUT, dedupe(about, (a) => `${a.decisionId}|${a.system}`).map((a) => ({ ...a })));
    await this.graph.batchWrite(graphName, Q.MERGE_CLAIMS, claims.map((c) => ({ ...c })));
    return { systems: systems.size, mentions: mentions.size, decisions: decisions.length, about: about.length, claims: claims.length };
  }

  /**
   * One new document (a live update): extract it (one cached LLM call, no length
   * filter: a short message can carry a decision), add what it names without
   * touching the rest, then run the second pass only for the systems its decisions
   * are about, with every page's claims rebuilt from the cache, so a decision that
   * replaces an older one can make the pages stating the older one stale.
   */
  async extractOne(graphName: string, artifactId: string): Promise<{ systems: string[]; decisions: { id: string; summary: string; systems: string[] }[]; supersedes: number; asserts: number; llmCalls: number }> {
    const usage = this.llm.usage();
    const [row] = await this.graph.roQuery<CandidateRow>(graphName, Q.CANDIDATE_BY_ID, { id: artifactId });
    if (!row) throw new Error(`No artifact "${artifactId}" to extract`);
    const body = (await this.textStore.get('artifacts', row.id)) ?? '';
    const title = row.title ?? '';
    const fingerprint = sha256(JSON.stringify([PROMPT_VERSION, usage.provider, usage.model, sha256(body), title, row.day, row.authors]));
    const item: PlannedItem = { id: row.id, label: row.label, title, day: row.day, authors: row.authors, body, fingerprint, cached: await this.cache.get(row.id, fingerprint) };

    const vocabulary = await this.liveVocabulary(graphName);
    const summary = emptySummary(graphName, usage.provider, usage.model, vocabulary);
    summary.extracted = await this.extractAll([item], vocabulary, false, summary, async () => undefined);
    if (summary.failures.length > 0) throw new Error(`Extraction failed: ${summary.failures[0].error}`);
    const rows = extractionRows(summary.extracted, new Canonicalizer(vocabulary), summary);
    await this.writeExtractionRows(graphName, rows, { clear: false });

    const decisionSystems = [...new Set(rows.about.map((a) => a.system))];
    const supersedes = await this.linkNewDecisions(graphName, decisionSystems, rows.decisions.map((d) => d.id), summary);
    return {
      systems: [...rows.systems].sort(),
      decisions: rows.decisions.map((d) => ({ id: d.id, summary: d.summary, systems: rows.about.filter((a) => a.decisionId === d.id).map((a) => a.system) })),
      supersedes,
      // Pages already carry their ASSERTS links; a page stating a decision this one replaced is now stale.
      asserts: 0,
      llmCalls: this.llm.usage().jsonCalls - usage.jsonCalls,
    };
  }

  /**
   * For a live document: per system its decisions are about, one cached LLM call
   * (LIVE_LINKS_SYSTEM_PROMPT) for which earlier decisions they replace; checked
   * like the full pass (known ids, not from the same document, newer not before
   * older) and kept only when the newer one is new. Returns how many were written.
   */
  private async linkNewDecisions(graphName: string, systems: string[], newIds: string[], summary: ExtractSummary): Promise<number> {
    if (systems.length === 0 || newIds.length === 0) return 0;
    const rows = await this.graph.roQuery<LinksPromptInput>(graphName, Q.SYSTEMS_FOR_LINKING_IN, { systems });
    const links: { newerId: string; olderId: string }[] = [];
    for (const row of rows) {
      const added = row.decisions.filter((d) => newIds.includes(d.id));
      // Only the earlier decisions that share the most rare words with the new ones: a short list
      // a small model reads reliably, where it overlooks the one that matters among hundreds.
      const earlier = closestDecisions(added, row.decisions.filter((d) => !newIds.includes(d.id)), LIVE_LINK_CANDIDATES);
      if (added.length === 0 || earlier.length === 0) continue;
      // Short ids (N1, E1, ...) so the model never has to copy long ones; mapped back before checking.
      const local = new Map<string, string>([...added.map((d, i) => [`N${i + 1}`, d.id] as const), ...earlier.map((d, i) => [`E${i + 1}`, d.id] as const)]);
      const short = (list: typeof added, prefix: string) => list.map((d, i) => ({ ...d, id: `${prefix}${i + 1}` }));
      const answer = await this.llm.generateObjectWithUsage(SystemLinksSchema, {
        task: LIVE_LINKS_PROMPT_VERSION,
        system: LIVE_LINKS_SYSTEM_PROMPT,
        prompt: liveLinksPrompt({ system: row.system, earlier: short(earlier, 'E'), added: short(added, 'N') }),
      });
      const proposed = answer.value.supersedes.map((link) => ({ newerId: local.get(link.newerId) ?? link.newerId, olderId: local.get(link.olderId) ?? link.olderId }));
      const valid = validateLinks({ system: row.system, decisions: [...earlier, ...added], claims: [] }, { supersedes: proposed, asserts: [] });
      summary.rejectedLinks += valid.rejected;
      links.push(...valid.supersedes.filter((link) => newIds.includes(link.newerId) && !newIds.includes(link.olderId)));
    }
    const kept = dedupe(links, (l) => `${l.newerId}|${l.olderId}`);
    await this.graph.batchWrite(graphName, Q.MERGE_SUPERSEDES, kept.map((l) => ({ ...l })));
    return kept.length;
  }

  /** The vocabulary for live documents: built once per process (it reads every body), then reused. */
  private vocabularyCache: Promise<string[]> | null = null;
  private liveVocabulary(graphName: string): Promise<string[]> {
    this.vocabularyCache ??= this.buildVocabulary(graphName).catch((error: unknown) => {
      this.vocabularyCache = null;
      throw error;
    });
    return this.vocabularyCache;
  }


  /**
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
   * Targeted stale-page pass. Rebuilds page claims from the extraction cache (no
   * LLM), picks core systems with a superseded decision or 3+ decisions (only those
   * with page claims when claimsOnly), and asks the stale-links prompt for
   * SUPERSEDES and ASSERTS. dryRun stops after the estimate. Links are added with
   * MERGE (existing ones stay); claims are deleted again at the end.
   */
  async relinkStale(graphName: string, options: { claimsOnly: boolean; dryRun: boolean }): Promise<StaleRelinkSummary> {
    const claims = await this.rebuildClaims(graphName);
    try {
      const targets = await this.graph.roQuery<{ system: string; decisions: number; superseded: number; claims: number }>(
        graphName,
        Q.STALE_LINK_TARGETS,
      );
      const chosen = targets.filter((t) => !options.claimsOnly || t.claims > 0);
      const inputs = (
        chosen.length === 0
          ? []
          : await this.graph.roQuery<StaleLinksPromptInput>(graphName, Q.STALE_LINK_INPUT, { names: chosen.map((t) => t.system) })
      ).map((row) => ({ ...row, decisions: row.decisions.slice(-MAX_LINK_DECISIONS), claims: row.claims.slice(0, MAX_LINK_CLAIMS) }));
      const prompts = inputs.map((input) => staleLinksPrompt(input));
      const summary: StaleRelinkSummary = {
        claims,
        targets: targets.length,
        targetsWithClaims: targets.filter((t) => t.claims > 0).length,
        calls: prompts.length,
        estimatedInputTokens: Math.round(prompts.reduce((sum, p) => sum + (STALE_LINKS_SYSTEM_PROMPT.length + p.length) / CHARS_PER_TOKEN, 0)),
        estimatedOutputTokens: prompts.length * STALE_LINK_OUTPUT_TOKENS,
        dryRun: options.dryRun,
        llmCalls: 0,
        supersedes: 0,
        asserts: 0,
        rejected: 0,
        failures: [],
        tokens: { ...NO_TOKENS },
      };
      if (options.dryRun) return summary;

      const before = this.llm.usage();
      const supersedes: { newerId: string; olderId: string }[] = [];
      const asserts: { pageId: string; decisionId: string }[] = [];
      await Promise.all(
        inputs.map(async (input, i) => {
          try {
            const answer = await this.llm.generateObjectWithUsage(SystemLinksSchema, {
              task: STALE_LINKS_PROMPT_VERSION,
              system: STALE_LINKS_SYSTEM_PROMPT,
              prompt: prompts[i],
            });
            const valid = validateLinks(input, answer.value);
            summary.rejected += valid.rejected;
            supersedes.push(...valid.supersedes);
            asserts.push(...valid.asserts);
          } catch (error) {
            summary.failures.push({ id: `stale:${input.system}`, error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
          }
        }),
      );
      const after = this.llm.usage();
      summary.llmCalls = after.jsonCalls - before.jsonCalls;
      summary.tokens = subtractUsage(after.tokens, before.tokens);
      const newSupersedes = dedupe(supersedes, (s) => `${s.newerId}|${s.olderId}`);
      const newAsserts = dedupe(asserts, (a) => `${a.pageId}|${a.decisionId}`);
      await this.graph.batchWrite(graphName, Q.MERGE_SUPERSEDES, newSupersedes.map((s) => ({ ...s })));
      await this.graph.batchWrite(graphName, Q.MERGE_ASSERTS, newAsserts.map((a) => ({ ...a })));
      // Links written before the same-artifact rule existed are removed here too.
      await this.graph.query(graphName, Q.DELETE_SAME_SOURCE_SUPERSEDES);
      await this.graph.query(graphName, Q.REACTIVATE_UNSUPERSEDED);
      summary.supersedes = newSupersedes.length;
      summary.asserts = newAsserts.length;
      return summary;
    } finally {
      await this.graph.query(graphName, Q.DELETE_CLAIMS);
    }
  }

  /** Recreates (:Page)-[:CLAIMS]->(:Claim) from cached page extractions, with today's canonical names. */
  async rebuildClaims(graphName: string, vocabulary?: string[]): Promise<number> {
    const { items } = await this.plan({ graph: graphName, refresh: false });
    const canon = new Canonicalizer(vocabulary ?? (await this.buildVocabulary(graphName)));
    const rows = items.flatMap((item) => (item.label === 'Page' && item.cached ? claimRows(item.id, item.cached.asserts, canon) : []));
    await this.graph.query(graphName, Q.DELETE_CLAIMS);
    await this.graph.batchWrite(graphName, Q.MERGE_CLAIMS, rows.map((r) => ({ ...r })));
    return rows.length;
  }

  /**
   * Replay support: copies what extraction already wrote into `sourceGraph` for
   * the artifacts of one day (systems, mentions, decisions, links) into
   * `targetGraph`. No LLM calls; every write is a MERGE, so replaying a day twice
   * changes nothing. Returns how many rows of each kind were copied.
   */
  async replayDay(sourceGraph: string, targetGraph: string, day: number): Promise<Record<string, number>> {
    // Rows are written into the target exactly as read (same keys as the MERGE queries expect).
    const read = (cypher: string) => this.graph.roQuery<BatchRow>(sourceGraph, cypher, { day });
    const systems = await read(Q.REPLAY_SYSTEMS_FOR_DAY);
    const mentions = await read(Q.REPLAY_MENTIONS_FOR_DAY);
    const decisions = await read(Q.REPLAY_DECISIONS_FOR_DAY);
    const about = await read(Q.REPLAY_ABOUT_FOR_DAY);
    const supersedes = await read(Q.REPLAY_SUPERSEDES_FOR_DAY);
    const asserts = await read(Q.REPLAY_ASSERTS_FOR_DAY);

    // Same order as a real extraction: nodes before the edges that MATCH them.
    await this.graph.batchWrite(targetGraph, Q.MERGE_SYSTEMS, systems);
    await this.graph.batchWrite(targetGraph, Q.MERGE_MENTIONS, mentions);
    await this.graph.batchWrite(targetGraph, Q.MERGE_DECISIONS, decisions);
    await this.graph.batchWrite(targetGraph, Q.MERGE_ABOUT, about);
    await this.graph.batchWrite(targetGraph, Q.MERGE_SUPERSEDES, supersedes);
    await this.graph.batchWrite(targetGraph, Q.MERGE_ASSERTS, asserts);
    return { systems: systems.length, mentions: mentions.length, decisions: decisions.length, supersedes: supersedes.length };
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

/** What one extraction run writes, before it is written. */
export interface ExtractionRows {
  systems: Set<string>;
  mentions: Map<string, { artifactId: string; system: string; weight: number }>;
  decisions: { id: string; artifactId: string; summary: string; day: number | null; kind: string; confidence: number }[];
  about: { decisionId: string; system: string }[];
  claims: { id: string; pageId: string; claim: string; system: string }[];
  canon: Canonicalizer;
}

/** LLM answers -> graph rows: systems canonicalised, weak mentions and decisions dropped, claims for Pages only. */
export function extractionRows(extracted: ExtractedItem[], canon: Canonicalizer, summary: ExtractSummary): ExtractionRows {
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
      for (const claim of claimRows(item.id, value.asserts, canon)) {
        systems.add(claim.system);
        claims.push(claim);
      }
    }
  }
  return { systems, mentions, decisions, about, claims, canon };
}

/** Earlier decisions shown to the live-links prompt per system. */
export const LIVE_LINK_CANDIDATES = 25;

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'via', 'use', 'using', 'all', 'new', 'per', 'will', 'are', 'its', 'our', 'not', 'than', 'then', 'that', 'this', 'next', 'back', 'instead']);

/** Lower-cased words of 3+ characters (keeping "max_pool_size" and "rds"), minus common words. */
export function decisionWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w)));
}

/**
 * The `limit` earlier decisions that share the most rare words with the new ones
 * (each shared word weighs log(N / decisions using it)), best first; ones that share
 * nothing are left out. Ties go to the newer decision.
 */
export function closestDecisions<T extends { id: string; day: number | null; summary: string }>(added: T[], earlier: T[], limit: number): T[] {
  const target = new Set(added.flatMap((d) => [...decisionWords(d.summary)]));
  const words = earlier.map((d) => decisionWords(d.summary));
  const uses = new Map<string, number>();
  for (const set of words) for (const w of set) uses.set(w, (uses.get(w) ?? 0) + 1);
  const scored = earlier.map((d, i) => ({
    d,
    score: [...words[i]].filter((w) => target.has(w)).reduce((sum, w) => sum + Math.log((earlier.length + 1) / (uses.get(w) ?? 1)), 0),
  }));
  return scored
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || (b.d.day ?? 0) - (a.d.day ?? 0))
    .slice(0, limit)
    .map((x) => x.d)
    .sort((a, b) => (a.day ?? 0) - (b.day ?? 0));
}

/** A blank summary for a run that is not a full extraction (one live document). */
function emptySummary(graph: string, provider: string, model: string, vocabulary: string[]): ExtractSummary {
  return {
    graph, provider, model, promptVersion: PROMPT_VERSION, candidates: 1, selected: 1, fromCache: 0, plannedCalls: 1,
    llmCalls: 0, failures: [], tokens: { ...NO_TOKENS }, linkCalls: 0, linkSystems: 0, vocabulary, dryRun: false,
    estimatedInputTokens: 0, estimatedOutputTokens: 0, extracted: [], rawSystemNames: new Map(), canonicalizer: null, rejectedLinks: 0,
  };
}

/**
 * Whether an artifact's body is worth an LLM call. Tickets always are: a sprint
 * ticket's body is just its title (~85 chars), yet the title names the systems
 * the work touches, and without MENTIONS a ticket has no candidate new owners (K6).
 * Everything else must be longer than minBodyChars.
 */
export function worthExtracting(label: string, body: string, minBodyChars: number): boolean {
  if (label === 'Ticket') return body.trim().length > 0;
  return body.length > minBodyChars;
}

/** Characters per token, for estimates only (English text averages about 4). */
const CHARS_PER_TOKEN = 4;
/** Estimated output tokens per stale-links call (a few ids each). */
const STALE_LINK_OUTPUT_TOKENS = 200;

export interface StaleRelinkSummary {
  claims: number;
  targets: number;
  targetsWithClaims: number;
  calls: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  dryRun: boolean;
  llmCalls: number;
  supersedes: number;
  asserts: number;
  rejected: number;
  failures: { id: string; error: string }[];
  tokens: LlmTokenUsage;
}

/** Claim rows for one page: canonical system name, stable id C:<page id>:<n>. */
export function claimRows(
  pageId: string,
  asserts: readonly { claim: string; system: string }[],
  canon: Canonicalizer,
): { id: string; pageId: string; claim: string; system: string }[] {
  return asserts.flatMap((claim, index) => {
    const system = canon.canonical(claim.system);
    return system ? [{ id: `C:${pageId}:${index}`, pageId, claim: claim.claim, system }] : [];
  });
}

/** The artifact a decision was made in, from its stable id "D:<artifact id>:<n>". */
export function decisionSource(decisionId: string): string {
  return decisionId.slice(0, decisionId.lastIndexOf(':'));
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
  // The model sometimes drops the "D:" prefix of a decision id; put it back when that names a given decision.
  const fixId = (id: string) => (dayById.has(id) || !dayById.has(`D:${id}`) ? id : `D:${id}`);
  const proposedSupersedes = answer.supersedes.map((s) => ({ newerId: fixId(s.newerId), olderId: fixId(s.olderId) }));
  const proposedAsserts = answer.asserts.map((a) => ({ pageId: a.pageId, decisionId: fixId(a.decisionId) }));
  const supersedes = proposedSupersedes.filter(({ newerId, olderId }) => {
    if (newerId === olderId || !dayById.has(newerId) || !dayById.has(olderId)) return false;
    // A document does not supersede itself: both decisions from one artifact are steps of one plan.
    if (decisionSource(newerId) === decisionSource(olderId)) return false;
    const newer = dayById.get(newerId);
    const older = dayById.get(olderId);
    return newer === null || older === null || newer === undefined || older === undefined || newer >= older;
  });
  const asserts = proposedAsserts.filter(({ pageId, decisionId }) => pages.has(pageId) && dayById.has(decisionId));
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
