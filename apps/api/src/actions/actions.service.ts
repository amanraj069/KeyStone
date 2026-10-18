import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { ActionRow, GraphView, HandoverPlan, LiveResult, WatcherProposal } from '@keystone/shared';
import { AnalyticsService } from '../analytics/analytics.service';
import { pathsToGraphView } from '../analytics/graph-view';
import { LAST_ARTIFACT_DAY, PERSON_EXISTS, SYSTEM_EXISTS } from '../analytics/queries/analytics.queries';
import { GraphService } from '../graph/graph.service';
import type { GraphPath } from '../graph/result-mapper';
import { LlmService } from '../llm/llm.service';
import { Semaphore } from '../whatif/semaphore';
import { WhatIfService } from '../whatif/whatif.service';
import {
  ACTIONS_SETTINGS,
  type ActionKind,
  type ActionStatus,
  type ActionsSettings,
  CREATED_BY,
  HANDOVER_SUMMARY_PROMPT,
  HANDOVER_SUMMARY_TASK,
  MAX_LISTED_ACTIONS,
  MAX_WATCHER_PROPOSALS,
  WATCHER,
} from './actions.constants';
import * as Q from './queries/actions.queries';

/** The shapes the web app parses: Zod schemas in @keystone/shared. */
export type { ActionRow, HandoverPlan };

/** A create call's answer: the action, and whether it is new or an open proposal that already existed. */
export interface Proposal {
  action: ActionRow;
  created: boolean;
}

const SummarySchema = z.object({ summary: z.string().trim().min(1).max(800) });

/**
 * Proposed actions: reassignments, runbook tasks, document reviews and handover
 * plans. Everything here only PROPOSES; approve and reject are separate methods
 * that only the HTTP endpoints (a person) call. The structure of every proposal
 * comes from the graph; the LLM only words the handover summary.
 */
@Injectable()
export class ActionsService {
  private readonly logger = new Logger(ActionsService.name);
  /** Creates run one at a time, so the duplicate check and the create cannot race. */
  private readonly writes = new Semaphore(1);

  constructor(
    private readonly graph: GraphService,
    private readonly whatIf: WhatIfService,
    private readonly analytics: AnalyticsService,
    private readonly llm: LlmService,
    @Inject(ACTIONS_SETTINGS) private readonly settings: ActionsSettings,
  ) {}

  // ------------------------------------------------------------------ proposals (agent tools and HTTP)

  /** Proposes moving a ticket to a person; returns the open proposal instead if one already targets the ticket. */
  proposeReassignment(ticketId: string, person: string, reason: string): Promise<Proposal> {
    return this.writes.run(() => this.reassign({ ticketId, person, reason, fromPerson: null, planId: null }));
  }

  /** Proposes a runbook task for a system, for its sole expert (or top expert); one open task per system. */
  createRunbookTask(system: string): Promise<Proposal> {
    return this.writes.run(() => this.runbook({ system, planId: null }));
  }

  /**
   * Drafts a handover plan for someone leaving, from the what-if simulation: one
   * reassignment per open ticket (to the best suggested owner), one review per page
   * only they wrote (to the strongest other expert on the page's main system), and
   * one runbook task per system only they know (for them, before they go).
   */
  draftHandover(person: string): Promise<HandoverPlan> {
    return this.writes.run(() => this.handover(person));
  }

  /**
   * The risk watcher: after a change to the graph (a live document), proposes the
   * follow-up work by itself, from what the graph says changed. A person who just
   * left gets new owners for their open tickets (K6), a system that just lost its
   * backups gets a runbook task for whoever still knows it, and a page that just went
   * stale gets a review by the author of the change. Each proposal is BASED_ON its
   * evidence (including the document that caused it) and marked createdBy 'watcher';
   * nothing is approved here. One failed proposal never stops the others.
   */
  reactToChange(change: WatchedChange): Promise<WatcherProposal[]> {
    return this.writes.run(() => this.watch(change));
  }

  // ------------------------------------------------------------------ decisions (people only, never a tool)

  /** Approves a proposed action; an approved reassignment moves the ticket's ASSIGNED edge. */
  async approve(id: string): Promise<ActionRow & { moved: number }> {
    await this.requireProposed(id);
    const [row] = await this.graph.query<{ moved: number }>(this.settings.graph, Q.APPROVE_ACTION, {
      id,
      now: Date.now(),
      today: await this.today(),
    });
    if (!row) throw new ConflictException(`Action ${id} is no longer proposed`);
    return { ...(await this.get(id)), moved: row.moved };
  }

