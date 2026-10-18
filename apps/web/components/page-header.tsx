import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  /** Plain text or a line of components; it is wrapped in a div, so it may hold a <p>. */
  description?: ReactNode;
  /** The small line above the title for context the breadcrumb does not give, e.g. a team. */
  eyebrow?: ReactNode;
  /** The page's main controls, on the right (on phones, under the title). */
  action?: ReactNode;
  className?: string;
}

/** The title block every page opens with: the title, one muted line, controls on the right. */
export function PageHeader({ title, description, eyebrow, action, className }: PageHeaderProps) {
  return (
    <header className={cn("flex shrink-0 flex-col justify-between gap-4 sm:flex-row sm:items-end sm:gap-6", className)}>
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="mb-1.5 text-xs font-medium text-muted-foreground capitalize">{eyebrow}</p>}
        <h1 className="truncate text-2xl leading-tight font-semibold tracking-[-0.02em] sm:text-[1.75rem]">{title}</h1>
        {description && <div className="mt-2 max-w-3xl text-sm leading-relaxed text-pretty text-muted-foreground">{description}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
