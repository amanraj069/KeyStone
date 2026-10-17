"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AnalyticsSummary, IngestEvent, IngestProgress } from "@keystone/shared";
import { useApi } from "@/hooks/use-api";
import { api, subscribeIngest, type ViewGraph } from "@/lib/api";

/** The replay job the top bar and Org Pulse follow. */
export interface ReplayState {
  jobId: string;
  running: boolean;
  /** The latest progress event, null until the first one arrives. */
  progress: IngestProgress | null;
  failedReason: string | null;
}

interface LiveGraphValue {
  /** The graph Org Pulse shows: the full company (apex) or the replay (apex_replay). */
  graph: ViewGraph;
  setGraph: (graph: ViewGraph) => void;
  summary: AnalyticsSummary | null;
  summaryError: string | null;
  /** Goes up every time new days land in the shown graph: pages refetch on it. */
  revision: number;
  replay: ReplayState | null;
  /** Called after POST /ingest/replay: follow this job and show the replay graph. */
  followReplay: (jobId: string) => void;
}

const LiveGraphContext = createContext<LiveGraphValue | null>(null);

/** Refetch at most this often while a replay streams progress. */
const REFRESH_DEBOUNCE_MS = 700;

/**
 * Follows GET /ingest/events once for the whole app: the top bar's live dot and day,
 * and Org Pulse's tiles, refresh as replayed days arrive.
 */
export function LiveGraphProvider({ children }: { children: ReactNode }) {
  const [graph, setGraph] = useState<ViewGraph>("apex");
  const [revision, setRevision] = useState(0);
  const [replay, setReplay] = useState<ReplayState | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const summary = useApi((signal) => api.summary(graph, signal), [graph, revision]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      setRevision((r) => r + 1);
    }, REFRESH_DEBOUNCE_MS);
  }, []);

  // A replay may already be running when the page opens.
  useEffect(() => {
    const controller = new AbortController();
    api
      .activeJobs(controller.signal)
      .then((jobs) => {
        const running = jobs.find((job) => job.name === "replay");
        if (running) setReplay({ jobId: running.jobId, running: true, progress: running.progress, failedReason: null });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const onEvent = (event: IngestEvent) => {
      if (event.type === "progress") {
        if (event.progress.kind !== "replay") return;
        setReplay({ jobId: event.jobId, running: true, progress: event.progress, failedReason: null });
        // A day (or a step of one) has landed: refresh what is on screen, debounced.
        scheduleRefresh();
        return;
      }
      setReplay((current) => {
        if (!current || current.jobId !== event.jobId) return current;
        return { ...current, running: false, failedReason: event.type === "failed" ? event.reason : null };
      });
      scheduleRefresh();
    };
    const close = subscribeIngest(onEvent);
    return () => {
      close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [scheduleRefresh]);

  const followReplay = useCallback((jobId: string) => {
    setReplay({ jobId, running: true, progress: null, failedReason: null });
    setGraph("apex_replay");
  }, []);

  return (
    <LiveGraphContext.Provider
      value={{
        graph,
        setGraph,
        summary: summary.data && summary.data.graph === graph ? summary.data : null,
        summaryError: summary.error,
        revision,
        replay,
        followReplay,
      }}
    >
      {children}
    </LiveGraphContext.Provider>
  );
}

export function useLiveGraph(): LiveGraphValue {
  const value = useContext(LiveGraphContext);
  if (!value) throw new Error("useLiveGraph must be used inside LiveGraphProvider");
  return value;
}
