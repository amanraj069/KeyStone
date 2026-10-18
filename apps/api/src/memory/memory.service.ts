import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { FeedbackRequest, FeedbackResponse, Note, NoteStatus, Recall, SessionSummary } from '@keystone/shared';
import { randomUUID } from 'node:crypto';
import { LAST_ARTIFACT_DAY } from '../analytics/queries/analytics.queries';
import { GraphService } from '../graph/graph.service';
import {
  ANONYMOUS_USER,
  MAX_LIST_ROWS,
  MAX_NAME_WORDS,
  MAX_NOTES_PER_QUESTION,
  MAX_PRIOR_TURNS,
  MAX_RECALLED_QUESTIONS,
  MAX_SUMMARY_CHARS,
  MEMORY_SETTINGS,
  type MemorySettings,
  NOTE_ID_PREFIX,
} from './memory.constants';
import * as Q from './queries/memory.queries';

/** An earlier turn of the same chat, as the model sees it before a follow-up. */
export interface PriorTurn {
  id: string;
  n: number;
  question: string;
  summary: string;
  /** Artifacts that turn cited: still valid citations in a follow-up. */
  cited: string[];
  subjects: string[];
}

/** An approved note the agent may use and cite. */
export interface RecalledNote {
  id: string;
  text: string;
  day: number | null;
}

/** What the agent knows before it answers: the chat so far and approved notes on its subjects. */
export interface MemoryContext {
  priorTurns: PriorTurn[];
  notes: RecalledNote[];
  /** Systems and people the question (or the chat so far) is about. */
  subjects: string[];
}

export const EMPTY_CONTEXT: MemoryContext = { priorTurns: [], notes: [], subjects: [] };

/** One answered question, as the agent reports it. */
export interface TurnInput {
  userId?: string;
  sessionId: string;
  question: string;
  answer: string;
  label: string;
  outcome: string;
  toolCalls: { name: string; args: Record<string, unknown> }[];
  cited: string[];
  latencyMs: number;
}

/** The part of MemoryService the agent uses (a fake in tests). */
export type AgentMemory = Pick<MemoryService, 'contextFor' | 'recordTurn'>;

/**
 * The agent's memory, kept in the company graph:
 * - episodic: every question and answer is a Turn of a Session, linked to the
 *   artifacts it cited and the systems and people it was about;
 * - semantic: a correction from a user becomes a Note that, once a person approves
 *   it, the agent sees and cites whenever a question is about the same subjects.
 * Writes never block an answer: the agent treats a failure here as "no memory".
 */