  /** Rejects a proposed action, with the reviewer's reason. */
  async reject(id: string, reason: string): Promise<ActionRow> {
    await this.requireProposed(id);
    const [row] = await this.graph.query(this.settings.graph, Q.REJECT_ACTION, { id, now: Date.now(), reason });
    if (!row) throw new ConflictException(`Action ${id} is no longer proposed`);
    return this.get(id);
  }

  // ------------------------------------------------------------------ reading

  list(status: ActionStatus | null = null, limit = MAX_LISTED_ACTIONS): Promise<ActionRow[]> {
    return this.graph.roQuery<ActionRow>(this.settings.graph, Q.LIST_ACTIONS, { status, id: null, planId: null, limit });
  }

  /** The audit trail of one action as a graph to draw: its target, assignee, evidence and the assignee's KNOWS. */
  async graphOf(id: string): Promise<GraphView> {
    await this.requireAction(id);
    const rows = await this.graph.roQuery<{ path: GraphPath }>(this.settings.graph, Q.ACTION_EVIDENCE_GRAPH, { id });
    return pathsToGraphView(rows.map((row) => row.path));
  }

  /** The audit trail of one action: why Keystone suggested it (WHY_SUGGESTED). */
  async why(id: string): Promise<Record<string, unknown>> {
    const [row] = await this.graph.roQuery<Record<string, unknown>>(this.settings.graph, Q.WHY_SUGGESTED, { id });
    if (!row) throw new NotFoundException(`No action ${id}`);
    return row;
  }

  // ------------------------------------------------------------------ the risk watcher (callers hold `writes`)

  private async watch(change: WatchedChange): Promise<WatcherProposal[]> {
    const proposals: WatcherProposal[] = [];
    const attempt = async (kind: WatcherProposal['kind'], target: string, work: () => Promise<Proposal>) => {
      try {
        const { action, created } = await work();
        proposals.push({ id: action.id, kind, target, assignee: action.assignee ?? null, reason: action.reason, created });
      } catch (error) {
        this.logger.warn(`Watcher: no ${kind} proposal for ${target}: ${String(error)}`);
      }
    };

    // Someone left: their open tickets need a new owner.
    for (const person of change.newlyInactive) {
      const impact = await this.analytics.departureImpact(person, undefined, this.settings.graph);
      for (const ticket of impact.openTickets.slice(0, MAX_WATCHER_PROPOSALS)) {
        const owner = ticket.suggestedOwners[0];
        if (!owner) continue;
        await attempt('reassign', ticket.ticket, () =>
          this.reassign({
            ticketId: ticket.ticket,
            person: owner,
            reason: `${person} has left the company (${change.sourceId}); ${owner} knows the systems this ticket names best.`,
            fromPerson: person,
            planId: null,
            evidenceIds: [change.sourceId, ...(ticket.ownerEvidence?.[0] ?? [])],
            createdBy: WATCHER,
          }),
        );
      }
    }

    // A system lost its backups: get the knowledge written down while someone still has it.
    for (const risk of watchedRiskChanges(change.riskChanges).slice(0, MAX_WATCHER_PROPOSALS)) {
      const reason =
        risk.after === 'critical'
          ? `${risk.system} went from ${risk.before ?? 'not core'} to critical after ${change.sourceId}: only ${risk.expertsAfter[0] ?? 'one person'} knows it now; a runbook spreads that knowledge.`
          : `${risk.system} went from ${risk.before ?? 'not core'} to orphaned after ${change.sourceId}: nobody left meets the expert bar, so whoever knows it best of those still here writes the runbook.`;
      await attempt('runbook', risk.system, () => this.runbook({ system: risk.system, planId: null, reason, createdBy: WATCHER }));
    }

    // A page now states a replaced decision: whoever made the change reviews it.
    for (const doc of change.newlyStale.slice(0, MAX_WATCHER_PROPOSALS)) {
      await attempt('review_doc', doc.stalePage, () =>
        this.reviewDoc({
          pageId: doc.stalePage,
          assignee: change.author,
          reason: `"${doc.pageTitle}" still states "${doc.outdatedClaim}", which a newer decision replaced: "${doc.currentDecision}". Update the page.`,
          evidenceIds: unique([doc.stalePage, change.sourceId, doc.decidedIn ?? '']),
          planId: null,
          createdBy: WATCHER,
        }),
      );
    }

    this.logger.log(`Watcher after ${change.sourceId}: ${proposals.filter((p) => p.created).length} new proposals, ${proposals.length} in all`);
    return proposals;
  }

