import type { AccuracyRow } from "@keystone/shared";
import { typeLabel, withCi } from "./format";

/** The chart's numbers as a table: accuracy with its 95% interval and the verdict, Keystone vs the vector-only baseline. */
export function AccuracyTable({ rows, overall }: { rows: AccuracyRow[]; overall: AccuracyRow }) {
  return (
    <div className="overflow-x-auto">
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
  );
}
