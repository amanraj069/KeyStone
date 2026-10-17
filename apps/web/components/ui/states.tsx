import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** A request failed: what happened, and a way to try again (Intake's ErrorState). */
export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-6 rounded-2xl border bg-card px-6 py-5 shadow-sm dark:shadow-none", className)} role="alert">
      <div className="min-w-0">
        <p className="text-xs font-bold text-signal">Could not load</p>
        <p className="mt-1 text-sm leading-relaxed text-foreground/85">{message}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** A request worked but found nothing, which is not an error. */
export function EmptyState({ title, description, action, className }: { title?: string; description: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card px-6 py-12 text-center", className)}>
      {title && <h3 className="text-base font-bold tracking-tight">{title}</h3>}
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed font-light text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Rows of placeholder bars while a list loads, sized like the rows that will replace them. */
export function SkeletonRows({ count, className, rowClassName = "h-11" }: { count: number; className?: string; rowClassName?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn("w-full rounded-xl", rowClassName)} />
      ))}
    </div>
  );
}
