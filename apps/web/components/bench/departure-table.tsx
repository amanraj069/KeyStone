import type { B1Results } from "@keystone/shared";
import { pct } from "./format";

/** B1: per departure, how well K5 (on a projection as of the day before) predicted the knowledge domains. */
export function DepartureTable({ b1 }: { b1: B1Results }) {
  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-semibold">Departure</th>
              <th className="py-2 pr-4 font-semibold">Predicted (K5)</th>
              <th className="py-2 pr-4 font-semibold">Gold domains</th>
              <th className="py-2 pr-4 text-right font-semibold">Precision</th>
              <th className="py-2 pr-4 text-right font-semibold">Recall</th>
              <th className="py-2 text-right font-semibold">F1</th>
            </tr>
          </thead>
          <tbody>
            {b1.departures.map((d) => (
              <tr key={d.person} className="border-b align-top">
                <td className="py-2.5 pr-4">
                  <p className="font-semibold">{d.person}</p>
                  <p className="text-xs text-muted-foreground">
                    left day {d.day} · as of day {d.asOfDay}
                  </p>
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">
                  {d.error ? <span className="text-signal">{d.error}</span> : `${d.predicted.length} systems, ${d.orphaned.length} orphaned`}
                </td>
                <td className="py-2.5 pr-4 text-muted-foreground">
                  {d.domains.length} ({d.domains.length - d.fn} found)
                </td>
                <td className="py-2.5 pr-4 text-right tabular-nums">{pct(d.precision)}</td>
                <td className="py-2.5 pr-4 text-right tabular-nums">{pct(d.recall)}</td>
                <td className="py-2.5 text-right tabular-nums">{pct(d.f1)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="py-2.5 pr-4" colSpan={3}>
                Overall (micro)
              </td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{pct(b1.overall.precision)}</td>
              <td className="py-2.5 pr-4 text-right tabular-nums">{pct(b1.overall.recall)}</td>
              <td className="py-2.5 text-right tabular-nums">{pct(b1.overall.f1)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Only the systems K5 says the person orphans (no backup left):{" "}
        <span className="font-semibold text-foreground">
          precision {pct(b1.overallOrphanedOnly.precision)}, recall {pct(b1.overallOrphanedOnly.recall)}, F1 {pct(b1.overallOrphanedOnly.f1)}
        </span>
        .
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        A second predictor, knowledge share (systems where the person holds at least a quarter of everyone&apos;s knowledge):{" "}
        <span className="font-semibold text-foreground">
          precision {pct(b1.overallKnowledgeShare.precision)}, recall {pct(b1.overallKnowledgeShare.recall)}, F1 {pct(b1.overallKnowledgeShare.f1)}
        </span>
        .
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Departures before day 1:{" "}
        <span className="font-semibold text-foreground">
          {b1.genesisOverall.found} of {b1.genesisOverall.total} domains ({pct(b1.genesisOverall.recall)})
        </span>{" "}
        show up as orphaned or critical in bus factor today
        {b1.genesis.length > 0 && ` (${b1.genesis.map((g) => `${g.person} ${pct(g.recall)}`).join(", ")})`}.
      </p>
    </div>
  );
}
