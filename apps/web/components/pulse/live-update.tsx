"use client";

import { useState, type ReactNode } from "react";
import type { LiveEvent, LivePost, LiveResult, LiveStep } from "@keystone/shared";
import { Check, Info, LoaderCircle, RotateCcw, Send, Signpost, UserMinus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OptionPills } from "@/components/ui/option-pills";
import { Panel, PanelHeading } from "@/components/ui/panel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLiveGraph } from "@/contexts/live-graph";
import { useAdminToken } from "@/hooks/use-admin-token";
import { useApi } from "@/hooks/use-api";
import { api, ApiError, postLive } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RISK_COPY } from "./risk";

const STEP_NAME: Record<LiveStep, string> = {
  ingest: "Read into the graph",
  extract: "Systems and decisions",
  embed: "Searchable",
  refresh: "Expertise and risk",
  diff: "What changed",
};

const TYPES = [
  { value: "slack", label: "Slack message" },
  { value: "confluence", label: "Page" },
] as const;

const MAX_LENGTH = 4000;

/** Two ready-made updates for a demo: a decision that makes a page stale, and a departure. */
const PRESETS: { label: string; description: string; icon: LucideIcon; post: LivePost }[] = [
  {
    label: "Undo the TitanDB pool cut",
    description: "A decision that makes a postmortem page stale",
    icon: Signpost,
    post: {
      type: "slack",
      author: "Jax",
      channel: "incidents",
      text:
        "Decision after the ENG-165 postmortem: we are reverting the TitanDB RDS max_pool_size change. The cut from 200 to 80 caused " +
        "the connection exhaustion, so max_pool_size goes back to 200 today, and from next sprint TitanDB connections go through RDS Proxy.",
    },
  },
  {
    label: "Priya is leaving",
    description: "A departure that orphans her systems",
    icon: UserMinus,
    post: { type: "slack", author: "Jax", channel: "digital-hq", text: "Heads up everyone: Priya's last day is today. Thank you Priya for all the TitanDB work!" },
  },
];

type StepState = { status: "start" | "done"; ms?: number; detail?: string };

/**
 * "Something changed": post a Slack message or a page now. It goes through the same
 * ingest and extraction as the company's documents, then Org Pulse refreshes and the
 * card shows what the graph learned: decisions replaced, pages now out of date,
 * systems whose risk moved, people who left. Undo removes every live update.
 */
