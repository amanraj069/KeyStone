import { HealthStatus } from "@/components/health-status";
import { IngestConsole } from "@/components/ingest-console";
import { PageHeader } from "@/components/page-header";
import { PageContainer } from "@/components/shell/app-shell";

/** Developer console: service health and full or replayed ingests with their raw progress log. */
export default function IngestPage() {
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
