import type { ReactNode } from "react";

/** The label beside a collapsed sidebar item on hover. Its parent carries `group/item relative`. */
export function SidebarTooltip({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute top-1/2 left-full z-50 ml-2 -translate-y-1/2 rounded-md bg-foreground px-3 py-2 text-[10px] font-bold whitespace-nowrap text-background opacity-0 shadow-md transition-opacity duration-100 group-hover/item:opacity-100"
    >
      {children}
    </span>
  );
}
