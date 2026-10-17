import type { Bridge } from "@keystone/shared";
import { Meter } from "@/components/ui/meter";
import { Panel, PanelHeading } from "@/components/ui/panel";
import { ErrorState, SkeletonRows } from "@/components/ui/states";

interface BridgesPanelProps {
  bridges: Bridge[] | null;
  error: string | null;
  onOpenArtifact: (id: string) => void;
}

/** The people who connect teams (betweenness on who works with whom), strongest first. */
export function BridgesPanel({ bridges, error, onOpenArtifact }: BridgesPanelProps) {
  const max = bridges?.[0]?.score || 1;
  return (
    <Panel className="p-5 sm:p-8">
      <PanelHeading
        title="Bridge people"
        description="The people most often on the shortest path between colleagues who work together. If they leave, teams stop talking to each other."
      />
      <div className="mt-6">
        {error && !bridges ? (
          <ErrorState message={error} />
        ) : !bridges ? (
          <SkeletonRows count={5} rowClassName="h-14" />
        ) : bridges.length === 0 ? (
          <p className="text-sm font-light text-muted-foreground">Nobody works across teams yet.</p>
        ) : (
          <ol className="grid gap-x-10 gap-y-1 md:grid-cols-2">
            {bridges.slice(0, 8).map((bridge, index) => (
              <li key={bridge.person} className="grid grid-cols-[1.75rem_1fr] items-center gap-x-2 border-b py-3.5 last:border-b-0 md:[&:nth-last-child(2)]:border-b-0">
                <span className="text-sm font-extrabold text-faint tabular-nums">{index + 1}</span>
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-semibold">{bridge.person}</p>
                    <p className="shrink-0 text-xs font-light text-muted-foreground">{bridge.dept?.replace(/_/g, " ") ?? "No department"}</p>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <Meter percent={(bridge.score / max) * 100} label={`${bridge.person}'s betweenness`} />
                    {bridge.evidence[0] && (
                      <button type="button" className="code-id shrink-0 text-muted-foreground hover:text-foreground hover:underline" onClick={() => onOpenArtifact(bridge.evidence[0])} title={bridge.evidence[0]}>
                        source
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Panel>
  );
}