@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private lastDayCache: { day: number | null; at: number } | null = null;

  constructor(
    private readonly graph: GraphService,
    @Inject(MEMORY_SETTINGS) private readonly settings: MemorySettings,
  ) {}

  /** Stores one answered question and returns the new Turn's id. */
  async recordTurn(input: TurnInput): Promise<string> {
    const graph = this.settings.graph;
    const id = `turn-${randomUUID()}`;
    const at = Date.now();
    const [row] = await this.graph.query<{ id: string; n: number }>(graph, Q.CREATE_TURN, {
      userId: input.userId ?? ANONYMOUS_USER,
      sessionId: input.sessionId,
      title: input.question.slice(0, 120),
      id,
      question: input.question,
      summary: summarize(input.answer),
      label: input.label,
      outcome: input.outcome,
      tools: input.toolCalls.map((call) => call.name),
      at,
      day: await this.lastDay(),
      latencyMs: input.latencyMs,
    });
    if (!row) throw new Error('The turn was not stored');

    const named = await this.subjectsIn(input.question);
    const fromTools = subjectsFromToolCalls(input.toolCalls);
    const systems = unique([...named.systems, ...fromTools.systems]);
    const people = unique([...named.people, ...fromTools.people]);
    if (input.cited.length > 0) await this.graph.query(graph, Q.LINK_TURN_CITED, { turnId: id, ids: input.cited });
    if (systems.length > 0) await this.graph.query(graph, Q.LINK_TURN_SYSTEMS, { turnId: id, names: systems });
    if (people.length > 0) await this.graph.query(graph, Q.LINK_TURN_PEOPLE, { turnId: id, names: people });
    return id;
  }

  /**
   * Before answering: the last turns of this chat, and the approved notes about the
   * systems and people named in the question or in those turns (a follow-up such as
   * "and if she leaves?" names nobody, so the chat's subjects count too).
   */
  async contextFor(sessionId: string, question: string): Promise<MemoryContext> {
    const graph = this.settings.graph;
    const priorTurns = await this.graph.roQuery<PriorTurn>(graph, Q.PRIOR_TURNS, { sessionId, limit: MAX_PRIOR_TURNS });
    const named = await this.subjectsIn(question);
    const subjects = unique([...named.systems, ...named.people, ...priorTurns.flatMap((t) => t.subjects)]);
    const notes =
      subjects.length === 0
        ? []
        : await this.graph.roQuery<RecalledNote>(graph, Q.APPROVED_NOTES_ABOUT, { names: subjects, limit: MAX_NOTES_PER_QUESTION });
    return { priorTurns, notes, subjects };
  }

  /** What Keystone remembers about some systems or people (the recall_memory tool, GET /memory/about). */
  async recall(names: string[]): Promise<Recall[]> {
    return this.graph.roQuery<Recall>(this.settings.graph, Q.RECALL, { names: unique(names), maxQuestions: MAX_RECALLED_QUESTIONS });
  }

  /** A rating on a turn; a thumbs-down with a correction also proposes a Note. */
  async feedback(turnId: string, request: FeedbackRequest): Promise<FeedbackResponse> {
    const graph = this.settings.graph;
    const [turn] = await this.graph.roQuery<{ id: string }>(graph, Q.TURN_EXISTS, { turnId });
    if (!turn) throw new NotFoundException(`No turn "${turnId}"`);
    const userId = request.userId ?? ANONYMOUS_USER;
    const at = Date.now();
    await this.graph.query(graph, Q.RECORD_FEEDBACK, { turnId, userId, id: `feedback-${randomUUID()}`, rating: request.rating, at });

    let noteId: string | null = null;
    if (request.rating === 'down' && request.correction) {
      noteId = `${NOTE_ID_PREFIX}${randomUUID().slice(0, 8)}`;
      await this.graph.query(graph, Q.PROPOSE_NOTE, { turnId, userId, id: noteId, text: request.correction, at });
      const named = await this.subjectsIn(request.correction);
      if (named.systems.length > 0) await this.graph.query(graph, Q.LINK_NOTE_SYSTEMS, { noteId, names: named.systems });
      if (named.people.length > 0) await this.graph.query(graph, Q.LINK_NOTE_PEOPLE, { noteId, names: named.people });
    }
    return { turnId, rating: request.rating, noteId };
  }

  /** Notes, newest first, optionally only one status. */
  async notes(status: NoteStatus | null = null): Promise<Note[]> {
    return this.graph.roQuery<Note>(this.settings.graph, Q.LIST_NOTES, { status, limit: MAX_LIST_ROWS });
  }

  /** Approves or rejects a proposed note. Only approved notes ever reach the agent. */
  async review(id: string, status: 'approved' | 'rejected', reason: string | null = null): Promise<Note> {
    const graph = this.settings.graph;
    const [existing] = await this.graph.roQuery<{ id: string; status: NoteStatus }>(graph, Q.NOTE_STATUS, { id });
    if (!existing) throw new NotFoundException(`No note "${id}"`);
    const [updated] = await this.graph.query<{ id: string }>(graph, Q.REVIEW_NOTE, { id, status, reason, at: Date.now() });
    if (!updated) throw new ConflictException(`Note "${id}" is already ${existing.status}`);
    const note = (await this.notes()).find((n) => n.id === id);
    if (!note) throw new NotFoundException(`No note "${id}"`);
    return note;
  }

  /** A user's chats, most recent first. */
  async sessions(userId: string): Promise<SessionSummary[]> {
    return this.graph.roQuery<SessionSummary>(this.settings.graph, Q.SESSIONS_OF_USER, { userId, limit: MAX_LIST_ROWS });
  }

  /** Core systems and people named in a text (matched in the graph against names and aliases). */
  async subjectsIn(text: string): Promise<{ systems: string[]; people: string[] }> {
    const terms = nameTerms(text);
    if (terms.length === 0) return { systems: [], people: [] };
    const graph = this.settings.graph;
    const [systems, people] = await Promise.all([
      this.graph.roQuery<{ name: string }>(graph, Q.SYSTEMS_IN_TERMS, { terms }),
      this.graph.roQuery<{ name: string }>(graph, Q.PEOPLE_IN_TERMS, { terms }),
    ]);
    return { systems: systems.map((r) => r.name), people: people.map((r) => r.name) };
  }

  /** The company's current day (last day with an artifact), read at most once a minute. */
  private async lastDay(): Promise<number | null> {
    if (this.lastDayCache && Date.now() - this.lastDayCache.at < 60_000) return this.lastDayCache.day;
    try {
      const [row] = await this.graph.roQuery<{ day: number | null }>(this.settings.graph, LAST_ARTIFACT_DAY);
      this.lastDayCache = { day: row?.day ?? null, at: Date.now() };
    } catch (error) {
      this.logger.warn(`Could not read the last day: ${String(error)}`);
      this.lastDayCache = { day: null, at: Date.now() };
    }
    return this.lastDayCache.day;
  }
}

/**
 * The lower-cased words of a text and every run of up to MAX_NAME_WORDS of them,
 * so names of several words ("react admin portal") and with dashes ("auth-service")
 * can be matched exactly. "Priya's" gives "priya".
 */
export function nameTerms(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) ?? [];
  const cleaned = words.map((w) => w.replace(/[._-]+$/, ''));
  const terms = new Set<string>();
  for (let i = 0; i < cleaned.length; i++) {
    for (let n = 1; n <= MAX_NAME_WORDS && i + n <= cleaned.length; n++) terms.add(cleaned.slice(i, i + n).join(' '));
  }
  return [...terms];
}

/** Systems and people named in tool arguments (who_knows {system}, simulate_departure {person}, ...). */
export function subjectsFromToolCalls(calls: { args: Record<string, unknown> }[]): { systems: string[]; people: string[] } {
  const systems: string[] = [];
  const people: string[] = [];
  const strings = (value: unknown): string[] =>
    typeof value === 'string' ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  for (const { args } of calls) {
    systems.push(...strings(args.system));
    people.push(...strings(args.person), ...strings(args.people), ...strings(args.eventPeople));
  }
  return { systems: unique(systems), people: unique(people) };
}

/** The start of an answer, cut at a sentence end when there is one near the limit. */
export function summarize(answer: string): string {
  const text = answer.trim();
  if (text.length <= MAX_SUMMARY_CHARS) return text;
  const cut = text.slice(0, MAX_SUMMARY_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return `${end > MAX_SUMMARY_CHARS / 2 ? cut.slice(0, end + 1) : cut}…`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
