import type { AgentStep } from "@/hooks/use-ask";

/** The argument worth showing next to a tool's name ("who_knows TitanDB"). */
export function stepSubject(step: AgentStep): string {
  const value = step.args.system ?? step.args.person ?? step.args.query ?? step.args.ticketId ?? Object.values(step.args)[0];
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * The tool result in words: "experts: 4; evidence: 12" becomes "4 experts", and the
 * evidence count is added as sources ("4 experts, 12 sources").
 */
export function stepOutcome(step: AgentStep): string {
  if (!step.result) return "";
  const { summary, evidenceCount } = step.result;
  const parts = summary.split("; ").map((part) => {
    const match = /^([A-Za-z]+): (\d+)$/.exec(part);
    return match ? `${match[2]} ${splitWords(match[1])}` : part;
  });
  const sources = `${evidenceCount} source${evidenceCount === 1 ? "" : "s"}`;
  return [...parts.filter((part) => !/^\d+ evidence( ids)?$/.test(part)), sources].join(", ");
}

/** "orphanedTickets" -> "orphaned tickets". */
const splitWords = (key: string) => key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
