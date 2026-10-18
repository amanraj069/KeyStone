"use client";

import type { BenchResults } from "@keystone/shared";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/shell/app-shell";
import { Panel, PanelHeading } from "@/components/ui/panel";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui/states";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import { AccuracyChart } from "./accuracy-chart";
import { AccuracyTable } from "./accuracy-table";
import { pct, seconds, withCi } from "./format";

/** Below this many questions the page says the sample is small. */
const SMALL_SAMPLE = 30;

/** Benchmark: the last `pnpm bench` run, Keystone against a vector-only baseline. */
export function BenchRoom() {
  const results = useApi((signal) => api.benchResults(signal), []);

  return (
    <PageContainer>
      <PageHeader
        className="animate-fade-up"
        title="Keystone vs vector-only"
        description={
          results.data
            ? `Same model (${results.data.provider} ${results.data.model}), same context budget. Run ${new Date(results.data.generatedAt).toLocaleString()}.`
            : "The same questions, the same model and the same context budget: Keystone's agent against top-k vector search pasted into one prompt."
        }
      />
      {results.error ? (
        <ErrorState message={results.error} onRetry={results.reload} />
      ) : results.loading && !results.data ? (
        <Panel className="p-5">
          <SkeletonRows count={6} />
        </Panel>
      ) : !results.data ? (
        <EmptyState title="No benchmark results yet" description="Run `pnpm bench` from the repository root; this page shows data/bench/results.json." />
      ) : (
        <Results data={results.data} />
      )}
    </PageContainer>
  );
}

function Results({ data }: { data: BenchResults }) {
  const { b2 } = data;
  return (
    <>
      {b2 && (
        <Panel className="space-y-6 p-5 sm:p-6">
          <PanelHeading
            title="Question answering accuracy by type"
            description={`Up to ${b2.perType} questions per type (seed ${b2.seed}); n under each group is the sample size. A blinded ${data.judgeModel} judge scored the yes/no answers.`}
          />
          {b2.overall.keystone !== null && b2.overall.baseline !== null && b2.overall.keystone < 0.5 && b2.overall.baseline < 0.5 && (
            <p className="rounded-xl border border-signal/30 bg-signal-soft px-4 py-3 text-sm leading-relaxed">
              <span className="font-bold">Both systems get most of these questions wrong.</span> The differences below come from a small sample near the
              floor; read them as a direction, not a result.
            </p>
          )}
          {(() => {
            const minTypeN = Math.min(...b2.byType.map((r) => r.n));
            return (
              minTypeN < SMALL_SAMPLE && (
                <p className="rounded-xl border bg-surface px-4 py-3 text-sm leading-relaxed">
                  <span className="font-bold">Small sample:</span> the smallest question type has only {minTypeN} questions ({b2.overall.n} total),
                  so one question moves that type&apos;s accuracy by about {Math.round(100 / Math.max(1, minTypeN))} points. Read the differences as a
                  direction, not a precise score — this question bank is fixed at {b2.overall.n} questions, so this will not shrink on its own.
                </p>
              )
            );
          })()}
          <AccuracyChart rows={b2.byType} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Stat
              label="Overall accuracy"
              keystone={withCi(b2.overall.keystone, b2.overall.keystoneCi)}
              baseline={withCi(b2.overall.baseline, b2.overall.baselineCi)}
              note={`${b2.overall.n} questions · 95% CI`}
            />
            {b2.paired && (
              <Stat
                label="Paired, same questions"
                keystone={`${b2.paired.keystoneOnly} only right`}
                baseline={`${b2.paired.baselineOnly} only right`}
                note={`sign test ${b2.paired.pValue < 0.001 ? "p < 0.001" : `p = ${b2.paired.pValue.toFixed(3)}`}`}
              />
            )}
            <Stat label="Median latency" keystone={seconds(b2.medianLatencyMs.keystone)} baseline={seconds(b2.medianLatencyMs.baseline)} note="uncached answers" />
            <Stat
              label="Evidence recall"
              keystone={pct(b2.overall.keystoneEvidenceRecall)}
              baseline={pct(b2.overall.baselineEvidenceRecall)}
              note="gold evidence the system saw"
            />
            <Stat
              label="Declined to answer"
              keystone={`${b2.refusals.keystone} of ${b2.overall.n}`}
              baseline={`${b2.refusals.baseline} of ${b2.overall.n}`}
              note="scored as wrong"
            />
            <Stat label="Context budget" keystone={`${(b2.contextBudgetChars / 1000).toFixed(0)}k chars`} baseline={`top ${b2.baselineK} chunks`} note="same for both" />
          </div>
          <AccuracyTable rows={b2.byType} overall={b2.overall} />
        </Panel>
      )}
    </>
  );
}

/** One figure for both systems, Keystone first. */
function Stat({ label, keystone, baseline, note }: { label: string; keystone: string; baseline: string; note: string }) {
  return (
    <div className="rounded-xl border bg-surface px-4 py-3">
      <p className="text-xs font-bold text-muted-foreground">{label}</p>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-[2px] bg-[var(--series-keystone)]" aria-hidden />
          <dt className="whitespace-nowrap text-muted-foreground">Keystone</dt>
          <dd className="ml-auto min-w-0 text-right font-semibold tabular-nums">{keystone}</dd>
        </div>
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-[2px] bg-[var(--series-baseline)]" aria-hidden />
          <dt className="whitespace-nowrap text-muted-foreground">Vector-only</dt>
          <dd className="ml-auto min-w-0 text-right font-semibold tabular-nums">{baseline}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-faint">{note}</p>
    </div>
  );
}
