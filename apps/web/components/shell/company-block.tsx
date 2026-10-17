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

  const badge = (
    <span className="relative flex size-9 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.06] text-xs font-bold">
      AA
      {live && <span className="live-dot absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-foreground" />}
    </span>
  );

  return (
    <div className="shrink-0 border-t px-3 pt-3 pb-4">
      {expanded ? (
        <Link href="/" onClick={onNavigate} className="flex items-center gap-3 rounded-xl p-1.5 transition-colors hover:bg-foreground/5">
          {badge}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold">Apex Athletics</span>
            <span className={cn("block truncate text-[11px] font-light text-muted-foreground", live && "text-foreground")}>
              {live ? `Replaying · day ${replayDay ?? "…"}` : `Day ${day ?? "–"} · ${graph === "apex" ? "full company" : "replay"}`}
            </span>
          </span>
        </Link>
      ) : (
        <div className="group/item relative flex justify-center">
          {badge}
          <SidebarTooltip>{`Apex Athletics · day ${day ?? "–"}${live ? " · replaying" : ""}`}</SidebarTooltip>
        </div>
      )}
    </div>
  );
}
