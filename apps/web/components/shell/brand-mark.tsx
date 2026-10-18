import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The logo mark (apps/web/public/logo.svg), inlined rather than loaded via <img>: an
 * externally-loaded SVG renders in its own document and never sees the page's CSS, so
 * its `stroke="currentColor"` would always resolve to black instead of the theme color.
 * Inlining it as JSX lets it inherit `color` from its wrapping element normally.
 */
export function KeystoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path d="M4 14L8 21L16 21L20 14L17.5 7.5L12 3L6.5 7.5L4 14Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 3V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 21L13 15M17.5 7.5L14 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6.5 7.5L10 10M11 15L8 21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 14L10 13M20 14L14 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect height="6" rx="2" width="4" x="10" y="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Icon and wordmark, linking home; the wordmark fades rather than unmounting, so the rail can clip it. */
export function BrandMark({ showName = true, onNavigate, className }: { showName?: boolean; onNavigate?: () => void; className?: string }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      aria-label="Keystone home"
      className={cn("group flex items-center gap-2.5 text-lg font-semibold tracking-tight text-foreground", className)}
    >
      <span className="flex size-8 shrink-0 items-center justify-center transition-transform duration-300 ease-spring group-hover:-rotate-6 group-active:scale-95">
        <KeystoneIcon className="size-7" />
      </span>
      <span className={cn("whitespace-nowrap leading-none transition-opacity duration-200", showName ? "opacity-100 delay-75" : "opacity-0")}>Keystone</span>
    </Link>
  );
}
