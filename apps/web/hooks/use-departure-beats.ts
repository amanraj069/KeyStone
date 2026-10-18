"use client";

import { useEffect, useState } from "react";
import type { DepartureKeys } from "@/lib/whatif";

/** Milliseconds per beat: the leaver fades (1), risk pulses (2), new owners glow (3). */
export const BEAT_MS = 800;
/** Risk keeps pulsing this long, then stays red and still. */
const PULSE_FOR_MS = 3600;

export interface BeatState {
  beat: 0 | 1 | 2 | 3;
  faded: string[];
  red: string[];
  pulse: string[];
  highlighted: string[];
}

const NONE: string[] = [];
const IDLE: BeatState = { beat: 0, faded: NONE, red: NONE, pulse: NONE, highlighted: NONE };

/**
 * Plays the departure in three beats once a simulation arrives:
 *   1. the leaver and their edges fade out (over 800 ms),
 *   2. systems with no expert left turn red and pulse; systems down to one expert
 *      pulse with a signal ring, and orphaned tickets get the ring,
 *   3. the suggested new owners glow in the accent colour.
 * `null` keys (no simulation yet) show the before-graph untouched.
 */
export function useDepartureBeats(keys: DepartureKeys | null): BeatState {
  const [state, setState] = useState<BeatState>(IDLE);

  useEffect(() => {
    if (!keys) {
      setState(IDLE);
      return;
    }
    const faded = [keys.leaver];
    // Red means no expert left; the other risks get a ring, so the red ones stand out.
    const red = keys.noExpert;
    const pulse = [...keys.noExpert, ...keys.critical];
    const ringed = [...keys.critical, ...keys.orphanedTickets];
    setState({ beat: 1, faded, red: NONE, pulse: NONE, highlighted: NONE });
    const timers = [
      setTimeout(() => setState({ beat: 2, faded, red, pulse, highlighted: ringed }), BEAT_MS),
      setTimeout(() => setState({ beat: 3, faded, red, pulse, highlighted: [...ringed, ...keys.newOwners] }), BEAT_MS * 2),
      setTimeout(() => setState((s) => ({ ...s, pulse: NONE })), BEAT_MS + PULSE_FOR_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [keys]);

  return state;
}
