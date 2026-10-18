"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import type { AgentStep } from "@/hooks/use-ask";
import { api, type QueryEntry, type QueryRegistry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { stepOutcome, stepSubject } from "./step-format";

/** The query registry is the same for every answer: fetched once per page load. */
let registry: Promise<QueryRegistry | null> | null = null;
function loadRegistry(): Promise<QueryRegistry | null> {
  registry ??= api.queries().catch(() => {
    registry = null;
    return null;
  });
  return registry;
}

/**
 * The tools the agent used, one compact line each: "who_knows Schema Registry · 5 experts, 8 sources".
 * "Cypher" opens the queries that tool ran in FalkorDB, exactly as the API runs them.
 */
export function StepList({ steps }: { steps: AgentStep[] }) {
  const [queries, setQueries] = useState<QueryRegistry | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    void loadRegistry().then((value) => alive && setQueries(value));
    return () => {
      alive = false;
    };
  }, []);

  if (steps.length === 0) return null;
  return (
    <ol className="space-y-1.5 rounded-xl bg-surface px-3.5 py-2.5">
      {steps.map((step, index) => {
        const entries = (queries?.tools[step.name] ?? []).flatMap((id) => (queries?.queries[id] ? [queries.queries[id]] : []));
        return (
          <li key={index} className="text-xs">
            <div className="flex items-start gap-2">
              {step.result ? (
                <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Done" />
              ) : (
                <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Running" />
              )}
              <span className="min-w-0 flex-1">
                <span className="code-id font-semibold">{step.name}</span>
                {stepSubject(step) && <span className="ml-1.5 font-semibold">{stepSubject(step)}</span>}
                {step.result && <span className="text-muted-foreground"> · {stepOutcome(step)}</span>}
              </span>
              {entries.length > 0 && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen((current) => (current === index ? null : index));
                  }}
                  aria-expanded={open === index}
                  title="The Cypher this tool ran in FalkorDB"
                  className={cn(
                    "shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground",
                    open === index && "bg-foreground/5 text-foreground",
                  )}
                >
                  Cypher
                </button>
              )}
            </div>
            {open === index && <CypherBlocks entries={entries} />}
          </li>
        );
      })}
    </ol>
  );
}

function CypherBlocks({ entries }: { entries: QueryEntry[] }) {
  return (
    <div className="mt-2 space-y-2 pl-5" onClick={(event) => event.stopPropagation()}>
      {entries.map((query) => (
        <figure key={query.id}>
          <figcaption className="mb-1 text-[11px] text-muted-foreground">
            <span className="code-id font-semibold text-foreground">{query.id}</span> {query.title} · <span className="code-id">{query.file}</span>
          </figcaption>
          <pre className="max-h-56 overflow-auto rounded-lg border bg-background px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre">{query.cypher}</pre>
        </figure>
      ))}
    </div>
  );
}
