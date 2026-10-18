import { Zap } from "lucide-react";
import { TIMING_LABELS } from "@/lib/whatif";

/** "Simulated in 245 ms on a scratch copy": how fast FalkorDB did it; hover for each step. */
export function Timings({ timings, memoryMb }: { timings: Record<string, number>; memoryMb?: number | null }) {
  const parts = TIMING_LABELS.filter(([key]) => timings[key] !== undefined).map(([key, label]) => `${label} ${timings[key]} ms`);
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums" title={parts.join(" · ")}>
      <Zap className="size-3.5 shrink-0" />
      {timings.total !== undefined && <span className="font-semibold text-foreground">Simulated in {timings.total} ms</span>}
      <span>
        on a scratch copy{memoryMb != null && ` (${memoryMb} MB)`}; nothing real changed.
      </span>
    </p>
  );
}
