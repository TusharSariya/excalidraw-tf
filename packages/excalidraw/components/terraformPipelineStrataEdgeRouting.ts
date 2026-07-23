/**
 * Strata Package C — post-A7 obstacle-avoiding edge routing (SDEC-59
 * follow-up; W9 battery terraformPipelineStrataRoutingSpike.test.ts), revised
 * by perf-exp E1.3 into a DIRECTION-AWARE SOFT ROUTER.
 *
 * Mode "penetrating-only": AFTER final geometry (post packedScoring guard,
 * post-A7, at scene-skeleton assembly), each rendered TFD arrow whose straight
 * centre-clipped chord passes through the INTERIOR of at least one FOREIGN
 * CARD (an unrelated primary-cluster card) is replaced by a polyline detour.
 * Every other arrow is left byte-identical; flag-off this module never runs.
 *
 * ── E1.3 obstacle classes (owner ruling: hull crossings are acceptable,
 * backward travel is worse, cards must still be avoided) ──
 *  - CARDS are HARD obstacles, inflated by STRATA_EDGE_ROUTING_CARD_CLEARANCE
 *    (24px — raised from 14 so detours hug cards less tightly).
 *  - HULLS are SOFT: non-ancestor hulls are NOT in the hard `blocks()` set any
 *    more. Instead every candidate polyline pays
 *    STRATA_EDGE_ROUTING_HULL_CROSSING_PENALTY per (segment × raw-hull-interior)
 *    crossing incidence in the cost. A short forward path across one hull line
 *    is now legal and usually beats the old long backward loop. The legacy
 *    14px hull clearance (strataEdgeRoutingClearance) is kept exported for the
 *    places where hulls remain relevant (tests / hull-side geometry); soft
 *    crossings themselves are counted against RAW hull interiors.
 *
 * ── E1.3 cost ──
 *    cost = L1(poly) + λ·backtrackXPx(poly) + γ_hull·hullCrossings(poly)
 *  with λ = STRATA_EDGE_ROUTING_BACKTRACK_LAMBDA (1.5) and γ_hull =
 *  STRATA_EDGE_ROUTING_HULL_CROSSING_PENALTY (40). Literature: Dwyer,
 *  Marriott & Wybrow (GD 2006) integrate edge routing as penalized poly-line
 *  cost minimization rather than hard feasibility; libavoid exposes the same
 *  direction bias as `reverseDirectionPenalty` — our λ·backtrackXPx term is
 *  its rectilinear analog. backtrackXPx = Σ max(0, −Δx) over segments,
 *  applied ONLY to net-forward edges (end.x > start.x). Net-BACKWARD declared
 *  edges are left direction-unpenalized: they are rare under LR strata and
 *  already orbit-handled by the strataEdgeStyle back-edge arm — mirroring the
 *  penalty (Σ max(0, +Δx)) would fight the orbit geometry for no gain.
 *
 * ── E1.3 candidate hygiene (net-forward edges only) ──
 *  Detour candidates any of whose corners lie left of
 *  min(start.x, end.x) − cardClearance are DROPPED (never even scored) — the
 *  old router's goofy backward loops entered the search here. Tie order is
 *  reversed to right-before-left (vertical-major) / below-before-above
 *  (horizontal-major), so exact cost ties now resolve forward/downward,
 *  deterministically (strict `<` keeps the earliest candidate).
 *
 * ── E1.3 spanner cap ──
 *  A found detour whose Euclidean polyline length exceeds
 *  STRATA_EDGE_ROUTING_T_DETOUR_CAP (1.8) × the chord's Euclidean length is
 *  discarded by the scene pass — the straight chord is kept (with whatever
 *  hull crossing that implies) and the edge is counted `cappedDetour`
 *  alongside the existing `unroutable` ledger.
 *
 * ── E1.3 acceptance split ──
 *  The scene-pass acceptance re-check rejects a detour only on raw foreign
 *  CARD penetration. Hull penetration is allowed — it was already paid for in
 *  the cost.
 *
 * ── E1.3 judgment calls (documented per the experiment brief) ──
 *  1. Eligibility narrowed to CARD penetration. A chord whose only foreign
 *     penetrations are hulls is, under the owner ruling, already the desired
 *     output — the router would return it unchanged (no hard blocker), so
 *     such edges are skipped early, stay byte-identical, and are NOT counted
 *     `unroutable` (keeping that ledger meaningful: it still means "a card is
 *     pierced and no clean route fit the cap").
 *  2. Soft-hull scoring integrates into the recursion by scoring COMPLETE
 *     candidate polylines at each recursion level (cost recomputed from the
 *     assembled geometry, never summed from child fragments) — no
 *     double-counting. Selection is greedy-hierarchical, not globally
 *     optimal, matching the pre-E1.3 structure.
 *  3. Recursion guard: hulls leaving the hard set strictly SHRINKS the
 *     blocker set (cards only), so there are fewer firstBlocker hits and
 *     fewer recursions than pre-E1.3; the waypoint budget still decreases by
 *     2 per nesting level, so termination is unchanged.
 *  4. `shortcut` keeps its hard-obstacle cleanliness test and additionally
 *     refuses to drop a waypoint when the bypass segment would INCREASE the
 *     soft-hull crossing count (L1 and backtrack are subadditive under
 *     waypoint removal, so only the hull term needs the guard).
 *  5. First-stamper-wins and provenance "route" are unchanged. Chord endpoints
 *     are the body-rect repair anchors when the shared authority resolves both
 *     keys (E1.5 — see `routeStrataSkeletonEdges` "ENDPOINTS = REPAIR ANCHORS"),
 *     else the frame-clipped chord (byte-identical to pre-E1.5). Eligibility,
 *     routing, the spanner cap and the write-back origin all use those endpoints.
 *
 * Earlier literature grounding (graph-layout corpus doc ids, W9 doc):
 *  - Wybrow/Marriott/Stuckey, Incremental Connector Routing
 *    (doi-10-1007-11618058-40); Bouts & Speckmann, Clustered Edge Routing
 *    (forward-10-1109-pacificvis-2015-7156356); Purchase
 *    (s2-10-1007-bfb0021827): bends are cheaper than crossings; Xu et al.
 *    2012 (doi-10-1109-tvcg-2012-189): deviate minimally from the chord.
 *
 * Determinism (C4′): no RNG, no clock. Edge order = skeleton emission order
 * (itself C4′-stable); obstacle order = hulls then cards, each code-unit
 * sorted by id; candidate order = below-before-above / right-before-left;
 * ties on cost keep the earliest candidate.
 *
 * Clearance: card clearance is the plain literal 24 (safe as a module-level
 * const). The legacy hull clearance PIPELINE_FRAME_PAD / 2 = 14px is computed
 * inside a function, never as a module-level const (SDEC-34: the
 * planParsing→layoutCore import cycle makes module-level consts derived from
 * terraformPipelineLayoutShared entry-order-dependent NaNs).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataEdgeRouting.test.ts --exclude "**\/.claude/**"
 */
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import { computeTerraformChordAnchors } from "./terraformEdgeAnchors";
import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";
import { segmentIntersectsStrataBoxInterior } from "./terraformPipelineStrataPackedScoring";
import { compareStrataContentKeys } from "./terraformPipelineStrataTypes";

