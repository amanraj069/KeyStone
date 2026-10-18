import { ConflictException, NotFoundException } from '@nestjs/common';
import { MemoryExportService } from '../src/backup/memory-export.service';
import { MemoryService, type TurnInput } from '../src/memory/memory.service';
import { fixtureExpertise, useFixtureGraph } from './graph-test-utils';
import { DELETE_MEMORY, MEMORY_COUNTS, NEXT_TURN } from './queries/test.queries';

/**
 * Stage 16 memory on the mini-company fixture: every memory query runs against
 * FalkorDB. Turns link to the fixture's artifacts, systems and people; notes only
 * reach the agent once approved. Expertise is refreshed first so TitanDB is core.
 */
describe('MemoryService on the fixture graph', () => {
  const fx = useFixtureGraph();
  let memory: MemoryService;

  beforeAll(async () => {
    await fixtureExpertise(fx.graph).refresh({ graph: fx.name, asOfDay: 12 });
    memory = new MemoryService(fx.graph, { graph: fx.name });
  });

  const turn = (input: Partial<TurnInput> & Pick<TurnInput, 'sessionId' | 'question'>): TurnInput => ({
    userId: 'u1',
    answer: 'An answer [T-1].',
    label: 'who_knows',
    outcome: 'answered',
    toolCalls: [],
    cited: [],
    latencyMs: 5,
    ...input,
  });

  it('finds core systems by name or alias, and people, named in a text (SYSTEMS_IN_TERMS, PEOPLE_IN_TERMS)', async () => {
    await expect(memory.subjectsIn("Who knows titan db, and what if Ben's out?")).resolves.toEqual({ systems: ['TitanDB'], people: ['Ben'] });
    await expect(memory.subjectsIn('Tomorrow at the bench is fine')).resolves.toEqual({ systems: [], people: [] });
  });

  it('stores the turns of a chat in order, linked to what they cited and were about (CREATE_TURN, LINK_TURN_*, PRIOR_TURNS)', async () => {
    const first = await memory.recordTurn(
      turn({ sessionId: 'chat-a', question: 'Who knows TitanDB?', answer: 'Ada is the top expert [T-1].', toolCalls: [{ name: 'who_knows', args: { system: 'TitanDB' } }], cited: ['T-1', 'NOPE-1'] }),
    );
    const second = await memory.recordTurn(
      turn({ sessionId: 'chat-a', question: 'And if she leaves?', answer: 'Ben would cover [PR-1].', label: 'what_if', toolCalls: [{ name: 'simulate_departure', args: { person: 'Ada' } }], cited: ['PR-1'] }),
    );

    const context = await memory.contextFor('chat-a', 'Who else?');
    expect(context.priorTurns.map((t) => [t.n, t.question, t.summary])).toEqual([
      [1, 'Who knows TitanDB?', 'Ada is the top expert [T-1].'],
      [2, 'And if she leaves?', 'Ben would cover [PR-1].'],
    ]);
    expect(context.priorTurns[0].cited).toEqual(['T-1']); // NOPE-1 is no artifact: not linked
    expect(context.priorTurns[0].subjects).toEqual(['TitanDB']);
    expect(context.priorTurns[1].subjects).toEqual(['Ada']);
    // "Who else?" names nobody: the chat's subjects carry over to the follow-up.
    expect([...context.subjects].sort()).toEqual(['Ada', 'TitanDB']);
    expect(context.notes).toEqual([]);

    const [next] = await fx.graph.roQuery<{ id: string }>(fx.name, NEXT_TURN, { id: first });
    expect(next?.id).toBe(second);
    await expect(memory.sessions('u1')).resolves.toEqual([expect.objectContaining({ id: 'chat-a', title: 'Who knows TitanDB?', turns: 2 })]);
    await expect(memory.sessions('nobody')).resolves.toEqual([]);
  });

  it('a correction becomes a proposed note, and only once approved does a new chat see it (PROPOSE_NOTE, REVIEW_NOTE, APPROVED_NOTES_ABOUT)', async () => {
    const id = await memory.recordTurn(
      turn({ userId: 'u2', sessionId: 'chat-b', question: 'Who owns TitanDB?', answer: 'Ada [T-1].', toolCalls: [{ name: 'who_knows', args: { system: 'TitanDB' } }], cited: ['T-1'] }),
    );
    const feedback = await memory.feedback(id, { userId: 'u2', rating: 'down', correction: 'Ben took over TitanDB from Ada last week.' });
    expect(feedback.noteId).toMatch(/^NOTE-[0-9a-f]{8}$/);
    const noteId = feedback.noteId as string;

    const [proposed] = await memory.notes('proposed');
    expect(proposed).toMatchObject({ id: noteId, status: 'proposed', question: 'Who owns TitanDB?', turnId: id, evidence: ['T-1'], day: 12 });
    // About the turn's subject, and the people the correction itself names.
    expect([...proposed.subjects].sort()).toEqual(['Ada', 'Ben', 'TitanDB']);

    expect((await memory.contextFor('chat-c', 'Who owns TitanDB now?')).notes).toEqual([]);
    await expect(memory.review(noteId, 'approved')).resolves.toMatchObject({ id: noteId, status: 'approved' });
    expect((await memory.contextFor('chat-c', 'Who owns TitanDB now?')).notes).toEqual([
      { id: noteId, text: 'Ben took over TitanDB from Ada last week.', day: 12 },
    ]);
    expect((await memory.contextFor('chat-d', 'What does Ben work on?')).notes.map((n) => n.id)).toEqual([noteId]);

    await expect(memory.review(noteId, 'rejected', 'changed my mind')).rejects.toBeInstanceOf(ConflictException);
    await expect(memory.review('NOTE-00000000', 'approved')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a thumbs-up stores no note, and feedback on an unknown turn is a 404 (RECORD_FEEDBACK)', async () => {
    const id = await memory.recordTurn(turn({ sessionId: 'chat-e', question: 'Who knows MobileApp?' }));
    await expect(memory.feedback(id, { rating: 'up' })).resolves.toEqual({ turnId: id, rating: 'up', noteId: null });
    await expect(memory.feedback('turn-00000000-0000-0000-0000-000000000000', { rating: 'up' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recall counts questions about a subject and returns its approved notes (RECALL)', async () => {
    const [titan] = await memory.recall(['TitanDB']);
    expect(titan).toMatchObject({ subject: 'TitanDB', kind: 'system', timesAsked: 2 });
    expect(titan.notes).toHaveLength(1);
    expect(titan.pastQuestions.map((q) => q.question).sort()).toEqual(['Who knows TitanDB?', 'Who owns TitanDB?']);

    const [ben] = await memory.recall(['Ben']);
    expect(ben).toMatchObject({ subject: 'Ben', kind: 'person', timesAsked: 0, pastQuestions: [] });
    expect(ben.notes).toHaveLength(1);
    await expect(memory.recall(['NoSuchThing'])).resolves.toEqual([]);
  });

  it('exports all memory and restores it into a rebuilt graph, twice without duplicates (EXPORT_MEMORY, RESTORE_MEMORY_*)', async () => {
    // Only readMemory and restoreInto are used: no export store or lock needed.
    const exporter = new MemoryExportService(fx.graph, null as never, null as never);
    const [before] = await fx.graph.roQuery<Record<string, number>>(fx.name, MEMORY_COUNTS);
    const exported = await exporter.readMemory(fx.name);
    expect(exported.length).toBe(before.nodes);
    expect(new Set(exported.map((n) => n.label))).toEqual(new Set(['User', 'Session', 'Turn', 'Feedback', 'Note']));

    // The rebuilt graph has the same artifacts, systems and people, and no memory.
    await fx.graph.query(fx.name, DELETE_MEMORY);
    await expect(memory.sessions('u1')).resolves.toEqual([]);
    const summary = await exporter.restoreInto(fx.name, exported);
    expect(summary).toMatchObject({ nodes: before.nodes, edges: before.edges, unknownEdges: 0 });
    await exporter.restoreInto(fx.name, exported);
    const [after] = await fx.graph.roQuery<Record<string, number>>(fx.name, MEMORY_COUNTS);
    expect(after).toEqual(before);

    // Everything works again: chats, approved notes, recall.
    // u1's two chats (chat-e from the thumbs-up test is newer), with their turn counts.
    expect((await memory.sessions('u1')).map((x) => [x.id, x.turns])).toEqual([['chat-e', 1], ['chat-a', 2]]);
    expect((await memory.contextFor('chat-a', 'Who else?')).priorTurns).toHaveLength(2);
    expect((await memory.contextFor('chat-z', 'Who owns TitanDB?')).notes).toHaveLength(1);
    const [titan] = await memory.recall(['TitanDB']);
    expect(titan.timesAsked).toBe(2);
  });
});
