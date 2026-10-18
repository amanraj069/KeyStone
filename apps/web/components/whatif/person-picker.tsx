"use client";

import { useMemo, useState } from "react";
import type { DepartureCandidate, PersonListItem } from "@keystone/shared";
import { SearchField } from "@/components/ui/search-field";
import { SkeletonRows } from "@/components/ui/states";
import { cn } from "@/lib/utils";

interface PersonPickerProps {
  candidates: DepartureCandidate[] | null;
  people: PersonListItem[] | null;
  selected: string | null;
  onSelect: (person: string) => void;
  error: string | null;
}

/** Search, then the most impactful departures, then everyone else (people who left are listed but cannot be picked). */
export function PersonPicker({ candidates, people, selected, onSelect, error }: PersonPickerProps) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();

  const { top, rest } = useMemo(() => {
    const matches = (name: string, dept: string | null) => !term || name.toLowerCase().includes(term) || (dept ?? "").toLowerCase().includes(term);
    const topNames = new Set((candidates ?? []).map((c) => c.person));
    return {
      top: (candidates ?? []).filter((c) => matches(c.person, c.dept)),
      rest: (people ?? []).filter((p) => !topNames.has(p.name) && matches(p.name, p.dept)),
    };
  }, [candidates, people, term]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-2.5">
        <SearchField value={search} onChange={setSearch} placeholder="Search people or teams" />
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {error && <p className="px-2 text-sm text-muted-foreground">{error}</p>}
        <p className="section-label px-3 pt-3 pb-1.5">Most impactful</p>
        {!candidates ? (
          <SkeletonRows count={5} className="px-1" />
        ) : top.length === 0 ? (
          <p className="px-3 pb-3 text-xs text-muted-foreground">{term ? "No match." : "Nobody is the only expert on a core system."}</p>
        ) : (
          <ul className="mb-3 space-y-0.5">
            {top.map((c) => (
              <PersonRow key={c.person} name={c.person} detail={`${c.orphaned} system${c.orphaned === 1 ? "" : "s"} only they know`} risk selected={selected === c.person} onSelect={onSelect} />
            ))}
          </ul>
        )}
        <p className="section-label px-3 pt-3 pb-1.5">Everyone</p>
        {!people ? (
          <SkeletonRows count={8} className="px-1" />
        ) : rest.length === 0 ? (
          <p className="px-3 text-xs text-muted-foreground">No match.</p>
        ) : (
          <ul className="space-y-0.5">
            {rest.map((p) => (
              <PersonRow
                key={p.name}
                name={p.name}
                detail={p.active ? (p.dept?.replace(/_/g, " ") ?? "") : `left on day ${p.departedDay ?? "?"}`}
                disabled={!p.active}
                selected={selected === p.name}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface PersonRowProps {
  name: string;
  detail: string;
  selected: boolean;
  onSelect: (person: string) => void;
  risk?: boolean;
  disabled?: boolean;
}

function PersonRow({ name, detail, selected, onSelect, risk = false, disabled = false }: PersonRowProps) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSelect(name)}
        aria-pressed={selected}
        className={cn(
          "relative flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors duration-150 disabled:opacity-40",
          selected ? "bg-selected" : "enabled:hover:bg-hover",
        )}
      >
        {selected && <span className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-foreground" aria-hidden />}
        <span className={cn("text-sm", selected ? "font-medium" : "text-foreground/90")}>{name}</span>
        <span className={cn("truncate text-xs", risk ? "text-signal" : "text-muted-foreground")}>{detail}</span>
      </button>
    </li>
  );
}
