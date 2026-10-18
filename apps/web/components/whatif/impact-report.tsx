"use client";

import { type ReactNode, useState } from "react";
import type { DepartureSimulation } from "@keystone/shared";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import { EvidenceChip } from "@/components/evidence-chip";
import { cn } from "@/lib/utils";

interface ImpactReportProps {
  simulation: DepartureSimulation;
  onOpenArtifact: (id: string) => void;
}

/** Long sections (a leaver can own dozens of tickets) show this many until expanded. */
const PREVIEW = 5;

const sectionId = (key: string) => `impact-${key}`;

/**
 * Everything the departure breaks: a scoreboard of counts, then one section per kind of
 * damage, each item with the artifacts that show it. Kinds with nothing in them are
 * listed together at the end instead of as empty sections.
 */
export function ImpactReport({ simulation: s, onOpenArtifact }: ImpactReportProps) {
  const chips = (ids: string[], max = 4) => <Chips ids={ids} max={max} onOpen={onOpenArtifact} />;

  const sections: SectionSpec[] = [
    {
      key: "orphaned",
      title: "No expert left",
      risk: true,
      empty: "no system loses its last expert",
      items: s.systemsNewlyOrphaned.map((c) => (
        <Item key={c.system} title={c.system} detail={<Experts before={c.expertsBefore} after={c.expertsAfter} />}>
          {chips(c.evidence)}
        </Item>
      )),
    },
    {
      key: "critical",
      title: "Down to one expert",
      risk: true,
      empty: "no system drops to a single expert",
      items: s.systemsNewlyCritical.map((c) => (
        <Item key={c.system} title={c.system} detail={<Experts before={c.expertsBefore} after={c.expertsAfter} />}>
          {chips(c.evidence)}
        </Item>
      )),
    },
    {
      key: "islands",
      title: "Knowledge islands",
      risk: true,
      empty: "no system becomes unknown to everyone",
      items: s.islandsCreated.map((i) => (
        <Item key={i.system} title={i.system} detail="Nobody else has worked on it.">
          {chips(i.evidence)}
        </Item>
      )),
    },
    {
      key: "tickets",
      title: "Open tickets to reassign",
      empty: "no open tickets",
      items: s.orphanedTickets.map((t) => (
        <Item key={t.ticket} title={t.title} id={t.ticket} onOpen={onOpenArtifact} detail={<Owners owners={t.suggestedOwners} />}>
          {t.ownerEvidence[0] && t.ownerEvidence[0].length > 0 && chips(t.ownerEvidence[0], 3)}
        </Item>
      )),
    },
    {
      key: "pages",
      title: "Pages only they wrote",
      empty: "every page they wrote has another author or reviewer",
      items: s.soleAuthoredPages.map((p) => <Item key={p.page} title={p.title} id={p.page} onOpen={onOpenArtifact} />),
    },
    {
      key: "bridges",
      title: "Who connects teams",
      empty: "the people who connect teams stay the same",
      items: s.bridgeShift.map((b) => (
        <Item key={b.person} title={b.person} aside={<Shift before={b.before} after={b.after} />}>
          {chips(b.evidence, 2)}
        </Item>
      )),
    },
  ];
  const filled = sections.filter((section) => section.items.length > 0);
  const empty = sections.filter((section) => section.items.length === 0);

  return (
    <div className="space-y-7">
      <Scoreboard sections={sections} />
      {filled.map((section) => (
        <Section key={section.key} section={section} />
      ))}
      {empty.length > 0 && (
        <section className="rounded-lg bg-surface px-4 py-3">
          <h3 className="section-label">Unchanged</h3>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {empty.map((section) => (
              <li key={section.key}>
                <span className="font-semibold text-foreground">{section.title}:</span> {section.empty}.
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface SectionSpec {
  key: string;
  title: string;
  /** Lost expertise: counted in the signal colour. */
  risk?: boolean;
  /** Said when the section has nothing in it, as the end of "Title: …". */
  empty: string;
  items: ReactNode[];
}

/** One tile per section; a tile with something in it jumps to its section. */
function Scoreboard({ sections }: { sections: SectionSpec[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {sections.map((section) => {
        const count = section.items.length;
        return (
          <button
            key={section.key}
            type="button"
            disabled={count === 0}
            onClick={() => document.getElementById(sectionId(section.key))?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className={cn(
              "rounded-lg border px-3 py-2.5 text-left transition-[border-color,box-shadow,transform] duration-200 ease-out-expo enabled:hover:-translate-y-px enabled:hover:border-input enabled:hover:shadow-raised disabled:cursor-default",
              count === 0 ? "opacity-70" : "bg-surface",
            )}
          >
            <span
              className={cn(
                "block text-xl font-semibold tracking-tight tabular-nums sm:text-2xl",
                count === 0 ? "text-faint" : section.risk && "text-signal",
              )}
            >
              {count}
            </span>
            <span className={cn("block text-[11px] leading-tight font-medium", count === 0 ? "text-faint" : "text-muted-foreground")}>{section.title}</span>
          </button>
        );
      })}
    </div>
  );
}

function Section({ section }: { section: SectionSpec }) {
  const [open, setOpen] = useState(false);
  const count = section.items.length;
  const shown = open ? section.items : section.items.slice(0, PREVIEW);
  return (
    <section id={sectionId(section.key)} className="scroll-mt-2">
      <h3 className="mb-2.5 flex items-baseline gap-2 text-sm font-semibold">
        <span className={cn(section.risk && "text-signal")}>{section.title}</span>
        <span className="text-xs font-semibold text-muted-foreground tabular-nums">{count}</span>
      </h3>
      <ul className="space-y-2">{shown}</ul>
      {count > PREVIEW && (
        <button type="button" onClick={() => setOpen((value) => !value)} className="mt-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
          {open ? "Show fewer" : `Show all ${count}`}
        </button>
      )}
    </section>
  );
}

interface ItemProps {
  title: string;
  detail?: ReactNode;
  /** Shown on the right of the title row. */
  aside?: ReactNode;
  id?: string;
  onOpen?: (id: string) => void;
  children?: ReactNode;
}

function Item({ title, detail, aside, id, onOpen, children }: ItemProps) {
  return (
    <li className="rounded-lg border bg-surface px-3 py-2.5 text-sm sm:px-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {id && onOpen && <EvidenceChip id={id} onOpen={onOpen} />}
        <span className="min-w-0 flex-1 truncate font-medium" title={title}>
          {title}
        </span>
        {aside}
      </div>
      {detail && <div className="mt-1 text-xs text-muted-foreground">{detail}</div>}
      {children}
    </li>
  );
}

/** The evidence ids, a few at a time. */
function Chips({ ids, max, onOpen }: { ids: string[]; max: number; onOpen: (id: string) => void }) {
  if (ids.length === 0) return null;
  return (
    <span className="mt-2 flex flex-wrap gap-1">
      {ids.slice(0, max).map((id) => (
        <EvidenceChip key={id} id={id} onOpen={onOpen} />
      ))}
      {ids.length > max && <span className="self-center text-[0.7rem] text-faint">+{ids.length - max}</span>}
    </span>
  );
}

/** The experts before the departure, the ones who are gone struck through: "~~Jax~~, Priya". */
function Experts({ before, after }: { before: string[]; after: string[] }) {
  const remaining = new Set(after);
  return (
    <span>
      Experts:{" "}
      {before.map((name, index) => (
        <span key={name}>
          {index > 0 && ", "}
          <span className={cn(remaining.has(name) ? "font-semibold text-foreground" : "line-through decoration-signal/70")}>{name}</span>
        </span>
      ))}
      {after.length === 0 && <span className="font-semibold text-signal"> · nobody left</span>}
    </span>
  );
}

/** Suggested owners, best match first. */
function Owners({ owners }: { owners: string[] }) {
  if (owners.length === 0) return <span>No suggested owner.</span>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="mr-0.5">Could take it:</span>
      {owners.map((owner, index) => (
        <span key={owner} className={cn("rounded-full border px-1.5 py-px text-[11px]", index === 0 ? "font-semibold text-foreground" : "")}>
          {owner}
        </span>
      ))}
    </span>
  );
}

/** Betweenness before and after; "left" for the leaver, an arrow for who takes on more or less. */
function Shift({ before, after }: { before: number | null; after: number | null }) {
  const up = before !== null && after !== null && after > before;
  const down = before !== null && after !== null && after < before;
  const Trend = up ? TrendingUp : down ? TrendingDown : ArrowRight;
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums" title="Betweenness: how often they sit on the shortest path between two people">
      {fmt(before)}
      <ArrowRight className="size-3" />
      <span className="font-semibold text-foreground">{after === null ? "left" : fmt(after)}</span>
      {(up || down) && <Trend className={cn("size-3.5", up && "text-signal")} />}
    </span>
  );
}

const fmt = (value: number | null) => (value === null ? "–" : value >= 100 ? Math.round(value).toString() : value.toFixed(1));
