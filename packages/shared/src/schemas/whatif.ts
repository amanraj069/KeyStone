import { z } from 'zod';

/** A system whose expert count drops: newly orphaned (none left) or newly critical (one left). */
export const SystemChangeSchema = z.object({
  system: z.string(),
  /** Experts before the departure (the leaver included). */
  expertsBefore: z.array(z.string()),
  /** Experts left afterwards (empty for a newly orphaned system). */
  expertsAfter: z.array(z.string()),
  /** Artifact ids: the leaver's evidence, then the remaining expert's. */
  evidence: z.array(z.string()),
});
export type SystemChange = z.infer<typeof SystemChangeSchema>;

/** A system nobody would know at all any more (K9). */
export const IslandSchema = z.object({
  system: z.string(),
  /** The leaver's KNOWS evidence on it: the only knowledge there was. */
  evidence: z.array(z.string()),
});
export type Island = z.infer<typeof IslandSchema>;

/** A bridge person's betweenness before and after; null = not in the top 10 (or gone). */
export const BridgeShiftSchema = z.object({
  person: z.string(),
  before: z.number().nullable(),
  after: z.number().nullable(),
  evidence: z.array(z.string()),
});
export type BridgeShift = z.infer<typeof BridgeShiftSchema>;

/** A node of the departure graph, with what the departure does to it. */
export const SimulationNodeSchema = z.object({
  id: z.string(),
  kind: z.enum(['person', 'system', 'ticket']),
  name: z.string(),
  /** Ticket id, so the UI can cite it. */
  artifactId: z.string().nullable(),
  /** The person leaving: the UI fades this node. */
  leaving: z.boolean(),
  /** Turns red: a system with no expert left, or a ticket whose owner leaves. */
  orphaned: z.boolean(),
  /** A system left with exactly one expert. */
  critical: z.boolean(),
  /** A system nobody knows at all any more (K9). */
  island: z.boolean(),
});
export type SimulationNode = z.infer<typeof SimulationNodeSchema>;

export const SimulationEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  type: z.enum(['KNOWS', 'ASSIGNED']),
  /** KNOWS score, when known. */
  score: z.number().nullable(),
});
export type SimulationEdge = z.infer<typeof SimulationEdgeSchema>;

export const SimulationGraphSchema = z.object({
  nodes: z.array(SimulationNodeSchema),
  edges: z.array(SimulationEdgeSchema),
  /** True when the person knows more systems than the graph shows (fewest backups shown first). */
  truncated: z.boolean(),
});
export type SimulationGraph = z.infer<typeof SimulationGraphSchema>;

/** POST /whatif/departure: what breaks if this person leaves, each item with its evidence. */
export const DepartureSimulationSchema = z.object({
  person: z.string(),
  dept: z.string().nullable(),
  systemsNewlyOrphaned: z.array(SystemChangeSchema),
  systemsNewlyCritical: z.array(SystemChangeSchema),
  islandsCreated: z.array(IslandSchema),
  bridgeShift: z.array(BridgeShiftSchema),
  /** Open tickets the leaver owns; ownerEvidence[i] backs suggestedOwners[i]; `evidence` is the ticket id. */
  orphanedTickets: z.array(
    z.object({
      ticket: z.string(),
      title: z.string(),
      suggestedOwners: z.array(z.string()),
      ownerEvidence: z.array(z.array(z.string())),
      evidence: z.array(z.string()),
    }),
  ),
  /** Pages only the leaver has written or reviewed; `evidence` is the page id. */
  soleAuthoredPages: z.array(z.object({ page: z.string(), title: z.string(), evidence: z.array(z.string()) })),
  /** Milliseconds per step: validate, ensureProjection, copy, before, removePerson, after, departureImpact, cleanup, total. */
  timingsMs: z.record(z.string(), z.number()),
  scratchGraph: z.string(),
  scratchGraphMemoryMb: z.number().nullable(),
  graph: SimulationGraphSchema,
});
export type DepartureSimulation = z.infer<typeof DepartureSimulationSchema>;

/** GET /whatif/candidates: people whose departure would orphan the most core systems. */
export const DepartureCandidateSchema = z.object({
  person: z.string(),
  dept: z.string().nullable(),
  /** Core systems this person is the only expert on. */
  orphaned: z.number().int(),
  systems: z.array(z.string()),
  evidence: z.array(z.string()),
});
export type DepartureCandidate = z.infer<typeof DepartureCandidateSchema>;

/** GET /whatif/subgraph: the graph around a person before simulating (same node ids as the simulation). */
export const BeforeGraphSchema = z.object({
  person: z.string(),
  dept: z.string().nullable(),
  graph: SimulationGraphSchema,
  timingsMs: z.record(z.string(), z.number()),
});
export type BeforeGraph = z.infer<typeof BeforeGraphSchema>;
