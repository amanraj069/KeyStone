import Link from "next/link";
import { cn } from "@/lib/utils";

/** The keystone: the wedge at the top of an arch that holds the rest in place. */
export function KeystoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path d="M4.5 3.5h15l-3.6 17h-7.8z" fill="currentColor" />
      <path d="M9.6 9.5h4.8" stroke="var(--card)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** Icon and wordmark, linking home. */
export function BrandMark({ showName = true, onNavigate, className }: { showName?: boolean; onNavigate?: () => void; className?: string }) {
  return (
    <Link href="/" onClick={onNavigate} className={cn("flex items-center gap-2.5 text-base font-extrabold tracking-tight transition-opacity hover:opacity-80", className)}>
      <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <KeystoneIcon className="size-4" />
      </span>
      {showName && "Keystone"}
    </Link>
  );
}