// Type-only: the shared body-rect anchor authority `buildStrataEdgeStyleAnchors`
// produces (terraformPipelineStrataSceneBuild.ts). edgeStyle does NOT import this
// module, and this is a type-only import anyway, so there is no runtime cycle.
import type { StrataEdgeStyleAnchors } from "./terraformPipelineStrataEdgeStyle";
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

/** E1.3 — clearance around HARD obstacles (cards), px. Raised from the legacy
 * 14 so detours keep visibly clear of card borders. Plain literal, so a
 * module-level const is SDEC-34-safe. */
export const STRATA_EDGE_ROUTING_CARD_CLEARANCE = 24;

/** E1.3 λ — cost per backtracked X pixel (Σ max(0, −Δx) over segments) on
 * net-forward edges. See header: Dwyer/Marriott/Wybrow GD2006; libavoid
 * `reverseDirectionPenalty`. */
export const STRATA_EDGE_ROUTING_BACKTRACK_LAMBDA = 1.5;

/** E1.3 γ_hull — cost (px-equivalent) per (segment × hull-interior) crossing
 * incidence against RAW soft-hull boxes. */
export const STRATA_EDGE_ROUTING_HULL_CROSSING_PENALTY = 40;

/** E1.3 T_DETOUR_CAP — spanner cap: a detour whose Euclidean length exceeds
 * this multiple of its chord is discarded (chord kept, counted
 * `cappedDetour`). */
