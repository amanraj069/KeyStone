/** Injection tokens. */
export const MEMORY_SETTINGS = Symbol('MEMORY_SETTINGS');
/** The memory the agent uses (MemoryService in the app; absent in the benchmark, so runs stay independent). */
export const AGENT_MEMORY = Symbol('AGENT_MEMORY');

export interface MemorySettings {
  /** The company graph memory lives in (apex): turns and notes link to its artifacts, systems and people. */
  graph: string;
}

/** Earlier turns of the same chat shown to the model before a follow-up. */
export const MAX_PRIOR_TURNS = 4;
/** A turn keeps this much of its answer in the graph (the model sees it in follow-ups). */
export const MAX_SUMMARY_CHARS = 600;
/** Approved notes added to one question. */
export const MAX_NOTES_PER_QUESTION = 5;
/** Past questions returned per subject by a recall. */
export const MAX_RECALLED_QUESTIONS = 5;
/** Longest run of words matched against system and person names ("React admin portal" is three). */
export const MAX_NAME_WORDS = 4;
/** Lists (notes, sessions) return at most this many rows. */
export const MAX_LIST_ROWS = 100;

/** Notes are cited like artifacts, as [NOTE-1a2b3c4d]. */
export const NOTE_ID_PREFIX = 'NOTE-';
/** Who asked, when the browser sent no user id (the CLI, MCP clients). */
export const ANONYMOUS_USER = 'anonymous';
