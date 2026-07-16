/**
 * Strata P3-pierce border-exit routing (Sander 1996 border-node insertion,
 * realized as a SAFE post-geometry polyline pass — the sibling of
 * terraformPipelineStrataEdgeRouting.ts).
 *
 * PROBLEM (P3-pierce). An edge from a source INSIDE a container hull (e.g.
 * vpc-5b587) to a region-level sink (vpc=none) OUTSIDE it slashes a long
 * diagonal through the container interior. By the Jordan-curve theorem the edge
 * MUST cross the boundary at least once — the crossing cannot be removed, only
 * made a single CLEAN exit at the facing side instead of a long interior
 * diagonal. This pass rewrites such an edge to `[start, W, end]` where W sits on
 * the boundary of the exited container, on the side facing the target.
 *
 * ORTHOGONAL BY CONSTRUCTION (the value story). Every existing accounting
 * system treats "exit your own ancestor hull" as LEGITIMATE and IGNORES it:
 *  - packed-scoring penetration term skips it (terraformPipelineStrataPacked-
 *    Scoring.ts "endpoint's own container/ancestor ⇒ legitimate passage");
 *  - computePierceMetrics skips it (terraformPipelineStrataPierceMetrics.ts
 *    `isPrefix(f.path, src.path) || isPrefix(f.path, tgt.path)`);
 *  - the edge router deliberately makes ancestor hulls PERMEABLE
 *    (terraformPipelineStrataEdgeRouting.ts "endpoints' own ancestor hulls stay
 *    permeable").
 * So this pass CANNOT move crossings / penetrations / lengthL1 / pierce.total —
 * default-off byte-identity is trivial and it can never regress a scored
 * objective. The payoff is UN-SCORED readability (clean side exit vs interior
 * diagonal); the new `interiorLenSavedL1` meta is what observes it.
 *
 * WHY NOT true in-layering Sander tonight: real Sander inserts the border node
 * during layering so the dummy chain participates in ordering/crossing-min. That
 * touches rankSeparate + ordering + placement (forbidden) and is high-risk. The
 * post-geometry realization delivers the same visible result (single clean side
 * exit) additively. Its one limitation: it cannot REORDER multiple edges that
 * exit the same side (mitigated by anchoring W to each edge's own chord
 * crossing, which spreads exits by source position).
 *
 * Determinism (C4′): no RNG, no clock. Edge order = skeleton emission order;
 * exit-box order = area (nesting); side/candidate ties fixed deterministically.
 * Clearance is computed inside the function, never as a module-level const
 * (SDEC-34: the planParsing→layoutCore import cycle makes such consts
 * entry-order-dependent NaNs).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataBorderRoute.test.ts --exclude "**\/.claude/**"
 */
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import {
  STRATA_EDGE_ROUTING_MAX_WAYPOINTS,
  strataEdgeRoutingClearance,
} from "./terraformPipelineStrataEdgeRouting";
import { segmentIntersectsStrataBoxInterior } from "./terraformPipelineStrataPackedScoring";
import { compareStrataContentKeys } from "./terraformPipelineStrataTypes";

import type {
  StrataBox,
  StrataHullNode,
  StrataModel,
  StrataPlacementResult,
} from "./terraformPipelineStrataTypes";

export type StrataBorderRouteMeta = {
  /** TFD arrows rewritten to a clean single-side container exit. */
  routed: number;
  /** Eligible edges left straight: the detour would re-penetrate the exited
   * box or newly penetrate a foreign box (never emit worse). */
  unclean: number;
  /** Eligible edges left straight: the side exit did not strictly shorten the
   * interior span (no readability improvement to bank). */
  noGain: number;
  /** Total interior waypoints added across all routed edges. */
  waypointsTotal: number;
  /** Σ (straight interior span − routed interior span), L1 px. A conservative
   * lower-bound accountant (it credits only the outermost box's interior span),
   * so it badly UNDER-reads the visible change; prefer `maxWaypointPerpDev`
   * below as the headline effect scalar. */
  interiorLenSavedL1: number;
  /** Max perpendicular deviation (px) of any inserted waypoint from its edge's
   * straight start→end chord, over all routed edges. This is the faithful
   * headline: how far the clean side-exit staircase pulls the polyline off the
   * interior diagonal (interiorLenSavedL1 under-measures it ~20×). */
  maxWaypointPerpDev: number;
};

