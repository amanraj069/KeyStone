import type { ActionRow } from "@keystone/shared";

/** "Title of the ticket … → Deepa": the title truncates, the assignee is always visible. */
export function ActionLine({ action }: { action: ActionRow }) {
  const named = action.targetType === "System" || action.targetType === "Person";
  const title = (!named && action.targetTitle) || action.target || "?";
  return (
    <p className="flex min-w-0 items-baseline gap-1.5 text-sm">
      <span className="min-w-0 truncate" title={title}>
        {title}
      </span>
      <span className="shrink-0 text-muted-foreground">→ {action.assignee ?? "no one found"}</span>
    </p>
  );
}