  // ------------------------------------------------------------------ creating (callers hold `writes`)

  private async reassign(input: { ticketId: string; person: string; reason: string; fromPerson: string | null; planId: string | null; evidenceIds?: string[]; createdBy?: string }): Promise<Proposal> {
    const existing = await this.openAction('reassign', input.ticketId);
    if (existing) return { action: existing, created: false };
    const [ticket] = await this.graph.roQuery(this.settings.graph, Q.TICKET_EXISTS, { ticketId: input.ticketId });
    if (!ticket) throw new NotFoundException(`No ticket ${input.ticketId}`);
    await this.requireActivePerson(input.person);
    const evidenceIds = input.evidenceIds ?? (await this.reassignEvidence(input.ticketId, input.person));
    return this.create(
      Q.CREATE_REASSIGN_PROPOSAL,
      { ticketId: input.ticketId, person: input.person, reason: input.reason, fromPerson: input.fromPerson, planId: input.planId, evidenceIds },
      input.createdBy,
    );
  }

  private async runbook(input: { system: string; planId: string | null; assignee?: string | null; evidenceIds?: string[]; reason?: string; createdBy?: string }): Promise<Proposal> {
    const existing = await this.openAction('runbook', input.system);
    if (existing) return { action: existing, created: false };
    const [system] = await this.graph.roQuery(this.settings.graph, SYSTEM_EXISTS, { system: input.system });
    if (!system) throw new NotFoundException(`No system named "${input.system}"`);

    let { assignee, evidenceIds, reason } = input;
    if (assignee === undefined || evidenceIds === undefined || reason === undefined) {
      // From bus factor: the sole expert if there is exactly one, else the strongest expert.
      const row = (await this.analytics.busFactor(undefined, this.settings.projectionGraph)).find((r) => r.system === input.system);
      const top = (await this.analytics.experts(input.system, this.settings.graph)).experts[0];
      const sole = row?.experts === 1 ? row.names[0] : null;
      assignee ??= sole ?? top?.person ?? null;
      evidenceIds ??= unique([...(row?.evidence.flat() ?? []), ...(top?.evidence ?? [])]).slice(0, 10);
      reason ??=
        row?.experts === 1
          ? `${input.system} has a single expert (${sole}); a runbook makes their knowledge available to others.`
          : `${input.system} has ${row?.experts ?? 'no counted'} experts (${row?.riskLevel ?? 'not a core system'}); a runbook spreads the knowledge.`;
    }
    return this.create(Q.CREATE_RUNBOOK_TASK, { system: input.system, assignee: assignee ?? null, reason, planId: input.planId, evidenceIds }, input.createdBy);
  }

  private async reviewDoc(input: { pageId: string; assignee: string | null; reason: string; evidenceIds: string[]; planId: string | null; createdBy?: string }): Promise<Proposal> {
    const existing = await this.openAction('review_doc', input.pageId);
    if (existing) return { action: existing, created: false };
    const { createdBy, ...params } = input;
    return this.create(Q.CREATE_REVIEW_DOC_TASK, params, createdBy);
  }