export function LiveUpdate() {
  const { refresh } = useLiveGraph();
  const people = useApi((signal) => api.people(signal), []);
  const { token, setToken, needed, setNeeded } = useAdminToken();
  const [activePreset, setActivePreset] = useState<number | null>(0);
  const [post, setPost] = useState<LivePost>(PRESETS[0].post);
  const [steps, setSteps] = useState<Partial<Record<LiveStep, StepState>>>({});
  const [result, setResult] = useState<LiveResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undone, setUndone] = useState<string | null>(null);

  const authors = (people.data ?? []).filter((p) => p.active).map((p) => p.name);
  // Editing by hand means the post no longer matches a preset.
  const change = (patch: Partial<LivePost>) => {
    setActivePreset(null);
    setPost((current) => ({ ...current, ...patch }));
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setUndone(null);
    setSteps({});
    try {
      await postLive(
        post,
        (event: LiveEvent) => {
          if (event.type === "step") setSteps((s) => ({ ...s, [event.step]: { status: event.status, ms: event.ms, detail: event.detail } }));
          else if (event.type === "done") setResult(event.result);
          else setError(event.message);
        },
        token || undefined,
      );
      setNeeded(false);
      refresh();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) setNeeded(true);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      const done = await api.resetLive(token || undefined);
      setUndone(`Removed ${done.deleted} live nodes${done.departuresUndone.length ? `; ${done.departuresUndone.join(", ")} back` : ""}.`);
      setResult(null);
      setSteps({});
      refresh();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) setNeeded(true);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  const hasSteps = Object.keys(steps).length > 0;
  const canPost = !busy && post.text.trim().length >= 10;

  return (
    <Panel className="p-5 sm:p-8">
      <PanelHeading
        title="Something changed? Post an update"
        description="Keystone reads it like any other document, then shows what it learned."
        action={
          <div className="flex items-center gap-1">
            <HowItWorks />
            <Button size="xs" variant="ghost" disabled={busy} onClick={() => void undo()} title="Remove every live update">
              <RotateCcw data-icon="inline-start" />
              Undo live updates
            </Button>
          </div>
        }
      />

      {/* ── Presets ────────────────────────────────────────── */}
      <div className="mt-6">
        <p className="section-label mb-2">Start from an example</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PRESETS.map((preset, i) => (
            <PresetCard
              key={preset.label}
              preset={preset}
              selected={activePreset === i}
              onSelect={() => {
                setActivePreset(i);
                setPost(preset.post);
              }}
            />
          ))}
        </div>
      </div>

      {/* ── Composer: toolbar, text, footer in one box ─────── */}
      <form
        className="mt-4 overflow-hidden rounded-xl border bg-surface transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/20"
        onSubmit={(event) => {
          event.preventDefault();
          if (canPost) void run();
        }}
      >
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b px-2 py-2">
          <OptionPills label="Kind" options={TYPES} value={post.type} onChange={(type) => change({ type })} />
          <span aria-hidden className="mx-2 hidden h-4 w-px bg-border sm:block" />
          <ToolbarField label="From">
            <select
              aria-label="Author"
              value={post.author}
              onChange={(event) => change({ author: event.target.value })}
              className="h-7 cursor-pointer rounded-md bg-transparent pr-1 pl-1.5 text-xs font-medium outline-none hover:bg-hover"
            >
              {[post.author, ...authors.filter((a) => a !== post.author)].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </ToolbarField>
          {post.type === "slack" ? (
            <ToolbarField label="In">
              <span className="flex h-7 items-center rounded-md pl-1.5 text-xs font-medium hover:bg-hover">
                <span className="text-faint">#</span>
                <input
                  aria-label="Channel"
                  value={post.channel ?? ""}
                  onChange={(e) => change({ channel: e.target.value.replace(/^#/, "") || undefined })}
                  placeholder="channel"
                  className="h-full w-28 bg-transparent pr-1.5 pl-0.5 outline-none placeholder:text-faint"
                />
              </span>
            </ToolbarField>
          ) : (
            <ToolbarField label="Title" className="min-w-48 flex-1">
              <input
                aria-label="Title"
                value={post.title ?? ""}
                onChange={(e) => change({ title: e.target.value })}
                placeholder="Page title"
                className="h-7 w-full rounded-md bg-transparent px-1.5 text-xs font-medium outline-none placeholder:text-faint hover:bg-hover"
              />
            </ToolbarField>
          )}
        </div>

        <textarea
          aria-label="Text"
          value={post.text}
          onChange={(e) => change({ text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
          rows={3}
          maxLength={MAX_LENGTH}
          placeholder={post.type === "slack" ? "Write a message…" : "Write the page…"}
          className="block field-sizing-content min-h-24 w-full resize-none bg-card px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-faint"
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2.5">
          <p className="flex items-center gap-3 text-[11px] text-faint">
            <span className="tabular-nums">
              {post.text.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
            </span>
            <span className="hidden items-center gap-1 sm:flex">
              <kbd className="kbd">⌘</kbd>
              <kbd className="kbd">↵</kbd>
              to post
            </span>
          </p>
          <div className="flex items-center gap-2">
            {needed && (
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Admin token"
                autoComplete="off"
                className="h-8 w-40 text-xs"
                aria-label="Admin token"
              />
            )}
            <Button type="submit" size="sm" disabled={!canPost}>
              {busy ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <Send data-icon="inline-start" />}
              {busy ? "Posting…" : "Post update"}
            </Button>
          </div>
        </div>
      </form>

      {(error || undone) && (
        <p className={cn("mt-3 text-xs", error ? "text-destructive" : "text-muted-foreground")}>{error ?? undone}</p>
      )}

      {/* ── Progress + result, only once something was posted ── */}
      {(hasSteps || result) && (
        <div className="mt-8 space-y-8 border-t pt-6">
          {hasSteps && <StepTrack steps={steps} />}
          {result && <LiveResultView result={result} />}
        </div>
      )}
    </Panel>
  );
}

function PresetCard({
  preset,
  selected,
  onSelect,
}: {
  preset: (typeof PRESETS)[number];
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = preset.icon;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left transition-[background-color,border-color,box-shadow] duration-200",
        selected ? "border-input bg-card shadow-raised" : "bg-surface hover:border-input hover:bg-card",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors",
          selected ? "bg-foreground/[0.06] text-foreground" : "text-muted-foreground group-hover:text-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{preset.label}</span>
        <span className="block truncate text-xs text-muted-foreground">{preset.description}</span>
      </span>
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
          selected && "border-foreground bg-foreground text-background",
        )}
      >
        {selected && <Check className="size-2.5" strokeWidth={3} />}
      </span>
    </button>
  );
}

/** A quiet label and its control in the composer toolbar ("From Jax", "In #incidents"). */
function ToolbarField({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <span className={cn("flex items-center gap-0.5 pl-1.5 text-xs", className)}>
      <span className="text-faint">{label}</span>
      {children}
    </span>
  );
}

/** The ⓘ button: what this panel does, kept out of the layout until asked for. */
function HowItWorks() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="How live updates work">
          <Info />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-xs">
        <p className="text-sm font-semibold">How live updates work</p>
        <ol className="mt-3 space-y-2.5">
          <HowStep n={1}>Pick an example, or write your own Slack message or page.</HowStep>
          <HowStep n={2}>
            Click <strong className="font-semibold text-foreground">Post update</strong>. It is read like every other document:{" "}
            {Object.values(STEP_NAME).join(" → ").toLowerCase()}.
          </HowStep>
          <HowStep n={3}>Keystone shows what it learned: decisions replaced, pages now out of date, systems at risk, people who left.</HowStep>
        </ol>
        <p className="mt-3 border-t pt-3 text-muted-foreground">
          <strong className="font-medium text-foreground">Undo live updates</strong> removes every live post and resets the graph.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function HowStep({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/5 text-[11px] font-semibold tabular-nums">{n}</span>
      <span className="leading-relaxed text-muted-foreground">{children}</span>
    </li>
  );
}

/** The five pipeline steps as one segmented bar: each segment fills as its step runs and finishes. */
function StepTrack({ steps }: { steps: Partial<Record<LiveStep, StepState>> }) {
  const order = Object.keys(STEP_NAME) as LiveStep[];
  const completed = order.filter((step) => steps[step]?.status === "done").length;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="section-label">Processing</p>
        <span className="text-xs tabular-nums text-muted-foreground">
          {completed} of {order.length}
        </span>
      </div>
      <ol className="grid gap-x-2 gap-y-4 sm:grid-cols-5">
        {order.map((step) => {
          const state = steps[step];
          const done = state?.status === "done";
          return (
            <li key={step} title={state?.detail} className="min-w-0">
              <div className="h-1 overflow-hidden rounded-full bg-foreground/[0.07]">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width,background-color] duration-500 ease-out",
                    done ? "w-full bg-emerald-500" : state ? "w-1/2 animate-pulse bg-foreground/40" : "w-0",
                  )}
                />
              </div>
              <p className={cn("mt-2.5 flex items-center gap-1.5 text-xs font-medium", !state && "text-faint")}>
                {done ? (
                  <Check className="size-3 shrink-0 text-emerald-500" strokeWidth={3} />
                ) : state ? (
                  <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground" />
                ) : null}
                <span className="truncate">{STEP_NAME[step]}</span>
              </p>
              <p className="mt-0.5 truncate text-[11px] text-faint tabular-nums">
                {state?.ms !== undefined ? `${(state.ms / 1000).toFixed(1)} s` : state ? "Running" : "Waiting"}
                {state?.detail ? ` · ${state.detail}` : ""}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** What the graph learned from one live document. */
function LiveResultView({ result }: { result: LiveResult }) {
  const moved = result.riskChanges.filter((c) => c.after === "orphaned" || c.after === "critical");
  const nothing =
    result.decisions.length === 0 && result.newlyStale.length === 0 && moved.length === 0 && result.newlyInactive.length === 0;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="section-label">What changed</p>
        <p className="text-[11px] text-faint">
          <span className="code-id">{result.id}</span> · day {result.day ?? "?"} · {result.systems.slice(0, 4).join(", ") || "no known system"} ·{" "}
          <span className="tabular-nums">{(result.ms / 1000).toFixed(1)} s</span>
        </p>
      </div>
      {nothing ? (
        <p className="rounded-lg border bg-surface px-4 py-3 text-xs text-muted-foreground">
          Stored and searchable; it changed no decision, page or risk.
        </p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {result.decisions.length > 0 && (
            <Section title={`Decisions recorded · ${result.decisions.length}${result.supersedes ? `, replacing ${result.supersedes} earlier` : ""}`}>
              {result.decisions.map((d) => (
                <li key={d.id}>{d.summary}</li>
              ))}
            </Section>
          )}
          {result.newlyStale.length > 0 && (
            <Section title="Now out of date" tone="signal">
              {result.newlyStale.map((doc) => (
                <li key={`${doc.stalePage}-${doc.outdatedId}`}>
                  <span className="font-semibold">{doc.pageTitle ?? doc.stalePage}</span> still says &ldquo;{doc.outdatedClaim}&rdquo;
                </li>
              ))}
            </Section>
          )}
          {result.newlyInactive.length > 0 && (
            <Section title="Left the company" tone="signal">
              <li>{result.newlyInactive.join(", ")}: their knowledge is now at risk.</li>
            </Section>
          )}
          {moved.length > 0 && (
            <Section title={`Systems now at risk · ${moved.length}`} tone="signal">
              {moved.slice(0, 6).map((c) => (
                <li key={c.system}>
                  <span className="font-semibold">{c.system}</span>: {c.before ? RISK_COPY[c.before].tab.toLowerCase() : "new"} →{" "}
                  {c.after ? RISK_COPY[c.after].tab.toLowerCase() : "gone"}
                  {c.expertsAfter.length > 0 ? ` (only ${c.expertsAfter.join(", ")})` : " (nobody left)"}
                </li>
              ))}
              {moved.length > 6 && <li className="text-muted-foreground">and {moved.length - 6} more</li>}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone?: "signal"; children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-surface px-4 py-3">
      <p className={cn("mb-1.5 flex items-center gap-1.5 text-xs font-medium", tone === "signal" ? "text-signal" : "text-muted-foreground")}>
        {tone === "signal" && <span aria-hidden className="size-1.5 rounded-full bg-signal" />}
        {title}
      </p>
      <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed marker:text-faint">{children}</ul>
    </div>
  );
}
