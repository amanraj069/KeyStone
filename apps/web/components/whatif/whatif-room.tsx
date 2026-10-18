"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ActionRow, DepartureSimulation, HandoverPlan } from "@keystone/shared";
import { ClipboardList, LoaderCircle, UserMinus } from "lucide-react";
import { ArtifactSheet } from "@/components/artifact-sheet";
import { GraphCanvas } from "@/components/graph-canvas";
import { PageHeader } from "@/components/page-header";
import { RoomContainer } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { OptionPills } from "@/components/ui/option-pills";
import { Panel } from "@/components/ui/panel";
import { ErrorState, SkeletonRows } from "@/components/ui/states";
import { useApi } from "@/hooks/use-api";
import { BEAT_MS, useDepartureBeats } from "@/hooks/use-departure-beats";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { departureCanvas, departureKeys } from "@/lib/whatif";
import { ApproveAll, HandoverChecklist } from "./handover-checklist";
import { ImpactPreview } from "./impact-preview";
import { ImpactReport } from "./impact-report";
import { PersonPicker } from "./person-picker";
import { Timings } from "./timings";

type Run<T> = { status: "idle" } | { status: "running" } | { status: "done"; value: T } | { status: "error"; message: string };

const BEATS = ["", "leaves the graph", "systems at risk", "suggested new owners"] as const;

/**
 * What-if: pick a person, see the graph around them, simulate their departure (three
 * animated beats), read the impact, and draft a handover plan to approve item by item.
 */
