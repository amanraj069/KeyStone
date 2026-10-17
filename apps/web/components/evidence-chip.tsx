import { cn } from "@/lib/utils";

interface EvidenceChipProps {
  id: string;
  onOpen: (id: string) => void;
  active?: boolean;
  title?: string;
}

/** An artifact id as a small monospace chip; clicking it opens or highlights the artifact. */
export function EvidenceChip({ id, onOpen, active = false, title }: EvidenceChipProps) {
  return (
    <button
      type="button"
      title={title ?? `Open ${id}`}
      onClick={() => onOpen(id)}
      className={cn(
        "code-id inline-flex items-center rounded-md border px-1.5 py-px align-baseline transition-colors",
        active ? "border-signal bg-signal-soft text-foreground" : "border-border bg-muted/50 text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {id}
    </button>
  );
}
