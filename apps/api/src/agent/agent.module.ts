import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Env } from '../config/env.schema';
import { APEX_GRAPH } from '../graph/graph.constants';
import { LLM_SETTINGS, type LlmSettings } from '../llm/llm.types';
import { AGENT_MODEL, AGENT_TOOLS, BUDGET_MS, FINAL_ANSWER_GRACE_MS, MAX_STEPS } from './agent.constants';
import { AgentController } from './agent.controller';
import { AGENT_SETTINGS, AgentService, type AgentSettings } from './agent.service';
import type { AgentModel } from './agent.types';
import { McpToolClient } from './mcp-tool-client';
import { GeminiAgentModel } from './models/gemini-agent.model';
import { OpenAiAgentModel } from './models/openai-agent.model';

/** POST /agent/ask: the question-answering agent, an MCP client of this API's own /mcp (Stage 10). */
@Module({
  controllers: [AgentController],
  providers: [
    {
      provide: AGENT_SETTINGS,
      useValue: { graph: APEX_GRAPH, maxSteps: MAX_STEPS, budgetMs: BUDGET_MS, finalAnswerGraceMs: FINAL_ANSWER_GRACE_MS } satisfies AgentSettings,
    },
    {
      // The same provider switch as the rest of the app: OpenAI when USE_OPENAI=yes, else Gemini.
      provide: AGENT_MODEL,
      inject: [LLM_SETTINGS, ConfigService],
      useFactory: (llm: LlmSettings, config: ConfigService<Env, true>): AgentModel =>
        llm.provider === 'openai'
          ? new OpenAiAgentModel(llm.openai.apiKey ?? '', llm.openai.model, config.get('AGENT_REASONING_EFFORT', { infer: true }))
          : new GeminiAgentModel(llm.gemini.apiKeys, llm.gemini.model),
    },
    {
      // The tools come from MCP over HTTP, in process: API_BASE_URL/mcp.
      provide: AGENT_TOOLS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new McpToolClient(() => new StreamableHTTPClientTransport(new URL('/mcp', config.get('API_BASE_URL', { infer: true })))),
    },
    AgentService,
  ],
})
export class AgentModule {}
