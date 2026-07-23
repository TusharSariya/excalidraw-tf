/**
 * Strata edge SMOOTHING pass (loop-3 E3.1 — GLEE lineage: Nachmanson/
 * Robertson/Lee GD2007 "refine, straighten, smooth", adapted to Excalidraw
 * through-point polylines). A final finishing pass over every STAMPED routed
 * polyline — all four router provenances (`channel` / `route` / `border`) plus
 * the container-boundary `clip` pass — that runs AFTER all the stampers and
 * BEFORE convert/repair in `assembleStrataSceneSkeleton`. Curve-STYLED
 * (`terraformRoutedBy:"style"`) records are SKIPPED: E1.1 already renders them
 * as dense exact-path samples (`roundness:null`), so they are smooth by
 * construction.
 *
 * WHY: the routed/clipped polylines keep the shared TFD emitter's
 * `roundness:{type:2}`, so RoughJS draws a Catmull-Rom THROUGH all their
 * points — bulging outside rectilinear runs (long E2.4 clip lanes render as
 * giant arcs; hull port chains as S-wiggles). The pass both simplifies the
 * polyline AND forces `roundness:null` so the rendered stroke is EXACTLY the
 * computed path (the same rationale as the style pass's E1.1 fix).
 *
 * FOUR STEPS, all per-edge and purely geometric:
 *  1. INFLECTION SHORTCUT: for consecutive points a,b,c,d where the turn
 *     direction flips at b→c (an S-kink), delete b when triangle (a,b,c)
 *     intersects no CARD body rect (hull INTERIORS are deliberately untested —
 *     the cheap obstacle class). Iterated to a fixpoint, so staircases
 *     straighten into clean diagonals where the corridor is clear.
 *  2. COLLINEAR DEDUPE: interior points collinear with their neighbours (and
 *     consecutive duplicates) are dropped. Endpoints always survive, and the
 *     polyline NEVER drops below 3 points — repair's routed-marker gate is
 *     `points.length > 2` — so a fully-straight result retains one interior
 *     midpoint (the E1.2 channel-router pattern; rendered geometry unchanged).
 *  3. CORNER ROUNDING VIA THROUGH-POINTS: each remaining genuine corner a,b,c
 *     is chamfered — insert m = a + k·(b−a) and n = c + k·(b−c) and drop b —
 *     with k escalating {1/2, 3/4, 7/8} until the cut corner region (triangle
 *     m,b,n) misses every card rect inflated by
 *     {@link STRATA_EDGE_SMOOTH_INFLATION_PX}. A corner no k clears stays
 *     sharp (counted, never forced). Total points per edge are budgeted at
 *     {@link STRATA_EDGE_SMOOTH_POINT_BUDGET} (lanes are long).
 *  4. ROUNDNESS DISCIPLINE: every processed record gets `roundness:null` —
 *     the rendered path IS the computed polyline. The waviness and the giant
 *     lane arcs die here, even on edges whose points needed no change.
 *
 * LR-DISCIPLINE GUARD (steps 1 and 3): a candidate's NEW segment (the
 * shortcut chord a–c / the chamfer cut m–n) must not cross any hull frame's
 * TOP or BOTTOM border. The clip pass crosses hull walls exclusively through
 * side faces (wrongFaceCrossings ≡ 0 by construction), and a hull-blind
 * diagonal could cut a hull CORNER — entering through the top face and
 * re-introducing exactly the wrong-face crossings the clip discipline
 * eliminated (measured: 48 on the owner arm without this guard). Testing two
 * horizontal border segments per hull is still the cheap class — no interior
 * containment tests, no port bookkeeping.
 *
 * LEAF-FRAME OBSTACLE CLASS (steps 1 and 3, loop-3 P0-a): the clip pass routes
 * AROUND foreign leaf-cluster (primary/satellite) frames; a hull-blind shortcut
 * or chamfer could re-cut one. So the shortcut triangle and the chamfer corner
 * region are cleared against foreign leaf-cluster frame rects too — a THIRD
 * obstacle class beside cards and the hull-face guard — with each edge's OWN
 * source/target cluster frames EXEMPT (a clip endpoint sits on its own frame's
 * border; same exemption the clip census uses). Absent leaf rects this is inert
 * (byte-identical for card+hull-only callers).
 *
 * SELF-CROSSING GUARD (steps 1 and 3, loop-3 P1-a): a shortcut chord a–c or a
 * chamfer cut m–n is rejected if it STRICTLY crosses any non-adjacent segment of
 * the SAME polyline — a deletion that would fold the polyline over itself is
 * refused (the kink/corner is kept instead).
 *
 * HARD CONSTRAINTS (adversarially verified in loop 2 — violating any gets the
 * edge flattened downstream by `repairTerraformEdgeBindings`):
 *  - ENDPOINTS NEVER MOVE. The clip gate is ±2px on the frame face and the
 *    card-anchored gate is 48px; this pass spends NONE of either budget —
 *    points[0] and points[last] are byte-identical in and out.
 *  - `terraformRoutedBy` provenance is NEVER restamped;
 *    `terraformClipAnchor` / `terraformClipLane` are untouched (customData is
 *    carried through by reference).
 *  - ≥3 points always (step 2's midpoint retention).
 *  - Endpoints fixed ⇒ origin fixed: el.x/el.y are never rewritten (the
 *    established write-back re-origins at poly[0], which this pass never
 *    moves), so no re-origin is needed — only `points`/`width`/`height`/
 *    `roundness` change.
 *
 * Determinism (C4′): no RNG, no clock; pure function of the polylines + card
 * rects. All iteration orders are array orders.
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataEdgeSmooth.test.ts
 */
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import type { EdgeAnchorRect } from "./terraformEdgeAnchors";

