import { notFound } from "next/navigation";
import { HealthStatus } from "@/components/health-status";
import { IngestConsole } from "@/components/ingest-console";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/shell/app-shell";

/**
 * Developer console: service health and full or replayed ingests with their raw
 * progress log, including a destructive full reset of the graph. Local development
 * only: a production build 404s here, so a visitor on the deployed demo link cannot
 * reach or trigger it even by guessing the URL (the sidebar also never links to it;
 * see nav-items.ts).
 */
export default function IngestPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <PageContainer>
      <PageHeader
        title="Load the company"
        description="Full ingest rebuilds apex from artifacts.jsonl without extraction; run the rebuild steps in the README afterwards."
      />
      <div className="max-w-3xl space-y-6">
        <HealthStatus />
        <IngestConsole />
      </div>
    </PageContainer>
  );
}
