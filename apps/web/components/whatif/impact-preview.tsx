import type { DepartureCandidate } from "@keystone/shared";
import { FileText, GitFork, Network, ShieldAlert, Ticket, UserMinus, Users } from "lucide-react";
import { EvidenceChip } from "@/components/evidence-chip";
import { Button } from "@/components/ui/button";

interface ImpactPreviewProps {
  person: string | null;
  /** Set when the person is among the most impactful departures. */
  candidate: DepartureCandidate | null;
  disabled: boolean;
  onSimulate: () => void;
  onOpenArtifact: (id: string) => void;
}

/** What the simulation measures, in the order the report lists it. */
const MEASURES = [
  { icon: ShieldAlert, text: "Systems left with no expert, or only one" },
  { icon: GitFork, text: "Systems nobody else has worked on" },
  { icon: Ticket, text: "Open tickets to reassign, with who could take them" },
  { icon: FileText, text: "Pages only they wrote" },
  { icon: Network, text: "Who ends up connecting the teams" },
] as const;

/** The Impact panel before a simulation: what is already known about the person, and what the run will measure. */
export function ImpactPreview({ person, candidate, disabled, onSimulate, onOpenArtifact }: ImpactPreviewProps) {
  return (
    <div className="flex min-h-full flex-col gap-6">
      {candidate && candidate.orphaned > 0 && (
        <div className="rounded-xl bg-surface p-4">
          <p className="section-label">Already known</p>
          <p className="mt-2 text-sm leading-relaxed">
            <span className="font-semibold">{candidate.person}</span> is the only expert on{" "}
            <span className="font-semibold text-signal">
              {candidate.orphaned} core system{candidate.orphaned === 1 ? "" : "s"}
            </span>
            .
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {candidate.systems.map((system) => (
              <span key={system} className="rounded-full border bg-card px-2 py-0.5 text-xs font-semibold">
                {system}
              </span>
            ))}
          </div>
          {candidate.evidence.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {candidate.evidence.slice(0, 4).map((id) => (
                <EvidenceChip key={id} id={id} onOpen={onOpenArtifact} />
              ))}
            </div>
          )}
        </div>
      )}

      <div>
        <p className="section-label">The simulation measures</p>
        <ul className="mt-3 space-y-2.5">
          {MEASURES.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-3 text-sm text-muted-foreground">
              <Icon className="mt-0.5 size-4 shrink-0" />
              {text}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto rounded-lg bg-surface p-4">
        <p className="flex items-start gap-3 text-xs leading-relaxed text-muted-foreground">
          <Users className="mt-px size-4 shrink-0" />
          It runs on a scratch copy of the people-and-systems graph, so nothing real changes.
        </p>
        <Button className="mt-3 w-full" onClick={onSimulate} disabled={disabled}>
          <UserMinus data-icon="inline-start" />
          {person ? `Simulate ${person} leaving` : "Simulate departure"}
        </Button>
      </div>
    </div>
  );
}