/** Card-rect inflation for the corner-rounding clearance test (px). Rounding
 * must never ADD a card touch: the chamfer segment lies inside triangle
 * (m,b,n), so a triangle clearing every 12px-inflated card keeps the new path
 * ≥12px from every card body. */
export const STRATA_EDGE_SMOOTH_INFLATION_PX = 12;
/** Max points per smoothed edge (post-rounding). Clip lanes are long — each
 * rounded corner nets +1 point, so the budget caps the chamfer count, never
 * the pre-existing waypoints. */
export const STRATA_EDGE_SMOOTH_POINT_BUDGET = 16;
/** Corner-cut escalation ladder: fraction of each adjacent segment KEPT
 * between the neighbour and the cut point (higher k ⇒ smaller cut). */
export const STRATA_EDGE_SMOOTH_CORNER_KS = [1 / 2, 3 / 4, 7 / 8] as const;
/** Corners whose shorter adjacent segment is below this are not chamfer
 * candidates — the inserted points would be sub-pixel noise. */
export const STRATA_EDGE_SMOOTH_MIN_SEGMENT_PX = 8;

const EPS = 1e-6;

export type StrataEdgeSmoothMeta = {
  /** Routed polylines the pass processed (roundness forced off; geometry
   * simplified where clear). All four router provenances + clip. */
  smoothed: number;
  /** Curve/step-styled `"style"`-provenance records skipped — E1.1 already
   * renders them exact-path. */
  skippedStyle: number;
  /** Stamped records the pass could not process (unknown provenance or a
   * degenerate <3-point polyline) — left byte-identical. */
  skippedUnrouted: number;
  /** Interior S-kink points deleted by the inflection shortcut (step 1). */
  kinksRemoved: number;
  /** Collinear/duplicate interior points removed (step 2). */
  collinearRemoved: number;
  /** Corners chamfer-rounded (m,n inserted, b dropped; step 3). */
  cornersRounded: number;
  /** Corners left sharp because no k in the ladder cleared the inflated card
   * rects. */
  cornersBlocked: number;
  /** Corners left sharp because the per-edge point budget was exhausted. */
  cornersBudget: number;
  /** Edges whose dedupe would have gone below 3 points and therefore retained
   * one interior midpoint (the ≥3-point floor). */
  midpointRetained: number;
  /** Σ polyline points across processed edges, before / after. */
  pointsBefore: number;
  pointsAfter: number;
};

type Pt = readonly [number, number];

/** A foreign leaf-cluster (primary/satellite) frame the smoother must NOT re-cut,
 * keyed by its cluster `address` (`terraformPrimaryAddress`) so each edge can
 * EXEMPT its own source/target cluster frames — the identical exemption the clip
 * census applies (a clip endpoint legitimately sits ON its own frame's border).
 * See {@link smoothStrataRoutedEdges}. */
export type StrataLeafFrameRect = {
  address: string;
  rect: EdgeAnchorRect;
};

