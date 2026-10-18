"use client";

import { useCountUp } from "@/hooks/use-count-up";

/** A figure that counts up to its value; text that is not a plain number shows as is. */
export function CountUp({ value }: { value: number | string }) {
  const numeric = typeof value === "number" ? value : Number.NaN;
  const shown = useCountUp(Number.isFinite(numeric) ? numeric : 0);
  return <>{Number.isFinite(numeric) ? shown.toLocaleString() : value}</>;
}
