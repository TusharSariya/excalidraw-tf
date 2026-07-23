/**
 * Strata Package C spike — post-A7 obstacle-avoiding edge routing (SDEC-59
 * follow-up; W9 battery terraformPipelineStrataRoutingSpike.test.ts).
 *
 * Mode "penetrating-only": AFTER final geometry (post packedScoring guard,
 * post-A7, at scene-skeleton assembly), each rendered TFD arrow whose straight
 * centre-clipped chord passes through the INTERIOR of at least one FOREIGN box
 * — a hull frame that is an ancestor of neither endpoint, or an unrelated
 * primary-cluster card — is replaced by a polyline detour around the offending
 * boxes. Every other arrow is left byte-identical; flag-off this module never
 * runs.
 *
 * Literature grounding (graph-layout corpus doc ids, cited in the W9 doc):
 *  - Wybrow/Marriott/Stuckey, Incremental Connector Routing
 *    (doi-10-1007-11618058-40): route AROUND obstacles with shortest
 *    obstacle-avoiding paths; the orthogonal variant penalizes bends over
 *    length — we bound bends hard (waypoint cap) and pick minimal added
 *    length.
 *  - Bouts & Speckmann, Clustered Edge Routing
 *    (forward-10-1109-pacificvis-2015-7156356): edges routed around cluster
 *    hull obstacles, endpoints' own ancestor hulls stay permeable.
 *  - Purchase (s2-10-1007-bfb0021827): bends cost readability less than
 *    crossings — a few shallow bends to remove a container pierce is the
 *    right trade.
 *  - Xu et al. 2012 (doi-10-1109-tvcg-2012-189): gratuitous curvature hurts;
 *    routes deviate minimally from the straight chord (greedy waypoint
 *    shortcutting below).
 *
 * Determinism (C4′): no RNG, no clock. Edge order = skeleton emission order
 * (itself C4′-stable); obstacle order = hulls then cards, each code-unit
 * sorted by id; candidate order = above-before-below / left-before-right;
 * ties on added L1 length keep the earliest candidate.
 *
 * Clearance: PIPELINE_FRAME_PAD / 2 = 14px — half the hull frame padding, and
 * below half the tightest sibling gap (PIPELINE_CLUSTER_GAP_Y = 36), so a
 * detour hugs the inflated obstacle inside the existing gutters. Computed
 * inside functions, never as a module-level const (SDEC-34: the
 * planParsing→layoutCore import cycle makes module-level consts derived from
 * terraformPipelineLayoutShared entry-order-dependent NaNs).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataEdgeRouting.test.ts --exclude "**\/.claude/**"
 */
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";
import { segmentIntersectsStrataBoxInterior } from "./terraformPipelineStrataPackedScoring";
import { compareStrataContentKeys } from "./terraformPipelineStrataTypes";

import type {
  StrataBox,
  StrataHullNode,
  StrataModel,
  StrataPlacementResult,
} from "./terraformPipelineStrataTypes";

/** Hard cap on interior waypoints per edge — beyond this the edge falls back
 * to its straight chord and is counted `unroutable` (never emit a worse mess).
 * Purchase: a few bends are cheap; many are not. */
export const STRATA_EDGE_ROUTING_MAX_WAYPOINTS = 6;

/** Detour clearance around obstacle boxes, px (see file header). */
export const strataEdgeRoutingClearance = (): number => PIPELINE_FRAME_PAD / 2;

export type StrataEdgeRoutingMeta = {
  /** Edges rewritten to a detour polyline. */
  routed: number;
  /** Eligible (penetrating) edges left straight: no clean route within the
   * waypoint cap, or every blocker's clearance zone contains an endpoint. */
  unroutable: number;
  /** Total interior waypoints added across all routed edges. */
  waypointsTotal: number;
};

type Pt = readonly [number, number];

/** Closed inflated obstacle in absolute px. */
type Inflated = { x0: number; y0: number; x1: number; y1: number };

const inflate = (b: StrataBox, c: number): Inflated => ({
  x0: b.x - c,
  y0: b.y - c,
  x1: b.x + b.width + c,
  y1: b.y + b.height + c,
});