type ArrowSkeleton = ExcalidrawElementSkeleton & {
  type: "arrow";
  x: number;
  y: number;
  points?: ReadonlyArray<readonly [number, number]>;
  customData?: Record<string, unknown>;
};

/** The stamped provenances this pass owns. `"style"` is deliberately absent
 * (already smooth, E1.1); anything else unknown is left untouched. */
const SMOOTHABLE_PROVENANCE: ReadonlySet<string> = new Set([
  "channel",
  "route",
  "border",
  "clip",
]);

/** Shared empty obstacle list — reused for the leaf-frame default so the
 * byte-identical (no leaf frames) path allocates nothing per edge. */
const EMPTY_RECTS: readonly EdgeAnchorRect[] = [];

/** The cluster addresses an edge legitimately touches — its own source/target.
 * Read from BOTH the typed `terraformClipAnchor` frameKeys and the
 * `relationship` source/target (the identical keys the clip census exempts by),
 * so a clip endpoint sitting ON its own leaf frame border is never treated as a
 * self-cut. Provenances without either simply exempt nothing. */
const ownClusterAddresses = (
  cd: Record<string, unknown> | undefined,
): ReadonlySet<string> => {
  const own = new Set<string>();
  const rel = cd?.relationship as
    | { source?: unknown; target?: unknown }
    | undefined;
  if (typeof rel?.source === "string") {
    own.add(rel.source);
  }
  if (typeof rel?.target === "string") {
    own.add(rel.target);
  }
  const anchor = cd?.terraformClipAnchor as
    | { start?: { frameKey?: unknown }; end?: { frameKey?: unknown } }
    | undefined;
  if (typeof anchor?.start?.frameKey === "string") {
    own.add(anchor.start.frameKey);
  }
  if (typeof anchor?.end?.frameKey === "string") {
    own.add(anchor.end.frameKey);
  }
  return own;
};

/** Signed turn (z of the cross product) at b for the path a→b→c. */
const orient = (a: Pt, b: Pt, c: Pt): number =>
  (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);

const turnSign = (a: Pt, b: Pt, c: Pt): number => {
  const o = orient(a, b, c);
  if (o > EPS) {
    return 1;
  }
  if (o < -EPS) {
    return -1;
  }
  return 0;
};

const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

const samePoint = (a: Pt, b: Pt): boolean =>
  Math.abs(a[0] - b[0]) <= EPS && Math.abs(a[1] - b[1]) <= EPS;

/** Closed point-in-rect (rect given as x/y/width/height). */
const pointInRect = (p: Pt, r: EdgeAnchorRect): boolean =>
  p[0] >= r.x && p[0] <= r.x + r.width && p[1] >= r.y && p[1] <= r.y + r.height;

/** Closed point-in-triangle via same-side orientation signs (degenerate
 * triangles return false — the caller handles them as segments). */
const pointInTriangle = (p: Pt, a: Pt, b: Pt, c: Pt): boolean => {
  const d1 = orient(a, b, p);
  const d2 = orient(b, c, p);
  const d3 = orient(c, a, p);
  const hasNeg = d1 < -EPS || d2 < -EPS || d3 < -EPS;
  const hasPos = d1 > EPS || d2 > EPS || d3 > EPS;
  return !(hasNeg && hasPos);
};