  private async handover(person: string): Promise<HandoverPlan> {
    const existing = await this.openAction('handover', person);
    if (existing) {
      const children = await this.graph.roQuery<ActionRow>(this.settings.graph, Q.LIST_ACTIONS, { status: null, id: null, planId: existing.id, limit: MAX_LISTED_ACTIONS });
      return { plan: existing, created: false, children, skipped: [] };
    }

    // The structure comes from the graph: the departure simulation (WhatIfService throws for unknown or departed people).
    const sim = await this.whatIf.simulateDeparture(person);
    const reviewers = await this.graph.roQuery<{ page: string; system: string | null; reviewer: string | null; evidence: string[] }>(
      this.settings.graph,
      Q.PAGE_REVIEWERS,
      { pages: sim.soleAuthoredPages.map((p) => p.page), leaver: person },
    );
    const summary = await this.summarize(person, sim, reviewers);
    const planEvidence = unique([
      ...sim.systemsNewlyOrphaned.flatMap((c) => c.evidence),
      ...sim.orphanedTickets.map((t) => t.ticket),
      ...sim.soleAuthoredPages.map((p) => p.page),
    ]).slice(0, 20);
    const { action: plan } = await this.create(Q.CREATE_HANDOVER_PLAN, {
      person,
      reason: `${person} is leaving: hand over open tickets, pages only they wrote and systems only they know.`,
      summary,
      evidenceIds: planEvidence,
    });

    const skipped: HandoverPlan['skipped'] = [];
    const keep = (kind: ActionKind, target: string, result: Proposal) => {
      if (!result.created) skipped.push({ kind, target, reason: 'an open proposal already exists', existing: result.action.id });
    };
    for (const ticket of sim.orphanedTickets) {
      const owner = ticket.suggestedOwners[0];
      if (!owner) {
        skipped.push({ kind: 'reassign', target: ticket.ticket, reason: 'nobody else knows the systems this ticket names' });
        continue;
      }
      const result = await this.reassign({
        ticketId: ticket.ticket,
        person: owner,
        reason: `${person} is leaving; ${owner} fits best: the strongest expertise on the systems this ticket names, weighted by workload.`,
        fromPerson: person,
        planId: plan.id,
        evidenceIds: ticket.ownerEvidence[0] ?? [],
      });
      keep('reassign', ticket.ticket, result);
    }
    for (const page of reviewers) {
      const reason = page.reviewer
        ? `Only ${person} wrote or reviewed this page; ${page.reviewer} knows its main system (${page.system}) best.`
        : `Only ${person} wrote or reviewed this page and nobody else knows its main system${page.system ? ` (${page.system})` : ''}: assign a reviewer.`;
      keep('review_doc', page.page, await this.reviewDoc({ pageId: page.page, assignee: page.reviewer, reason, evidenceIds: [page.page, ...page.evidence], planId: plan.id }));
    }
    for (const change of sim.systemsNewlyOrphaned) {
      const result = await this.runbook({
        system: change.system,
        planId: plan.id,
        assignee: person,
        evidenceIds: change.evidence,
        reason: `${person} is the only expert on ${change.system}; write the runbook before leaving.`,
      });
      keep('runbook', change.system, result);
    }

    const children = await this.graph.roQuery<ActionRow>(this.settings.graph, Q.LIST_ACTIONS, { status: null, id: null, planId: plan.id, limit: MAX_LISTED_ACTIONS });
    this.logger.log(`Handover plan ${plan.id} for ${person}: ${children.length} actions, ${skipped.length} skipped`);
    return { plan: await this.get(plan.id), created: true, children, skipped };
  }

  /** Runs one CREATE query with the shared fields, then reads the action back. */
  private async create(cypher: string, params: Record<string, unknown>, createdBy: string = CREATED_BY): Promise<Proposal> {
    const id = `act-${randomBytes(6).toString('hex')}`;
    const [row] = await this.graph.query<{ id: string }>(this.settings.graph, cypher, {
      ...params,
      id,
      today: await this.today(),
      createdBy,
      createdAt: Date.now(),
    } as never);
    if (!row) throw new NotFoundException('The target of this action was not found');
    return { action: await this.get(id), created: true };
  }

