import Link from "next/link";
import { HealthStatus } from "@/components/health-status";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 p-6">
      <header className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Keystone</h1>
        <p className="mt-2 text-muted-foreground">
          The company brain for Apex Athletics: who knows what, and what breaks if they leave.
        </p>
      </header>
      <HealthStatus />
      <Link href="/ingest" className="text-sm underline underline-offset-4">
        Ingestion and day-by-day replay →
      </Link>
    </main>
  );
}
