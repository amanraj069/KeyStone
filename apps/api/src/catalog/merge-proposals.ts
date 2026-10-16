import { z } from 'zod';
import type { MergeGroup, SystemRow } from './merge-key';

/** Bump when the prompt changes, so cached answers for the old prompt are not reused. */
export const MERGE_PROMPT_VERSION = 'system-merge-v3';

export const MergeProposalSchema = z.object({
  groups: z.array(
    // Loose on purpose: one bad group must not fail the whole answer; validateProposals
    // drops groups with fewer than two known names.
    z.object({
      canonical: z.string().optional(),
      members: z.array(z.string()),
      reason: z.string().default(''),
    }),
  ),
});
export type MergeProposal = z.infer<typeof MergeProposalSchema>;

export const MERGE_SYSTEM_PROMPT = `You clean up a catalog of software systems extracted from one company's documents by an
automatic tool, which often recorded the same system under several names. Find EVERY group of
names that refer to the same system. Typical cases (Foo/Bar are placeholders):
- vendor or language prefix: "Apache Foo" = "Foo"; "Java Foo" = "Foo"
- shortened or partial product names: "Foo Bar Baz" = "Bar Baz" when Bar Baz is the product
- usage adjectives glued to the name: "Foo-backed", "Foo-based", "Foo-managed" = "Foo"
- the system plus its own repo, infra or config: "foo-infra", "foo config" = "Foo"
- the same service described with or without its implementation language or platform
Do NOT group systems that are merely related: a database and a cache in front of it, a service and
its client library, a cluster and an application running on it, a framework and a different framework,
two different products of the same vendor.
Only use names exactly as given. A name may appear in at most one group.
A list this size from such a tool normally contains many groups; list all you are confident about.`;

/** The prompt: one line per system with its mention count. */
export function mergePrompt(systems: readonly SystemRow[]): string {
  const lines = systems.map((s) => `- ${s.name} (${s.mentionCount} mentions)`).join('\n');
  return `Systems (most mentioned first):\n${lines}\n\nReturn {"groups": [{"canonical", "members", "reason"}]}, members including the canonical name.`;
}

export interface ValidatedProposal extends MergeGroup {
  reason: string;
}

/**
 * Keeps only groups the model could not have invented: every member must be one
 * of the names we sent, no name in two groups, at least two members. The
 * survivor is the most mentioned member (the same rule as the automatic merge),
 * not the model's pick, so names always come from the artifacts.
 */
export function validateProposals(proposal: MergeProposal, systems: readonly SystemRow[]): ValidatedProposal[] {
  const byName = new Map(systems.map((s) => [s.name, s]));
  const used = new Set<string>();
  const groups: ValidatedProposal[] = [];
  for (const group of proposal.groups) {
    const members = [...new Set(group.members)].filter((name) => byName.has(name) && !used.has(name));
    if (members.length < 2) continue;
    members.forEach((name) => used.add(name));
    const [keep, ...merge] = members
      .map((name) => byName.get(name)!)
      .sort((a, b) => b.mentionCount - a.mentionCount || a.name.length - b.name.length || a.name.localeCompare(b.name))
      .map((s) => s.name);
    groups.push({ keep, merge, reason: group.reason });
  }
  return groups;
}