type Pt = readonly [number, number];

type Side = "L" | "R" | "T" | "B";

const L1 = (a: Pt, b: Pt): number =>
  Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);

const box0 = (b: StrataBox) => ({
  x0: b.x,
  y0: b.y,
  x1: b.x + b.width,
  y1: b.y + b.height,
});

/** Strict-interior containment (open box), matching
 * segmentIntersectsStrataBoxInterior's `>`/`<` slab test. */
const strictlyInside = (p: Pt, b: StrataBox): boolean => {
  const q = box0(b);
  return p[0] > q.x0 && p[0] < q.x1 && p[1] > q.y0 && p[1] < q.y1;
};

/**
 * The side of `b` whose outward normal faces `end`, given `start` is inside.
 * Pick the axis of larger overshoot (end beyond that side); ties prefer the
 * horizontal axis, then (within an axis tie) the nearer face. Guaranteed a real
 * side because `end` is outside `b` (checked by the caller) ⇒ overshoot > 0 on
 * at least one axis.
 */
const facingSide = (b: StrataBox, end: Pt): Side => {
  const q = box0(b);
  const overRight = Math.max(0, end[0] - q.x1);
  const overLeft = Math.max(0, q.x0 - end[0]);
  const overBottom = Math.max(0, end[1] - q.y1);
  const overTop = Math.max(0, q.y0 - end[1]);
  const hOver = Math.max(overRight, overLeft);
  const vOver = Math.max(overBottom, overTop);
  if (hOver >= vOver) {
    return overRight >= overLeft ? "R" : "L";
  }
  return overBottom >= overTop ? "B" : "T";
};

/**
 * Border waypoint on `side` of `b`, at the straight chord's crossing of that
 * side's line, clamped to the side segment inset by `pad`. If the side is
 * shorter than 2·pad the crossing is placed at the side midpoint. The chord's
 * denominator is nonzero on the chosen axis (the facing side always has a
 * positive overshoot ⇒ start/end straddle the side's line).
 */
const borderWaypoint = (
  b: StrataBox,
  side: Side,
  start: Pt,
  end: Pt,
  pad: number,
): Pt => {
  const q = box0(b);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const clamp = (v: number, lo: number, hi: number): number =>
    lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
  if (side === "L" || side === "R") {
    const x = side === "L" ? q.x0 : q.x1;
    const y = dx === 0 ? start[1] : start[1] + ((x - start[0]) * dy) / dx;
    return [x, clamp(y, q.y0 + pad, q.y1 - pad)];
  }
  const y = side === "T" ? q.y0 : q.y1;
  const x = dy === 0 ? start[0] : start[0] + ((y - start[1]) * dx) / dy;
  return [clamp(x, q.x0 + pad, q.x1 - pad), y];
};

/** L1 length of the straight chord start→end clipped to `b`'s interior, given
 * `start` is strictly inside. Exit param t* is the first face the ray leaves
 * through (or 1 if `end` is also inside). */
const straightInteriorL1 = (start: Pt, end: Pt, b: StrataBox): number => {
  const q = box0(b);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  let t = 1;
  if (dx > 0) {
    t = Math.min(t, (q.x1 - start[0]) / dx);
  } else if (dx < 0) {
    t = Math.min(t, (q.x0 - start[0]) / dx);
  }
  if (dy > 0) {
    t = Math.min(t, (q.y1 - start[1]) / dy);
  } else if (dy < 0) {
    t = Math.min(t, (q.y0 - start[1]) / dy);
  }
  return t * (Math.abs(dx) + Math.abs(dy));
};