export const STRATA_EDGE_ROUTING_T_DETOUR_CAP = 1.8;

/** Legacy hull-side clearance (14px = PIPELINE_FRAME_PAD / 2), kept where
 * hulls remain relevant. Function, not const — see SDEC-34 note in header. */
export const strataEdgeRoutingClearance = (): number => PIPELINE_FRAME_PAD / 2;

export type StrataEdgeRoutingMeta = {
  /** Edges rewritten to a detour polyline. */
  routed: number;
  /** Eligible (card-penetrating) edges left straight: no clean route within
   * the waypoint cap, every blocker's clearance zone contains an endpoint, or
   * the found detour re-entered a raw foreign card. */
  unroutable: number;
  /** E1.3: eligible edges whose found detour exceeded the
   * STRATA_EDGE_ROUTING_T_DETOUR_CAP spanner bound — the straight chord is
   * kept (with whatever hull crossing that implies). */
  cappedDetour: number;
  /** Total interior waypoints added across all routed edges. */
  waypointsTotal: number;
};

type Pt = readonly [number, number];

/** Closed inflated obstacle in absolute px. */
type Inflated = { x0: number; y0: number; x1: number; y1: number };

/** E1.3 direction/soft context, computed ONCE per edge in routeStrataEdge and
 * threaded through the recursion (direction is a property of the WHOLE edge,
 * not of a sub-segment). */
type RouteCtx = {
  /** Net-forward edge (end.x > start.x): backtrack is penalized and left-
   * swinging candidates are dropped. Net-backward/vertical edges get neither
   * (rare + orbit-handled; see header). */
  forward: boolean;
  /** Hygiene floor: min(start.x, end.x) − cardClearance. Applied to candidate
   * corners of net-forward edges only. */
  xFloor: number;
  /** RAW foreign hull boxes — soft obstacles, crossed at γ_hull cost each. */
  softHulls: readonly StrataBox[];
};

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
 * The corner detours around an inflated blocker, deterministic order.
 * Chord-axis rule: a mostly-horizontal chord detours below/above (E1.3:
 * BELOW first); a mostly-vertical one detours right/left (E1.3: RIGHT
 * first) — cost ties resolve forward/downward. Corners are ordered along the
 * direction of travel. E1.3 hygiene: on net-forward edges, candidates with
 * any corner left of ctx.xFloor are dropped (no backward loops enter the
 * search).
 */
function detourCandidates(a: Pt, b: Pt, box: Inflated, ctx: RouteCtx): Pt[][] {
  let out: Pt[][];
  if (Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1])) {
    const xs: readonly [number, number] =
      a[0] <= b[0] ? [box.x0, box.x1] : [box.x1, box.x0];
    out = [
      [
        [xs[0], box.y1],
        [xs[1], box.y1],
      ], // below (first — ties resolve downward)
      [
        [xs[0], box.y0],
        [xs[1], box.y0],
      ], // above
    ];
  } else {
    const ys: readonly [number, number] =
      a[1] <= b[1] ? [box.y0, box.y1] : [box.y1, box.y0];
    out = [
      [
        [box.x1, ys[0]],
        [box.x1, ys[1]],
      ], // right (first — ties resolve forward)
      [
        [box.x0, ys[0]],
        [box.x0, ys[1]],
      ], // left
    ];
  }
  if (!ctx.forward) {
    return out;
  }
  return out.filter((corners) => corners.every((c) => c[0] >= ctx.xFloor));
}