const insideInflated = (p: Pt, b: Inflated): boolean =>
  p[0] > b.x0 && p[0] < b.x1 && p[1] > b.y0 && p[1] < b.y1;

const blocks = (a: Pt, b: Pt, box: Inflated): boolean =>
  segmentIntersectsStrataBoxInterior(
    a[0],
    a[1],
    b[0],
    b[1],
    box.x0,
    box.y0,
    box.x1,
    box.y1,
  );

/**
 * Liang–Barsky entry parameter of segment a→b into the CLOSED box, for
 * deterministic "first blocker along the segment" ordering. Callers only use
 * it on boxes already known to block, so the interval is nonempty.
 */
function entryParam(a: Pt, b: Pt, box: Inflated): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - box.x0, box.x1 - a[0], a[1] - box.y0, box.y1 - a[1]];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      continue;
    }
    const r = q[i]! / p[i]!;
    if (p[i]! < 0) {
      if (r > t0) {
        t0 = r;
      }
    } else if (r < t1) {
      t1 = r;
    }
  }
  return t1 < t0 ? 1 : t0;
}

/** Index of the first blocking obstacle along a→b (min entry t, tie → lowest
 * index), or -1 when the segment is clean. */
function firstBlocker(a: Pt, b: Pt, obstacles: readonly Inflated[]): number {
  let best = -1;
  let bestT = Infinity;
  for (let i = 0; i < obstacles.length; i++) {
    if (!blocks(a, b, obstacles[i]!)) {
      continue;
    }
    const t = entryParam(a, b, obstacles[i]!);
    if (t < bestT) {
      bestT = t;
      best = i;
    }
  }
  return best;
}

/**
 * The two corner detours around an inflated blocker, deterministic order.
 * Chord-axis rule: a mostly-horizontal chord detours above/below (above
 * first); a mostly-vertical one detours left/right (left first). Corners are
 * ordered along the direction of travel.
 */
function detourCandidates(a: Pt, b: Pt, box: Inflated): Pt[][] {
  if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) {
    const xs: readonly [number, number] =
      a[0] <= b[0] ? [box.x0, box.x1] : [box.x1, box.x0];
    return [
      [
        [xs[0], box.y0],
        [xs[1], box.y0],
      ], // above
      [
        [xs[0], box.y1],
        [xs[1], box.y1],
      ], // below
    ];
  }
  const ys: readonly [number, number] =
    a[1] <= b[1] ? [box.y0, box.y1] : [box.y1, box.y0];
  return [
    [
      [box.x0, ys[0]],
      [box.x0, ys[1]],
    ], // left
    [
      [box.x1, ys[0]],
      [box.x1, ys[1]],
    ], // right
  ];
}

const l1 = (poly: readonly Pt[]): number => {
  let s = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    s += Math.abs(poly[i + 1]![0] - poly[i]![0]);
    s += Math.abs(poly[i + 1]![1] - poly[i]![1]);
  }
  return s;
};

/**
 * Route a→b around `obstacles` with at most `remaining` interior waypoints.
 * Returns the polyline (a and b included) or null when no clean route fits
 * the budget. Recursive corner search: find the first blocker, try its two
 * corner detours, repair each sub-segment recursively, keep the candidate
 * with minimal L1 length (tie → earliest candidate). The budget strictly
 * decreases by 2 per nesting level, so the search always terminates.
 */
function routeSegment(
  a: Pt,
  b: Pt,
  obstacles: readonly Inflated[],
  remaining: number,
): Pt[] | null {
  const bi = firstBlocker(a, b, obstacles);
  if (bi < 0) {
    return [a, b];
  }
  if (remaining < 2) {
    return null;
  }
  let best: Pt[] | null = null;
  let bestL1 = Infinity;
  for (const corners of detourCandidates(a, b, obstacles[bi]!)) {
    const anchor: Pt[] = [a, ...corners, b];
    let budget = remaining - corners.length;
    const pts: Pt[] = [anchor[0]!];
    let ok = true;
    for (let i = 0; i + 1 < anchor.length; i++) {
      const sub = routeSegment(anchor[i]!, anchor[i + 1]!, obstacles, budget);
      if (sub === null) {
        ok = false;
        break;
      }
      budget -= sub.length - 2;
      if (budget < 0) {
        ok = false;
        break;
      }
      pts.push(...sub.slice(1));
    }
    if (!ok) {
      continue;
    }
    const len = l1(pts);
    if (len < bestL1) {
      bestL1 = len;
      best = pts;
    }
  }
  return best;
}

