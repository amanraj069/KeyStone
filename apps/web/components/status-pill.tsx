import { Badge } from "@/components/ui/badge";

export type PillState = "up" | "down" | "checking";

const STYLES: Record<PillState, string> = {
  up: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  down: "bg-red-500/15 text-red-700 dark:text-red-400",
  checking: "bg-muted text-muted-foreground",
};

/** A rounded label like "FalkorDB · up", coloured by state. */
export function StatusPill({ label, state }: { label: string; state: PillState }) {
  return (
    <Badge className={`h-7 gap-2 px-3 text-sm ${STYLES[state]}`}>
      <span aria-hidden className="size-2 rounded-full bg-current" />
      {label} · {state}
    </Badge>
  );
}