const l1 = (poly: readonly Pt[]): number => {
  let s = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    s += Math.abs(poly[i + 1]![0] - poly[i]![0]);
    s += Math.abs(poly[i + 1]![1] - poly[i]![1]);
  }
  return s;
};

/** Σ max(0, −Δx) over segments — X pixels travelled backward. */
const backtrackXPx = (poly: readonly Pt[]): number => {
  let s = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    s += Math.max(0, poly[i]![0] - poly[i + 1]![0]);
  }
  return s;
};

/** Crossing incidences of one segment against RAW soft-hull interiors. */
const segmentHullCrossings = (
  a: Pt,
  b: Pt,
  hulls: readonly StrataBox[],
): number => {
  let n = 0;
  for (const h of hulls) {
    if (
      segmentIntersectsStrataBoxInterior(
        a[0],
        a[1],
        b[0],
        b[1],
        h.x,
        h.y,
        h.x + h.width,
        h.y + h.height,
      )
    ) {
      n += 1;
    }
  }
  return n;
};

const polylineHullCrossings = (
  poly: readonly Pt[],
  hulls: readonly StrataBox[],
): number => {
  let n = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    n += segmentHullCrossings(poly[i]!, poly[i + 1]!, hulls);
  }
  return n;
};

/** E1.3 candidate cost — computed from COMPLETE candidate geometry at each
 * recursion level (never summed from child fragments; see header note 2). */
const routeCost = (poly: readonly Pt[], ctx: RouteCtx): number =>
  l1(poly) +
  (ctx.forward
    ? STRATA_EDGE_ROUTING_BACKTRACK_LAMBDA * backtrackXPx(poly)
    : 0) +
  STRATA_EDGE_ROUTING_HULL_CROSSING_PENALTY *
    polylineHullCrossings(poly, ctx.softHulls);

/**
 * Route a→b around HARD `obstacles` with at most `remaining` interior
 * waypoints. Returns the polyline (a and b included) or null when no clean
 * route fits the budget. Recursive corner search: find the first blocker, try
 * its (hygiene-filtered) corner detours, repair each sub-segment recursively,
 * keep the candidate with minimal E1.3 cost (tie → earliest candidate). The
 * budget strictly decreases by 2 per nesting level, so the search always
 * terminates; with hulls out of the hard set the blocker set is strictly
 * smaller than pre-E1.3, so recursion volume can only shrink.
 */
function routeSegment(
  a: Pt,
  b: Pt,
  obstacles: readonly Inflated[],
  remaining: number,
  ctx: RouteCtx,
): Pt[] | null {
  const bi = firstBlocker(a, b, obstacles);
  if (bi < 0) {
    return [a, b];
  }
  if (remaining < 2) {
    return null;
  }
  let best: Pt[] | null = null;
  let bestCost = Infinity;
  for (const corners of detourCandidates(a, b, obstacles[bi]!, ctx)) {
    const anchor: Pt[] = [a, ...corners, b];
    let budget = remaining - corners.length;
    const pts: Pt[] = [anchor[0]!];
    let ok = true;
    for (let i = 0; i + 1 < anchor.length; i++) {
      const sub = routeSegment(
        anchor[i]!,
        anchor[i + 1]!,
        obstacles,
        budget,
        ctx,
      );
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
    const cost = routeCost(pts, ctx);
    if (cost < bestCost) {
      bestCost = cost;
      best = pts;
    }
  }
  return best;
}

/** Greedy single pass dropping interior waypoints whose bypass segment is
 * clean against HARD obstacles (Xu: minimal deviation) AND does not increase
 * the soft-hull crossing count (E1.3 guard — L1/backtrack are subadditive
 * under waypoint removal, the hull term is not). */
function shortcut(
  poly: readonly Pt[],
  obstacles: readonly Inflated[],
  ctx: RouteCtx,
): Pt[] {
  const out: Pt[] = [...poly];
  let i = 1;
  while (i + 1 < out.length) {
    const hardClean = firstBlocker(out[i - 1]!, out[i + 1]!, obstacles) < 0;
    const bypassHulls = hardClean
      ? segmentHullCrossings(out[i - 1]!, out[i + 1]!, ctx.softHulls)
      : Infinity;
    const keptHulls =
      segmentHullCrossings(out[i - 1]!, out[i]!, ctx.softHulls) +
      segmentHullCrossings(out[i]!, out[i + 1]!, ctx.softHulls);
    if (hardClean && bypassHulls <= keptHulls) {
      out.splice(i, 1);
    } else {
      i += 1;
    }
  }
  return out;
}

const euclideanLen = (poly: readonly Pt[]): number => {
  let s = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    s += Math.hypot(
      poly[i + 1]![0] - poly[i]![0],
      poly[i + 1]![1] - poly[i]![1],
    );
  }
  return s;
};

