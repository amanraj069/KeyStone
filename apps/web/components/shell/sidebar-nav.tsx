"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive, NAV_GROUPS } from "./nav-items";
import { SidebarTooltip } from "./sidebar-tooltip";

/**
 * The rooms in labelled groups (dividers on the icon rail). The one you are in gets a
 * quiet fill and an accent bar, as in most work tools, rather than a solid pill.
 */
export function SidebarNav({ expanded, onNavigate }: { expanded: boolean; onNavigate: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group, index) => (
        <div key={group.label} className={cn(index > 0 && (expanded ? "mt-5" : "mt-3 border-t pt-3"))}>
          {expanded && <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-faint uppercase">{group.label}</p>}
          <ul className="space-y-0.5">
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = isActive(href, pathname);
              return (
                <li key={href} className="group/item relative">
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    title={expanded ? undefined : label}
                    className={cn(
                      "relative flex h-9 items-center rounded-md text-sm transition-colors duration-150",
                      expanded ? "gap-2.5 px-2.5" : "justify-center",
                      active ? "bg-foreground/[0.07] font-semibold text-foreground" : "font-medium text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                    )}
                  >
                    {active && <span className="absolute top-2 bottom-2 -left-3 w-[3px] rounded-r-full bg-primary dark:bg-ring" aria-hidden />}
                    <Icon className="size-4 shrink-0" strokeWidth={active ? 2.2 : 1.9} />
                    {expanded && <span className="truncate">{label}</span>}
                  </Link>
                  {!expanded && <SidebarTooltip>{label}</SidebarTooltip>}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