/** Proper/improper segment intersection (closed; collinear overlap counts). */
const segmentsIntersect = (p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean => {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (
    ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
    ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
  ) {
    return true;
  }
  const onSeg = (a: Pt, b: Pt, p: Pt): boolean =>
    Math.abs(orient(a, b, p)) <= EPS &&
    p[0] >= Math.min(a[0], b[0]) - EPS &&
    p[0] <= Math.max(a[0], b[0]) + EPS &&
    p[1] >= Math.min(a[1], b[1]) - EPS &&
    p[1] <= Math.max(a[1], b[1]) + EPS;
  return (
    onSeg(p3, p4, p1) ||
    onSeg(p3, p4, p2) ||
    onSeg(p1, p2, p3) ||
    onSeg(p1, p2, p4)
  );
};

/** STRICT (proper) crossing only: both segments straddle each other's supporting
 * line with the endpoints on OPPOSITE sides (no collinear-overlap / shared-
 * endpoint / touching case). Used by the self-crossing guard — a shortcut chord
 * or chamfer cut that merely shares an endpoint with, or grazes, a neighbouring
 * segment is fine; only a genuine interior crossing makes the polyline
 * self-intersect. */
const segmentsProperlyCross = (p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean => {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return (
    ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
    ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
  );
};

/** Self-crossing guard: does candidate segment [p,q] strictly cross any segment
 * of `poly` OTHER than those in the inclusive index window [skipLo, skipHi]?
 * The window skips the segments incident to the candidate's own endpoints (and
 * the segments the candidate replaces) — those necessarily touch it and are not
 * self-crossings. Any other proper crossing means the simplification would make
 * the polyline self-intersect, so the candidate must be rejected. */
const segmentCrossesOwnPolyline = (
  p: Pt,
  q: Pt,
  poly: readonly Pt[],
  skipLo: number,
  skipHi: number,
): boolean => {
  for (let k = 0; k + 1 < poly.length; k++) {
    if (k >= skipLo && k <= skipHi) {
      continue;
    }
    if (segmentsProperlyCross(p, q, poly[k]!, poly[k + 1]!)) {
      return true;
    }
  }
  return false;
};

const rectCorners = (r: EdgeAnchorRect): [Pt, Pt, Pt, Pt] => [
  [r.x, r.y],
  [r.x + r.width, r.y],
  [r.x + r.width, r.y + r.height],
  [r.x, r.y + r.height],
];

const segmentIntersectsRect = (a: Pt, b: Pt, r: EdgeAnchorRect): boolean => {
  if (pointInRect(a, r) || pointInRect(b, r)) {
    return true;
  }
  const [c0, c1, c2, c3] = rectCorners(r);
  return (
    segmentsIntersect(a, b, c0, c1) ||
    segmentsIntersect(a, b, c1, c2) ||
    segmentsIntersect(a, b, c2, c3) ||
    segmentsIntersect(a, b, c3, c0)
  );
};

/**
 * Does triangle (a,b,c) intersect the rect's interior? The rect is DEFLATED by
 * a hairline (0.5px) so a triangle that merely TOUCHES a card border — the
 * card-anchored routers put polyline endpoints exactly ON card borders — does
 * not count as a hit. Degenerate (collinear) triangles are tested as the two
 * segments they are.
 */
export const triangleIntersectsRect = (
  a: Pt,
  b: Pt,
  c: Pt,
  rect: EdgeAnchorRect,
): boolean => {
  const shrink = Math.min(0.5, rect.width / 4, rect.height / 4);
  const r: EdgeAnchorRect = {
    x: rect.x + shrink,
    y: rect.y + shrink,
    width: Math.max(0, rect.width - 2 * shrink),
    height: Math.max(0, rect.height - 2 * shrink),
  };
  // Quick bbox reject.
  const minX = Math.min(a[0], b[0], c[0]);
  const maxX = Math.max(a[0], b[0], c[0]);
  const minY = Math.min(a[1], b[1], c[1]);
  const maxY = Math.max(a[1], b[1], c[1]);
  if (
    maxX < r.x ||
    minX > r.x + r.width ||
    maxY < r.y ||
    minY > r.y + r.height
  ) {
    return false;
  }
  if (Math.abs(orient(a, b, c)) <= EPS) {
    // Degenerate triangle — a polyline run; test the two segments.
    return segmentIntersectsRect(a, b, r) || segmentIntersectsRect(b, c, r);
  }
  if (pointInRect(a, r) || pointInRect(b, r) || pointInRect(c, r)) {
    return true;
  }
  for (const corner of rectCorners(r)) {
    if (pointInTriangle(corner, a, b, c)) {
      return true;
    }
  }
  return (
    segmentIntersectsRect(a, b, r) ||
    segmentIntersectsRect(b, c, r) ||
    segmentIntersectsRect(c, a, r)
  );
};

const inflate = (r: EdgeAnchorRect, by: number): EdgeAnchorRect => ({
  x: r.x - by,
  y: r.y - by,
  width: r.width + 2 * by,
  height: r.height + 2 * by,
});

const triangleClearOfRects = (
  a: Pt,
  b: Pt,
  c: Pt,
  rects: readonly EdgeAnchorRect[],
): boolean => {
  for (const r of rects) {
    if (triangleIntersectsRect(a, b, c, r)) {
      return false;
    }
  }
  return true;
};

/** LR-discipline guard: does segment [p,q] cross any hull's TOP or BOTTOM
 * border? (See the header — a smoothing diagonal must never cut a hull corner
 * through a horizontal face.) */
const segmentCrossesHullHorizontalFace = (
  p: Pt,
  q: Pt,
  hullRects: readonly EdgeAnchorRect[],
): boolean => {
  const minX = Math.min(p[0], q[0]);
  const maxX = Math.max(p[0], q[0]);
  const minY = Math.min(p[1], q[1]);
  const maxY = Math.max(p[1], q[1]);
  for (const r of hullRects) {
    if (maxX < r.x || minX > r.x + r.width) {
      continue;
    }
    const top: [Pt, Pt] = [
      [r.x, r.y],
      [r.x + r.width, r.y],
    ];
    const bottom: [Pt, Pt] = [
      [r.x, r.y + r.height],
      [r.x + r.width, r.y + r.height],
    ];
    if (
      (maxY >= r.y && minY <= r.y && segmentsIntersect(p, q, top[0], top[1])) ||
      (maxY >= r.y + r.height &&
        minY <= r.y + r.height &&
        segmentsIntersect(p, q, bottom[0], bottom[1]))
    ) {
      return true;
    }
  }
  return false;
};

/** Step 1 — inflection shortcut to a fixpoint. Returns [points, deletions]. */
const shortcutInflections = (
  pts: Pt[],
  cardRects: readonly EdgeAnchorRect[],
  hullRects: readonly EdgeAnchorRect[],
  /** Foreign leaf-cluster frame rects (own source/target already exempted) —
   * a third obstacle class alongside cards: the shortcut triangle must clear
   * them too, or the chord re-cuts a frame the clip pass dodged (P0-a). */
  leafFrameRects: readonly EdgeAnchorRect[],
): [Pt[], number] => {
  let removed = 0;
  let out = pts;
  let changed = true;
  while (changed && out.length >= 4) {
    changed = false;
    for (let i = 1; i + 2 <= out.length - 1; i++) {
      // b = out[i], c = out[i+1]; both interior (i>=1, i+1<=len-2).
      const a = out[i - 1]!;
      const b = out[i]!;
      const c = out[i + 1]!;
      const d = out[i + 2]!;
      const tb = turnSign(a, b, c);
      const tc = turnSign(b, c, d);
      if (tb === 0 || tc === 0 || tb === tc) {
        continue;
      }
      if (!triangleClearOfRects(a, b, c, cardRects)) {
        continue;
      }
      // P0-a: the shortcut triangle must also clear every FOREIGN leaf-cluster
      // frame (own source/target frames pre-exempted by the caller). Without
      // this the chord a–c re-enters a frame the clip pass routed around.
      if (!triangleClearOfRects(a, b, c, leafFrameRects)) {
        continue;
      }
      // LR-discipline guard: the shortcut chord a–c must not cut a hull
      // corner through a horizontal face (see the header).
      if (segmentCrossesHullHorizontalFace(a, c, hullRects)) {
        continue;
      }
      // P1-a self-crossing guard: deleting b makes a–c the new segment. Reject
      // if it strictly crosses any non-adjacent segment of the polyline — the
      // skip window covers the two segments incident to a/c (k=i-2, i+1) and
      // the two removed segments a-b/b-c (k=i-1, i).
      if (segmentCrossesOwnPolyline(a, c, out, i - 2, i + 1)) {
        continue;
      }
      out = [...out.slice(0, i), ...out.slice(i + 1)];
      removed += 1;
      changed = true;
      break;
    }
  }
  return [out, removed];
};

/** Step 2 — collinear/duplicate dedupe with the ≥3-point floor.
 * Returns [points, removals, midpointRetained]. */
const dedupeCollinear = (pts: Pt[]): [Pt[], number, boolean] => {
  const kept: Pt[] = [pts[0]!];
  let removed = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = kept[kept.length - 1]!;
    const cur = pts[i]!;
    const next = pts[i + 1]!;
    if (samePoint(cur, prev) || Math.abs(orient(prev, cur, next)) <= EPS) {
      removed += 1;
      continue;
    }
    kept.push(cur);
  }
  const last = pts[pts.length - 1]!;
  if (samePoint(last, kept[kept.length - 1]!) && kept.length > 1) {
    // Duplicate terminal point — drop the interior copy, keep the endpoint.
    kept.pop();
    removed += 1;
  }
  kept.push(last);
  if (kept.length < 3) {
    // Repair's routed-marker gate needs > 2 points: retain one interior
    // midpoint (collinear — rendered geometry unchanged).
    const s = kept[0]!;
    const e = kept[kept.length - 1]!;
    return [[s, [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2], e], removed, true];
  }
  return [kept, removed, false];
};

/** Step 3 — chamfer corner rounding with the k-escalation ladder + budget. */
const roundCorners = (
  pts: Pt[],
  inflatedRects: readonly EdgeAnchorRect[],
  hullRects: readonly EdgeAnchorRect[],
  /** Foreign leaf-cluster frame rects (own source/target already exempted) —
   * the chamfer corner region must clear them too (P0-a). Un-inflated: unlike
   * cards, a frame is a routed-around obstacle, not a body to keep 12px off. */
  leafFrameRects: readonly EdgeAnchorRect[],
  meta: StrataEdgeSmoothMeta,
): Pt[] => {
  const out: Pt[] = [pts[0]!];
  let budgetLeft = STRATA_EDGE_SMOOTH_POINT_BUDGET - pts.length;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    if (turnSign(a, b, c) === 0) {
      out.push(b);
      continue;
    }
    if (Math.min(dist(a, b), dist(c, b)) < STRATA_EDGE_SMOOTH_MIN_SEGMENT_PX) {
      // Sub-pixel chamfer — not a candidate (neither rounded nor blocked).
      out.push(b);
      continue;
    }
    if (budgetLeft < 1) {
      meta.cornersBudget += 1;
      out.push(b);
      continue;
    }
    let rounded = false;
    for (const k of STRATA_EDGE_SMOOTH_CORNER_KS) {
      const m: Pt = [a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1])];
      const n: Pt = [c[0] + k * (b[0] - c[0]), c[1] + k * (b[1] - c[1])];
      if (
        triangleClearOfRects(m, b, n, inflatedRects) &&
        // P0-a: the chamfer corner region must also clear every FOREIGN
        // leaf-cluster frame — otherwise the cut m–n clips a frame the clip
        // pass routed around (own source/target frames pre-exempted).
        triangleClearOfRects(m, b, n, leafFrameRects) &&
        // LR-discipline guard: the chamfer cut m–n must not cross a hull's
        // top/bottom border (escalating k shrinks the cut toward b, which
        // sits on the LEGAL path — so a tighter k can clear).
        !segmentCrossesHullHorizontalFace(m, n, hullRects) &&
        // P1-a self-crossing guard: the cut m–n replaces corner b; reject if it
        // strictly crosses any non-adjacent polyline segment (skip the two
        // segments incident to b at k=i-1/i, whose trims a-m and n-c touch it).
        !segmentCrossesOwnPolyline(m, n, pts, i - 1, i)
      ) {
        out.push(m, n);
        budgetLeft -= 1;
        meta.cornersRounded += 1;
        rounded = true;
        break;
      }
    }
    if (!rounded) {
      meta.cornersBlocked += 1;
      out.push(b);
    }
  }
  out.push(pts[pts.length - 1]!);
  // Collapse the exact-duplicate seam two adjacent k=1/2 chamfers share.
  const deduped: Pt[] = [out[0]!];
  for (let i = 1; i < out.length; i++) {
    if (!samePoint(out[i]!, deduped[deduped.length - 1]!)) {
      deduped.push(out[i]!);
    }
  }
  return deduped;
};

