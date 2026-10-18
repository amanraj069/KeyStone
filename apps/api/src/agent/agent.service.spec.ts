import { NOT_IN_RECORDS, SYSTEM_PROMPT } from './agent.constants';
import { AgentService, type AgentSettings, sentences, withHint } from './agent.service';
import type { AgentEvent, AgentMessage, AgentModel, AgentTools, ModelTurn, ToolEnvelope } from './agent.types';
import type { AgentMemory, MemoryContext } from '../memory/memory.service';

/** A model that plays back scripted turns, recording what it was asked. */
function scriptedModel(turns: (ModelTurn | ((n: number) => ModelTurn))[]) {
  const calls: { allowTools: boolean; messages: number }[] = [];
  const inputs: AgentMessage[][] = [];
  const model: AgentModel & { calls: typeof calls; inputs: typeof inputs } = {
    provider: 'scripted',
    model: 'test',
    calls,
    inputs,
    step: jest.fn(async (input) => {
      expect(input.system).toBe(SYSTEM_PROMPT);
      calls.push({ allowTools: input.allowTools, messages: input.messages.length });
      inputs.push([...input.messages]);
      const next = turns[Math.min(calls.length - 1, turns.length - 1)];
      return typeof next === 'function' ? next(calls.length) : next;
    }),
  };
  return model;
}

const TOOLS = [{ name: 'who_knows', description: 'Experts on a system.', inputSchema: { type: 'object', properties: { system: { type: 'string' } } } }];

function fakeTools(result: (name: string) => ToolEnvelope | Promise<ToolEnvelope> = () => ({ data: { experts: [1, 2] }, evidence: ['CONF-1', 'CONF-2'], graphPath: { nodes: [{ id: 1 }], edges: [] } })): AgentTools & { call: jest.Mock } {
  return {
    list: jest.fn(async () => TOOLS),
    call: jest.fn(async (name: string) => ({ envelope: await result(name), isError: false })),
  };
}

function agent(model: AgentModel, tools: AgentTools, label = 'who_knows', settings: Partial<AgentSettings> = {}, memory?: AgentMemory) {
  const llm = { generateObjectWithUsage: jest.fn(async () => ({ value: { label }, usage: {}, cached: true })) };
  const graph = {
    roQuery: jest.fn(async (_g: string, _q: string, params: { ids: string[] }) =>
      params.ids.map((id) => ({ id, title: `Title of ${id}`, type: 'confluence', day: 3 })),
    ),
  };
  const service = new AgentService(model, tools, llm as never, graph as never, {
    graph: 'apex',
    maxSteps: 5,
    budgetMs: 60_000,
    finalAnswerGraceMs: 20_000,
    ...settings,
  }, memory);
  return { service, graph };
}

/** A memory that returns `context` before answering and records what it was asked to store. */
function fakeMemory(context: Partial<MemoryContext> = {}, fail = false) {
  const recordTurn = jest.fn(async () => {
    if (fail) throw new Error('graph down');
    return 'turn-1';
  });
  const contextFor = jest.fn(async () => {
    if (fail) throw new Error('graph down');
    return { priorTurns: [], notes: [], subjects: [], ...context };
  });
  return { contextFor, recordTurn } satisfies AgentMemory;
}

async function collect(stream: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const answerOf = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'answer_delta' ? [e.text] : [])).join('');
const doneOf = (events: AgentEvent[]) => events.find((e) => e.type === 'done') as Extract<AgentEvent, { type: 'done' }>;

