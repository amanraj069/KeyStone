import type { ReactNode } from "react";

/**
 * Re-mounted on every navigation (unlike the layout), so each page arrives with a short
 * rise. It passes main's flex column through, so full-height rooms still fit.
 */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="animate-page-in flex min-h-0 flex-1 flex-col">{children}</div>;
}