/** Greedy single pass dropping interior waypoints whose bypass segment is
 * clean (Xu: minimal deviation — never keep a bend that buys nothing). */
function shortcut(poly: readonly Pt[], obstacles: readonly Inflated[]): Pt[] {
  const out: Pt[] = [...poly];
  let i = 1;
  while (i + 1 < out.length) {
    if (firstBlocker(out[i - 1]!, out[i + 1]!, obstacles) < 0) {
      out.splice(i, 1);
    } else {
      i += 1;
    }
  }
  return out;
}

/**
 * Pure routing core: route start→end around `obstacleBoxes` (raw, uninflated).
 * Eligibility is the CALLER's job (raw-interior penetration test); this
 * function inflates by `clearance`, drops obstacles whose clearance zone
 * contains an endpoint (cannot route around a box you start inside), and
 * returns the detour polyline or null (no clean route within the cap, or the
 * route degenerates to the chord after the drop rule).
 */
export function routeStrataEdge(
  start: Pt,
  end: Pt,
  obstacleBoxes: readonly StrataBox[],
  clearance: number = strataEdgeRoutingClearance(),
): { points: Pt[]; waypoints: number } | null {
  const inflated = obstacleBoxes
    .map((b) => inflate(b, clearance))
    .filter((b) => !insideInflated(start, b) && !insideInflated(end, b));
  const routed = routeSegment(
    start,
    end,
    inflated,
    STRATA_EDGE_ROUTING_MAX_WAYPOINTS,
  );
  if (routed === null) {
    return null;
  }
  const poly = shortcut(routed, inflated);
  if (poly.length <= 2) {
    return null; // chord (blockers all endpoint-adjacent) — leave untouched
  }
  return { points: poly, waypoints: poly.length - 2 };
}

/** leaf clusterId → ids of every hull whose subtree contains it (local copy
 * of the packed-scoring helper's shape; kept here so this module stays
 * dependency-light — the walk is 10 lines and pinned by the unit tests). */
function leafAncestorsOf(root: StrataHullNode): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const walk = (hull: StrataHullNode, chain: readonly string[]): void => {
    const next = [...chain, hull.id];
    for (const leaf of hull.leafClusterIds) {
      out.set(leaf, new Set(next));
    }
    for (const child of hull.children) {
      walk(child, next);
    }
  };
  walk(root, []);
  return out;
}

type ArrowSkeleton = ExcalidrawElementSkeleton & {
  type: "arrow";
  points?: ReadonlyArray<readonly [number, number]>;
  customData?: Record<string, unknown>;
};

const relationshipOf = (
  el: ArrowSkeleton,
): { source: string; target: string } | null => {
  const cd = el.customData;
  if (cd?.terraformEdgeLayer !== "declaredDataFlow") {
    return null;
  }
  const rel = cd?.relationship as Record<string, unknown> | undefined;
  if (
    !rel ||
    typeof rel.source !== "string" ||
    typeof rel.target !== "string" ||
    rel.aggregated === true ||
    rel.source === rel.target
  ) {
    return null;
  }
  return { source: rel.source, target: rel.target };
};

/**
 * Scene-level pass (penetrating-only mode): rewrite, IN PLACE in the skeleton
 * array, every TFD arrow whose straight chord penetrates a foreign box.
 * Non-penetrating arrows are untouched (byte-identical emission); soft-delete
 * semantics, bindings and relationship customData are preserved — only
 * `points`/`width`/`height` change, and `x`/`y` (the chord start) never move.
 */