describe('AgentService', () => {
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));

  it('streams classified, tool_call, tool_result, answer_delta, done in order, and removes a fake citation', async () => {
    const model = scriptedModel([
      { text: null, toolCalls: [{ id: 'c1', name: 'who_knows', args: { system: 'TitanDB' } }] },
      { text: 'Priya knows TitanDB best [CONF-1]. She also wrote the runbook [FAKE-99].', toolCalls: [] },
    ]);
    const { service, graph } = agent(model, fakeTools());
    const events = await collect(service.run('Who knows TitanDB best?', 's1'));

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('classified');
    expect(types.slice(1, 3)).toEqual(['tool_call', 'tool_result']);
    expect(types.at(-1)).toBe('done');
    expect(types.slice(3, -1).every((t) => t === 'answer_delta')).toBe(true);
    expect(events[1]).toEqual({ type: 'tool_call', name: 'who_knows', args: { system: 'TitanDB' } });
    expect(events[2]).toMatchObject({ type: 'tool_result', name: 'who_knows', summary: 'experts: 2', evidenceCount: 2 });

    expect(answerOf(events)).toBe('Priya knows TitanDB best [CONF-1]. She also wrote the runbook.');
    const done = doneOf(events);
    expect(done.citations).toEqual([{ id: 'CONF-1', title: 'Title of CONF-1', type: 'confluence', day: 3 }]);
    expect(done.graphPath.nodes).toEqual([{ id: 1 }]);
    expect(done.timings).toMatchObject({ steps: 1 });
    expect(graph.roQuery).toHaveBeenCalledTimes(1); // one Cypher query for all titles
  });

  it('stops after 5 tool calls and asks for a final answer without tools', async () => {
    const model = scriptedModel([
      (n) => (n <= 5 ? { text: null, toolCalls: [{ id: `c${n}`, name: 'who_knows', args: { system: `S${n}` } }] } : { text: 'Final [CONF-2].', toolCalls: [] }),
    ]);
    const tools = fakeTools();
    const events = await collect(agent(model, tools).service.run('Who knows everything?', 's2'));
    expect(events.filter((e) => e.type === 'tool_call')).toHaveLength(5);
    expect(tools.call).toHaveBeenCalledTimes(5);
    expect(model.calls.map((c) => c.allowTools)).toEqual([true, true, true, true, true, false]);
    expect(answerOf(events)).toBe('Final [CONF-2].');
    expect(doneOf(events).timings).toMatchObject({ steps: 5 });
  });

  it('answers every call of a turn, but runs only up to the step limit', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `c${i}`, name: 'who_knows', args: { system: `S${i}` } }));
    const model = scriptedModel([{ text: null, toolCalls: many }, { text: 'Done [CONF-1].', toolCalls: [] }]);
    const tools = fakeTools();
    const events = await collect(agent(model, tools).service.run('Many?', 's3'));
    expect(tools.call).toHaveBeenCalledTimes(5);
    expect(model.calls.map((c) => c.allowTools)).toEqual([true, false]);
    expect(model.calls[1].messages).toBe(1 + 1 + 7 + 1); // question, assistant turn, 7 tool results (2 "not run"), final prompt
    expect(answerOf(events)).toBe('Done [CONF-1].');
  });

  it('replaces an uncited answer with the not-in-records message and the tools tried', async () => {
    const model = scriptedModel([
      { text: null, toolCalls: [{ id: 'c1', name: 'who_knows', args: { system: 'X' } }] },
      { text: 'Probably Priya, she is great.', toolCalls: [] },
    ]);
    const events = await collect(agent(model, fakeTools()).service.run('Who knows X?', 's4'));
    expect(answerOf(events)).toBe(`${NOT_IN_RECORDS} Tools tried: who_knows.`);
    expect(doneOf(events).citations).toEqual([]);
  });

  it('a cited "No" about something missing is an answer, not a refusal', async () => {
    const model = scriptedModel([
      { text: null, toolCalls: [{ id: 'c1', name: 'what_followed', args: { id: 'CONF-1' } }] },
      { text: "No, no postmortem followed it in the company's records [CONF-1].", toolCalls: [] },
    ]);
    const events = await collect(agent(model, fakeTools(), 'event').service.run('Was a postmortem written after it?', 's9'));
    expect(answerOf(events)).toBe("No, no postmortem followed it in the company's records [CONF-1].");
    expect(doneOf(events).citations.map((c) => c.id)).toEqual(['CONF-1']);
  });

  it('the question carries its type, and a tool recipe for the event types', () => {
    expect(withHint('Was a ticket opened?', 'event')).toMatch(/Question type: event\. 1\) find_event .*2\) check_follow_up/);
    expect(withHint('Why did we pick Kafka?', 'why')).toMatch(/Question type: why\. Use it to choose tools/);
    expect(withHint('How is Chloe connected to TitanDB?', 'who_knows')).toMatch(/Question type: who_knows\. .*how_connected/);
    expect(withHint('Is the runbook current?', 'freshness')).toMatch(/Question type: freshness\. Call find_stale_docs first/);
  });

  it("normalizes the model's own refusal and drops its citations", async () => {
    const model = scriptedModel([
      { text: null, toolCalls: [{ id: 'c1', name: 'who_knows', args: { system: 'X' } }] },
      { text: 'Not in Apex Athletics records. [CONF-1][CONF-2]', toolCalls: [] },
    ]);
    const events = await collect(agent(model, fakeTools()).service.run("What is the CEO's favourite food?", 's8'));
    expect(answerOf(events)).toBe(`${NOT_IN_RECORDS} Tools tried: who_knows.`);
    expect(doneOf(events).citations).toEqual([]);
  });

  it('an answer that only mentions a gap later on is not treated as a refusal', async () => {
    const model = scriptedModel([
      { text: null, toolCalls: [{ id: 'c1', name: 'who_knows', args: { system: 'X' } }] },
      { text: 'Priya knows X best [CONF-1]. Her backup is not in the company records yet.', toolCalls: [] },
    ]);
    const events = await collect(agent(model, fakeTools()).service.run('Who knows X?', 's9'));
    expect(answerOf(events)).toBe('Priya knows X best [CONF-1]. Her backup is not in the company records yet.');
  });

  it('a refusal in other words is still normalized (general question too)', async () => {
    const model = scriptedModel([{ text: "There is no recorded information about the CEO's favourite food in Apex Athletics records. [CONF-1]", toolCalls: [] }]);
    const events = await collect(agent(model, fakeTools(), 'general').service.run("CEO's favourite food?", 's10'));
    expect(answerOf(events)).toBe(`${NOT_IN_RECORDS} No tools were tried.`);
    expect(doneOf(events).citations).toEqual([]);
  });

  it('keeps an uncited answer for a general question', async () => {
    const model = scriptedModel([{ text: 'Hello! Ask me about Apex Athletics.', toolCalls: [] }]);
    const events = await collect(agent(model, fakeTools(), 'general').service.run('Hi', 's5'));
    expect(answerOf(events)).toBe('Hello! Ask me about Apex Athletics.');
  });

  it('a tool past the time budget becomes an error result, then the model must answer', async () => {
    const model = scriptedModel([
      { text: null, toolCalls: [{ id: 'c1', name: 'who_knows', args: { system: 'Slow' } }] },
      { text: 'Nothing found [CONF-1].', toolCalls: [] },
    ]);
    const slow = fakeTools(() => new Promise<ToolEnvelope>((resolve) => setTimeout(() => resolve({ data: null, evidence: ['CONF-1'] }), 300)));
    const events = await collect(agent(model, slow, 'who_knows', { budgetMs: 50 }).service.run('Slow?', 's6'));
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ summary: 'error: Not finished within the time budget.', evidenceCount: 0 });
    expect(model.calls.map((c) => c.allowTools)).toEqual([true, false]);
    // CONF-1 never arrived as evidence, so the citation is dropped and the answer replaced.
    expect(answerOf(events)).toBe(`${NOT_IN_RECORDS} Tools tried: who_knows.`);
  });

  it('ask() returns the whole run at once, with tools, steps and summed token usage', async () => {
    const usage = { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 5 };
    const model = scriptedModel([
      { text: null, toolCalls: [{ id: 'c1', name: 'who_knows', args: { system: 'TitanDB' } }], usage },
      { text: 'Priya knows TitanDB best [CONF-1].', toolCalls: [], usage },
    ]);
    const { service } = agent(model, fakeTools());
    const result = await service.ask('Who knows TitanDB best?', 's1');

    expect(result.answer).toBe('Priya knows TitanDB best [CONF-1].');
    expect(result.citations.map((c) => c.id)).toEqual(['CONF-1']);
    expect(result.toolsUsed).toEqual(['who_knows']);
    expect(result.toolCalls).toEqual([{ name: 'who_knows', args: { system: 'TitanDB' } }]);
    expect(result.evidence).toEqual(['CONF-1', 'CONF-2']);
    expect(result.steps).toBe(1);
    expect(result.label).toBe('who_knows');
    expect(result.usage).toEqual({ inputTokens: 200, cachedInputTokens: 0, outputTokens: 40, reasoningTokens: 10 });
    expect(result.error).toBeNull();
  });

  it('turns a failure into an error event', async () => {
    const model: AgentModel = { provider: 'x', model: 'x', step: jest.fn(async () => Promise.reject(new Error('model down'))) };
    const events = await collect(agent(model, fakeTools()).service.run('Who?', 's7'));
    expect(events.map((e) => e.type)).toEqual(['classified', 'error']);
    expect(events[1]).toEqual({ type: 'error', message: 'model down' });
  });
});