/**
 * Smooth, IN PLACE in the skeleton array, every stamped routed polyline of the
 * four router/clip provenances. Only `points`/`width`/`height`/`roundness`
 * change — never `x`/`y`, never endpoints, never `customData`.
 */
export function smoothStrataRoutedEdges(
  skeleton: ExcalidrawElementSkeleton[],
  cardBodyRects: readonly EdgeAnchorRect[],
  /** Hull (topology container) frame rects — used ONLY by the LR-discipline
   * guard (top/bottom border crossing tests), never as interior obstacles. */
  hullRects: readonly EdgeAnchorRect[] = [],
  /** Leaf-cluster (primary/satellite) frame rects keyed by cluster address —
   * a THIRD obstacle class for the shortcut/chamfer clearance tests (P0-a).
   * PER EDGE the caller-supplied set is filtered so the edge's OWN source/target
   * cluster frames are exempt (a clip endpoint sits ON its own frame border) —
   * exactly the exemption the clip census uses. Empty ⇒ frames are not tested
   * (the byte-identical default for callers that pass only card + hull rects). */
  leafFrameRects: readonly StrataLeafFrameRect[] = [],
): StrataEdgeSmoothMeta {
  const meta: StrataEdgeSmoothMeta = {
    smoothed: 0,
    skippedStyle: 0,
    skippedUnrouted: 0,
    kinksRemoved: 0,
    collinearRemoved: 0,
    cornersRounded: 0,
    cornersBlocked: 0,
    cornersBudget: 0,
    midpointRetained: 0,
    pointsBefore: 0,
    pointsAfter: 0,
  };
  const inflatedRects = cardBodyRects.map((r) =>
    inflate(r, STRATA_EDGE_SMOOTH_INFLATION_PX),
  );

  for (let index = 0; index < skeleton.length; index++) {
    const el = skeleton[index] as ArrowSkeleton;
    if (el?.type !== "arrow") {
      continue;
    }
    const cd = el.customData;
    if (cd?.terraformRoutedPolyline !== true) {
      continue;
    }
    const provenance = cd?.terraformRoutedBy;
    if (provenance === "style") {
      meta.skippedStyle += 1;
      continue;
    }
    if (
      typeof provenance !== "string" ||
      !SMOOTHABLE_PROVENANCE.has(provenance)
    ) {
      meta.skippedUnrouted += 1;
      continue;
    }
    const rel = el.points ?? [];
    if (rel.length < 3) {
      meta.skippedUnrouted += 1;
      continue;
    }

    const abs: Pt[] = rel.map((p) => [el.x + p[0], el.y + p[1]] as const);
    meta.pointsBefore += abs.length;

    // P0-a per-edge exemption: the leaf-cluster frames THIS edge legitimately
    // touches (its own source/target cluster addresses) are not obstacles — a
    // clip endpoint sits ON its own frame's border. Read both the clip anchor
    // frameKeys and the relationship source/target (the same keys the clip
    // census uses); everything else stays an obstacle.
    const foreignLeafRects =
      leafFrameRects.length === 0
        ? EMPTY_RECTS
        : (() => {
            const own = ownClusterAddresses(cd);
            const foreign: EdgeAnchorRect[] = [];
            for (const f of leafFrameRects) {
              if (!own.has(f.address)) {
                foreign.push(f.rect);
              }
            }
            return foreign;
          })();

    const [afterShortcut, kinks] = shortcutInflections(
      abs,
      cardBodyRects,
      hullRects,
      foreignLeafRects,
    );
    meta.kinksRemoved += kinks;
    const [afterDedupe, collinear, midRetained] =
      dedupeCollinear(afterShortcut);
    meta.collinearRemoved += collinear;
    if (midRetained) {
      meta.midpointRetained += 1;
    }
    const finalAbs = roundCorners(
      afterDedupe,
      inflatedRects,
      hullRects,
      foreignLeafRects,
      meta,
    );

    // Endpoints NEVER move (hard constraint) — assert cheaply and, on the
    // impossible violation, keep the original geometry (fail-safe).
    if (
      finalAbs.length < 3 ||
      !samePoint(finalAbs[0]!, abs[0]!) ||
      !samePoint(finalAbs[finalAbs.length - 1]!, abs[abs.length - 1]!)
    ) {
      meta.pointsAfter += abs.length;
      skeleton[index] = {
        ...el,
        roundness: null,
      } as ExcalidrawElementSkeleton;
      meta.smoothed += 1;
      continue;
    }
    meta.pointsAfter += finalAbs.length;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of finalAbs) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }

    // Write-back: endpoints fixed ⇒ origin fixed — el.x/el.y (and points[0])
    // are byte-identical, so no re-origin is needed (verified by the unit
    // suite). customData rides through UNCHANGED (provenance/anchors/lane are
    // never restamped). `roundness:null` = exact-path rendering (E1.1).
    skeleton[index] = {
      ...el,
      points: finalAbs.map(([px, py]) =>
        pointFrom<LocalPoint>(px - el.x, py - el.y),
      ),
      width: maxX - minX,
      height: maxY - minY,
      roundness: null,
    } as ExcalidrawElementSkeleton;
    meta.smoothed += 1;
  }

  return meta;
}
