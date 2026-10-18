"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { useTheme } from "@/contexts/theme-context";
import type { CanvasEdge, CanvasNode } from "@/lib/graph";
import { type Palette, colorForLabel, isAnchor, pathColor, radiusForLabel, readPalette, rgba } from "./palette";

export interface GraphCanvasViewProps {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  highlightedIds: ReadonlySet<string>;
  fadedIds: ReadonlySet<string>;
  redIds: ReadonlySet<string>;
  /** Nodes drawn with a pulsing signal ring (newly at risk), on top of their look. */
  pulseIds: ReadonlySet<string>;
  /** How long a highlight change takes to animate. */
  animationMs: number;
  /** Whether the wheel zooms and the background pans (off inside a scrolling page). */
  interactive: boolean;
  /**
   * When each node of the agent's path was found, 0 (first) to 1 (last): its ring and
   * the path's edges go from whitish orange to orange. Nodes without one are drawn as last.
   */
  pathOrder?: ReadonlyMap<string, number>;
  onArtifactClick: (artifactId: string) => void;
}

type GNode = NodeObject<CanvasNode>;
type GLink = LinkObject<CanvasNode, { type: string }>;

/** How a node looks in one state; highlight changes animate between two of these. */
interface Look {
  alpha: number;
  /** 0..1: how much of the signal ring is drawn (the agent's path). */
  ring: number;
  /** 0..1: how much the fill turns to the signal colour (risk). */
  red: number;
  scale: number;
}

/** Small graphs name every node; bigger ones name people, systems and the nodes in focus. */
const LABEL_ALL_UP_TO = 14;
/** Fit the camera this long after a new graph arrives, even if the layout is still settling. */
const EARLY_FIT_MS = 900;
/** One pulse of a pulsing ring. */
const PULSE_MS = 1100;
/** zoomToFit on a few nodes would make them huge; never zoom in further than this. */
const MAX_FIT_ZOOM = 2.6;
const NORMAL: Look = { alpha: 0.9, ring: 0, red: 0, scale: 1 };

/** An id matches a node by its canvas key or by its artifact id (citations use artifact ids). */
const matches = (ids: ReadonlySet<string>, node: CanvasNode) => ids.has(node.key) || (node.artifactId !== null && ids.has(node.artifactId));

