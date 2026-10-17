/**
 * Ask Keystone's agent from the command line (same agent as POST /agent/ask; the
 * API must be running, because the tools come from its /mcp endpoint):
 *
 *   pnpm ask "Who knows TitanDB best?"          prints the event stream
 *   pnpm ask --raw "Who knows TitanDB best?"     also prints the model's answer before the citation guardrail
 */
import 'reflect-metadata';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config as loadDotenv } from 'dotenv';
import { join } from 'node:path';
import { BUDGET_MS, FINAL_ANSWER_GRACE_MS, MAX_STEPS } from '../src/agent/agent.constants';
import { AgentService } from '../src/agent/agent.service';
import { McpToolClient } from '../src/agent/mcp-tool-client';
import { GeminiAgentModel } from '../src/agent/models/gemini-agent.model';
import { OpenAiAgentModel } from '../src/agent/models/openai-agent.model';
import { validateEnv } from '../src/config/env.schema';
import { findRepoRoot } from '../src/config/repo-root';
import { falkorSettingsFromEnv } from '../src/graph/falkor-settings';
import { APEX_GRAPH } from '../src/graph/graph.constants';
import { GraphService } from '../src/graph/graph.service';
import { llmSettingsFromEnv } from '../src/llm/llm-settings';
import { LlmService } from '../src/llm/llm.service';

async function main(): Promise<void> {
  loadDotenv({ path: join(findRepoRoot(), '.env'), quiet: true });
  const env = validateEnv(process.env);
  const raw = process.argv.includes('--raw');
  const question = process.argv.slice(2).filter((a) => a !== '--raw').join(' ');
  if (!question) throw new Error('Usage: pnpm ask [--raw] "question"');

  const graph = new GraphService(falkorSettingsFromEnv(env));
  await graph.connect(5);
  const settings = llmSettingsFromEnv(env);
  const llm = new LlmService(settings);
  llm.onModuleInit();
  const model =
    settings.provider === 'openai'
      ? new OpenAiAgentModel(settings.openai.apiKey ?? '', settings.openai.model, env.AGENT_REASONING_EFFORT)
      : new GeminiAgentModel(settings.gemini.apiKeys, settings.gemini.model);
  const tools = new McpToolClient(() => new StreamableHTTPClientTransport(new URL('/mcp', env.API_BASE_URL)));
  const agent = new AgentService(model, tools, llm, graph, {
    graph: APEX_GRAPH,
    maxSteps: MAX_STEPS,
    budgetMs: BUDGET_MS,
    finalAnswerGraceMs: FINAL_ANSWER_GRACE_MS,
  });
  try {
    for await (const event of agent.run(question, 'cli')) {
      const shown = event.type === 'tool_result' || event.type === 'done' ? { ...event, graphPath: event.graphPath ? `${event.graphPath.nodes.length} nodes` : null } : event;
      console.log(JSON.stringify(shown));
    }
    if (raw) console.log(`\nraw answer before the guardrail:\n${agent.lastRawAnswer ?? '(none)'}`);
  } finally {
    await tools.close();
    await graph.onModuleDestroy();
  }
}

main().catch((error: unknown) => {
  console.error('ask failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