export function routeStrataSkeletonEdges(
  skeleton: ExcalidrawElementSkeleton[],
  model: StrataModel,
  placement: StrataPlacementResult,
): StrataEdgeRoutingMeta {
  const ancestors = leafAncestorsOf(model.hullRoot);

  type Obstacle = { id: string; kind: "hull" | "card"; box: StrataBox };
  const obstacles: Obstacle[] = [];
  const hullIds = [...placement.boxedHulls.keys()]
    .filter((id) => id !== model.hullRoot.id)
    .sort(compareStrataContentKeys);
  for (const id of hullIds) {
    obstacles.push({
      id,
      kind: "hull",
      box: placement.boxedHulls.get(id)!.box,
    });
  }
  const cardIds = [...placement.leafBoxes.keys()].sort(
    compareStrataContentKeys,
  );
  for (const id of cardIds) {
    obstacles.push({ id, kind: "card", box: placement.leafBoxes.get(id)! });
  }

  const meta: StrataEdgeRoutingMeta = {
    routed: 0,
    unroutable: 0,
    waypointsTotal: 0,
  };

  for (let i = 0; i < skeleton.length; i++) {
    const el = skeleton[i] as ArrowSkeleton;
    if (el.type !== "arrow") {
      continue;
    }
    const rel = relationshipOf(el);
    if (!rel) {
      continue;
    }
    const pts = el.points;
    if (!Array.isArray(pts) || pts.length < 2) {
      continue;
    }
    const sx = el.x;
    const sy = el.y;
    const last = pts[pts.length - 1]!;
    const start: Pt = [sx, sy];
    const end: Pt = [sx + last[0], sy + last[1]];

    // Foreign boxes for THIS edge: non-ancestor hulls + non-endpoint cards.
    const srcAnc = ancestors.get(rel.source);
    const tgtAnc = ancestors.get(rel.target);
    const foreign: StrataBox[] = [];
    for (const o of obstacles) {
      if (o.kind === "hull") {
        if (srcAnc?.has(o.id) || tgtAnc?.has(o.id)) {
          continue;
        }
      } else if (o.id === rel.source || o.id === rel.target) {
        continue;
      }
      foreign.push(o.box);
    }

    // Eligibility: the straight chord penetrates ≥1 RAW foreign interior.
    const penetrates = foreign.some((b) =>
      segmentIntersectsStrataBoxInterior(
        start[0],
        start[1],
        end[0],
        end[1],
        b.x,
        b.y,
        b.x + b.width,
        b.y + b.height,
      ),
    );
    if (!penetrates) {
      continue;
    }

    const route = routeStrataEdge(start, end, foreign);
    if (route === null) {
      meta.unroutable += 1;
      continue;
    }
    // Acceptance check ("never emit a worse mess"): the detour must be
    // penetration-free against EVERY raw foreign box — including obstacles
    // the router dropped because their clearance zone contained an endpoint
    // (the detour itself may not enter them either). Otherwise keep the
    // straight chord and count the edge unroutable.
    let detourClean = true;
    for (const b of foreign) {
      for (let s = 0; s + 1 < route.points.length && detourClean; s++) {
        if (
          segmentIntersectsStrataBoxInterior(
            route.points[s]![0],
            route.points[s]![1],
            route.points[s + 1]![0],
            route.points[s + 1]![1],
            b.x,
            b.y,
            b.x + b.width,
            b.y + b.height,
          )
        ) {
          detourClean = false;
        }
      }
      if (!detourClean) {
        break;
      }
    }
    if (!detourClean) {
      meta.unroutable += 1;
      continue;
    }
    const abs = route.points;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of abs) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    skeleton[i] = {
      ...el,
      points: abs.map(([px, py]) => pointFrom<LocalPoint>(px - sx, py - sy)),
      width: maxX - minX,
      height: maxY - minY,
      customData: {
        ...(el.customData ?? {}),
        // Consumed by repairTerraformEdgeBindings: the repair re-anchors
        // bindings but MUST NOT flatten this arrow back to a straight
        // 2-point chord (its endpoints are already the centre-clipped chord
        // endpoints; only interior waypoints were added).
        terraformRoutedPolyline: true,
        terraformRoutedBy: "route",
      },
    } as ExcalidrawElementSkeleton;
    meta.routed += 1;
    meta.waypointsTotal += route.waypoints;
  }

  return meta;
}
