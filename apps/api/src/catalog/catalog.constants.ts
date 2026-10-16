/** Injection token for catalog settings. */
export const CATALOG_SETTINGS = Symbol('CATALOG_SETTINGS');

export interface CatalogSettings {
  /** A core system is mentioned by at least this many artifacts (env CORE_MIN_MENTIONS)... */
  coreMinMentions: number;
  /** ...written by at least this many different people. */
  coreMinAuthors: number;
}

/** Default core rule. CORE_MIN_MENTIONS can override the mention count; see catalog.service.ts. */
export const DEFAULT_CORE_MIN_MENTIONS = 5;
export const CORE_MIN_AUTHORS = 2;

/** The LLM merge pass only looks at this many systems, the most mentioned first. */
export const PROPOSAL_TOP_SYSTEMS = 300;