export function WhatIfRoom() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const candidates = useApi((signal) => api.candidates(signal), []);
  const people = useApi((signal) => api.people(signal), []);

  // The person is in the URL (?person=), so a departure can be linked to; the top candidate by default.
  const person = params.get("person") ?? candidates.data?.[0]?.person ?? null;
  const select = (name: string) => router.replace(`${pathname}?person=${encodeURIComponent(name)}`, { scroll: false });

  const before = useApi(person ? (signal) => api.beforeGraph(person, signal) : null, [person]);
  const [simulation, setSimulation] = useState<Run<DepartureSimulation>>({ status: "idle" });
  const [plan, setPlan] = useState<Run<HandoverPlan>>({ status: "idle" });
  const [tab, setTab] = useState<"impact" | "plan">("impact");
  const [openArtifact, setOpenArtifact] = useState<string | null>(null);

  // A new person starts from their before-graph.
  useEffect(() => {
    setSimulation({ status: "idle" });
    setPlan({ status: "idle" });
    setTab("impact");
  }, [person]);

  const result = simulation.status === "done" && simulation.value.person === person ? simulation.value : null;
  const beforeGraph = before.data?.person === person ? before.data : null;
  const canvas = useMemo(
    () => (result ? departureCanvas(result.graph, result) : beforeGraph ? departureCanvas(beforeGraph.graph, null) : { nodes: [], edges: [] }),
    [result, beforeGraph],
  );
  const keys = useMemo(() => (result ? departureKeys(result) : null), [result]);
  const beats = useDepartureBeats(keys);

  const simulate = async () => {
    if (!person) return;
    setSimulation({ status: "running" });
    try {
      setSimulation({ status: "done", value: await api.simulateDeparture(person) });
    } catch (error) {
      setSimulation({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const draft = async () => {
    if (!person) return;
    setPlan({ status: "running" });
    setTab("plan");
    try {
      setPlan({ status: "done", value: await api.draftHandover(person) });
    } catch (error) {
      setPlan({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const updateItem = (action: ActionRow) =>
    setPlan((current) =>
      current.status === "done"
        ? { status: "done", value: { ...current.value, children: current.value.children.map((c) => (c.id === action.id ? action : c)) } }
        : current,
    );

  const info = people.data?.find((p) => p.name === person);
  const candidate = candidates.data?.find((c) => c.person === person) ?? null;

  return (
    <RoomContainer>
      <PageHeader
        eyebrow={info?.dept ? info.dept.replace(/_/g, " ") : undefined}
        title={person ? `If ${person} leaves` : "If someone leaves"}
        description={
          <div className="min-h-[1.25rem]">
            {result ? (
              <Timings timings={result.timingsMs} memoryMb={result.scratchGraphMemoryMb} />
            ) : beforeGraph ? (
              `The ${beforeGraph.graph.nodes.length} people, systems and tickets around them.`
            ) : null}
          </div>
        }
        action={
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" className="w-full sm:w-auto" disabled={!result || plan.status === "running"} onClick={() => void draft()}>
              <ClipboardList data-icon="inline-start" />
              {plan.status === "running" ? "Drafting…" : "Draft handover plan"}
            </Button>
            <Button className="w-full sm:w-auto" onClick={() => void simulate()} disabled={!person || simulation.status === "running" || !beforeGraph}>
              {simulation.status === "running" ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : <UserMinus data-icon="inline-start" />}
              {simulation.status === "running" ? "Simulating…" : result ? "Simulate again" : "Simulate departure"}
            </Button>
          </div>
        }
      />

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]">
        <Panel className="h-72 overflow-hidden sm:h-80 lg:h-auto" aria-label="People">
          <PersonPicker candidates={candidates.data} people={people.data} selected={person} onSelect={select} error={candidates.error ?? people.error} />
        </Panel>

        <Panel className="relative flex min-h-[55dvh] flex-col overflow-hidden sm:min-h-[60dvh] lg:min-h-0" aria-label="Departure graph">
          <GraphCanvas
            className="flex-1"
            nodes={canvas.nodes}
            edges={canvas.edges}
            fadedIds={beats.faded}
            redIds={beats.red}
            redLabel="No expert left"
            pulseIds={beats.pulse}
            highlightedIds={beats.highlighted}
            animationMs={beats.beat === 1 ? BEAT_MS : 300}
            emptyHint={
              before.error ?? (before.loading ? "Loading the graph around them…" : person ? `${person} is not an expert on any core system and has no open tickets.` : "Pick a person.")
            }
          />
          <BeatCaption beat={beats.beat} person={person} />
          {simulation.status === "error" && <ErrorState className="absolute inset-x-4 top-4" message={simulation.message} onRetry={() => void simulate()} />}
        </Panel>

        <Panel className="flex min-h-0 flex-col overflow-hidden" aria-label="Impact">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5 sm:py-3.5">
            {plan.status === "idle" ? (
              <h2 className="text-[15px] font-semibold tracking-tight">Impact</h2>
            ) : (
              <OptionPills
                label="Report"
                options={[
                  { value: "impact", label: "Impact" },
                  { value: "plan", label: "Handover plan" },
                ]}
                value={tab}
                onChange={setTab}
              />
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-5">
            {tab === "impact" ? (
              simulation.status === "running" ? (
                <SkeletonRows count={6} rowClassName="h-14" />
              ) : result ? (
                <ImpactReport simulation={result} onOpenArtifact={setOpenArtifact} />
              ) : (
                <ImpactPreview
                  person={person}
                  candidate={candidate}
                  disabled={!person || !beforeGraph}
                  onSimulate={() => void simulate()}
                  onOpenArtifact={setOpenArtifact}
                />
              )
            ) : plan.status === "running" ? (
              <SkeletonRows count={6} rowClassName="h-16" />
            ) : plan.status === "error" ? (
              <ErrorState message={plan.message} onRetry={() => void draft()} />
            ) : plan.status === "done" ? (
              <HandoverChecklist plan={plan.value} onChange={updateItem} onOpenArtifact={setOpenArtifact} />
            ) : null}
          </div>
          {tab === "plan" && plan.status === "done" && plan.value.children.some((c) => c.status === "proposed") && (
            <div className="border-t p-4">
              <ApproveAll items={plan.value.children} onChange={updateItem} />
            </div>
          )}
        </Panel>
      </div>
      <ArtifactSheet artifactId={openArtifact} onClose={() => setOpenArtifact(null)} />
    </RoomContainer>
  );
}

/** Names the beat that is playing, so the animation reads as a sentence. */
function BeatCaption({ beat, person }: { beat: number; person: string | null }) {
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap gap-1.5 sm:inset-x-auto sm:top-4 sm:left-4" aria-live="polite">
      {[1, 2, 3].map((n) => (
        <span
          key={n}
          className={cn(
            "rounded-full border bg-card/85 px-2 py-0.5 text-[11px] font-medium shadow-raised sm:px-2.5 sm:py-1 sm:text-xs backdrop-blur-md transition-all duration-500 ease-out-expo",
            beat >= n ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0",
          )}
        >
          <span className={n === 1 ? "text-muted-foreground" : "text-signal"}>{n}</span>{" "}
          {n === 1 ? `${person ?? ""} ${BEATS[1]}` : BEATS[n]}
        </span>
      ))}
    </div>
  );
}
