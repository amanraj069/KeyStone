"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import ThemeToggle from "@/components/theme-toggle";
import { useLiveGraph } from "@/contexts/live-graph";
import { cn } from "@/lib/utils";
import { pageName } from "./nav-items";

/**
 * The desktop bar above every page: where you are on the left; on the right, whether
 * the graph is reachable and which day it shows, and the theme.
 */
export function TopBar() {
  const pathname = usePathname();
  const { graph, summary, summaryError, replay } = useLiveGraph();
  const live = replay?.running ?? false;
  const replayDay = live && replay?.progress?.graph === graph ? replay.progress.day : null;
  const day = replayDay ?? summary?.day ?? null;
  const state = summaryError && !summary ? "down" : summary ? "up" : "checking";

  return (
    <header className="sticky top-0 z-30 hidden h-14 shrink-0 items-center justify-between gap-6 border-b bg-background/75 px-8 backdrop-blur-xl backdrop-saturate-150 lg:flex">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        <Link href="/" className="shrink-0 text-muted-foreground transition-colors hover:text-foreground">
          Apex Athletics
        </Link>
        <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden />
        {/* Keyed by page, so the name slides in when you move. */}
        <span key={pathname} className="animate-page-in truncate font-medium" aria-current="page">
          {pageName(pathname)}
        </span>
      </nav>

      <div className="flex shrink-0 items-center gap-3">
        <span
          className={cn("flex h-7 items-center rounded-full border bg-card px-3 text-xs text-muted-foreground shadow-card", state === "down" && "text-signal")}
          title={state === "down" ? (summaryError ?? "The graph is unreachable") : "The company graph Keystone reasons over"}
        >
          {state === "down" ? (
            "Graph offline"
          ) : (
            <span className="tabular-nums">
              {live ? `Replaying · day ${replayDay ?? "…"}` : `Day ${day ?? "–"} · ${graph === "apex" ? "Full company" : "Replay"}`}
            </span>
          )}
        </span>
        <span className="h-4 w-px bg-border" aria-hidden />
        <div className="flex size-8 items-center justify-center">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
