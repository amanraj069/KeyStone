import { ChevronRight, FileClock, Network, Siren, TriangleAlert, UserMinus, UserSearch } from "lucide-react";
import { KeystoneIcon } from "@/components/shell/brand-mark";

/** Example questions, one per kind of question the agent handles, in two columns of three. */
const EXAMPLES = [
  { label: "Who knows a system", description: "Schema Registry's experts, with evidence", prompt: "Who knows Schema Registry best, and how do we know?", icon: UserSearch },
  { label: "If someone leaves", description: "What breaks when Jax goes", prompt: "What happens if Jax leaves?", icon: UserMinus },
  { label: "Single points of failure", description: "Systems that hang on one person", prompt: "Which systems depend on a single person?", icon: TriangleAlert },
  { label: "Who connects teams", description: "The people teams talk through", prompt: "Who connects the most teams?", icon: Network },
  { label: "Out-of-date pages", description: "Docs that state a replaced decision", prompt: "Which Confluence pages are out of date?", icon: FileClock },
  { label: "Trace an incident", description: "What happened on Day 8, and who was in it", prompt: "What happened in the incident on Day 8 involving Jax and Kaitlyn?", icon: Siren },
] as const;

/**
 * The empty chat (Intake's chat empty state): what Keystone does, and questions to
 * start with. Picking one puts it in the composer, to edit or send as it is.
 */
export function Suggestions({ onPick }: { onPick: (question: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl border border-foreground/10 bg-card text-foreground shadow-card">
        <KeystoneIcon className="size-7" />
      </span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight">What do you want to know?</h1>
      <p className="mt-2 max-w-sm text-sm leading-relaxed font-light text-muted-foreground">
        Answers come from Apex&apos;s company graph, and every claim cites the document it came from.
      </p>

      <div className="mt-8 grid w-full max-w-3xl grid-cols-1 gap-3 text-left sm:grid-cols-2 sm:gap-3.5">
        {EXAMPLES.map(({ label, description, prompt, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => onPick(prompt)}
            className="group flex items-center gap-4 rounded-2xl border border-foreground/10 bg-card px-5 py-3.5 shadow-card transition-all duration-200 ease-out hover:scale-[1.02] hover:border-foreground/25 hover:shadow-raised active:scale-[0.98]"
          >
            <Icon className="size-5 shrink-0 text-foreground/80 transition-colors group-hover:text-foreground" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">{label}</span>
              <span className="mt-0.5 block truncate text-xs font-light text-muted-foreground">{description}</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform duration-150 ease-out group-hover:translate-x-1" />
          </button>
        ))}
      </div>
      <p className="mt-5 text-xs font-light text-faint">
        Type <kbd className="kbd">/</kbd> in the box to mention a person or system.
      </p>
    </div>
  );
}
