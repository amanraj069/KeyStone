"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";

interface ArtifactSheetProps {
  /** The artifact to show; null closes the sheet. */
  artifactId: string | null;
  onClose: () => void;
}

/** Side sheet with an artifact's title, type, day, people and the start of its body. */
export function ArtifactSheet({ artifactId, onClose }: ArtifactSheetProps) {
  const { data, error, loading } = useApi(artifactId ? (signal) => api.artifact(artifactId, signal) : null, [artifactId]);
  const shown = data && data.id === artifactId ? data : null;

  return (
    <Sheet open={artifactId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="gap-2 border-b px-6 pt-6 pb-5">
          <p className="code-id text-muted-foreground">{artifactId}</p>
          <SheetTitle className="text-xl leading-snug font-semibold tracking-tight">
            {shown?.title ?? (loading ? <Skeleton className="h-6 w-3/4" /> : "Untitled")}
          </SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {shown?.label && <Meta name="Type" value={shown.type ? `${shown.label} · ${shown.type}` : shown.label} />}
              {shown?.day != null && <Meta name="Day" value={String(shown.day)} />}
              {shown && shown.people.length > 0 && <Meta name="People" value={shown.people.join(", ")} />}
            </div>
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && <p className="text-sm text-muted-foreground">Could not load this artifact: {error}</p>}
          {loading && !shown && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          )}
          {shown && (
            <p className="text-[0.9rem] leading-relaxed whitespace-pre-wrap text-foreground/90">
              {shown.excerpt ?? "The body of this artifact is not in the text store."}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Meta({ name, value }: { name: string; value: string }) {
  return (
    <span>
      <span className="text-faint">{name}</span> <span className="text-foreground/80">{value}</span>
    </span>
  );
}
