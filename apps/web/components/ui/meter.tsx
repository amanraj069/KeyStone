import { cn } from "@/lib/utils";

/** A hairline bar for a share of something (scores, betweenness). Ink by default, signal for risk. */
export function Meter({ percent, label, risk = false, className }: { percent: number; label: string; risk?: boolean; className?: string }) {
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-foreground/[0.07]", className)} role="img" aria-label={label}>
      <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out-expo", risk ? "bg-signal" : "bg-foreground/60")} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}
