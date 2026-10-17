import type { SearchResponse } from '@keystone/shared';
import type { AgentAnswer } from '../agent/agent.service';
import type { Question } from './answer-key';
import { EXPECTED_TASK, JUDGE_TASK } from './bench.constants';
import { KNOWN_ARTIFACT_IDS } from './queries/bench.queries';
import { QaBench } from './qa-bench';

const QUESTION: Question = {
  question_id: 'q1',
  question_type: 'SILENCE',
  question_text: 'Was a follow-up filed?',
  ground_truth: { answer: false, expected_search_space: ['D-2', 'D-9'] },
};

function setup(agentAnswer: Partial<AgentAnswer> | Error, baselineAnswer = 'No follow-up was filed [D-1]. See also [D-9].') {
  const hits = ['D-1', 'D-2', 'D-3'].map((id) => ({ artifactId: id, text: 'x'.repeat(40) }));
  const retrieval = { vectorOnlySearch: jest.fn(async () => ({ hits }) as unknown as SearchResponse) };
  const agent = {
    ask: jest.fn(async (): Promise<AgentAnswer> => {
      if (agentAnswer instanceof Error) throw agentAnswer;
      return { label: 'general', answer: 'No [D-2].', citations: [{ id: 'D-2', title: null, type: null, day: null }], toolsUsed: ['find_artifacts'], toolCalls: [{ name: 'find_artifacts', args: { fromDay: 3 } }], evidence: ['D-2', 'D-7'], steps: 1, timings: {}, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0 }, error: null, ...agentAnswer };
    }),
  };
  const prompts: { task: string; prompt: string }[] = [];
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };
  const llm = {
    generateObjectWithUsage: jest.fn(async (_schema: unknown, request: { task: string; prompt: string }) => {
      prompts.push(request);
      return { value: { answer: baselineAnswer }, usage, cached: false };
    }),
  };
  // The judge is its own service (BENCH_JUDGE_MODEL); the baseline's never judges.
  const judge = {
    generateObjectWithUsage: jest.fn(async (_schema: unknown, request: { task: string; prompt: string }) => {
      prompts.push(request);
      if (request.task === EXPECTED_TASK) return { value: { answer: 'no' }, usage, cached: false };
      return { value: { verdict: 'correct', reason: 'Says no.\nSame conclusion.' }, usage, cached: false };
    }),
  };
  // D-2 is a real artifact; D-9 (also listed by the answer key) is not, so it is not gold evidence.
  const graph = { roQuery: jest.fn(async (_g: string, query: string) => (query === KNOWN_ARTIFACT_IDS ? [{ id: 'D-2' }] : [])) };
  // A budget that fits two of the three 45-character blocks.
  const bench = new QaBench({ agent, retrieval, llm: llm as never, judge: judge as never, graph: graph as never }, { graph: 'apex', contextBudgetChars: 100, baselineK: 3 });
  return { bench, agent, retrieval, prompts, llm, judge };
}

describe('QaBench', () => {
  it('runs both systems, keeps the baseline inside the context budget and its citations to what it was shown', async () => {
    const { bench, prompts, retrieval, agent } = setup({});
    const gold = await bench.goldAnswers([QUESTION]);
    const [result] = await bench.run([QUESTION], gold);

    expect(agent.ask).toHaveBeenCalledWith('Was a follow-up filed?', 'bench-q1');
    expect(retrieval.vectorOnlySearch).toHaveBeenCalledWith('apex', { q: 'Was a follow-up filed?', k: 3 });
    const baselinePrompt = prompts.find((p) => p.task !== JUDGE_TASK)!.prompt;
    expect(baselinePrompt).toContain('[D-2]');
    expect(baselinePrompt).not.toContain('[D-3]');
    expect(result.baseline.citedIds).toEqual(['D-1']);
    expect(result.keystone.citedIds).toEqual(['D-2']);
    // Both open with "No", the expected answer: compared directly, no free-form judging needed.
    expect(result).toMatchObject({ method: 'judge', keystone: { correct: true, reason: expect.stringContaining('opens with "no"') }, baseline: { correct: true } });
  });

  it('records the gold verdict and evidence, what each system had in front of it, and evidence recall', async () => {
    const { bench, llm, judge } = setup({});
    const [result] = await bench.run([QUESTION], await bench.goldAnswers([QUESTION]));
    expect(result).toMatchObject({ goldVerdict: 'no', goldEvidence: ['D-2'] });
    expect(result.keystone).toMatchObject({ retrieved: ['D-2', 'D-7'], evidenceRecall: 1, toolCalls: [{ name: 'find_artifacts', args: { fromDay: 3 } }] });
    expect(result.baseline).toMatchObject({ retrieved: ['D-1', 'D-2'], evidenceRecall: 1 });
    expect(llm.generateObjectWithUsage).toHaveBeenCalledTimes(1);
    // One expected-answer call for the question, shared by both systems; no free-form judging.
    expect(judge.generateObjectWithUsage).toHaveBeenCalledTimes(1);
  });

  it('the judge sees the question, the gold answer and one blinded candidate, never the ground truth of other fields or the system', async () => {
    const { bench, prompts } = setup({ answer: "The answer is not in the company's records. Tools tried: who_knows." });
    await bench.run([QUESTION], await bench.goldAnswers([QUESTION]));
    const judged = prompts.filter((p) => p.task === JUDGE_TASK).map((p) => p.prompt);
    // Only the refusal reaches the free-form judge: the baseline's leading "No" is compared directly.
    expect(judged).toHaveLength(1);
    expect(judged.join('\n')).not.toMatch(/Tools tried|keystone|baseline/i);
    expect(judged[0]).toContain('Correct conclusion: no, what the question asks about did not happen');
  });

  it('rescore judges a stored answer again with the current judge, keeping what the system did', async () => {
    const { bench, judge } = setup({});
    const gold = await bench.goldAnswers([QUESTION]);
    const [result] = await bench.run([QUESTION], gold);
    // An answer without a leading Yes/No goes to the free-form judge.
    const stored = { ...result.keystone, answer: 'The follow-up was never filed [D-2].', correct: false, reason: 'old judge' };
    const again = await bench.rescore(QUESTION, gold.get('q1')!, stored);
    expect(again).toMatchObject({ correct: true, reason: 'Says no. Same conclusion.', retrieved: stored.retrieved, latencyMs: stored.latencyMs, evidenceRecall: 1 });
    expect(judge.generateObjectWithUsage).toHaveBeenCalledTimes(2);
  });

  it('a leading Yes against an expected No is wrong, without asking the judge', async () => {
    const { bench, judge } = setup({ answer: 'Yes, a follow-up was filed [D-2].' });
    const [result] = await bench.run([QUESTION], await bench.goldAnswers([QUESTION]));
    expect(result.keystone).toMatchObject({ correct: false, reason: expect.stringContaining('opens with "yes"') });
    expect(judge.generateObjectWithUsage).toHaveBeenCalledTimes(1);
  });

  it('a failed run is scored wrong without asking the judge', async () => {
    const { bench, prompts } = setup(new Error('model down'));
    const [result] = await bench.run([QUESTION], await bench.goldAnswers([QUESTION]));
    expect(result.keystone).toMatchObject({ correct: false, error: 'model down', reason: 'no answer: model down' });
    expect(prompts.filter((p) => p.task === JUDGE_TASK)).toHaveLength(0);
  });
});
