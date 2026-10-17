"use client";

import { useEffect, useState } from "react";
import type { BusFactorRow, RiskLevel } from "@keystone/shared";
import { ArrowRight } from "lucide-react";
import { OptionPills } from "@/components/ui/option-pills";
import { Panel, PanelHeading } from "@/components/ui/panel";
import { EmptyState, SkeletonRows } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { RISK_COPY, RISK_ORDER } from "./risk";

interface SystemsPanelProps {
  rows: BusFactorRow[] | null;
  onOpen: (row: BusFactorRow) => void;
}

/** Core systems, one risk level at a time (most urgent first); a row opens who knows it. */
export function SystemsPanel({ rows, onOpen }: SystemsPanelProps) {
  const [level, setLevel] = useState<RiskLevel>("orphaned");
  // Start on the most urgent level that has any systems.
  useEffect(() => {
    if (!rows) return;
    const first = RISK_ORDER.find((l) => rows.some((r) => r.riskLevel === l));
    if (first && !rows.some((r) => r.riskLevel === level)) setLevel(first);
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = rows?.filter((r) => r.riskLevel === level) ?? [];
  const options = RISK_ORDER.map((l) => ({ value: l, label: `${RISK_COPY[l].tab}${rows ? ` ${rows.filter((r) => r.riskLevel === l).length}` : ""}` }));

  return (
    <Panel className="p-5 sm:p-8">
      <PanelHeading
        title="Core systems"
        description={RISK_COPY[level].blurb}
        action={<OptionPills label="Risk level" options={options} value={level} onChange={setLevel} className="hidden md:inline-flex" />}
      />
      <OptionPills label="Risk level" options={options} value={level} onChange={setLevel} className="mt-4 max-w-full overflow-x-auto md:hidden" />
      <div className="mt-6">
        {!rows ? (
          <SkeletonRows count={6} rowClassName="h-[3.75rem]" className="grid gap-2.5 space-y-0 sm:grid-cols-2 lg:grid-cols-3" />
        ) : rows.length === 0 ? (
          <EmptyState description="No core systems yet. They appear once enough artifacts mention them." />
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-sm font-light text-muted-foreground">No systems at this level.</p>
        ) : (
          <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((row) => (
              <li key={row.system}>
                <SystemRow row={row} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function SystemRow({ row, onOpen }: { row: BusFactorRow; onOpen: (row: BusFactorRow) => void }) {
  const atRisk = row.riskLevel === "orphaned" || row.riskLevel === "critical";
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className="group flex w-full items-center gap-3 rounded-xl bg-surface px-4 py-3 text-left transition-colors hover:bg-accent"
    >
      <span className={cn("size-2 shrink-0 rounded-full", atRisk ? "bg-signal" : "bg-foreground/25")} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{row.system}</span>
        <span className={cn("block truncate text-xs", row.names.length === 0 ? "text-signal" : "font-light text-muted-foreground")}>
          {row.names.length === 0 ? "No active expert" : row.names.join(", ")}
        </span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:translate-x-1" />
    </button>
  );
}
