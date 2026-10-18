import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A card on the page: the white surface everything sits on (Intake's Card, in Keystone's colours). */
export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-xl border bg-card shadow-card", className)} {...props} />;
}

interface PanelHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/** A panel's own title row: title, one muted line, an action on the right (on phones, under the title). */
export function PanelHeading({ title, description, action, className }: PanelHeadingProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground sm:text-sm">{description}</p>}
      </div>
      {action && <div className="max-w-full min-w-0 sm:shrink-0">{action}</div>}
    </div>
  );
}