function lookFor(node: CanvasNode, props: Pick<GraphCanvasViewProps, "highlightedIds" | "fadedIds" | "redIds">): Look {
  const red = matches(props.redIds, node);
  const highlighted = matches(props.highlightedIds, node);
  if (matches(props.fadedIds, node) && !red && !highlighted) return { alpha: 0.14, ring: 0, red: 0, scale: 0.9 };
  return { alpha: 1, ring: highlighted ? 1 : 0, red: red ? 1 : 0, scale: highlighted || red ? 1.35 : 1 };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** The force-directed canvas. Loaded only in the browser (see graph-canvas.tsx). */
export default function GraphCanvasView(props: GraphCanvasViewProps) {
  const { nodes, edges, highlightedIds, fadedIds, redIds, pulseIds, animationMs, interactive, onArtifactClick, pathOrder } = props;
  const { theme } = useTheme();
  const container = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [palette, setPalette] = useState<Palette | null>(null);
  const [animating, setAnimating] = useState(false);
  // State, not a ref: the re-render hands the graph new callbacks, which makes it repaint.
  const [hovered, setHovered] = useState<string | null>(null);
  const fitted = useRef(false);

  // Highlight animation: every node goes from its look at the last change to its new look.
  const looks = useRef<Transition>({ from: new Map(), to: new Map(), start: 0, duration: animationMs });
  const previousNodes = useRef<GNode[]>([]);

  // The force simulation mutates node objects (x, y, vx...), so they are rebuilt only
  // when the graph itself changes, not when highlights change. Nodes that were already
  // on screen keep their place, so a changed graph (a simulation result replacing the
  // before-graph) only moves what is new; the camera then stays where it is.
  const data = useMemo(() => {
    // Only nodes the simulation has actually laid out count as placed (in development,
    // React runs this twice, and the first run's nodes have no position yet).
    const placed = new Map(previousNodes.current.filter((n) => n.x !== undefined).map((n) => [n.key, n]));
    const graphNodes = nodes.map((node) => {
      const old = placed.get(node.key);
      return { ...node, id: node.key, ...(old ? { x: old.x, y: old.y } : {}) };
    }) as GNode[];
    previousNodes.current = graphNodes;
    const kept = graphNodes.filter((n) => placed.has(n.key)).length;
    fitted.current = graphNodes.length > 0 && kept >= graphNodes.length / 2;
    return { nodes: graphNodes, links: edges.map((edge) => ({ ...edge })) as GLink[] };
  }, [nodes, edges]);

  // How many edges each node has: of two names that would overlap, the better-connected one is drawn.
  const degree = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
      counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
    }
    return counts;
  }, [edges]);

  // Size the canvas to its container.
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Colours come from CSS variables, so they follow light and dark mode. The theme
  // class is applied by ThemeProvider's effect, which runs after this one: wait a frame.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setPalette(readPalette()));
    return () => cancelAnimationFrame(frame);
  }, [theme]);

  // Start a transition (300 ms by default) whenever the highlight sets change.
  useEffect(() => {
    const now = performance.now();
    const current = looks.current;
    const from = new Map<string, Look>();
    const to = new Map<string, Look>();
    for (const node of nodes) {
      from.set(node.key, currentLook(current, node.key, now));
      to.set(node.key, lookFor(node, { highlightedIds, fadedIds, redIds }));
    }
    looks.current = { from, to, start: now, duration: animationMs };
    setAnimating(true);
    const timer = setTimeout(() => setAnimating(false), animationMs + 50);
    return () => clearTimeout(timer);
  }, [nodes, highlightedIds, fadedIds, redIds, animationMs]);

  const pulsing = pulseIds.size > 0;
  const inFocus = (node: CanvasNode) => matches(highlightedIds, node) || matches(pulseIds, node) || matches(redIds, node);
  const labelAll = nodes.length <= LABEL_ALL_UP_TO;

  /** Lower is more important: hovered, in focus, a person or system, any other node (small graphs only). */
  const labelRank = (node: CanvasNode) => {
    if (node.key === hovered) return 0;
    if (inFocus(node)) return 1;
    if (isAnchor(node.label)) return 2;
    return labelAll ? 3 : -1;
  };
  // The graph's own node objects, so the label pass reads their live positions.
  const labelOrder = data.nodes
    .filter((node) => labelRank(node) >= 0)
    .sort((a, b) => labelRank(a) - labelRank(b) || (degree.get(b.key) ?? 0) - (degree.get(a.key) ?? 0));

  // A new graph (not one that kept most of its layout) gets fitted early, then again when the layout stops.
  useEffect(() => {
    if (fitted.current) return;
    const timer = setTimeout(() => fit(), EARLY_FIT_MS);
    return () => clearTimeout(timer);
  }, [data]);

  function fit() {
    // The padding leaves room for the names under the outermost nodes.
    graph.current?.zoomToFit(400, 48);
    setTimeout(() => {
      const zoom = graph.current?.zoom();
      if (zoom !== undefined && zoom > MAX_FIT_ZOOM) graph.current?.zoom(MAX_FIT_ZOOM, 250);
    }, 420);
  }

  if (!palette) return <div ref={container} className="size-full" />;

  const lookOf = (key: string) => currentLook(looks.current, key, performance.now());
  const orderOf = (key: string) => pathOrder?.get(key) ?? 1;

  const drawNode = (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const look = lookOf(node.key);
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const radius = radiusForLabel(node.label) * look.scale;

    ctx.globalAlpha = look.alpha;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = colorForLabel(palette, node.label);
    ctx.fill();
    if (look.red > 0) {
      ctx.globalAlpha = look.alpha * look.red;
      ctx.fillStyle = rgba(palette.signal);
      ctx.fill();
    }
    // A hairline in the surface colour keeps overlapping nodes apart (thinner on tiny nodes).
    ctx.globalAlpha = look.alpha;
    ctx.lineWidth = Math.min(1 / scale, radius * 0.25);
    ctx.strokeStyle = rgba(palette.labelBg);
    ctx.stroke();
    if (look.ring > 0) {
      ctx.globalAlpha = look.ring;
      ctx.lineWidth = 1.75 / scale;
      ctx.strokeStyle = rgba(pathColor(palette, orderOf(node.key)));
      ctx.beginPath();
      ctx.arc(x, y, radius + 2.5 / scale + 0.6, 0, 2 * Math.PI);
      ctx.stroke();
    }
    if (matches(pulseIds, node)) {
      // An expanding, fading ring: the node is newly at risk.
      const phase = (performance.now() % PULSE_MS) / PULSE_MS;
      ctx.globalAlpha = (1 - phase) * 0.8;
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = rgba(palette.signal);
      ctx.beginPath();
      ctx.arc(x, y, radius + (2 + phase * 9) / Math.max(scale, 0.6), 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };

  /**
   * Names are drawn after every node, so no node hides one. Going from most to least
   * important, a name that would overlap one already placed is skipped; zooming in
   * makes room for it. Faded nodes stay unnamed unless hovered.
   */
  const drawLabels = (ctx: CanvasRenderingContext2D, scale: number) => {
    const placed: Label[] = [];
    for (const node of labelOrder) {
      const look = lookOf(node.key);
      const isHovered = node.key === hovered;
      if (!isHovered && look.alpha < 0.3) continue;
      const style: LabelStyle = isHovered ? "hover" : inFocus(node) ? "focus" : "name";
      const top = (node.y ?? 0) + radiusForLabel(node.label) * look.scale + 3 / scale;
      const label = layoutLabel(ctx, palette, node.name, style, node.x ?? 0, top, scale, isHovered ? 1 : look.alpha);
      if (!isHovered && placed.some((other) => overlaps(other, label))) continue;
      placed.push(label);
    }
    // The most important name is painted last, so it sits on top.
    for (const label of placed.reverse()) paintLabel(ctx, palette, label, scale);
  };

  /** An edge is on the path when both ends are highlighted or red; it fades with its faded ends. */
  const linkStyle = (link: GLink) => {
    const a = lookOf(endKey(link.source));
    const b = lookOf(endKey(link.target));
    const onPath = Math.min(a.ring + a.red, 1) * Math.min(b.ring + b.red, 1) > 0.5;
    // The hovered node's edges stand out, so you can see what it connects to.
    const touchesHover = hovered !== null && (endKey(link.source) === hovered || endKey(link.target) === hovered);
    if (touchesHover && !onPath) return { color: rgba(palette.label, 0.4), width: 1.1 };
    const alpha = Math.min(a.alpha, b.alpha) * (onPath ? 0.85 : 0.6);
    // A path edge takes the colour of its later end: the step that walked it.
    const when = Math.max(orderOf(endKey(link.source)), orderOf(endKey(link.target)));
    return { color: rgba(onPath ? pathColor(palette, when) : palette.edge, alpha), width: onPath ? 1.4 : 0.8 };
  };

  return (
    <div ref={container} className="size-full">
      {size.width > 0 && (
        <ForceGraph2D<CanvasNode, { type: string }>
          ref={graph}
          graphData={data}
          width={size.width}
          height={size.height}
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={4}
          nodeCanvasObjectMode={() => "replace"}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={(node, color, ctx) => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, radiusForLabel(node.label) + 3, 0, 2 * Math.PI);
            ctx.fill();
          }}
          linkColor={(link) => linkStyle(link).color}
          linkWidth={(link) => linkStyle(link).width}
          linkDirectionalArrowLength={0}
          cooldownTicks={120}
          enableZoomInteraction={interactive}
          enablePanInteraction={interactive}
          onRenderFramePost={drawLabels}
          autoPauseRedraw={!animating && !pulsing}
          onEngineStop={() => {
            if (fitted.current) return;
            fitted.current = true;
            fit();
          }}
          onNodeHover={(node) => {
            setHovered(node?.key ?? null);
            if (container.current) container.current.style.cursor = node?.artifactId ? "pointer" : node ? "grab" : "";
          }}
          onNodeClick={(node) => {
            if (node.artifactId) onArtifactClick(node.artifactId);
          }}
        />
      )}
    </div>
  );
}

