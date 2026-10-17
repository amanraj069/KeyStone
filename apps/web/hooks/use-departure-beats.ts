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
 *   2. newly orphaned and critical systems pulse red (orphaned tickets turn red),
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
    const red = [...keys.atRisk, ...keys.orphanedTickets];
    setState({ beat: 1, faded, red: NONE, pulse: NONE, highlighted: NONE });
    const timers = [
      setTimeout(() => setState({ beat: 2, faded, red, pulse: keys.atRisk, highlighted: NONE }), BEAT_MS),
      setTimeout(() => setState({ beat: 3, faded, red, pulse: keys.atRisk, highlighted: keys.newOwners }), BEAT_MS * 2),
      setTimeout(() => setState((s) => ({ ...s, pulse: NONE })), BEAT_MS + PULSE_FOR_MS),
    ];
    return () => timers.forEach(clearTimeout);
  }, [keys]);

  return state;
}
