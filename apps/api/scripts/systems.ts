/**
 * System catalog maintenance (apex):
 *
 *   pnpm systems report                  distribution by mentions and authors, top 50, core counts
 *   pnpm systems merge [--dry-run]       merge names that differ only by case, punctuation,
 *                                        versions or a generic last word; updates aliases.json
 *   pnpm systems propose                 ONE cached LLM call on the 300 most mentioned systems:
 *                                        proposed merge groups -> data/catalog/merge-proposals.json
 *   pnpm systems apply-proposals         apply that file (after a human has reviewed it)
 *
 * merge and apply-proposals finish with an expertise refresh (KNOWS, COLLAB, apex_proj).
 */
import 'reflect-metadata';
import { config as loadDotenv } from 'dotenv';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ExpertiseService } from '../src/analytics/expertise.service';
import { type AliasFileJson, withMergedAliases } from '../src/catalog/alias-update';
import { CORE_MIN_AUTHORS, PROPOSAL_TOP_SYSTEMS } from '../src/catalog/catalog.constants';
import { CatalogService } from '../src/catalog/catalog.service';
import type { MergeGroup } from '../src/catalog/merge-key';
import {
  MERGE_PROMPT_VERSION,
  MERGE_SYSTEM_PROMPT,
  MergeProposalSchema,
  mergePrompt,
  type ValidatedProposal,
  validateProposals,
} from '../src/catalog/merge-proposals';
import { validateEnv } from '../src/config/env.schema';
import { findRepoRoot } from '../src/config/repo-root';
import { falkorSettingsFromEnv } from '../src/graph/falkor-settings';
import { APEX_GRAPH } from '../src/graph/graph.constants';
import { GraphService } from '../src/graph/graph.service';
import { llmSettingsFromEnv } from '../src/llm/llm-settings';
import { LlmService } from '../src/llm/llm.service';
import { costUsd } from '../src/llm/pricing';

/** Reasoning effort for the merge proposal call (OpenAI GPT-5 models). */
const MERGE_REASONING_EFFORT = 'medium';
import { ProjectionService } from '../src/projection/projection.service';

const ALIAS_PATH = join(findRepoRoot(), 'apps/api/src/extract/aliases.json');

async function main(): Promise<void> {
  loadDotenv({ path: join(findRepoRoot(), '.env'), quiet: true });
  const env = validateEnv(process.env);
  const graph = new GraphService(falkorSettingsFromEnv(env));
  await graph.connect(5);
  const catalog = new CatalogService(graph, { coreMinMentions: env.CORE_MIN_MENTIONS, coreMinAuthors: CORE_MIN_AUTHORS });
  const proposalsPath = join(env.DATA_DIR, 'catalog', 'merge-proposals.json');
  const command = process.argv[2] ?? 'report';
  try {
    if (command === 'report') await report(catalog);
    else if (command === 'merge') await automaticMerge(graph, catalog, process.argv.includes('--dry-run'));
    else if (command === 'propose') await propose(env, catalog, proposalsPath);
    else if (command === 'apply-proposals') await applyProposals(graph, catalog, proposalsPath);
    else throw new Error(`Unknown command "${command}" (report | merge | propose | apply-proposals)`);
  } finally {
    await graph.onModuleDestroy();
  }
}

async function report(catalog: CatalogService): Promise<void> {
  await catalog.refreshStats(APEX_GRAPH);
  const r = await catalog.report(APEX_GRAPH, 50);
  console.log(`\n${r.systems} systems, ${r.core} core`);
  console.log('by artifact mentions:', r.byMentions.map((b) => `${b.bucket}: ${b.systems}`).join(', '));
  console.log('by distinct authors: ', r.byAuthors.map((b) => `${b.bucket}: ${b.systems}`).join(', '));
  const counts = await catalog.coreCountsAt(APEX_GRAPH, [3, 4, 5, 6, 8, 10, 15, 20]);
  console.log(`core systems (authors >= ${CORE_MIN_AUTHORS}) by min mentions:`, counts.map((c) => `${c.minMentions}: ${c.core}`).join(', '));
  console.log('\ntop 50 (mentions / authors):');
  r.top.forEach((s, i) => console.log(`${String(i + 1).padStart(3)}. ${s.name} (${s.mentionCount} / ${s.authorCount})${s.core ? '' : '  [not core]'}`));
}

async function automaticMerge(graph: GraphService, catalog: CatalogService, dryRun: boolean): Promise<void> {
  const groups = await catalog.planAutomaticMerges(APEX_GRAPH);
  const merged = groups.reduce((n, g) => n + g.merge.length, 0);
  console.log(`\n${groups.length} groups, ${merged} systems to fold into a survivor${dryRun ? ' (dry run)' : ''}:`);
  printGroups(groups, 40);
  if (dryRun || groups.length === 0) return;
  await recordAndApply(graph, catalog, groups);
}

