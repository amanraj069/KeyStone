import type { RiskLevel } from "@keystone/shared";

/** Risk levels, most urgent first, with the words the UI uses for each. */
export const RISK_ORDER: readonly RiskLevel[] = ["orphaned", "critical", "watch", "ok"];

export const RISK_COPY: Record<RiskLevel, { tab: string; title: string; blurb: string }> = {
  orphaned: { tab: "No expert", title: "No expert left", blurb: "Nobody active knows these well enough." },
  critical: { tab: "One expert", title: "One expert", blurb: "A single person holds this knowledge." },
  watch: { tab: "Two experts", title: "Two experts", blurb: "Thin, but there is a backup." },
  ok: { tab: "Covered", title: "Covered", blurb: "Three or more people know these." },
};

/** The bar segment colour of each level: the signal for real risk, ink tints otherwise. */
export const RISK_BAR: Record<RiskLevel, string> = {
  orphaned: "bg-signal",
  critical: "bg-signal/55",
  watch: "bg-foreground/35",
  ok: "bg-foreground/12",
};
