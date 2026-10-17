import { ArrowRight } from "lucide-react";
import { KeystoneIcon } from "@/components/shell/brand-mark";
import { cn } from "@/lib/utils";

/** Example questions, one per kind of question the agent handles. */
export const EXAMPLES = [
  { label: "Who knows a system", description: "Schema Registry's experts, with evidence", prompt: "Who knows Schema Registry best, and how do we know?" },
  { label: "If someone leaves", description: "What breaks when Jax goes", prompt: "What happens if Jax leaves?" },
  { label: "Single points of failure", description: "Systems that hang on one person", prompt: "Which systems depend on a single person?" },
  { label: "Who connects teams", description: "The people teams talk through", prompt: "Who connects the most teams?" },
  { label: "Out-of-date pages", description: "Docs that state a replaced decision", prompt: "Which Confluence pages are out of date?" },
] as const;

/** The empty conversation (Intake's chat empty state): what Keystone does, and questions to start with. */
export function Suggestions({ onPick, disabled }: { onPick: (question: string) => void; disabled: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-2 py-8 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-card text-primary shadow-sm dark:text-foreground">
        <KeystoneIcon className="size-6" />
      </span>
      <h2 className="mt-4 text-xl font-semibold tracking-tight">What do you want to know?</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed font-light text-muted-foreground">
        Answers come from Apex&apos;s company graph, and every claim cites the document it came from.
      </p>
      <div className="mt-8 grid w-full max-w-2xl gap-2.5 text-left sm:grid-cols-2">
        {EXAMPLES.map(({ label, description, prompt }, index) => (
          <button
            key={label}
            type="button"
            disabled={disabled}
            onClick={() => onPick(prompt)}
            className={cn(
              "group flex items-center gap-4 rounded-2xl border bg-card/80 px-5 py-3.5 text-left transition-all duration-200 hover:scale-[1.015] hover:shadow-md active:scale-[0.98] disabled:opacity-50",
              index === EXAMPLES.length - 1 && "sm:col-span-2",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">{label}</span>
              <span className="block truncate text-xs font-light text-muted-foreground">{description}</span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:translate-x-1" />
          </button>
        ))}
      </div>
    </div>
  );
}
