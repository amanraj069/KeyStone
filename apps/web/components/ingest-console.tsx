"use client";

import { useEffect, useRef, useState } from "react";
import type { GraphCounts, IngestEvent } from "@keystone/shared";
import { Button } from "@/components/ui/button";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelHeading } from "@/components/ui/panel";
import { startIngest, watchIngest } from "@/lib/ingest";

type LogLine = { at: string; text: string; tone: "info" | "ok" | "error" };

const EMPTY: GraphCounts = { people: 0, artifacts: 0, edges: 0 };

/**
 * Starts a full ingest or a day-by-day replay and shows the live progress
 * stream: graph totals as tiles, one log line per event.
 */
export function IngestConsole() {
  const [running, setRunning] = useState(false);
  const [percent, setPercent] = useState(0);
  const [totals, setTotals] = useState<GraphCounts>(EMPTY);
  const [graph, setGraph] = useState<string>("-");
  const [log, setLog] = useState<LogLine[]>([]);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  const append = (text: string, tone: LogLine["tone"] = "info") =>
    setLog((lines) => [...lines, { at: new Date().toLocaleTimeString(), text, tone }]);

  function onEvent(event: IngestEvent) {
    if (event.type === "progress") {
      setPercent(event.progress.percent);
      setTotals(event.progress.totals);
      setGraph(event.progress.graph);
      append(event.progress.message);
    } else if (event.type === "completed") {
      append("Job completed", "ok");
      setRunning(false);
    } else {
      append(`Job failed: ${event.reason}`, "error");
      setRunning(false);
    }
  }

  async function run(kind: "full" | "replay", body: object, label: string) {
    stop.current?.();
    setRunning(true);
    setPercent(0);
    setTotals(EMPTY);
    setLog([]);
    try {
      const job = await startIngest(kind, body);
      append(`${label}: job ${job.jobId} queued`);
      stop.current = watchIngest(job.jobId, onEvent);
    } catch (error) {
      append(error instanceof Error ? error.message : String(error), "error");
      setRunning(false);
    }
  }

  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeading
        title="Ingestion"
        description={
          <>
            Build the company graph from <code className="code-id">data/artifacts.jsonl</code>, no LLM. Replay feeds it in day by day; open
            FalkorDB Browser on <code className="code-id">apex_replay</code> to watch it grow.
          </>
        }
      />
      <div className="mt-5 flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          <Button disabled={running} onClick={() => run("replay", { fromDay: 1, toDay: 5, delayMs: 2000 }, "Replay days 1-5")}>
            Replay days 1-5
          </Button>
          <Button variant="outline" disabled={running} onClick={() => run("full", { graph: "apex" }, "Full ingest")}>
            Full ingest (apex)
          </Button>
        </div>

        <Meter percent={percent} label={`${percent}% done`} />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Graph" value={graph} />
          <Stat label="People" value={totals.people.toLocaleString()} />
          <Stat label="Artifacts" value={totals.artifacts.toLocaleString()} />
          <Stat label="Edges" value={totals.edges.toLocaleString()} />
        </div>

        <ol className="max-h-72 overflow-y-auto rounded-lg border bg-surface p-3 font-mono text-xs leading-6">
          {log.length === 0 && <li className="text-muted-foreground">No job yet.</li>}
          {log.map((line, index) => (
            <li
              key={index}
              className={line.tone === "error" ? "text-signal" : line.tone === "ok" ? "text-[var(--node-system)]" : ""}
            >
              <span className="text-muted-foreground">{line.at}</span> {line.text}
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-surface px-3 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-xl font-semibold tracking-tight tabular-nums">{value}</div>
    </div>
  );
}
