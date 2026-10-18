/** An RGB colour resolved from a CSS variable, so the canvas can add any alpha to it. */
export type Rgb = readonly [number, number, number];

/** The canvas colours of the current theme (see the --node-* variables in globals.css). */
export interface Palette {
  nodes: Record<string, Rgb>;
  edge: Rgb;
  signal: Rgb;
  label: Rgb;
  /** The surface behind the canvas: label pills, text halos and node outlines. */
  labelBg: Rgb;
  font: string;
}

/** Node labels with their own colour; anything else uses --node-artifact. */
export const LABEL_VARS: Record<string, string> = {
  Person: "--node-person",
  System: "--node-system",
  Ticket: "--node-ticket",
  Page: "--node-page",
  Thread: "--node-thread",
  PR: "--node-pr",
  Email: "--node-email",
  Meeting: "--node-meeting",
  Decision: "--node-decision",
  Action: "--node-action",
  Artifact: "--node-artifact",
};

/** People and systems are the anchors of every picture, so they are drawn larger. */
const RADIUS: Record<string, number> = { Person: 5.5, System: 6.5, Decision: 4.5, Action: 4.5 };

export const radiusForLabel = (label: string) => RADIUS[label] ?? 3.6;

/** The anchors are always named; artifacts are named on hover, as their titles are long. */
export const isAnchor = (label: string) => label === "Person" || label === "System";

export const colorForLabel = (palette: Palette, label: string, alpha = 1) =>
  rgba(palette.nodes[label] ?? palette.nodes.Artifact, alpha);

export const rgba = ([r, g, b]: Rgb, alpha = 1) => `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;

/** a at t = 0, b at t = 1. */
export const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as unknown as Rgb;

/** How far the agent's path starts towards white: its first steps are a whitish orange. */
const PATH_START_WHITE = 0.62;

/**
 * The colour of the agent's path at a point in time: whitish orange for what it found
 * first (t = 0), full signal orange for what it found last (t = 1).
 */
export const pathColor = (palette: Palette, t: number): Rgb =>
  mixRgb(mixRgb(palette.signal, [255, 255, 255], PATH_START_WHITE), palette.signal, Math.min(1, Math.max(0, t)));

/**
 * Reads the theme's CSS variables and resolves each to RGB by painting it on a
 * 1x1 canvas (the variables are oklch, which canvas accepts but cannot mix).
 */
export function readPalette(): Palette {
  const styles = getComputedStyle(document.documentElement);
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const resolve = (name: string): Rgb => {
    const value = styles.getPropertyValue(name).trim();
    if (!probe || !value) return [128, 128, 128];
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = value;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
    return [r, g, b];
  };
  const nodes: Record<string, Rgb> = {};
  for (const [label, variable] of Object.entries(LABEL_VARS)) nodes[label] = resolve(variable);
  return {
    nodes,
    edge: resolve("--edge"),
    signal: resolve("--signal"),
    label: resolve("--canvas-label"),
    labelBg: resolve("--canvas-label-bg"),
    font: styles.getPropertyValue("--font-body").trim() || "sans-serif",
  };
}
