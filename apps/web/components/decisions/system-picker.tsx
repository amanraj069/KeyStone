"use client";

import { useMemo, useState } from "react";
import type { SystemWithDecisions } from "@keystone/shared";
import { Search } from "lucide-react";
import { SkeletonRows } from "@/components/ui/states";
import { cn } from "@/lib/utils";

interface SystemPickerProps {
  systems: SystemWithDecisions[] | null;
  selected: string | null;
  onSelect: (system: string) => void;
  error: string | null;
}

/** Systems with decisions, in two groups: those where a decision was replaced, then the rest. */
export function SystemPicker({ systems, selected, onSelect, error }: SystemPickerProps) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const shown = useMemo(() => (systems ?? []).filter((s) => !term || s.name.toLowerCase().includes(term)), [systems, term]);
  const changed = shown.filter((s) => s.changes > 0);
  const rest = shown.filter((s) => s.changes === 0);

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <label className="flex h-10 items-center gap-2 rounded-xl border bg-surface px-3 focus-within:border-ring">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search systems"
            aria-label="Search systems"
            className="min-w-0 flex-1 bg-transparent text-sm placeholder:font-light placeholder:text-muted-foreground focus:outline-none focus-visible:outline-none"
          />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {error && <p className="px-2 text-sm text-muted-foreground">{error}</p>}
        {!systems && !error ? (
          <SkeletonRows count={10} rowClassName="h-11" className="px-1" />
        ) : !systems ? null : shown.length === 0 ? (
          <p className="px-3 pt-2 text-xs font-light text-muted-foreground">{search ? "No match." : "No decisions have been extracted yet."}</p>
        ) : (
          <>
            {changed.length > 0 && (
              <>
                <p className="section-label px-3 pt-2 pb-2">Changed</p>
                <ul className="mb-3 space-y-0.5">
                  {changed.map((s) => (
                    <SystemRow key={s.name} system={s} selected={selected === s.name} onSelect={onSelect} />
                  ))}
                </ul>
              </>
            )}
            {rest.length > 0 && (
              <>
                <p className="section-label px-3 pt-3 pb-2">All systems</p>
                <ul className="space-y-0.5">
                  {rest.map((s) => (
                    <SystemRow key={s.name} system={s} selected={selected === s.name} onSelect={onSelect} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface SystemRowProps {
  system: SystemWithDecisions;
  selected: boolean;
  onSelect: (system: string) => void;
}

/** A system's name over what is on record for it, as in the What-if person picker. */
function SystemRow({ system, selected, onSelect }: SystemRowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(system.name)}
        aria-pressed={selected}
        className={cn(
          "flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors",
          selected ? "bg-primary text-primary-foreground shadow-sm" : "hover:bg-foreground/5",
        )}
      >
        <span className="truncate text-sm font-semibold">{system.name}</span>
        <span className={cn("truncate text-xs tabular-nums", selected ? "text-primary-foreground/80" : "font-light text-muted-foreground")}>
          {system.decisions} decision{system.decisions === 1 ? "" : "s"}
          {system.changes > 0 && <span className={cn(!selected && "font-semibold text-foreground")}> · {system.changes} replaced</span>}
        </span>
      </button>
    </li>
  );
}