describe('sentences', () => {
  it('splits after sentence ends and keeps trailing citations with their sentence', () => {
    const text = 'Priya leads [A]. Ben helps [B, C]! Done?';
    expect(sentences(text)).toEqual(['Priya leads [A]. ', 'Ben helps [B, C]! ', 'Done?']);
    expect(sentences(text).join('')).toBe(text);
  });

  it('does not split decimals, and splits at line breaks', () => {
    const text = 'Priya scores 100.47. [A]\n\n- Jax 65.4 [B]';
    expect(sentences(text)).toEqual(['Priya scores 100.47. [A]\n\n', '- Jax 65.4 [B]']);
    expect(sentences(text).join('')).toBe(text);
  });

  describe('with memory (Stage 16)', () => {
    const priorTurn = { id: 'turn-0', n: 1, question: 'Who knows TitanDB?', summary: 'Priya is the top expert [CONF-OLD].', cited: ['CONF-OLD'], subjects: ['TitanDB', 'Priya'] };

    it('shows the chat so far to the model, keeps its citations valid and stores the new turn', async () => {
      const model = scriptedModel([
        { text: null, toolCalls: [{ id: 'c1', name: 'simulate_departure', args: { person: 'Priya' } }] },
        { text: 'Jax would cover TitanDB [CONF-1]; Priya is still the top expert [CONF-OLD].', toolCalls: [] },
      ]);
      const memory = fakeMemory({ priorTurns: [priorTurn], subjects: ['TitanDB', 'Priya'] });
      const { service } = agent(model, fakeTools(), 'what_if', {}, memory);
      const events = await collect(service.run('And if she leaves?', 'chat-1', { userId: 'u1' }));

      expect(events[1]).toEqual({ type: 'memory', priorTurns: 1, notes: [], subjects: ['TitanDB', 'Priya'] });
      expect(model.inputs[0].slice(0, 2)).toEqual([
        { role: 'user', text: 'Who knows TitanDB?' },
        { role: 'assistant', text: 'Priya is the top expert [CONF-OLD].', toolCalls: [] },
      ]);
      expect(model.inputs[0][2]).toMatchObject({ role: 'user', text: expect.stringContaining('And if she leaves?') });
      // CONF-OLD came from the earlier turn, not from a tool now: it still counts as evidence.
      expect(answerOf(events)).toBe('Jax would cover TitanDB [CONF-1]; Priya is still the top expert [CONF-OLD].');
      expect(doneOf(events).turnId).toBe('turn-1');
      expect(memory.contextFor).toHaveBeenCalledWith('chat-1', 'And if she leaves?');
      expect(memory.recordTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          sessionId: 'chat-1',
          question: 'And if she leaves?',
          label: 'what_if',
          outcome: 'answered',
          toolCalls: [{ name: 'simulate_departure', args: { person: 'Priya' } }],
          cited: ['CONF-1', 'CONF-OLD'],
        }),
      );
    });

    it('adds approved notes to the question and lets the answer cite them', async () => {
      const model = scriptedModel([{ text: 'Tom took over TitanDB in March [NOTE-1a2b3c4d], after Priya [CONF-OLD].', toolCalls: [] }]);
      const note = { id: 'NOTE-1a2b3c4d', text: 'Tom took over TitanDB on-call in March.', day: 60 };
      const memory = fakeMemory({ priorTurns: [priorTurn], notes: [note], subjects: ['TitanDB'] });
      const { service, graph } = agent(model, fakeTools(), 'who_knows', {}, memory);
      const events = await collect(service.run('Who owns TitanDB now?', 'chat-2'));

      const asked = model.inputs[0].at(-1) as Extract<AgentMessage, { role: 'user' }>;
      expect(asked.text).toContain('- [NOTE-1a2b3c4d] Tom took over TitanDB on-call in March.');
      expect(answerOf(events)).toContain('[NOTE-1a2b3c4d]');
      expect(doneOf(events).citations.map((c) => c.id)).toEqual(['NOTE-1a2b3c4d', 'CONF-OLD']);
      // Notes are looked up as notes (CITED_NOTES), and are not stored as cited artifacts of the turn.
      expect(graph.roQuery.mock.calls.some(([, cypher]) => cypher.includes('MATCH (n:Note)'))).toBe(true);
      expect(memory.recordTurn).toHaveBeenCalledWith(expect.objectContaining({ cited: ['CONF-OLD'] }));
    });

    it('a note that was not recalled is still a hallucinated citation', async () => {
      const model = scriptedModel([{ text: 'Tom owns it [NOTE-deadbeef] [CONF-OLD].', toolCalls: [] }]);
      const { service } = agent(model, fakeTools(), 'who_knows', {}, fakeMemory({ priorTurns: [priorTurn] }));
      const events = await collect(service.run('Who owns TitanDB now?', 'chat-3'));
      expect(answerOf(events)).toBe('Tom owns it [CONF-OLD].');
    });

    it('answers without memory when reading or storing it fails', async () => {
      const model = scriptedModel([
        { text: null, toolCalls: [{ id: 'c1', name: 'who_knows', args: { system: 'TitanDB' } }] },
        { text: 'Priya knows TitanDB best [CONF-1].', toolCalls: [] },
      ]);
      const memory = fakeMemory({}, true);
      const { service } = agent(model, fakeTools(), 'who_knows', {}, memory);
      const events = await collect(service.run('Who knows TitanDB best?', 'chat-4'));
      expect(events.some((e) => e.type === 'memory' || e.type === 'error')).toBe(false);
      expect(answerOf(events)).toBe('Priya knows TitanDB best [CONF-1].');
      expect(doneOf(events).turnId).toBeNull();
    });

    it('without memory nothing is recalled or stored', async () => {
      const model = scriptedModel([{ text: 'Priya [CONF-1].', toolCalls: [] }]);
      const { service } = agent(model, fakeTools(), 'general');
      const events = await collect(service.run('Hi', 'chat-5'));
      expect(events.some((e) => e.type === 'memory')).toBe(false);
      expect(doneOf(events).turnId).toBeNull();
      expect(model.inputs[0]).toHaveLength(1);
    });
  });
});
