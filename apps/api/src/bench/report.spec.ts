import type { QuestionResult, SystemAnswer } from '@keystone/shared';
import { accuracyByType, b1Summary, b2Summary, isRefusal, majorityAccuracy, median, medianLatency, signTestP, summarizeQuestions, verdict, wilson } from './report';
import type { B1Results } from '@keystone/shared';

const answer = (correct: boolean | null, latencyMs = 100, cached = false): SystemAnswer => ({
  answer: '',
  citedIds: [],
  correct,
  reason: '',
  toolsUsed: [],
  steps: 0,
  latencyMs,
  cached,
  usage: null,
  error: null,
  toolCalls: [],
  retrieved: [],
  evidenceRecall: null,
});
const result = (type: string, k: boolean | null, b: boolean | null, kMs = 100, bMs = 10, bCached = false): QuestionResult => ({
  id: `${type}-${Math.random()}`,
  type,
  difficulty: null,
  question: 'Q?',
  method: 'judge',
  gold: 'yes',
  goldVerdict: 'yes',
  goldEvidence: [],
  keystone: answer(k, kMs),
  baseline: answer(b, bMs, bCached),
});

describe('report', () => {
  it('accuracy per type counts unscored answers as not correct', () => {
    const rows = accuracyByType([result('B', true, false), result('A', true, true), result('A', null, false)]);
    expect(rows.map((r) => [r.type, r.n, r.keystone, r.baseline])).toEqual([
      ['A', 2, 0.5, 0.5],
      ['B', 1, 1, 0],
    ]);
  });

  it('says plainly when the baseline wins or ties, with a hypothesis', () => {
    expect(verdict('SILENCE', 0.6, 0.4)).toBe('Keystone ahead by 20 points.');
    expect(verdict('SILENCE', 0.4, 0.4)).toMatch(/^Tie: the vector-only baseline does as well as Keystone\. Hypothesis: /);
    expect(verdict('NEW_TYPE', 0.2, 0.5)).toMatch(/^The vector-only baseline wins by 30 points\. Hypothesis: /);
  });

  it('median latency skips cached answers', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(median([])).toBeNull();
    const results = [result('A', true, true, 100, 10, true), result('A', true, true, 300, 30)];
    expect(medianLatency(results, 'keystone')).toBe(200);
    expect(medianLatency(results, 'baseline')).toBe(30);
  });

  it('counts refusals, and says plainly when both systems get most questions wrong', () => {
    expect(isRefusal("The answer is not in the company's records. Tools tried: who_knows.")).toBe(true);
    expect(isRefusal('Not determinable from the provided records.')).toBe(true);
    expect(isRefusal('No. Tom was on the thread [Z-1].')).toBe(false);
    const questions = [result('A', true, false), result('A', false, false), result('A', false, false)];
    questions[1].baseline.answer = "Not in the company's records.";
    const summary = summarizeQuestions(questions);
    expect(summary.refusals).toEqual({ keystone: 0, baseline: 1 });
    const text = b2Summary({ perType: 15, seed: 13, contextBudgetChars: 1, baselineK: 1, sampled: [], questions, ...summary }).join('\n');
    expect(text).toContain('**Both systems get most of these questions wrong** (Keystone 33%, vector-only 0%)');
    expect(text).toContain('vector-only 1 of 3');
  });

  it("the hindsight reference answers each type's most common yes/no, and recall is averaged where gold evidence exists", () => {
    const qs = [result('A', true, false), result('A', false, false), result('A', false, false), result('B', false, false)];
    qs[0].goldVerdict = 'no';
    qs[3].goldVerdict = 'no';
    // A: 2 yes, 1 no -> 2 right; B: 1 no -> 1 right; 3 of 4.
    expect(majorityAccuracy(qs)).toBe(0.75);
    qs[0].keystone.evidenceRecall = 1;
    qs[1].keystone.evidenceRecall = 0.5;
    expect(accuracyByType(qs)[0]).toMatchObject({ type: 'A', majority: 2 / 3, keystoneEvidenceRecall: 0.75, baselineEvidenceRecall: null });
  });

  it('B1 summary calls out empty predictions and a missed genesis check', () => {
    const prf = { tp: 0, fp: 0, fn: 3, precision: null, recall: 0, f1: null };
    const b1: B1Results = {
      minScore: 0.4,
      departures: [
        {
          person: 'Ada', day: 12, asOfDay: 11, projection: 'bench_proj_12', domains: ['a', 'b', 'c'], predicted: [], orphaned: [], matches: [],
          orphanedOnly: prf, knowledgeShare: { ...prf, predicted: [], matches: [] }, error: null, ...prf,
        },
      ],
      overall: prf,
      overallOrphanedOnly: prf,
      overallKnowledgeShare: prf,
      genesis: [],
      genesisOverall: { found: 0, total: 4, recall: 0 },
    };
    const text = b1Summary(b1).join('\n');
    expect(text).toContain('K5 listed **no systems** for Ada as of day 11');
    expect(text).toContain('**None** of the pre-day-1');
  });
});

describe('statistics', () => {
  it('wilson: a 95% interval that stays inside 0..1', () => {
    const [lo, hi] = wilson(10, 15)!;
    expect(lo).toBeCloseTo(0.417, 2);
    expect(hi).toBeCloseTo(0.848, 2);
    expect(wilson(0, 15)![0]).toBe(0);
    expect(wilson(15, 15)![1]).toBe(1);
    expect(wilson(0, 0)).toBeNull();
  });

  it('signTestP: exact two-sided binomial', () => {
    expect(signTestP(0, 0)).toBe(1);
    expect(signTestP(5, 5)).toBe(1);
    expect(signTestP(10, 0)).toBeCloseTo(2 / 1024, 6);
    expect(signTestP(8, 2)).toBeCloseTo(0.109375, 6);
  });
});
