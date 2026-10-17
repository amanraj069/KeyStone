import { Check, LoaderCircle } from "lucide-react";
import type { AgentStep } from "@/hooks/use-ask";
import { stepOutcome, stepSubject } from "./step-format";

/** The tools the agent used, one compact line each: "who_knows Schema Registry · 5 experts, 8 sources". */
export function StepList({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="space-y-1.5 rounded-xl bg-surface px-3.5 py-2.5">
      {steps.map((step, index) => (
        <li key={index} className="flex items-start gap-2 text-xs">
          {step.result ? (
            <Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Done" />
          ) : (
            <LoaderCircle className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Running" />
          )}
          <span className="min-w-0">
            <span className="code-id font-semibold">{step.name}</span>
            {stepSubject(step) && <span className="ml-1.5 font-semibold">{stepSubject(step)}</span>}
            {step.result && <span className="font-light text-muted-foreground"> · {stepOutcome(step)}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
