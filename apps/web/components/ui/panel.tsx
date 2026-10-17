import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A card on the page: the white surface everything sits on (Intake's Card, in Keystone's colours). */
export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-xl border bg-card shadow-xs dark:shadow-none", className)} {...props} />;
}

interface PanelHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** A panel's own title row: bold title, light description, an action on the right. */
export function PanelHeading({ title, description, action, className }: PanelHeadingProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        {description && <p className="mt-1 text-sm leading-relaxed font-light text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
