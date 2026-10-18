"use client";

import { useEffect, useRef, useState } from "react";

/** How long a figure takes to count to a new value. */
const DURATION_MS = 900;

/**
 * A number that counts up to its value (and glides to later values) with an ease-out,
 * so headline figures settle in rather than pop. Shows the value at once when the
 * person prefers reduced motion.
 */
export function useCountUp(value: number): number {
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 4);
      const next = origin + (value - origin) * eased;
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return Math.round(shown);
}
