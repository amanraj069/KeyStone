/** 0.4667 -> "47%"; null -> "n/a". */
export const pct = (value: number | null) => (value === null ? "n/a" : `${Math.round(value * 100)}%`);

/** 12345 ms -> "12.3 s"; null -> "n/a". */
export const seconds = (ms: number | null) => (ms === null ? "n/a" : `${(ms / 1000).toFixed(1)} s`);

/** "COUNTERFACTUAL" -> "Counterfactual". */
export const typeLabel = (type: string) => type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();

/** "67% (55–77)": an accuracy with its 95% interval, when there is one. */
export const withCi = (value: number | null, ci: [number, number] | null | undefined) =>
  ci ? `${pct(value)} (${Math.round(ci[0] * 100)}–${Math.round(ci[1] * 100)})` : pct(value);
