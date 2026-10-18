import { ChevronRight, FileClock, GitBranch, Siren, TriangleAlert, UserMinus, UserSearch } from "lucide-react";
import { KeystoneIcon } from "@/components/shell/brand-mark";
import type { DirectoryKind } from "./slash-commands";

/**
 * A question with one gap for a person or a system. Picking the template puts the
 * question in the box with "/people" or "/systems" in the gap, which opens that list.
 */
export interface Template {
  before: string;
  slot: DirectoryKind;
  /** Starts with a space, so the caret sits in the gap and the picked name needs none. */
  after: string;
}

/** Example questions, one per kind of question the agent handles, in two columns of three. */
const EXAMPLES = [
  { label: "Who knows a system", description: "Pick a system, see its experts", template: { before: "Who knows ", slot: "systems", after: " best, and how do we know?" }, icon: UserSearch },
  { label: "If someone leaves", description: "Pick a person, see what breaks", template: { before: "What happens if ", slot: "people", after: " leaves?" }, icon: UserMinus },
  { label: "Single points of failure", description: "Pick a system, see who it hangs on", template: { before: "Does ", slot: "systems", after: " depend on a single person?" }, icon: TriangleAlert },
  { label: "Why it works this way", description: "Pick a system, trace its decisions", template: { before: "Why does ", slot: "systems", after: " work the way it does? Trace the decisions behind it." }, icon: GitBranch },
  { label: "Out-of-date pages", description: "Pick a system, find its stale docs", template: { before: "Which pages about ", slot: "systems", after: " are out of date?" }, icon: FileClock },
  { label: "Someone's incidents", description: "Pick a person, trace what happened", template: { before: "Which incidents was ", slot: "people", after: " involved in, and what happened?" }, icon: Siren },
] as const satisfies readonly { label: string; description: string; template: Template; icon: typeof UserSearch }[];

/**
 * The empty chat (Intake's chat empty state): what Keystone does, and questions to
 * start with. Each one asks for a person or a system, picked from the list it opens.
 */
export function Suggestions({ onPick }: { onPick: (template: Template) => void }) {
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
        {EXAMPLES.map(({ label, description, template, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => onPick(template)}
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