  /**
   * A two- or three-sentence summary in words. The model gets the counts already
   * computed (it miscounted lists), and a summary with any number that is not in
   * the facts is replaced by a fixed template, so the summary never invents numbers.
   */
  private async summarize(person: string, sim: Awaited<ReturnType<WhatIfService['simulateDeparture']>>, reviewers: { reviewer: string | null }[]): Promise<string> {
    const ticketsByNewOwner: Record<string, number> = {};
    for (const t of sim.orphanedTickets) {
      const owner = t.suggestedOwners[0] ?? 'nobody found';
      ticketsByNewOwner[owner] = (ticketsByNewOwner[owner] ?? 0) + 1;
    }
    // Keys in plain words: the model tended to quote camelCase keys ("per ticketsByNewOwner").
    const facts = {
      'person leaving': person,
      department: sim.dept,
      'open tickets to reassign': sim.orphanedTickets.length,
      'tickets each new owner takes': ticketsByNewOwner,
      'pages only they wrote, for someone else to review': reviewers.length,
      'of those pages, how many have no reviewer yet': reviewers.filter((r) => !r.reviewer).length,
      'systems only they know, each needing a runbook they must write before leaving': sim.systemsNewlyOrphaned.map((c) => c.system),
      'systems left with a single expert (who)': sim.systemsNewlyCritical.map((c) => `${c.system} (${c.expertsAfter[0]})`),
    };
    const template =
      `${person} is leaving: ${sim.orphanedTickets.length} open tickets to reassign, ${reviewers.length} pages to review ` +
      `and ${sim.systemsNewlyOrphaned.length} systems only they know.`;
    try {
      const { value } = await this.llm.generateObjectWithUsage(SummarySchema, {
        task: HANDOVER_SUMMARY_TASK,
        system: HANDOVER_SUMMARY_PROMPT,
        prompt: JSON.stringify(facts),
      });
      const invented = numbersIn(value.summary).filter((n) => !numbersIn(JSON.stringify(facts)).includes(n));
      if (invented.length > 0) {
        this.logger.warn(`Handover summary used numbers not in the plan (${invented.join(', ')}); using the template`);
        return template;
      }
      return value.summary;
    } catch (error) {
      this.logger.warn(`Handover summary falls back to a template: ${String(error)}`);
      return template;
    }
  }

  private async openAction(kind: ActionKind, target: string): Promise<ActionRow | null> {
    const [row] = await this.graph.roQuery<{ id: string }>(this.settings.graph, Q.OPEN_ACTION_FOR_TARGET, { kind, target });
    return row ? this.get(row.id) : null;
  }

  private async get(id: string): Promise<ActionRow> {
    const [row] = await this.graph.roQuery<ActionRow>(this.settings.graph, Q.LIST_ACTIONS, { status: null, id, planId: null, limit: 1 });
    if (!row) throw new NotFoundException(`No action ${id}`);
    return row;
  }

  private async requireAction(id: string): Promise<void> {
    const [row] = await this.graph.roQuery<{ status: string }>(this.settings.graph, Q.ACTION_STATUS, { id });
    if (!row) throw new NotFoundException(`No action ${id}`);
  }

  private async requireProposed(id: string): Promise<void> {
    const [row] = await this.graph.roQuery<{ status: string }>(this.settings.graph, Q.ACTION_STATUS, { id });
    if (!row) throw new NotFoundException(`No action ${id}`);
    if (row.status !== 'proposed') throw new ConflictException(`Action ${id} is already ${row.status}`);
  }

  private async requireActivePerson(person: string): Promise<void> {
    const [row] = await this.graph.roQuery<{ active: boolean }>(this.settings.graph, PERSON_EXISTS, { person });
    if (!row) throw new NotFoundException(`No person named "${person}"`);
    if (!row.active) throw new ConflictException(`${person} is not active`);
  }

  private async reassignEvidence(ticketId: string, person: string): Promise<string[]> {
    const [row] = await this.graph.roQuery<{ evidence: string[][] }>(this.settings.graph, Q.REASSIGN_EVIDENCE, { ticketId, person });
    return unique(row?.evidence.flat() ?? []).slice(0, 5);
  }

  /** "Today" for actions: the last day the company data covers. */
  private async today(): Promise<number> {
    const [row] = await this.graph.roQuery<{ day: number | null }>(this.settings.graph, LAST_ARTIFACT_DAY);
    return row?.day ?? 0;
  }
}

/** A change the risk watcher reacts to: what a live document did to the graph, and who posted it. */
export interface WatchedChange {
  /** The document that caused the change (cited as evidence on every proposal). */
  sourceId: string;
  /** Its author: they review the pages their change made stale. */
  author: string;
  newlyStale: LiveResult['newlyStale'];
  riskChanges: LiveResult['riskChanges'];
  newlyInactive: string[];
}

/** Risk changes worth a runbook: a system that became critical or orphaned (worse than before). */
export function watchedRiskChanges(changes: LiveResult['riskChanges']): LiveResult['riskChanges'] {
  const rank = { orphaned: 0, critical: 1, watch: 2, ok: 3 } as const;
  return changes.filter(
    (c) => (c.after === 'orphaned' || c.after === 'critical') && (c.before === null || rank[c.after] < rank[c.before]),
  );
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter((v) => typeof v === 'string' && v.length > 0))];
}

/** Every whole number written in a text ("22 open tickets", "Go 1.21" -> 22, 1, 21). */
export function numbersIn(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map(Number);
}
