import type { StaleDoc } from "@keystone/shared";
import { EvidenceChip } from "@/components/evidence-chip";
import { Panel, PanelHeading } from "@/components/ui/panel";

/** Pages that still assert a decision a later one replaced: the old claim against the current decision. */
export function StalePages({ docs, onOpenArtifact }: { docs: StaleDoc[]; onOpenArtifact: (id: string) => void }) {
  return (
    <Panel className="p-5 sm:p-7">
      <PanelHeading title={<>Stale pages <span className="ml-1 font-normal text-muted-foreground tabular-nums">{docs.length}</span></>} description="These pages still state a decision that someone later replaced." />
      <ul className="mt-5 divide-y rounded-lg border">
        {docs.map((doc) => (
          <li key={`${doc.stalePage}-${doc.outdatedId}`} className="p-4">
            <div className="flex items-baseline gap-2">
              <EvidenceChip id={doc.stalePage} onOpen={onOpenArtifact} />
              <span className="min-w-0 truncate text-sm font-medium">{doc.pageTitle}</span>
            </div>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="section-label">Old claim</dt>
                <dd className="mt-1 text-muted-foreground line-through decoration-faint">{doc.outdatedClaim}</dd>
              </div>
              <div>
                <dt className="section-label">Current decision</dt>
                <dd className="mt-1">{doc.currentDecision}</dd>
                <dd className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                  Day {doc.decidedOn ?? "?"}
                  {doc.decidedIn && <EvidenceChip id={doc.decidedIn} onOpen={onOpenArtifact} />}
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
