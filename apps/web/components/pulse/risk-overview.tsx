import type { AnalyticsSummary } from "@keystone/shared";
import { Panel } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { RISK_BAR, RISK_COPY, RISK_ORDER } from "./risk";

/**
 * The headline (Intake's "today" panel): how many core systems hang on one person or
 * nobody, a bar split by risk level, and the company's other figures as rows.
 */
export function RiskOverview({ summary }: { summary: AnalyticsSummary | null }) {
  return (
    <Panel className="p-5 sm:p-8 lg:p-10">
      <div className="grid items-center gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
        <div className="lg:border-r lg:pr-12">{summary ? <RiskHeadline summary={summary} /> : <HeadlineSkeleton />}</div>
        <div>
          <p className="section-label mb-4">The company</p>
          <div className="flex flex-col gap-2.5">
            {summary ? (
              <>
                <StatRow label="People" value={summary.people.active} note={summary.people.inactive > 0 ? `${summary.people.inactive} departed` : "all active"} />
                <StatRow label="Open tickets" value={summary.openTickets} note="assigned and not done" />
                <StatRow label="Stale pages" value={summary.staleDocs} note="still state a replaced decision" />
                <StatRow
                  label="Graph"
                  value={`${summary.memory.graphs.find((g) => g.graph === summary.graph)?.totalMb ?? "–"} MB`}
                  note={summary.memory.usedMemoryHuman ? `FalkorDB uses ${summary.memory.usedMemoryHuman}` : "in FalkorDB"}
                />
              </>
            ) : (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[3.6rem] rounded-xl" />)
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function RiskHeadline({ summary }: { summary: AnalyticsSummary }) {
  const { systems } = summary;
  const total = RISK_ORDER.reduce((sum, level) => sum + systems[level], 0);
  const atRisk = systems.orphaned + systems.critical;
  return (
    <div>
      <p className="section-label">Bus factor</p>
      <p className="mt-4 flex items-baseline gap-3">
        <span className={cn("text-6xl font-extrabold tracking-tighter tabular-nums sm:text-7xl", atRisk > 0 && "text-signal")}>{atRisk}</span>
        <span className="text-lg font-bold text-muted-foreground">of {total} systems</span>
      </p>
      <p className="mt-2 max-w-md text-sm leading-relaxed font-light text-muted-foreground">
        core systems depend on a single person, or on nobody who is still here.
      </p>
      <div className="mt-6 flex h-2 overflow-hidden rounded-full bg-foreground/5" role="img" aria-label="Systems by risk level">
        {total > 0 &&
          RISK_ORDER.map((level) => (
            <div key={level} className={cn("h-full", RISK_BAR[level])} style={{ width: `${(systems[level] / total) * 100}%` }} />
          ))}
      </div>
      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
        {RISK_ORDER.map((level) => (
          <div key={level} className="flex items-center gap-2 text-xs">
            <span className={cn("size-2 rounded-full", RISK_BAR[level])} />
            <dt className="whitespace-nowrap text-muted-foreground">{RISK_COPY[level].tab}</dt>
            <dd className="font-bold tabular-nums">{systems[level]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StatRow({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-surface px-4 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        <p className="truncate text-xs font-light text-muted-foreground">{note}</p>
      </div>
      <p className="text-xl font-extrabold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

function HeadlineSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-16 w-56" />
      <Skeleton className="h-4 w-72" />
      <Skeleton className="mt-6 h-2 w-full" />
    </div>
  );
}
