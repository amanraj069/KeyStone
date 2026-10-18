"use client";

import { useEffect, useState } from "react";
import type { HealthResponse } from "@keystone/shared";
import { Panel, PanelHeading } from "@/components/ui/panel";
import { API_BASE_URL, api } from "@/lib/api";
import { StatusPill, type PillState } from "./status-pill";

const POLL_MS = 5_000;

/** Polls GET /health every few seconds and shows one pill per service. */
export function HealthStatus() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [apiState, setApiState] = useState<PillState>("checking");

  useEffect(() => {
    const controller = new AbortController();

    async function poll() {
      try {
        setHealth(await api.health(controller.signal));
        setApiState("up");
      } catch {
        if (controller.signal.aborted) return;
        setHealth(null);
        setApiState("down");
      }
    }

    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, []);

  // If the API itself is down we cannot know the others, so they show "down" too.
  const falkorState: PillState = health ? health.falkordb : apiState === "checking" ? "checking" : "down";
  const redisState: PillState = health ? health.redis : apiState === "checking" ? "checking" : "down";

  return (
    <Panel className="p-5 sm:p-6">
      <PanelHeading
        title="System status"
        description={
          <>
            Live from <code className="code-id">{API_BASE_URL}/health</code>, refreshed every {POLL_MS / 1000}s.
          </>
        }
      />
      <div className="mt-5 flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <StatusPill label="API" state={apiState} />
          <StatusPill label="FalkorDB" state={falkorState} />
          <StatusPill label="Redis" state={redisState} />
        </div>
        {health?.memory && (
          <div className="text-sm text-muted-foreground">
            <p>
              FalkorDB memory: <span className="font-mono text-foreground">{health.memory.usedMemoryHuman ?? "n/a"}</span>
            </p>
            {health.memory.graphs.length > 0 && (
              <ul className="mt-1 list-inside list-disc">
                {health.memory.graphs.map((graph) => (
                  <li key={graph.graph}>
                    <span className="font-mono">{graph.graph}</span>:{" "}
                    {graph.totalMb === null ? "n/a" : `${graph.totalMb} MB`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}
