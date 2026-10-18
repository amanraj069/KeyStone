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
        "code-id inline-block max-w-full truncate rounded-[5px] border px-1.5 py-px align-baseline transition-[color,background-color,border-color,transform] duration-150 active:scale-[0.97]",
        active ? "border-signal/60 bg-signal-soft text-foreground" : "border-border bg-surface text-muted-foreground hover:border-input hover:bg-card hover:text-foreground",
      )}
    >
      {id}
    </button>
  );
}
