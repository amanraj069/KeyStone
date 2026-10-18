export { ACTION_KINDS, type ActionKind } from '@keystone/shared';

export { ACTION_STATUSES, type ActionStatus } from '@keystone/shared';

/** Who creates proposals. Only a person approves them (POST /actions/:id/approve), never a tool. */
export const CREATED_BY = 'keystone';

/** Proposals the risk watcher made by itself after a change (nobody asked); a person still approves them. */
export const WATCHER = 'watcher';

/** Per change, the watcher proposes at most this many of each kind, so one big change cannot flood Audit. */
export const MAX_WATCHER_PROPOSALS = 5;

/** Injection token for actions settings. */
export const ACTIONS_SETTINGS = Symbol('ACTIONS_SETTINGS');

export interface ActionsSettings {
  /** The company graph actions live in (apex). */
  graph: string;
  /** The projection bus factor reads (apex_proj). */
  projectionGraph: string;
}

/** GET /actions returns at most this many. */
export const MAX_LISTED_ACTIONS = 500;

/** Bump when the handover summary prompt changes (part of the LLM cache key). */
export const HANDOVER_SUMMARY_TASK = 'handover-summary-v5';

export const HANDOVER_SUMMARY_PROMPT = [
  'You write the summary of a handover plan for a manager, in 2 or 3 plain sentences.',
  'Everything in the plan is work still to do (tickets to move, pages to review, runbooks to write).',
  'Use only the names and numbers given, exactly as given (do not count or add them up yourself);',
  'do not add facts, advice or opinions. Never quote the field names of the input.',
  'Return {"summary": "..."}.',
].join('\n');