/** leaf clusterId → ids of every hull whose subtree contains it (local copy of
 * the edge-routing helper; the 10-line walk is pinned by the unit tests). */
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
 * Scene-level pass: rewrite, IN PLACE in the skeleton array, every TFD arrow
 * that leaves its own ancestor container(s) as a long interior diagonal, giving
 * it a clean single-side exit. Endpoints (`x`/`y` and the final absolute point)
 * NEVER move — only interior waypoints are inserted. Non-eligible arrows are
 * untouched (byte-identical); flag-off this module never runs.
 */
export function routeStrataBorderExits(
  skeleton: ExcalidrawElementSkeleton[],
  model: StrataModel,
  placement: StrataPlacementResult,
): StrataBorderRouteMeta {
  const ancestors = leafAncestorsOf(model.hullRoot);
  const pad = strataEdgeRoutingClearance();

  // Hull obstacle boxes (excluding root) + leaf card boxes, deterministic order.
  const hullBox = new Map<string, StrataBox>();
  for (const [id, boxed] of placement.boxedHulls) {
    if (id !== model.hullRoot.id) {
      hullBox.set(id, boxed.box);
    }
  }
  type Obstacle = { id: string; kind: "hull" | "card"; box: StrataBox };
  const obstacles: Obstacle[] = [];
  for (const id of [...hullBox.keys()].sort(compareStrataContentKeys)) {
    obstacles.push({ id, kind: "hull", box: hullBox.get(id)! });
  }
  for (const id of [...placement.leafBoxes.keys()].sort(
    compareStrataContentKeys,
  )) {
    obstacles.push({ id, kind: "card", box: placement.leafBoxes.get(id)! });
  }

  const meta: StrataBorderRouteMeta = {
    routed: 0,
    unclean: 0,
    noGain: 0,
    waypointsTotal: 0,
    interiorLenSavedL1: 0,
    maxWaypointPerpDev: 0,
  };

  /** Perpendicular distance (px) of `p` from the infinite line through a→b. */
  const perpDist = (p: Pt, a: Pt, b: Pt): number => {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const len = Math.hypot(abx, aby);
    if (len === 0) {
      return 0;
    }
    return Math.abs(abx * (p[1] - a[1]) - aby * (p[0] - a[0])) / len;
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
    // Yield to edgeRouting so the two passes own genuinely DISJOINT edge sets.
    // edgeRouting stamps this exact marker on any arrow it detoured around a
    // FOREIGN box; re-deriving `[start, W, end]` here from only el.x/el.y + the
    // last point would DISCARD those interior waypoints, and guard (c) below —
    // which tests the STRAIGHT chord for pre-existing foreign hits — could then
    // wave through a re-pierce of a box edgeRouting specifically detoured. Skip
    // it: whichever pass fired first keeps the edge.
    if (el.customData?.terraformRoutedPolyline === true) {
      continue;
    }
    const pts = el.points;
    if (!Array.isArray(pts) || pts.length < 2) {
      continue;
    }
    const sx = el.x;
    const sy = el.y;
    const lastPt = pts[pts.length - 1]!;
    const start: Pt = [sx, sy];
    const end: Pt = [sx + lastPt[0], sy + lastPt[1]];

    const srcAnc = ancestors.get(rel.source);
    const tgtAnc = ancestors.get(rel.target);
    if (!srcAnc) {
      continue;
    }
    // EXIT SET: hulls the edge legitimately LEAVES — ancestor of source, not of
    // target (the mirror image of edgeRouting's foreign set). Ordered by area
    // (nesting): innermost first, outermost last.
    const exitBoxes: { id: string; box: StrataBox }[] = [];
    for (const id of [...srcAnc].sort(compareStrataContentKeys)) {
      if (tgtAnc?.has(id)) {
        continue;
      }
      const box = hullBox.get(id);
      if (box) {
        exitBoxes.push({ id, box });
      }
    }
    if (exitBoxes.length === 0) {
      continue; // no ancestor exit — edgeRouting owns foreign-box detours.
    }
    if (exitBoxes.length > STRATA_EDGE_ROUTING_MAX_WAYPOINTS) {
      meta.unclean += 1;
      continue; // waypoint cap: never emit an over-bent mess.
    }
    exitBoxes.sort(
      (a, b) => a.box.width * a.box.height - b.box.width * b.box.height,
    );
    const outer = exitBoxes[exitBoxes.length - 1]!.box;

    // Degenerate guards: start must be strictly inside the outermost box and
    // end strictly outside it, else the "single clean exit" is ill-defined.
    if (!strictlyInside(start, outer) || strictlyInside(end, outer)) {
      continue;
    }
    const side = facingSide(outer, end);

    // Interior waypoints: one per exit box on the SAME facing side, inner→outer.
    const waypoints: Pt[] = exitBoxes.map(({ box }) =>
      borderWaypoint(box, side, start, end, pad),
    );
    const wOuter = waypoints[waypoints.length - 1]!;

    // Never emit worse (1): the routed interior span must STRICTLY shorten the
    // straight interior diagonal through the outermost box.
    const straightSpan = straightInteriorL1(start, end, outer);
    let routedSpan = L1(start, waypoints[0]!);
    for (let w = 0; w + 1 < waypoints.length; w++) {
      routedSpan += L1(waypoints[w]!, waypoints[w + 1]!);
    }
    if (!(routedSpan < straightSpan)) {
      meta.noGain += 1;
      continue;
    }

    const poly: Pt[] = [start, ...waypoints, end];

    // Never emit worse (2): the exit segment W→end must not re-penetrate the
    // outermost box interior (exactly-one-crossing guarantee).
    if (
      segmentIntersectsStrataBoxInterior(
        wOuter[0],
        wOuter[1],
        end[0],
        end[1],
        outer.x,
        outer.y,
        outer.x + outer.width,
        outer.y + outer.height,
      )
    ) {
      meta.unclean += 1;
      continue;
    }

    // Never emit worse (3): the detour must not NEWLY penetrate any foreign box
    // (ancestor of neither endpoint, nor an endpoint card) that the straight
    // chord did not already pierce.
    let newForeign = false;
    for (const o of obstacles) {
      if (o.kind === "hull") {
        if (srcAnc.has(o.id) || tgtAnc?.has(o.id)) {
          continue;
        }
      } else if (o.id === rel.source || o.id === rel.target) {
        continue;
      }
      const q = box0(o.box);
      const straightHit = segmentIntersectsStrataBoxInterior(
        start[0],
        start[1],
        end[0],
        end[1],
        q.x0,
        q.y0,
        q.x1,
        q.y1,
      );
      if (straightHit) {
        continue; // pre-existing pierce — routing did not create it.
      }
      for (let s = 0; s + 1 < poly.length; s++) {
        if (
          segmentIntersectsStrataBoxInterior(
            poly[s]![0],
            poly[s]![1],
            poly[s + 1]![0],
            poly[s + 1]![1],
            q.x0,
            q.y0,
            q.x1,
            q.y1,
          )
        ) {
          newForeign = true;
          break;
        }
      }
      if (newForeign) {
        break;
      }
    }
    if (newForeign) {
      meta.unclean += 1;
      continue;
    }

    // Accept: rewrite in place, el-relative points, bbox extents, marker set so
    // repairTerraformEdgeBindings does not flatten the polyline back to a chord.
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of poly) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    skeleton[i] = {
      ...el,
      points: poly.map(([px, py]) => pointFrom<LocalPoint>(px - sx, py - sy)),
      width: maxX - minX,
      height: maxY - minY,
      customData: {
        ...(el.customData ?? {}),
        terraformRoutedPolyline: true,
      },
    } as ExcalidrawElementSkeleton;
    meta.routed += 1;
    meta.waypointsTotal += waypoints.length;
    meta.interiorLenSavedL1 += straightSpan - routedSpan;
    for (const w of waypoints) {
      meta.maxWaypointPerpDev = Math.max(
        meta.maxWaypointPerpDev,
        perpDist(w, start, end),
      );
    }
  }

  return meta;
}
