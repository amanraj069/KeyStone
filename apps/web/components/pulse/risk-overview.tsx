import type { AnalyticsSummary } from "@keystone/shared";
import { CountUp } from "@/components/ui/count-up";
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
        <div className="lg:border-r lg:pr-14">{summary ? <RiskHeadline summary={summary} /> : <HeadlineSkeleton />}</div>
        <div>
          <p className="section-label mb-2">The company</p>
          <div className="flex flex-col divide-y">
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
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="my-2 h-11 rounded-lg" />)
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
      <p className="mt-3 flex items-baseline gap-3">
        <span className={cn("text-6xl leading-none font-semibold tracking-[-0.04em] tabular-nums sm:text-7xl", atRisk > 0 && "text-signal")}>
          <CountUp value={atRisk} />
        </span>
        <span className="text-base text-muted-foreground">of {total} systems</span>
      </p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        core systems depend on a single person, or on nobody who is still here.
      </p>
      {/* The bar, split by level; each level's label and count sit under its own segment colour. */}
      <div className="mt-7 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-foreground/5" role="img" aria-label="Systems by risk level">
        {total > 0 &&
          RISK_ORDER.map((level) => (
            <div
              key={level}
              className={cn("h-full rounded-full transition-[width] duration-1000 ease-out-expo", RISK_BAR[level])}
              style={{ width: `${(systems[level] / total) * 100}%` }}
            />
          ))}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {RISK_ORDER.map((level) => (
          <div key={level} className="min-w-0">
            <dt className="truncate text-xs text-muted-foreground">{RISK_COPY[level].tab}</dt>
            <dd className={cn("mt-0.5 text-lg font-semibold tabular-nums", (level === "orphaned" || level === "critical") && systems[level] > 0 && "text-signal")}>
              {systems[level]}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function StatRow({ label, value, note }: { label: string; value: number | string; note: string }) {
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{note}</p>
      </div>
      <p className="text-xl font-semibold tracking-tight tabular-nums">
        <CountUp value={value} />
      </p>
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
