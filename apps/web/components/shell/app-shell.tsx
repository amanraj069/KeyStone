"use client";

import { type ReactNode, useCallback, useState } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import ThemeToggle from "@/components/theme-toggle";
import { useSidebarExpansion } from "@/hooks/use-sidebar-expansion";
import { cn } from "@/lib/utils";
import { BrandMark } from "./brand-mark";
import { CompanyBlock } from "./company-block";
import { SidebarNav } from "./sidebar-nav";
import { TopBar } from "./top-bar";

const ICON_BUTTON = "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground";

/** Every page's content column, Ask and What-if included, so all pages line up. */
const COLUMN = "mx-auto w-full max-w-7xl";
const GUTTER = "px-4 sm:px-6 lg:px-8";

/**
 * Every page's frame: a permanent sidebar from lg up, which retracts to an icon rail,
 * with a top bar (breadcrumb, graph status, theme) over the page; below lg, a
 * slide-in drawer opened from a mobile top bar.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { expanded: storedExpanded, toggle } = useSidebarExpansion();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  // In the drawer the labels are always shown.
  const expanded = storedExpanded || drawerOpen;

  return (
    <div className="min-h-dvh">
      {/* Phones and tablets: a top bar that opens the drawer. */}
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between gap-4 border-b bg-card/95 px-4 backdrop-blur-md lg:hidden">
        <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Open navigation" aria-expanded={drawerOpen} className={ICON_BUTTON}>
          <Menu className="size-5" />
        </button>
        <BrandMark />
        <ThemeToggle />
      </header>

      <button
        type="button"
        aria-label="Close navigation"
        onClick={closeDrawer}
        className={cn(
          "fixed inset-0 z-40 cursor-default bg-black/35 backdrop-blur-[2px] transition-opacity duration-300 lg:hidden",
          drawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col border-r bg-card transition-[width,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] max-lg:w-72 max-lg:shadow-xl lg:translate-x-0",
          storedExpanded ? "lg:w-60" : "lg:w-16",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className={cn("flex h-14 shrink-0 items-center border-b", expanded ? "justify-between px-4" : "justify-center")}>
          <BrandMark showName={expanded} onNavigate={closeDrawer} />
          {expanded && (
            <button type="button" onClick={toggle} aria-label="Collapse sidebar" title="Collapse sidebar" className={cn(ICON_BUTTON, "hidden lg:flex")}>
              <PanelLeftClose className="size-4" />
            </button>
          )}
          <button type="button" onClick={closeDrawer} aria-label="Close navigation" className={cn(ICON_BUTTON, "lg:hidden")}>
            <X className="size-4" />
          </button>
        </div>

        <SidebarNav expanded={expanded} onNavigate={closeDrawer} />
        {!expanded && (
          <div className="hidden justify-center pb-2 lg:flex">
            <button type="button" onClick={toggle} aria-label="Expand sidebar" title="Expand sidebar" className={ICON_BUTTON}>
              <PanelLeftOpen className="size-4" />
            </button>
          </div>
        )}
        <CompanyBlock expanded={expanded} onNavigate={closeDrawer} />
      </aside>

      <main
        className={cn(
          "flex min-h-dvh flex-col pt-14 transition-[margin] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] lg:pt-0",
          storedExpanded ? "lg:ml-60" : "lg:ml-16",
        )}
      >
        <TopBar />
        {children}
      </main>
    </div>
  );
}

/** A normal page: the shared column, scrolling with the window. */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn(GUTTER, "py-6 lg:py-8")}>
      <div className={cn(COLUMN, "space-y-6 pb-16 sm:space-y-8", className)}>{children}</div>
    </div>
  );
}

/**
 * A full-height room (Ask, What-if): the same column as every page, but on large
 * screens exactly the height under the top bar, so its panels scroll inside.
 * lg:flex-none matters: in main's flex column, flex-1 would make the basis 0% and the
 * browser would size the room to its content, ignoring the height.
 */
export function RoomContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn(GUTTER, "flex min-h-0 flex-1 flex-col py-6 lg:h-[calc(100dvh-3.5rem)] lg:flex-none lg:overflow-hidden lg:py-6")}>
      <div className={cn(COLUMN, "flex min-h-0 flex-1 flex-col gap-6", className)}>{children}</div>
    </div>
  );
}