async function propose(env: ReturnType<typeof validateEnv>, catalog: CatalogService, path: string): Promise<void> {
  await catalog.refreshStats(APEX_GRAPH);
  const systems = (await catalog.systems(APEX_GRAPH))
    .sort((a, b) => b.mentionCount - a.mentionCount || a.name.localeCompare(b.name))
    .slice(0, PROPOSAL_TOP_SYSTEMS);
  // One call over 300 names needs more thought than per-document extraction: with
  // minimal reasoning gpt-5-nano stopped after one group. The effort is part of the
  // cache key (task) so answers made with different efforts are never mixed up.
  const settings = llmSettingsFromEnv(env);
  const llm = new LlmService({ ...settings, openai: { ...settings.openai, reasoningEffort: MERGE_REASONING_EFFORT } });
  llm.onModuleInit();
  const answer = await llm.generateObjectWithUsage(MergeProposalSchema, {
    task: `${MERGE_PROMPT_VERSION}:${MERGE_REASONING_EFFORT}`,
    system: MERGE_SYSTEM_PROMPT,
    prompt: mergePrompt(systems),
  });
  const groups = validateProposals(answer.value, systems);
  const usage = llm.usage();
  const cost = costUsd(usage.model, answer.usage);
  console.log(
    `\n${systems.length} systems sent; LLM calls: ${usage.jsonCalls} (cached answer: ${answer.cached ? 'yes' : 'no'}); ` +
      `tokens in ${answer.usage.inputTokens} out ${answer.usage.outputTokens}${cost === null ? '' : `; cost $${cost.toFixed(4)}`}`,
  );
  console.log(`${answer.value.groups.length} groups proposed, ${groups.length} valid (names from the list only):`);
  const mentions = new Map(systems.map((s) => [s.name, s.mentionCount]));
  for (const g of groups) {
    console.log(`  ${g.keep} (${mentions.get(g.keep)}) <- ${g.merge.map((m) => `${m} (${mentions.get(m)})`).join(', ')}  | ${g.reason}`);
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ promptVersion: MERGE_PROMPT_VERSION, groups }, null, 2) + '\n');
  console.log(`\nSaved to ${path}. Review it (delete groups you disagree with), then: pnpm systems apply-proposals`);
}

async function applyProposals(graph: GraphService, catalog: CatalogService, path: string): Promise<void> {
  const { groups } = JSON.parse(await readFile(path, 'utf8')) as { groups: ValidatedProposal[] };
  // Only names that still exist (an earlier merge may have folded some away).
  const existing = new Set((await catalog.systems(APEX_GRAPH)).map((s) => s.name));
  const live = groups
    .filter((g) => existing.has(g.keep))
    .map((g) => ({ keep: g.keep, merge: g.merge.filter((m) => existing.has(m)) }))
    .filter((g) => g.merge.length > 0);
  console.log(`\nApplying ${live.length} reviewed groups:`);
  printGroups(live, live.length);
  await recordAndApply(graph, catalog, live);
}

/** Merge in the graph, record the merges in aliases.json, then refresh expertise and apex_proj. */
async function recordAndApply(graph: GraphService, catalog: CatalogService, groups: MergeGroup[]): Promise<void> {
  const result = await catalog.applyMerges(APEX_GRAPH, groups);
  const file = JSON.parse(await readFile(ALIAS_PATH, 'utf8')) as AliasFileJson;
  const next = withMergedAliases(file, groups);
  await writeFile(ALIAS_PATH, JSON.stringify(next, null, 2) + '\n');
  const added = Object.keys(next.aliases).length - Object.keys(file.aliases).length;
  console.log(`\nMerged ${result.merged} systems: ${result.systems} left, ${result.core} core; aliases.json +${added} entries`);
  const refreshed = await new ExpertiseService(graph, catalog).refresh();
  const projected = await new ProjectionService(graph).rebuild();
  console.log(`Expertise refreshed: ${refreshed.knows} KNOWS, ${refreshed.collab} COLLAB; apex_proj ${projected.systems} systems`);
}

function printGroups(groups: readonly MergeGroup[], limit: number): void {
  for (const g of groups.slice(0, limit)) console.log(`  ${g.keep} <- ${g.merge.join(' | ')}`);
  if (groups.length > limit) console.log(`  ... and ${groups.length - limit} more`);
}

main().catch((error: unknown) => {
  console.error('systems failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
