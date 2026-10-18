import type { ReactNode } from "react";
import { CircleAlert, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** A request failed: what happened, and a way to try again (Intake's ErrorState). */
export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-6 rounded-xl border bg-card px-5 py-4 shadow-card", className)} role="alert">
      <div className="flex min-w-0 items-start gap-3">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-signal" />
        <div className="min-w-0">
          <p className="text-sm font-medium">Could not load</p>
          <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{message}</p>
        </div>
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
    <div className={cn("flex flex-col items-center justify-center rounded-xl border bg-card px-6 py-14 text-center shadow-card", className)}>
      <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-surface text-muted-foreground ring-1 ring-border ring-inset">
        <Inbox className="size-[18px]" strokeWidth={1.7} />
      </span>
      {title && <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>}
      <p className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-pretty text-muted-foreground">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Rows of placeholder bars while a list loads, sized like the rows that will replace them. */
export function SkeletonRows({ count, className, rowClassName = "h-11" }: { count: number; className?: string; rowClassName?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn("w-full rounded-lg", rowClassName)} style={{ animationDelay: `${i * 90}ms` }} />
      ))}
    </div>
  );
}