interface Transition {
  from: Map<string, Look>;
  to: Map<string, Look>;
  start: number;
  duration: number;
}

/** The look of a node at time `now`, part-way through the current transition. */
function currentLook(state: Transition, key: string, now: number): Look {
  const to = state.to.get(key) ?? NORMAL;
  const from = state.from.get(key) ?? to;
  const t = easeOut(Math.min(1, Math.max(0, (now - state.start) / state.duration)));
  return {
    alpha: lerp(from.alpha, to.alpha, t),
    ring: lerp(from.ring, to.ring, t),
    red: lerp(from.red, to.red, t),
    scale: lerp(from.scale, to.scale, t),
  };
}

/** After the simulation starts, link ends are node objects; before, they are keys. */
function endKey(end: GLink["source"]): string {
  if (end && typeof end === "object") return String((end as GNode).key ?? (end as GNode).id);
  return String(end);
}

/**
 * hover: a pill with the full title (artifact titles are long). focus: bold, full
 * strength. name: the always-on names of people and systems, a little quieter.
 * Sizes and padding are in screen pixels.
 */
type LabelStyle = "hover" | "focus" | "name";
const LABEL_STYLES: Record<LabelStyle, { size: number; weight: number; chars: number; padX: number; padY: number }> = {
  hover: { size: 11.5, weight: 600, chars: 64, padX: 7, padY: 3.5 },
  focus: { size: 11, weight: 600, chars: 28, padX: 2, padY: 1 },
  name: { size: 10.5, weight: 500, chars: 24, padX: 2, padY: 1 },
};

