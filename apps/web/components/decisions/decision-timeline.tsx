"use client";

import { useMemo, useState } from "react";
import type { DecisionTraceRow } from "@keystone/shared";
import { CornerDownRight, FileText, History, Mail, MessageSquare, Ticket, Users, Video, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { EvidenceChip } from "@/components/evidence-chip";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { OptionPills, type PillOption } from "@/components/ui/option-pills";
import { cn } from "@/lib/utils";

/** Long timelines (Terraform has hundreds of decisions) render in pages of this many. */
const PAGE = 40;
/** How long a decision you jumped to stays outlined. */
const FLASH_MS = 1600;

/** Filter values; kinds are prefixed so a kind can never clash with the other two. */
const ALL = "all";
const REPLACEMENTS = "replacements";
const kindFilter = (kind: string) => `kind:${kind}`;

/** Where a decision was made, by the source artifact's doc type. */
const SOURCES: Record<string, { icon: LucideIcon; name: string }> = {
  slack: { icon: MessageSquare, name: "Slack" },
  confluence: { icon: FileText, name: "Confluence page" },
  zoom_transcript: { icon: Video, name: "Meeting" },
  email: { icon: Mail, name: "Email" },
  jira: { icon: Ticket, name: "Ticket" },
  zd_ticket: { icon: Ticket, name: "Support ticket" },
};

interface DecisionTimelineProps {
  rows: DecisionTraceRow[];
  onOpenArtifact: (id: string) => void;
}

const anchor = (id: string) => `decision-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/**
 * Decisions about one system, newest first, grouped by day: a summary and filters on
 * top, then one card per decision. A decision that a later one replaced is struck
 * through and links to its replacement; a decision that replaced an earlier one shows
 * what it replaced.
 */
export function DecisionTimeline({ rows, onOpenArtifact }: DecisionTimelineProps) {
  const [limit, setLimit] = useState(PAGE);
  const [filter, setFilter] = useState(ALL);
  const [flashed, setFlashed] = useState<string | null>(null);
  // id of a replaced decision -> the decision that replaced it.
  const replacedBy = useMemo(() => new Map(rows.filter((r) => r.replacedId).map((r) => [r.replacedId!, r])), [rows]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const changes = rows.filter((r) => r.replacedId).length;

  const options = useMemo(() => {
    const kinds = new Map<string, number>();
    for (const row of rows) kinds.set(row.kind, (kinds.get(row.kind) ?? 0) + 1);
    const list: PillOption<string>[] = [{ value: ALL, label: `All ${rows.length}` }];
    if (changes > 0) list.push({ value: REPLACEMENTS, label: `Replacements ${changes}` });
    for (const [kind, count] of [...kinds].sort((a, b) => b[1] - a[1])) list.push({ value: kindFilter(kind), label: `${capitalize(kind)} ${count}` });
    return list;
  }, [rows, changes]);

  const matchesFilter = (row: DecisionTraceRow, value: string) =>
    value === ALL || (value === REPLACEMENTS ? row.replacedId !== null || replacedBy.has(row.id) : value === kindFilter(row.kind));
  const filtered = rows.filter((row) => matchesFilter(row, filter));
  const groups = groupByDay(filtered.slice(0, limit));

  const choose = (value: string) => {
    setFilter(value);
    setLimit(PAGE);
  };

  /** Scrolls to a decision, clearing a filter that hides it, and outlines it for a moment. */
  const jump = (id: string) => {
    const target = byId.get(id);
    if (!target) return;
    const value = matchesFilter(target, filter) ? filter : ALL;
    const index = rows.filter((row) => matchesFilter(row, value)).indexOf(target);
    setFilter(value);
    if (index >= limit) setLimit(index + 1);
    setFlashed(id);
    setTimeout(() => setFlashed((current) => (current === id ? null : current)), FLASH_MS);
    // Two frames: one for React to render the row, one for layout.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => document.getElementById(anchor(id))?.scrollIntoView({ behavior: "smooth", block: "center" })),
    );
  };

  return (
    <div>
      <div className="flex flex-col gap-4 border-b px-4 py-5 sm:gap-5 sm:px-7 xl:flex-row xl:items-center xl:justify-between">
        <dl className="flex flex-wrap gap-x-8 gap-y-3 sm:gap-x-10">
          <Figure label="Decisions" value={rows.length} />
          <Figure label="Replacements" value={changes} />
          <Figure label="Span" value={span(rows)} />
        </dl>
        {rows.length > 1 && options.length > 2 && (
          <div className="-mx-1 min-w-0 px-1 py-0.5">
            <OptionPills label="Show" options={options} value={filter} onChange={choose} />
          </div>
        )}
      </div>

      <div className="px-2.5 py-5 sm:px-7 sm:py-8">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decisions match.</p>
        ) : (
          // Keyed by filter, so a new filter replays the entrance.
          <ol key={filter}>
            {groups.map((group, index) => (
              <li
                key={`${group.day}-${index}`}
                className="animate-rise grid grid-cols-1 gap-1 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-0"
                style={{ "--i": index } as CSSProperties}
              >
                {/* The top bar is 3.5rem, so the day sticks just below it. */}
                <div className="flex items-baseline gap-2 px-1.5 sm:sticky sm:top-20 sm:block sm:self-start sm:px-0 sm:pt-3.5 sm:pr-6 sm:text-right">
                  <p className="text-sm font-semibold tabular-nums">Day {group.day ?? "?"}</p>
                  <p className="text-xs text-muted-foreground">
                    {group.rows.length} decision{group.rows.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className={cn("relative sm:border-l sm:pl-5", index < groups.length - 1 && "pb-6 sm:pb-8")}>
                  <ol className="space-y-1">
                    {group.rows.map((row) => (
                      <DecisionCard
                        key={row.id}
                        row={row}
                        replacement={replacedBy.get(row.id) ?? null}
                        earlier={row.replacedId ? (byId.get(row.replacedId) ?? null) : null}
                        flashed={flashed === row.id}
                        onJump={jump}
                        onOpenArtifact={onOpenArtifact}
                      />
                    ))}
                  </ol>
                </div>
              </li>
            ))}
          </ol>
        )}
        {filtered.length > limit && (
          <Button variant="outline" size="sm" className="mt-6 ml-1.5 sm:mt-8 sm:ml-[6.75rem]" onClick={() => setLimit((n) => n + PAGE)}>
            Show {Math.min(PAGE, filtered.length - limit)} older
            <span className="text-muted-foreground tabular-nums">{filtered.length - limit} left</span>
          </Button>
        )}
      </div>
    </div>
  );
}

interface DecisionCardProps {
  row: DecisionTraceRow;
  /** The later decision that replaced this one, if any. */
  replacement: DecisionTraceRow | null;
  /** The earlier decision this one replaced, when it is about the same system. */
  earlier: DecisionTraceRow | null;
  flashed: boolean;
  onJump: (id: string) => void;
  onOpenArtifact: (id: string) => void;
}

function DecisionCard({ row, replacement, earlier, flashed, onJump, onOpenArtifact }: DecisionCardProps) {
  const superseded = Boolean(replacement) || row.status === "superseded";
  const source = SOURCES[row.sourceType] ?? { icon: FileText, name: row.sourceType };
  const SourceIcon = source.icon;
  const authors = row.authors.length > 0 ? row.authors.slice(0, 4).join(", ") + (row.authors.length > 4 ? ` +${row.authors.length - 4}` : "") : "Author unknown";

  return (
    <li
      id={anchor(row.id)}
      className={cn(
        "group/card scroll-mt-24 rounded-lg px-1.5 py-3 transition-colors duration-200 hover:bg-surface sm:px-4 sm:py-3.5",
        flashed && "animate-flash bg-surface",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <KindTag kind={row.kind} />
        {superseded && <span className="text-[11px] font-medium text-faint">Replaced</span>}
        <span className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-1.5 text-muted-foreground" title={source.name}>
          <SourceIcon className="size-3.5 shrink-0" strokeWidth={1.8} aria-label={source.name} />
          <span className="max-w-[min(22rem,100%)] min-w-0">
            <EvidenceChip id={row.source} onOpen={onOpenArtifact} title={`Decided in ${row.source}`} />
          </span>
        </span>
      </div>

      <p
        className={cn(
          "mt-2.5 text-sm leading-snug font-medium text-pretty sm:text-[15px]",
          superseded && "font-normal text-muted-foreground line-through decoration-faint/70",
        )}
      >
        {row.summary}
      </p>

      {row.replacedId && <ReplacedNote text={row.replaced ?? row.replacedId} earlier={earlier} onJump={onJump} />}

      {replacement && (
        <button
          type="button"
          onClick={() => onJump(replacement.id)}
          className="group/link mt-2.5 flex items-start gap-1.5 text-left text-xs text-foreground/90"
        >
          <CornerDownRight className="mt-px size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-hover/link:translate-x-0.5" />
          <span className="underline-offset-2 group-hover/link:underline">
            <span className="font-medium">Replaced on day {replacement.day ?? "?"}</span>
            <span className="text-muted-foreground"> by {truncate(replacement.summary, 110)}</span>
          </span>
        </button>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
        <Users className="size-3.5 shrink-0" strokeWidth={1.8} />
        {authors}
      </p>
    </li>
  );
}

/** What a decision replaced, as a struck-through quote; a link to it when it is on this timeline. */
function ReplacedNote({ text, earlier, onJump }: { text: string; earlier: DecisionTraceRow | null; onJump: (id: string) => void }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
        <History className="size-3.5 shrink-0" strokeWidth={1.8} />
        {earlier ? `Replaces a day ${earlier.day ?? "?"} decision` : "Replaces an earlier decision about another system"}
      </span>
      <span className="mt-1 block leading-relaxed text-muted-foreground/90 line-through decoration-faint/60">{truncate(text, 200)}</span>
    </>
  );
  const box = "mt-3 block w-full border-l-2 border-border py-0.5 pl-3 text-left text-xs";
  return earlier ? (
    <button type="button" onClick={() => onJump(earlier.id)} className={cn(box, "transition-colors duration-200 hover:border-foreground/40")}>
      {body}
    </button>
  ) : (
    <div className={box}>{body}</div>
  );
}

function KindTag({ kind }: { kind: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium", kind === "deprecate" ? "bg-signal-soft text-signal" : "bg-foreground/[0.06] text-foreground/80")}>
      {capitalize(kind)}
    </span>
  );
}

function Figure({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="section-label">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold sm:text-2xl tracking-tight tabular-nums">
        <CountUp value={value} />
      </dd>
    </div>
  );
}

/** Rows are newest first, so a day's decisions are always next to each other. */
function groupByDay(rows: DecisionTraceRow[]) {
  const groups: { day: number | null; rows: DecisionTraceRow[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last && last.day === row.day) last.rows.push(row);
    else groups.push({ day: row.day, rows: [row] });
  }
  return groups;
}

/** "Day 50", or "Day 0–60" across several days. */
function span(rows: DecisionTraceRow[]) {
  const days = rows.map((r) => r.day).filter((day): day is number => day !== null);
  if (days.length === 0) return "–";
  const first = Math.min(...days);
  const last = Math.max(...days);
  return first === last ? `Day ${first}` : `Day ${first}–${last}`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
