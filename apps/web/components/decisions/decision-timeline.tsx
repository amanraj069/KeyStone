"use client";

import { useMemo, useState } from "react";
import type { DecisionTraceRow } from "@keystone/shared";
import { ArrowUpRight, FileText, History, Mail, MessageSquare, Ticket, Users, Video, type LucideIcon } from "lucide-react";
import { EvidenceChip } from "@/components/evidence-chip";
import { Button } from "@/components/ui/button";
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

/** Each kind gets a graph colour, so the tag reads at a glance. */
const KIND_COLOR: Record<string, string> = {
  change: "var(--node-person)",
  adopt: "var(--node-system)",
  policy: "var(--node-ticket)",
  deprecate: "var(--signal)",
};

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
      <div className="flex flex-col gap-5 border-b px-5 py-5 sm:px-8 xl:flex-row xl:items-center xl:justify-between">
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          <Figure label="Decisions" value={rows.length} />
          <Figure label="Replacements" value={changes} />
          <Figure label="Span" value={span(rows)} />
        </dl>
        {rows.length > 1 && options.length > 2 && (
          <div className="-mx-1 overflow-x-auto px-1 pb-1 xl:pb-0">
            <OptionPills label="Show" options={options} value={filter} onChange={choose} />
          </div>
        )}
      </div>

      <div className="px-5 py-6 sm:px-8 sm:py-8">
        {filtered.length === 0 ? (
          <p className="text-sm font-light text-muted-foreground">No decisions match.</p>
        ) : (
          <ol className="space-y-8">
            {groups.map((group, index) => (
              <li key={`${group.day}-${index}`} className="grid gap-3 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-6">
                <div className="sm:sticky sm:top-6 sm:self-start sm:pt-4">
                  <p className="text-sm font-extrabold tracking-tight tabular-nums">Day {group.day ?? "?"}</p>
                  <p className="text-xs font-light text-muted-foreground">
                    {group.rows.length} decision{group.rows.length === 1 ? "" : "s"}
                  </p>
                </div>
                <ol className="space-y-3">
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
              </li>
            ))}
          </ol>
        )}
        {filtered.length > limit && (
          <Button variant="outline" size="sm" className="mt-8 sm:ml-[7rem]" onClick={() => setLimit((n) => n + PAGE)}>
            Show {Math.min(PAGE, filtered.length - limit)} older ({filtered.length - limit} left)
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
        "rounded-xl border p-4 transition-shadow duration-500 sm:p-5",
        superseded ? "border-dashed" : "bg-surface",
        flashed && "ring-2 ring-ring ring-offset-2 ring-offset-card",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <KindTag kind={row.kind} />
        {superseded && <span className="text-xs font-semibold text-faint">Replaced</span>}
        <span className="ml-auto flex min-w-0 items-center gap-1.5 text-muted-foreground" title={source.name}>
          <SourceIcon className="size-3.5 shrink-0" aria-label={source.name} />
          <EvidenceChip id={row.source} onOpen={onOpenArtifact} title={`Decided in ${row.source}`} />
        </span>
      </div>

      <p className={cn("mt-3 text-[15px] leading-snug font-semibold", superseded && "font-normal text-muted-foreground line-through decoration-faint")}>
        {row.summary}
      </p>

      {row.replacedId && <ReplacedNote text={row.replaced ?? row.replacedId} earlier={earlier} onJump={onJump} />}

      {replacement && (
        <button
          type="button"
          onClick={() => onJump(replacement.id)}
          className="mt-3 flex items-start gap-1.5 text-left text-xs font-semibold underline-offset-2 hover:underline"
        >
          <ArrowUpRight className="mt-px size-3.5 shrink-0" />
          Replaced on day {replacement.day ?? "?"} by: {truncate(replacement.summary, 110)}
        </button>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-xs font-light text-muted-foreground">
        <Users className="size-3.5 shrink-0" />
        {authors}
      </p>
    </li>
  );
}

/** What a decision replaced, struck through; a link to it when it is on this timeline. */
function ReplacedNote({ text, earlier, onJump }: { text: string; earlier: DecisionTraceRow | null; onJump: (id: string) => void }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 font-semibold text-muted-foreground">
        <History className="size-3.5 shrink-0" />
        {earlier ? `Replaces a day ${earlier.day ?? "?"} decision` : "Replaces an earlier decision about another system"}
      </span>
      <span className="mt-1 block leading-relaxed text-muted-foreground line-through decoration-faint">{truncate(text, 200)}</span>
    </>
  );
  const box = "mt-3 block w-full rounded-lg border border-dashed px-3 py-2.5 text-left text-xs";
  return earlier ? (
    <button type="button" onClick={() => onJump(earlier.id)} className={cn(box, "transition-colors hover:border-foreground/30 hover:bg-foreground/[0.03]")}>
      {body}
    </button>
  ) : (
    <div className={box}>{body}</div>
  );
}

function KindTag({ kind }: { kind: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-[11px] font-bold">
      <span className="size-1.5 rounded-full" style={{ background: KIND_COLOR[kind] ?? "var(--node-artifact)" }} aria-hidden />
      {capitalize(kind)}
    </span>
  );
}

function Figure({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="section-label">{label}</dt>
      <dd className="mt-1 text-2xl font-extrabold tracking-tight tabular-nums">{value}</dd>
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
