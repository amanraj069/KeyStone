import type { Question } from './answer-key';
import { blindAnswer, describeGold, expectedFromWording, goldAnswer, judgePrompt, leadingVerdict, scoreIds, scoreName } from './scoring';

const question = (truth: Record<string, unknown>): Question => ({
  question_id: 'q1',
  question_type: 'T',
  question_text: 'Q?',
  ground_truth: truth,
});
const known = { isArtifactId: (v: string) => /^ENG-\d+$/.test(v), isPersonOrSystem: (v: string) => ['Ada', 'Ledger'].includes(v) };

describe('scoring', () => {
  it('chooses ids, name or judge from the gold answer', () => {
    expect(goldAnswer(question({ answer: ['ENG-1', 'ENG-2'] }), known)).toMatchObject({ method: 'ids', ids: ['ENG-1', 'ENG-2'] });
    expect(goldAnswer(question({ answer: 'Ada' }), known)).toMatchObject({ method: 'name', name: 'Ada' });
    expect(goldAnswer(question({ answer: false, link_value: 'ENG-1' }), known).method).toBe('judge');
    expect(goldAnswer(question({ answer: 'something else' }), known).method).toBe('judge');
  });

  it('describes a yes/no gold answer with its reason and evidence for the judge', () => {
    expect(describeGold({ could_actor_have_known: true, reason: 'Was on the thread', evidence_artifacts: ['ENG-1'] })).toBe(
      'Correct conclusion: the person could have known about it by then\nReason: Was on the thread\nSupporting artifacts: ENG-1',
    );
    expect(describeGold({ outcome_changed: false, outcome: 'still happens', evidence_chain_artifacts: { cause: ['A'], effect: ['B'] } })).toBe(
      'Correct conclusion: the later outcome would have happened anyway, even without the earlier event\nOutcome: still happens\nSupporting artifacts: A, B',
    );
  });

  it('ids: every gold id must be cited, exactly as written', () => {
    expect(scoreIds(['ENG-1'], ['ENG-1', 'ENG-9']).correct).toBe(true);
    expect(scoreIds(['ENG-1', 'ENG-2'], ['ENG-1']).correct).toBe(false);
    expect(scoreIds(['ENG-1'], ['eng-1']).correct).toBe(false);
  });

  it('names: whole-word match after normalising', () => {
    expect(scoreName('Ada', 'Ask ADA, she wrote it [ENG-1].').correct).toBe(true);
    expect(scoreName('Ada', 'Ask Adam.').correct).toBe(false);
    expect(scoreName('Ledger-Sync', 'The ledger sync service owns it.').correct).toBe(true);
  });

  it('expectedFromWording settles the two unambiguous counterfactual shapes, and nothing else', () => {
    const changed = { outcome_changed: true };
    expect(expectedFromWording('Had Miki not reviewed it, would Alex still have merged it?', changed)).toBe('no');
    expect(expectedFromWording('Would the coordination have occurred without the incident?', changed)).toBe('no');
    expect(expectedFromWording('Was the ticket a direct consequence of the vendor email?', changed)).toBe('yes');
    expect(expectedFromWording('Would X still have happened?', { outcome_changed: false })).toBe('yes');
    expect(expectedFromWording('Did Bill make the mistake?', changed)).toBeNull();
    expect(expectedFromWording('Would Alex still have known?', { could_actor_have_known: true })).toBeNull();
  });

  it('leadingVerdict reads only the opening yes/no', () => {
    expect(leadingVerdict('No: nothing followed [T-1].')).toBe('no');
    expect(leadingVerdict('  Yes. It did.')).toBe('yes');
    expect(leadingVerdict('Yes/No: No. The escalation had no ticket.')).toBe('no');
    expect(leadingVerdict('Not determinable; no, maybe.')).toBeNull();
    expect(leadingVerdict("The answer is not in the company's records.")).toBeNull();
  });

  it("blinds the judge: Keystone's tools note is removed and the prompt never names a system", () => {
    expect(blindAnswer("The answer is not in the company's records. Tools tried: search_knowledge, who_knows.")).toBe(
      "The answer is not in the company's records.",
    );
    const prompt = judgePrompt('Q?', 'Answer: yes', 'Yes [ENG-1].');
    expect(prompt).not.toMatch(/keystone|baseline|vector/i);
  });
});