/** E1.3 spanner cap check: true when the polyline's Euclidean length exceeds
 * STRATA_EDGE_ROUTING_T_DETOUR_CAP × its own chord (first→last). Degenerate
 * zero-length chords never cap. */
export function strataDetourExceedsCap(points: readonly Pt[]): boolean {
  if (points.length < 2) {
    return false;
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
  if (!(chord > 0)) {
    return false;
  }
  return euclideanLen(points) > STRATA_EDGE_ROUTING_T_DETOUR_CAP * chord;
}

/**
 * Pure routing core: route start→end around HARD `obstacleBoxes` (raw,
 * uninflated — cards), treating `softHullBoxes` (raw foreign hulls) as
 * cost-only soft obstacles. Eligibility is the CALLER's job (raw CARD
 * interior penetration); this function inflates hard obstacles by
 * `clearance`, drops obstacles whose clearance zone contains an endpoint
 * (cannot route around a box you start inside), and returns the detour
 * polyline or null (no clean route within the cap, or the route degenerates
 * to the chord after the drop rule). The spanner cap is applied by the scene
 * pass (via strataDetourExceedsCap), which owns the telemetry split.
 */
export function routeStrataEdge(
  start: Pt,
  end: Pt,
  obstacleBoxes: readonly StrataBox[],
  clearance: number = STRATA_EDGE_ROUTING_CARD_CLEARANCE,
  softHullBoxes: readonly StrataBox[] = [],
): { points: Pt[]; waypoints: number } | null {
  const ctx: RouteCtx = {
    forward: end[0] > start[0],
    xFloor: Math.min(start[0], end[0]) - clearance,
    softHulls: softHullBoxes,
  };
  const inflated = obstacleBoxes
    .map((b) => inflate(b, clearance))
    .filter((b) => !insideInflated(start, b) && !insideInflated(end, b));
  const routed = routeSegment(
    start,
    end,
    inflated,
    STRATA_EDGE_ROUTING_MAX_WAYPOINTS,
    ctx,
  );
  if (routed === null) {
    return null;
  }
  const poly = shortcut(routed, inflated, ctx);
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
 * array, every TFD arrow whose straight chord penetrates a foreign CARD
 * (E1.3: hull-only penetrations are the desired output and stay untouched).
 * Non-penetrating arrows are untouched (byte-identical emission); soft-delete
 * semantics, bindings and relationship customData are preserved — only
 * `points`/`width`/`height` and (when `anchors` resolve, per E1.5) `x`/`y`
 * change.
 *
 * ── ENDPOINTS = REPAIR ANCHORS (wave-4 E1.5). ── When the shared body-rect
 * anchor authority (`buildStrataEdgeStyleAnchors`, terraformPipelineStrataScene-
 * Build.ts) resolves BOTH of an edge's endpoint keys, the chord `start`/`end` —
 * used for eligibility (card-penetration), obstacle routing, the spanner cap AND
 * the write-back origin — are `computeTerraformChordAnchors(bodyRectA, bodyRectB)`
 * (terraformEdgeAnchors.ts): the EXACT centre-clipped BODY-rect endpoints
 * `repairTerraformEdgeBindings` re-derives at element time. Because obstacle
 * tests and detours run on those real endpoints, the routed polyline's first/last
 * absolute points sit ON the body cards (chebyshev 0), so repair's validate-
 * before-trust gate (ROUTED_ANCHOR_TOLERANCE = 48px) KEEPS the
 * `terraformRoutedPolyline` stamp instead of flattening the detour. Previously
 * the endpoints were the leaf FRAME-clipped chord (el.x/el.y + last point), which
 * for tall composite cards sits >48px from the inset body rect — so repair
 * flattened those detours back to chords in FULL mode. A per-edge key MISS
 * (endpoint not a keyed body rect) falls back to the frame-clipped chord — exactly
 * the edges repair leaves unchanged (terraformVisibility.ts `!rectA || !rectB`
 * early return). Absent the `anchors` argument every edge takes the chord
 * fallback, byte-identical to the pre-E1.5 pass. `el.x`/`el.y` are re-anchored at
 * `poly[0]` (the routed polyline's first absolute point, which equals the derived
 * `start`) because `convertToExcalidrawElements` re-normalizes `points[0]`→[0,0]
 * anchored at `el.x`/`el.y`; an element whose first point drifted from the OLD
 * frame-clipped origin would otherwise be re-anchored back to it, discarding the
 * fix. In the fallback case `start === [el.x, el.y]`, so this is byte-identical.
 *
 * DEGENERATE <3-POINT COLLAPSE: not reachable here. `routeStrataEdge` only ever
 * returns a genuine detour (>2 points; it returns null when the route degenerates
 * to the chord), and the write-back preserves that array verbatim without a
 * simplify pass — so a stamped route polyline always has >2 points and never
 * trips repair's `points.length > 2` gate. (The channel router needed E1.2's
 * collinear-stub because it runs `simplifyPolyline` on write-back; this pass does
 * not.)
 *
 * @param anchors The shared body-rect anchor authority
 *   (`buildStrataEdgeStyleAnchors`). When supplied and BOTH of an edge's endpoint
 *   keys resolve, the chord endpoints are the body-clipped anchors repair re-
 *   derives; absent / a per-edge key miss ⇒ the frame-clipped chord (byte-
 *   identical to the pre-E1.5 pass).
 */
export function routeStrataSkeletonEdges(
  skeleton: ExcalidrawElementSkeleton[],
  model: StrataModel,
  placement: StrataPlacementResult,
  anchors?: StrataEdgeStyleAnchors,
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
    cappedDetour: 0,
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
    // First-stamper-wins: an arrow already routed by an earlier pass (clip /
    // channel) keeps its geometry and provenance. Without this skip a composed
    // `strataEdgeClip=1&strataEdgeRouting=1` (or `strataChannelRoute`) run
    // silently RE-ROUTES clip/channel-stamped edges here — overwriting
    // `terraformRoutedBy` and leaving a stale `terraformClipAnchor` behind (the
    // clip pass runs FIRST in assembleStrataSceneSkeleton). Mirror the idiom the
    // channel (:550) / border (:414) / style (:741) passes already use.
    if (el.customData?.terraformRoutedPolyline === true) {
      continue;
    }
    const pts = el.points;
    if (!Array.isArray(pts) || pts.length < 2) {
      continue;
    }
    const last = pts[pts.length - 1]!;
    // Default endpoints = the skeleton chord, clipped against the leaf FRAME box.
    // These are the endpoints repair leaves alone when an anchor is missing.
    let start: Pt = [el.x, el.y];
    let end: Pt = [el.x + last[0], el.y + last[1]];
    // Prefer the shared body-rect anchors (the SAME endpoints
    // `repairTerraformEdgeBindings` re-derives at element time) when BOTH endpoint
    // keys resolve to a card body rect — keyed exactly as repair keys them
    // (`customData.relationship` source/target). Eligibility, routing, the spanner
    // cap and the write-back origin ALL run on these real endpoints, so repair
    // finds the routed polyline already on its recomputed anchors and keeps the
    // stamp. A key miss falls back to the frame-clipped chord — the same edges
    // repair leaves unchanged (see the file header "ENDPOINTS = REPAIR ANCHORS").
    if (anchors) {
      const rectA = anchors.bodyRectByKey.get(rel.source);
      const rectB = anchors.bodyRectByKey.get(rel.target);
      if (rectA && rectB) {
        const pairKey = [rel.source, rel.target].sort().join("|||");
        const chord = computeTerraformChordAnchors(rectA, rectB, {
          structuralPair: anchors.structuralPairKeys.has(pairKey),
        });
        start = [chord.startPoint.x, chord.startPoint.y];
        end = [chord.endPoint.x, chord.endPoint.y];
      }
    }

    // Foreign boxes for THIS edge, split by E1.3 class: non-endpoint cards
    // are HARD, non-ancestor hulls are SOFT.
    const srcAnc = ancestors.get(rel.source);
    const tgtAnc = ancestors.get(rel.target);
    const foreignCards: StrataBox[] = [];
    const foreignHulls: StrataBox[] = [];
    for (const o of obstacles) {
      if (o.kind === "hull") {
        if (srcAnc?.has(o.id) || tgtAnc?.has(o.id)) {
          continue;
        }
        foreignHulls.push(o.box);
      } else {
        if (o.id === rel.source || o.id === rel.target) {
          continue;
        }
        foreignCards.push(o.box);
      }
    }

    // Eligibility (E1.3): the straight chord penetrates ≥1 RAW foreign CARD
    // interior. Hull-only penetrations keep the chord byte-identical — hull
    // crossings are acceptable by owner ruling, so there is nothing to fix.
    const penetratesCard = foreignCards.some((b) =>
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
    if (!penetratesCard) {
      continue;
    }

    const route = routeStrataEdge(
      start,
      end,
      foreignCards,
      STRATA_EDGE_ROUTING_CARD_CLEARANCE,
      foreignHulls,
    );
    if (route === null) {
      meta.unroutable += 1;
      continue;
    }
    // E1.3 spanner cap: a detour longer than T_DETOUR_CAP × chord is worse
    // than the pierce it fixes — keep the straight chord.
    if (strataDetourExceedsCap(route.points)) {
      meta.cappedDetour += 1;
      continue;
    }
    // Acceptance check ("never emit a worse mess"), E1.3 split: the detour
    // must be penetration-free against EVERY raw foreign CARD — including
    // obstacles the router dropped because their clearance zone contained an
    // endpoint (the detour itself may not enter them either). Hull
    // penetration is ALLOWED (already paid for in cost). Otherwise keep the
    // straight chord and count the edge unroutable.
    let detourClean = true;
    for (const b of foreignCards) {
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
    // Origin the element at the polyline's FIRST absolute point (`abs[0]` === the
    // derived `start`) so points[0] === [0,0] and el.x/el.y === that first point.
    // When the anchors resolved, that is the body-rect anchor repair re-derives —
    // `convertToExcalidrawElements` re-normalizes points[0]→[0,0] anchored at
    // el.x/el.y, so an element whose first point drifted from el.x/el.y would
    // otherwise be re-anchored back to the OLD frame-clipped origin, discarding
    // the fix. In the chord fallback, `start === [el.x, el.y]`, so this is
    // byte-identical (see the file header "ENDPOINTS = REPAIR ANCHORS").
    const [ox, oy] = start;
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
    // Defense-in-depth: drop any clip-pass markers before re-stamping. The
    // first-stamper skip above means we never actually re-route a clip edge, but
    // if one ever reached here its stale `terraformClipAnchor`/`terraformClipLane`
    // are inert to the repair gate yet serialize as garbage (and would inflate
    // the lane census); strip them so a "route" stamp is self-consistent.
    const {
      terraformClipAnchor: _staleClipAnchor,
      terraformClipLane: _staleClipLane,
      ...prevCustomData
    } = el.customData ?? {};
    skeleton[i] = {
      ...el,
      x: ox,
      y: oy,
      points: abs.map(([px, py]) => pointFrom<LocalPoint>(px - ox, py - oy)),
      width: maxX - minX,
      height: maxY - minY,
      customData: {
        ...prevCustomData,
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