/** A name laid out under its node, in graph coordinates (x, y is the top left corner). */
interface Label {
  text: string;
  style: LabelStyle;
  font: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alpha: number;
}

function layoutLabel(
  ctx: CanvasRenderingContext2D,
  palette: Palette,
  text: string,
  style: LabelStyle,
  centerX: number,
  top: number,
  scale: number,
  alpha: number,
): Label {
  const spec = LABEL_STYLES[style];
  const clipped = text.length > spec.chars ? `${text.slice(0, spec.chars - 1)}…` : text;
  const fontSize = spec.size / scale;
  const font = `${spec.weight} ${fontSize}px ${palette.font}`;
  ctx.font = font;
  const width = ctx.measureText(clipped).width + (2 * spec.padX) / scale;
  const height = fontSize + (2 * spec.padY) / scale;
  return { text: clipped, style, font, x: centerX - width / 2, y: top, width, height, alpha };
}

const overlaps = (a: Label, b: Label) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function paintLabel(ctx: CanvasRenderingContext2D, palette: Palette, label: Label, scale: number) {
  const textY = label.y + LABEL_STYLES[label.style].padY / scale;
  const centerX = label.x + label.width / 2;
  ctx.globalAlpha = label.alpha;
  ctx.font = label.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  if (label.style === "hover") {
    ctx.beginPath();
    ctx.roundRect(label.x, label.y, label.width, label.height, label.height / 2);
    ctx.fillStyle = rgba(palette.labelBg, 0.96);
    ctx.fill();
    ctx.lineWidth = 1 / scale;
    ctx.strokeStyle = rgba(palette.edge);
    ctx.stroke();
    ctx.fillStyle = rgba(palette.label);
  } else {
    // A halo in the surface colour keeps the name readable over edges, without a box.
    ctx.lineWidth = 3 / scale;
    ctx.lineJoin = "round";
    ctx.strokeStyle = rgba(palette.labelBg, 0.9);
    ctx.strokeText(label.text, centerX, textY);
    ctx.fillStyle = rgba(palette.label, label.style === "focus" ? 1 : 0.8);
  }
  ctx.fillText(label.text, centerX, textY);
  ctx.globalAlpha = 1;
}
