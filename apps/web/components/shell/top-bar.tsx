"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, SquareTerminal } from "lucide-react";
import ThemeToggle from "@/components/theme-toggle";
import { useLiveGraph } from "@/contexts/live-graph";
import { cn } from "@/lib/utils";
import { pageName } from "./nav-items";

/**
 * The desktop bar above every page: where you are on the left; on the right, whether
 * the graph is reachable and which day it shows, the developer console and the theme.
 */
export function TopBar() {
  const pathname = usePathname();
  const { graph, summary, summaryError, replay } = useLiveGraph();
  const live = replay?.running ?? false;
  const replayDay = live && replay?.progress?.graph === graph ? replay.progress.day : null;
  const day = replayDay ?? summary?.day ?? null;
  const state = summaryError && !summary ? "down" : summary ? "up" : "checking";

  return (
    <header className="sticky top-0 z-30 hidden h-14 shrink-0 items-center justify-between gap-6 border-b bg-background/85 px-8 backdrop-blur-md lg:flex">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        <Link href="/" className="shrink-0 font-medium text-muted-foreground transition-colors hover:text-foreground">
          Apex Athletics
        </Link>
        <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden />
        <span className="truncate font-semibold" aria-current="page">
          {pageName(pathname)}
        </span>
      </nav>

      <div className="flex shrink-0 items-center gap-2">
        <span
          className="flex h-8 items-center gap-2 rounded-md border bg-card px-2.5 text-xs font-medium text-muted-foreground"
          title={state === "down" ? (summaryError ?? "The graph is unreachable") : "The company graph Keystone reasons over"}
        >
          <span
            className={cn(
              "size-2 rounded-full",
              state === "up" ? "bg-[var(--node-system)]" : state === "down" ? "bg-signal" : "bg-faint",
              live && "live-dot",
            )}
            aria-hidden
          />
          {state === "down" ? (
            "Graph offline"
          ) : (
            <span className="tabular-nums">
              {live ? `Replaying · day ${replayDay ?? "…"}` : `Day ${day ?? "–"} · ${graph === "apex" ? "Full company" : "Replay"}`}
            </span>
          )}
        </span>
        <Link
          href="/ingest"
          title="Developer console"
          aria-label="Developer console"
          className={cn(
            "flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
            pathname === "/ingest" && "bg-foreground/[0.07] text-foreground",
          )}
        >
          <SquareTerminal className="size-4" />
        </Link>
        <div className="flex size-8 items-center justify-center">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
