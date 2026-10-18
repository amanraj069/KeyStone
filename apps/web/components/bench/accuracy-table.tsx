import type { AccuracyRow } from "@keystone/shared";
import { typeLabel, withCi } from "./format";

/**
 * The chart's numbers as a table: accuracy with its 95% interval and the verdict, Keystone vs
 * the vector-only baseline. On phones each question type is a small card instead of a row.
 */
export function AccuracyTable({ rows, overall }: { rows: AccuracyRow[]; overall: AccuracyRow }) {
  return (
    <>
      <ul className="divide-y rounded-xl border sm:hidden">
        {[...rows, overall].map((r) => (
          <li key={r.type} className="px-4 py-3 text-sm">
            <p className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{r === overall ? "Overall" : typeLabel(r.type)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">n = {r.n}</span>
            </p>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              <dt className="text-muted-foreground">Keystone</dt>
              <dd className="text-right font-semibold tabular-nums">{withCi(r.keystone, r.keystoneCi)}</dd>
              <dt className="text-muted-foreground">Vector-only</dt>
              <dd className="text-right font-semibold tabular-nums">{withCi(r.baseline, r.baselineCi)}</dd>
            </dl>
            {r.verdict && <p className="mt-1.5 text-xs text-muted-foreground">{r.verdict}</p>}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto sm:block">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-4 font-semibold">Question type</th>
            <th className="py-2 pr-4 text-right font-semibold">n</th>
            <th className="py-2 pr-4 text-right font-semibold">Keystone (95% CI)</th>
            <th className="py-2 pr-4 text-right font-semibold">Vector-only (95% CI)</th>
            <th className="py-2 font-semibold">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {[...rows, overall].map((r) => (
            <tr key={r.type} className={r === overall ? "font-bold" : "border-b align-top"}>
              <td className="py-2.5 pr-4">{r === overall ? "Overall" : typeLabel(r.type)}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{r.n}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{withCi(r.keystone, r.keystoneCi)}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{withCi(r.baseline, r.baselineCi)}</td>
              <td className="py-2.5 font-normal text-muted-foreground">{r.verdict}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
