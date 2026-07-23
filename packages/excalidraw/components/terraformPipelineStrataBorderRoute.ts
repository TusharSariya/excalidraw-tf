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
 * SYMMETRY (E1.4). The dual defect is INGRESS: an edge whose target is nested
 * enters the target's container(s) at an arbitrary angle. The pass is now
 * symmetric — it also inserts one clean single-side ENTRY waypoint per hull the
 * edge legitimately ENTERS (ancestor of target, NOT of source), on the side
 * facing the SOURCE (`facingSide(entryOuter, start)`). Full path order becomes
 * `[start, exit inner→outer, entry outer→inner, end]` (the entry chain is the
 * mirror of the exit chain). Both chains share ONE waypoint budget
 * (STRATA_EDGE_ROUTING_MAX_WAYPOINTS); when they overflow, the entry chain is
 * trimmed to its OUTERMOST (largest-area, visually dominant) hulls. Entries are
 * as orthogonal-by-construction as exits: the target's own ancestor hulls are
 * permeable to the router and free to the scorers, so ingress waypoints move no
 * scored term either — only un-scored readability.
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
 * exit/entry-box order = area (nesting); side/candidate ties fixed
 * deterministically.
 * Clearance is computed inside the function, never as a module-level const
 * (SDEC-34: the planParsing→layoutCore import cycle makes such consts
 * entry-order-dependent NaNs).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataBorderRoute.test.ts --exclude "**\/.claude/**"
 */
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import { computeTerraformChordAnchors } from "./terraformEdgeAnchors";
import {
  STRATA_EDGE_ROUTING_MAX_WAYPOINTS,
  strataEdgeRoutingClearance,
} from "./terraformPipelineStrataEdgeRouting";
import { segmentIntersectsStrataBoxInterior } from "./terraformPipelineStrataPackedScoring";
import { compareStrataContentKeys } from "./terraformPipelineStrataTypes";

// Type-only: the shared body-rect anchor authority `buildStrataEdgeStyleAnchors`
// produces (terraformPipelineStrataSceneBuild.ts). Type-only import ⇒ no runtime
// cycle.
import type { StrataEdgeStyleAnchors } from "./terraformPipelineStrataEdgeStyle";
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
  /** Total interior waypoints added across all routed edges (exit + entry). */
  waypointsTotal: number;
  /** ENTRY-side interior waypoints added across all routed edges (E1.4; a
   * subset of `waypointsTotal`). The symmetric partner of the exit chain: one
   * clean single-side ingress waypoint per hull the edge ENTERS to reach a
   * nested target. */
  entryWaypointsTotal: number;
  /** Entry hulls dropped because the exit+entry chains together exceeded the
   * waypoint budget (E1.4). The OUTERMOST (visually dominant) entry hulls are
   * kept; the innermost are dropped and counted here. */
  entryBudgetSkipped: number;
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

type ChainOutcome =
  | {
      kind: "waypoints";
      waypoints: Pt[];
      outerBox: StrataBox;
      straightSpan: number;
      routedSpan: number;
    }
  | { kind: "empty" }
  | { kind: "degenerate" }
  | { kind: "noGain" };

/**
 * One side of the symmetric border route. `inside` is strictly inside every box
 * in `boxes`; `outside` is strictly outside the outermost. `boxes` are ordered
 * inner→outer (area asc). Emits one waypoint per box, all on the SINGLE side of
 * the outermost box that faces `outside`, at that side's chord crossing (clamped
 * inset by `pad`) — ordered inner→outer from `inside`. Used for BOTH chains:
 * the exit chain passes (start, end); the entry chain passes (end, start) so its
 * facing side is the one toward the SOURCE and its crossing is the same chord
 * line (direction-independent). Rejects (kind ≠ "waypoints") when the box set is
 * empty, the endpoints are degenerate (`inside` not strictly inside, or
 * `outside` strictly inside, the outermost box), or the routed interior span
 * does not STRICTLY shorten the straight interior diagonal (no readability to
 * bank). Re-penetration / foreign guards run on the assembled poly by the caller.
 */
