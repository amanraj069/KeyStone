"use client";

import Link from "next/link";
import { useLiveGraph } from "@/contexts/live-graph";
import { cn } from "@/lib/utils";
import { SidebarTooltip } from "./sidebar-tooltip";

/**
 * Foot of the sidebar: the company the graph describes, the day it has reached,
 * which graph is shown, and whether a replay is running (where Intake shows the account).
 */
export function CompanyBlock({ expanded, onNavigate }: { expanded: boolean; onNavigate: () => void }) {
  const { graph, summary, replay } = useLiveGraph();
  const live = replay?.running ?? false;
  // While the shown graph is being replayed, the replay's own day is ahead of the (debounced) summary.
  const replayDay = live && replay?.progress?.graph === graph ? replay.progress.day : null;
  const day = replayDay ?? summary?.day ?? null;
  const status = live ? `Replaying · day ${replayDay ?? "…"}` : `Day ${day ?? "–"} · ${graph === "apex" ? "full company" : "replay"}`;

  return (
    <div className="shrink-0 border-t px-3 py-3">
      <SidebarTooltip label={`Apex Athletics · ${status}`} show={!expanded}>
        <Link
          href="/"
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-lg p-1 transition-colors hover:bg-hover"
          aria-label={expanded ? undefined : `Apex Athletics, ${status}`}
        >
          <span className="relative flex size-8 shrink-0 items-center justify-center rounded-lg bg-selected text-[11px] font-semibold tracking-wide ring-1 ring-border ring-inset">
            AA
          </span>
          <span className={cn("min-w-0 flex-1 whitespace-nowrap transition-opacity duration-200", expanded ? "opacity-100 delay-75" : "opacity-0")}>
            <span className="block truncate text-[13px] font-medium">Apex Athletics</span>
            <span className={cn("block truncate text-xs text-muted-foreground tabular-nums", live && "text-foreground")}>{status}</span>
          </span>
        </Link>
      </SidebarTooltip>
    </div>
  );
}
