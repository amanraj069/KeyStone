"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { isActive, NAV_GROUPS } from "./nav-items";
import { SidebarTooltip } from "./sidebar-tooltip";

/**
 * The rooms in labelled groups. A group's label row keeps its height on the rail (it
 * turns into a short rule), so no icon moves when the sidebar collapses. The room you
 * are in sits on a soft fill that glides from item to item as you navigate.
 */
export function SidebarNav({ expanded, onNavigate }: { expanded: boolean; onNavigate: () => void }) {
  const pathname = usePathname();
  const list = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<{
    top: number;
    height: number;
    animate: boolean;
  } | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const active = list.current?.querySelector<HTMLElement>("[aria-current=page]");
      if (!list.current || !active) return setIndicator(null);
      const top = active.getBoundingClientRect().top - list.current.getBoundingClientRect().top;
      // The first placement jumps; later ones glide.
      setIndicator((current) => ({
        top,
        height: active.offsetHeight,
        animate: current !== null,
      }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (list.current) observer.observe(list.current);
    return () => observer.disconnect();
  }, [pathname]);

  return (
    <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 pt-2 pb-4">
      <div ref={list} className="relative">
        {indicator && (
          <span
            aria-hidden
            className={cn("absolute inset-x-0 top-0 rounded-lg bg-selected", indicator.animate && "transition-[transform,height] duration-300 ease-out-expo")}
            style={{
              transform: `translateY(${indicator.top}px)`,
              height: indicator.height,
            }}
          />
        )}
        {NAV_GROUPS.map((group, index) => (
          <div key={group.label} className={cn(index > 0 && "mt-4")}>
            <div className="relative flex h-7 items-center px-3" aria-hidden={!expanded}>
              <p
                className={cn(
                  "text-xs font-medium whitespace-nowrap text-faint transition-opacity duration-200",
                  expanded ? "opacity-100 delay-75" : "opacity-0",
                )}
              >
                {group.label}
              </p>
              <span className={cn("absolute left-3 h-px w-4 bg-border transition-opacity duration-200", expanded ? "opacity-0" : "opacity-100")} />
            </div>
            <ul className="space-y-px">
              {group.items.map(({ href, label, icon: Icon }) => {
                const active = isActive(href, pathname);
                return (
                  <li key={href} className="group/item relative">
                    <SidebarTooltip label={label} show={!expanded}>
                      <Link
                        href={href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        aria-label={expanded ? undefined : label}
                        className={cn(
                          "relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-150",
                          active ? "font-medium text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
                        )}
                      >
                        <Icon
                          className="size-4 shrink-0 transition-transform duration-200 ease-spring group-active/item:scale-90"
                          strokeWidth={active ? 2.1 : 1.8}
                        />
                        <span className={cn("truncate transition-opacity duration-200", expanded ? "opacity-100 delay-75" : "opacity-0")}>{label}</span>
                      </Link>
                    </SidebarTooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
