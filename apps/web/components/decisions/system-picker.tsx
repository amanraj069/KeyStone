"use client";

import { useMemo, useState } from "react";
import type { SystemWithDecisions } from "@keystone/shared";
import { SearchField } from "@/components/ui/search-field";
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
      <div className="border-b p-2.5">
        <SearchField value={search} onChange={setSearch} placeholder="Search systems" />
      </div>
      <div className="flex-1 overflow-y-auto px-2 pt-1 pb-3">
        {error && <p className="px-2 text-sm text-muted-foreground">{error}</p>}
        {!systems && !error ? (
          <SkeletonRows count={10} rowClassName="h-11" className="px-1 pt-2" />
        ) : !systems ? null : shown.length === 0 ? (
          <p className="px-3 pt-3 text-xs text-muted-foreground">{search ? "No match." : "No decisions have been extracted yet."}</p>
        ) : (
          <>
            {changed.length > 0 && (
              <>
                <p className="section-label px-3 pt-3 pb-1.5">Changed</p>
                <ul className="mb-2 space-y-px">
                  {changed.map((s) => (
                    <SystemRow key={s.name} system={s} selected={selected === s.name} onSelect={onSelect} />
                  ))}
                </ul>
              </>
            )}
            {rest.length > 0 && (
              <>
                <p className="section-label px-3 pt-3 pb-1.5">All systems</p>
                <ul className="space-y-px">
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
          "relative flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors duration-150",
          selected ? "bg-selected" : "hover:bg-hover",
        )}
      >
        {selected && <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-foreground" aria-hidden />}
        <span className={cn("truncate text-sm", selected ? "font-medium text-foreground" : "text-foreground/90")}>{system.name}</span>
        <span className="truncate text-xs text-muted-foreground tabular-nums">
          {system.decisions} decision{system.decisions === 1 ? "" : "s"}
          {system.changes > 0 && <span className="text-foreground/80"> · {system.changes} replaced</span>}
        </span>
      </button>
    </li>
  );
}
