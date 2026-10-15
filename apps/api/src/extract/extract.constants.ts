/** Injection tokens for the extraction module. */
export const EXTRACT_SETTINGS = Symbol('EXTRACT_SETTINGS');
export const EXTRACT_CACHE = Symbol('EXTRACT_CACHE');

export interface ExtractSettings {
  dataDir: string;
  /** Only artifacts whose body is longer than this are extracted. */
  minBodyChars: number;
  /** Refuse to start if more LLM calls than this are planned (unless force). */
  maxCalls: number;
  /** Only artifacts authored by people in these departments; empty = all. */
  depts: string[];
}

/** Artifact types sent to the LLM (Meeting included: meetings are where decisions are made). */
export const EXTRACT_LABELS = ['Page', 'Thread', 'PR', 'Email', 'Ticket', 'Meeting'] as const;

/** Second pass: per system, at most this many (most recent) decisions and claims go in one prompt. */
export const MAX_LINK_DECISIONS = 250;
export const MAX_LINK_CLAIMS = 150;

/** Rough per-call output size for the dry-run cost estimate (measured on the 200-artifact sample). */
export const ESTIMATED_OUTPUT_TOKENS_PER_CALL = 320;
