import { cn } from "@/lib/utils";

export type PillState = "up" | "down" | "checking";

/** A service and its state, like "FalkorDB up"; a service that is down reads in the signal colour. */
export function StatusPill({ label, state }: { label: string; state: PillState }) {
  return (
    <span className={cn("inline-flex h-8 items-center gap-2 rounded-lg border bg-surface px-3 text-sm", state === "down" && "border-signal/40")}>
      <span className="font-medium">{label}</span>
      <span className={cn("text-muted-foreground", state === "down" && "text-signal", state === "checking" && "animate-pulse")}>{state}</span>
    </span>
  );
}
