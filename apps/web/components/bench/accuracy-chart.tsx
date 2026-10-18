"use client";

import type { AccuracyRow } from "@keystone/shared";
import { Bar, BarChart, CartesianGrid, ErrorBar, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { pct, typeLabel } from "./format";

/** The two series, in a fixed order; colours are theme tokens (globals.css), validated for both modes. */
const SERIES = [
  { key: "keystone", label: "Keystone", color: "var(--series-keystone)" },
  { key: "baseline", label: "Vector-only", color: "var(--series-baseline)" },
] as const;

interface Datum {
  type: string;
  n: number;
  keystone: number;
  baseline: number;
  /** 95% interval as distances below and above the bar, in points (ErrorBar's format). */
  keystoneErr: [number, number] | null;
  baselineErr: [number, number] | null;
  keystoneCi: [number, number] | null;
  baselineCi: [number, number] | null;
  keystoneCorrect: number;
  baselineCorrect: number;
}

/**
 * Accuracy per question type, Keystone and the vector-only baseline side by side —
 * just the two systems, for a direct comparison. Each group is labelled with its
 * sample size and the legend names the series. Exact values and intervals are in the
 * tooltip and in AccuracyTable under the chart (value labels at the bar tips would
 * collide with the interval whiskers). A 0% bar keeps a 2px stub (minPointSize) so it
 * reads as zero, not as missing. Whiskers show each system's 95% confidence interval.
 */
export function AccuracyChart({ rows }: { rows: AccuracyRow[] }) {
  const points = (ci: [number, number] | null | undefined): [number, number] | null => (ci ? [Math.round(ci[0] * 100), Math.round(ci[1] * 100)] : null);
  const below = (value: number, ci: [number, number] | null): [number, number] | null => (ci ? [value - ci[0], ci[1] - value] : null);
  const data: Datum[] = rows.map((r) => {
    const keystone = Math.round((r.keystone ?? 0) * 100);
    const baseline = Math.round((r.baseline ?? 0) * 100);
    const keystoneCi = points(r.keystoneCi);
    const baselineCi = points(r.baselineCi);
    return {
    type: r.type,
    n: r.n,
    keystone,
    baseline,
    keystoneCi,
    baselineCi,
    keystoneErr: below(keystone, keystoneCi),
    baselineErr: below(baseline, baselineCi),
    keystoneCorrect: r.keystoneCorrect,
    baselineCorrect: r.baselineCorrect,
    };
  });

  return (
    <figure>
      <figcaption className="sr-only">Accuracy by question type for Keystone and the vector-only baseline; the table below has the same numbers.</figcaption>
      <Legend />
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 24, right: 8, bottom: 8, left: 0 }} barGap={2} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="type" tickLine={false} axisLine={{ stroke: "var(--border)" }} interval={0} height={44} tick={<TypeTick data={data} />} />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tickLine={false}
              axisLine={false}
              width={44}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            <Tooltip cursor={{ fill: "var(--foreground)", fillOpacity: 0.04 }} content={<ChartTooltip />} />
            {SERIES.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} maxBarSize={24} minPointSize={2} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {/* The 95% interval: a thin whisker in neutral ink, so it reads as uncertainty, not as a series. */}
                <ErrorBar dataKey={`${s.key}Err`} width={6} strokeWidth={1.25} stroke="var(--muted-foreground)" direction="y" />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

function Legend() {
  return (
    <ul className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
      {SERIES.map((s) => (
        <li key={s.key} className="flex items-center gap-2">
          <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** X-axis tick: the question type, and its sample size under it. */
function TypeTick({ x, y, payload, data }: { x?: number; y?: number; payload?: { value: string }; data: Datum[] }) {
  const type = payload?.value ?? "";
  const n = data.find((d) => d.type === type)?.n ?? 0;
  return (
    <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text dy={14} textAnchor="middle" fill="var(--foreground)" fontSize={12} fontWeight={600}>
        {typeLabel(type)}
      </text>
      <text dy={30} textAnchor="middle" fill="var(--muted-foreground)" fontSize={11}>
        n = {n}
      </text>
    </g>
  );
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Datum }[] }) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) return null;
  return (
    <div className="rounded-xl border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-bold">
        {typeLabel(datum.type)} <span className="font-normal text-muted-foreground">· {datum.n} questions</span>
      </p>
      {SERIES.map((s) => (
        <p key={s.key} className="mt-1 flex items-center gap-2">
          <span className="size-2 rounded-[2px]" style={{ background: s.color }} aria-hidden />
          <span className="text-muted-foreground">{s.label}</span>
          <span className="ml-auto pl-4 font-semibold tabular-nums">
            {pct(datum[s.key] / 100)} ({s.key === "keystone" ? datum.keystoneCorrect : datum.baselineCorrect}/{datum.n})
            {(() => {
              const ci = s.key === "keystone" ? datum.keystoneCi : datum.baselineCi;
              return ci ? <span className="font-normal text-muted-foreground"> · 95% CI {ci[0]}–{ci[1]}%</span> : null;
            })()}
          </span>
        </p>
      ))}
    </div>
  );
}
