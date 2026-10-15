import Link from "next/link";
import { IngestConsole } from "@/components/ingest-console";

export default function IngestPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center gap-8 p-6 pt-16">
      <header className="w-full">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← Keystone
        </Link>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Load the company</h1>
      </header>
      <IngestConsole />
    </main>
  );
}