const buildBorderChain = (
  inside: Pt,
  outside: Pt,
  boxes: { id: string; box: StrataBox }[],
  pad: number,
): ChainOutcome => {
  if (boxes.length === 0) {
    return { kind: "empty" };
  }
  const outerBox = boxes[boxes.length - 1]!.box;
  if (!strictlyInside(inside, outerBox) || strictlyInside(outside, outerBox)) {
    return { kind: "degenerate" };
  }
  const side = facingSide(outerBox, outside);
  const waypoints: Pt[] = boxes.map(({ box }) =>
    borderWaypoint(box, side, inside, outside, pad),
  );
  const straightSpan = straightInteriorL1(inside, outside, outerBox);
  let routedSpan = L1(inside, waypoints[0]!);
  for (let w = 0; w + 1 < waypoints.length; w++) {
    routedSpan += L1(waypoints[w]!, waypoints[w + 1]!);
  }
  if (!(routedSpan < straightSpan)) {
    return { kind: "noGain" };
  }
  return { kind: "waypoints", waypoints, outerBox, straightSpan, routedSpan };
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
 * it a clean single-side exit. Interior waypoints are inserted; the chord
 * endpoints (`x`/`y` and the final absolute point) are the body-rect repair
 * anchors when the shared authority resolves both keys (E1.5), else the
 * frame-clipped chord. Non-eligible arrows are untouched (byte-identical);
 * flag-off this module never runs.
 *
 * ── ENDPOINTS = REPAIR ANCHORS (wave-4 E1.5). ── When the shared body-rect
 * anchor authority (`buildStrataEdgeStyleAnchors`, terraformPipelineStrataScene-
 * Build.ts) resolves BOTH of an edge's endpoint keys, the chord `start`/`end` —
 * which drive facingSide, borderWaypoint, straightInteriorL1, the re-penetration
 * / foreign guards AND the write-back origin — are
 * `computeTerraformChordAnchors(bodyRectA, bodyRectB)` (terraformEdgeAnchors.ts):
 * the EXACT centre-clipped BODY-rect endpoints `repairTerraformEdgeBindings`
 * re-derives at element time. The exit/entry waypoint math therefore runs on the
 * real endpoints, and the routed polyline's first/last absolute points sit ON the
 * body cards (chebyshev 0), so repair's validate-before-trust gate
 * (ROUTED_ANCHOR_TOLERANCE = 48px) KEEPS the `terraformRoutedPolyline` stamp
 * instead of flattening the border route. Previously the endpoints were the leaf
 * FRAME-clipped chord (el.x/el.y + last point), which for tall composite cards
 * sits >48px from the inset body rect — so repair flattened those routes back to
 * chords in FULL mode. A per-edge key MISS (endpoint not a keyed body rect) falls
 * back to the frame-clipped chord — exactly the edges repair leaves unchanged
 * (terraformVisibility.ts `!rectA || !rectB` early return). Absent the `anchors`
 * argument every edge takes the chord fallback, byte-identical to the pre-E1.5
 * pass. `el.x`/`el.y` are re-anchored at `poly[0]` (which equals the derived
 * `start`) because `convertToExcalidrawElements` re-normalizes `points[0]`→[0,0]
 * anchored at `el.x`/`el.y`; in the fallback case `start === [el.x, el.y]`, so
 * this stays byte-identical.
 *
 * DEGENERATE <3-POINT COLLAPSE: not reachable here. A stamp is emitted only when
 * at least one chain returns "waypoints" (≥1 inserted waypoint), so the written
 * `poly = [start, ...waypoints, end]` always has ≥3 entries, and the write-back
 * preserves that array verbatim (no simplify pass) — so a stamped border polyline
 * always trips repair's `points.length > 2` gate as a genuine route. (The channel
 * router needed E1.2's collinear-stub because it runs `simplifyPolyline`; this
 * pass does not.)
 *
 * @param anchors The shared body-rect anchor authority
 *   (`buildStrataEdgeStyleAnchors`). When supplied and BOTH of an edge's endpoint
 *   keys resolve, the chord endpoints are the body-clipped anchors repair re-
 *   derives; absent / a per-edge key miss ⇒ the frame-clipped chord (byte-
 *   identical to the pre-E1.5 pass).
 */
