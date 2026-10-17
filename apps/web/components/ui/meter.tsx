import { cn } from "@/lib/utils";

/** A hairline bar for a share of something (scores, betweenness). Ink by default, signal for risk. */
export function Meter({ percent, label, risk = false, className }: { percent: number; label: string; risk?: boolean; className?: string }) {
  return (
    <div className={cn("h-[3px] w-full bg-foreground/10", className)} role="img" aria-label={label}>
      <div className={cn("h-full transition-[width] duration-300 ease-out", risk ? "bg-signal" : "bg-foreground/70")} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}
