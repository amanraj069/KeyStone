"use client";

import { type FormEvent, useState } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelHeading } from "@/components/ui/panel";
import { useLiveGraph } from "@/contexts/live-graph";
import { useAdminToken } from "@/hooks/use-admin-token";
import { api, ApiError } from "@/lib/api";

/** Business days in the dataset (ReplayRequestSchema allows 1..60). */
const FIRST_DAY = 1;
const LAST_DAY = 60;
/** Pause between days, so the systems can be watched changing. */
const DELAY_MS = 1500;

/**
 * Replays the company day by day into apex_replay (POST /ingest/replay); the
 * progress comes from GET /ingest/events and the page refreshes as days land.
 */
export function ReplayControl() {
  const { replay, followReplay } = useLiveGraph();
  const [fromDay, setFromDay] = useState(FIRST_DAY);
  const [toDay, setToDay] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const { token, setToken, needed: needsToken, setNeeded: setNeedsToken } = useAdminToken();
  const [starting, setStarting] = useState(false);
  const running = replay?.running ?? false;
  const progress = replay?.progress;

  async function start(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setStarting(true);
    try {
      const job = await api.startReplay({ fromDay, toDay, delayMs: DELAY_MS, reset: true }, token || undefined);
      followReplay(job.jobId);
      setNeedsToken(false);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) setNeedsToken(true);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStarting(false);
    }
  }

  return (
    <Panel className="p-5 sm:p-8">
      <form onSubmit={start} className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <PanelHeading
          title="Replay the company"
          description="Rebuild Apex one business day at a time and watch knowledge pile up on a few people. Everything below follows the replay."
        />
        <div className="flex flex-wrap items-end gap-3">
          <DayField label="From day" value={fromDay} onChange={setFromDay} min={FIRST_DAY} max={toDay} disabled={running} />
          <DayField label="To day" value={toDay} onChange={setToDay} min={fromDay} max={LAST_DAY} disabled={running} />
          {needsToken && (
            <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
              Admin token
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="h-10 w-40 rounded-xl" autoComplete="off" />
            </label>
          )}
          <Button type="submit" disabled={running || starting}>
            <Play data-icon="inline-start" />
            {running ? "Replaying…" : "Start replay"}
          </Button>
        </div>
      </form>

      {(replay || error) && (
        <div className="mt-6 border-t pt-5">
          <Meter percent={progress?.percent ?? 0} label="Replay progress" />
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {error ? (
              <span className="text-foreground">{error}</span>
            ) : replay?.failedReason ? (
              <span className="text-foreground">Replay failed: {replay.failedReason}</span>
            ) : progress ? (
              <>
                {progress.day != null && <span className="font-semibold text-foreground tabular-nums">Day {progress.day}</span>}
                <span>{progress.message}</span>
                <span className="tabular-nums">
                  {progress.totals.people} people · {progress.totals.artifacts} artifacts · {progress.totals.edges} edges
                </span>
                {!running && <span className="font-semibold text-foreground">Done</span>}
              </>
            ) : (
              <span>Queued…</span>
            )}
          </p>
        </div>
      )}
    </Panel>
  );
}

interface DayFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  disabled: boolean;
}

function DayField({ label, value, onChange, min, max, disabled }: DayFieldProps) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold text-muted-foreground">
      {label}
      <Input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || min)))}
        className="h-10 w-24 rounded-xl text-sm font-semibold tabular-nums"
      />
    </label>
  );
}