export function routeStrataBorderExits(
  skeleton: ExcalidrawElementSkeleton[],
  model: StrataModel,
  placement: StrataPlacementResult,
  anchors?: StrataEdgeStyleAnchors,
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
    entryWaypointsTotal: 0,
    entryBudgetSkipped: 0,
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
    const lastPt = pts[pts.length - 1]!;
    // Default endpoints = the skeleton chord, clipped against the leaf FRAME box.
    // These are the endpoints repair leaves alone when an anchor is missing.
    let start: Pt = [el.x, el.y];
    let end: Pt = [el.x + lastPt[0], el.y + lastPt[1]];
    // Prefer the shared body-rect anchors (the SAME endpoints
    // `repairTerraformEdgeBindings` re-derives at element time) when BOTH endpoint
    // keys resolve to a card body rect — keyed exactly as repair keys them
    // (`customData.relationship` source/target). The exit/entry waypoint math, the
    // guards and the write-back origin ALL run on these real endpoints, so repair
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

    const srcAnc = ancestors.get(rel.source);
    const tgtAnc = ancestors.get(rel.target);
    if (!srcAnc) {
      continue;
    }
    // EXIT SET: hulls the edge legitimately LEAVES — ancestor of source, not of
    // target (the mirror image of edgeRouting's foreign set). Collected in key
    // order; sorted by area (nesting) — innermost first, outermost last — below.
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
    // ENTRY SET (E1.4): hulls the edge legitimately ENTERS — ancestor of target,
    // NOT of source. The exact mirror of the exit set; emitted OUTER→INNER in
    // path order (see below), so the ingress reflects the egress.
    const entryBoxes: { id: string; box: StrataBox }[] = [];
    if (tgtAnc) {
      for (const id of [...tgtAnc].sort(compareStrataContentKeys)) {
        if (srcAnc.has(id)) {
          continue;
        }
        const box = hullBox.get(id);
        if (box) {
          entryBoxes.push({ id, box });
        }
      }
    }
    if (exitBoxes.length === 0 && entryBoxes.length === 0) {
      continue; // neither leaves nor enters an ancestor hull — nothing to route.
    }
    // The exit chain keeps its legacy WHOLESALE cap: a source nested deeper than
    // the whole budget is left as a chord rather than emitted as an over-bent
    // mess. (Entries, by contrast, TRIM to the remaining budget — see below.)
    if (exitBoxes.length > STRATA_EDGE_ROUTING_MAX_WAYPOINTS) {
      meta.unclean += 1;
      continue;
    }
    exitBoxes.sort(
      (a, b) => a.box.width * a.box.height - b.box.width * b.box.height,
    );
    entryBoxes.sort(
      (a, b) => a.box.width * a.box.height - b.box.width * b.box.height,
    );

    // Total-waypoint budget (E1.4): exit + entry ≤ STRATA_EDGE_ROUTING_MAX_-
    // WAYPOINTS. Exits are already within budget; the remainder funds the entry
    // chain, keeping the OUTERMOST (largest-area, visually dominant) entry hulls
    // — the tail of the ascending sort — and dropping the innermost on overflow.
    const entryBudget = STRATA_EDGE_ROUTING_MAX_WAYPOINTS - exitBoxes.length;
    let entryUsed = entryBoxes;
    if (entryBoxes.length > entryBudget) {
      meta.entryBudgetSkipped += entryBoxes.length - Math.max(0, entryBudget);
      entryUsed =
        entryBudget > 0
          ? entryBoxes.slice(entryBoxes.length - entryBudget)
          : [];
    }

    // Build both chains. Exit passes (start, end); entry passes (end, start) so
    // its facing side is the one toward the SOURCE. Each returns waypoints
    // ordered inner→outer from its `inside` endpoint.
    const exitChain = buildBorderChain(start, end, exitBoxes, pad);
    const entryChain = buildBorderChain(end, start, entryUsed, pad);

    if (exitChain.kind !== "waypoints" && entryChain.kind !== "waypoints") {
      // Neither side yields a clean chain: fall back to the straight chord,
      // accounting for it as the exit-only pass always has (noGain when a side
      // gained no interior span; degenerate/empty stay silent, matching the
      // legacy bare `continue`).
      if (exitChain.kind === "noGain" || entryChain.kind === "noGain") {
        meta.noGain += 1;
      }
      continue;
    }

    const exitWaypoints: Pt[] =
      exitChain.kind === "waypoints" ? exitChain.waypoints : [];
    // Entry waypoints are inner→outer from the target; in path order (source→
    // target) they read OUTER→INNER, so reverse them.
    const entryWaypoints: Pt[] =
      entryChain.kind === "waypoints"
        ? [...entryChain.waypoints].reverse()
        : [];
    const waypoints: Pt[] = [...exitWaypoints, ...entryWaypoints];
    const poly: Pt[] = [start, ...waypoints, end];

    // Never emit worse (exit): the segment LEAVING the outermost exit box must
    // not re-penetrate it (exactly-one-crossing). Its continuation is the first
    // entry waypoint when present, else `end`.
    if (exitChain.kind === "waypoints") {
      const wExitOuter = exitWaypoints[exitWaypoints.length - 1]!;
      const afterExit = poly[exitWaypoints.length + 1]!;
      const eb = exitChain.outerBox;
      if (
        segmentIntersectsStrataBoxInterior(
          wExitOuter[0],
          wExitOuter[1],
          afterExit[0],
          afterExit[1],
          eb.x,
          eb.y,
          eb.x + eb.width,
          eb.y + eb.height,
        )
      ) {
        meta.unclean += 1;
        continue;
      }
    }

    // Never emit worse (entry, mirror): the segment ARRIVING at the outermost
    // entry box must not penetrate it BEFORE the waypoint. Its predecessor is
    // the outermost exit waypoint when present, else `start`.
    if (entryChain.kind === "waypoints") {
      const wEntryOuter = entryWaypoints[0]!;
      const beforeEntry = poly[exitWaypoints.length]!;
      const nb = entryChain.outerBox;
      if (
        segmentIntersectsStrataBoxInterior(
          beforeEntry[0],
          beforeEntry[1],
          wEntryOuter[0],
          wEntryOuter[1],
          nb.x,
          nb.y,
          nb.x + nb.width,
          nb.y + nb.height,
        )
      ) {
        meta.unclean += 1;
        continue;
      }
    }

    // Never emit worse (foreign): the detour must not NEWLY penetrate any
    // foreign box (ancestor of neither endpoint, nor an endpoint card) that the
    // straight chord did not already pierce. Covers exit AND entry segments.
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

    // Accept: rewrite in place, origin-relative points, bbox extents, marker set
    // so repairTerraformEdgeBindings does not flatten the polyline back to a
    // chord. Origin the element at the polyline's FIRST absolute point
    // (`poly[0]` === the derived `start`) so points[0] === [0,0] and el.x/el.y ===
    // that first point — the body-rect anchor repair re-derives when the anchors
    // resolved (else the frame-clipped chord, byte-identical). See the file header
    // "ENDPOINTS = REPAIR ANCHORS" for why re-origining is required.
    const [ox, oy] = start;
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
    // Defense-in-depth: drop any clip-pass markers before re-stamping (the
    // first-stamper skip above means a clip edge never reaches here, but a stale
    // `terraformClipAnchor`/`terraformClipLane` is inert to the repair gate yet
    // serializes as garbage / inflates the lane census — strip so a "border"
    // stamp is self-consistent).
    const {
      terraformClipAnchor: _staleClipAnchor,
      terraformClipLane: _staleClipLane,
      ...prevCustomData
    } = el.customData ?? {};
    skeleton[i] = {
      ...el,
      x: ox,
      y: oy,
      points: poly.map(([px, py]) => pointFrom<LocalPoint>(px - ox, py - oy)),
      width: maxX - minX,
      height: maxY - minY,
      customData: {
        ...prevCustomData,
        terraformRoutedPolyline: true,
        terraformRoutedBy: "border",
      },
    } as ExcalidrawElementSkeleton;
    meta.routed += 1;
    meta.waypointsTotal += waypoints.length;
    meta.entryWaypointsTotal += entryWaypoints.length;
    // Conservative lower-bound accountant: each side credits only its outermost
    // box's interior span saved (see the meta doc).
    if (exitChain.kind === "waypoints") {
      meta.interiorLenSavedL1 += exitChain.straightSpan - exitChain.routedSpan;
    }
    if (entryChain.kind === "waypoints") {
      meta.interiorLenSavedL1 +=
        entryChain.straightSpan - entryChain.routedSpan;
    }
    for (const w of waypoints) {
      meta.maxWaypointPerpDev = Math.max(
        meta.maxWaypointPerpDev,
        perpDist(w, start, end),
      );
    }
  }

  return meta;
}
