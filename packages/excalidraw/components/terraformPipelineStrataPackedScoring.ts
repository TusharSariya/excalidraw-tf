/**
 * Strata engine — whole-layout candidate-set scoring for packed-hull ordering
 * (round 9, docs/rcll-v2-shit-test-round9.md, SDEC-57; default-off behind the
 * `strataPackedScoring` option).
 *
 * Round 9 (R9-F1..F3) proved the packed per-sweep acceptance structurally
 * blind: it counts crossings only among the ONE hull's lifted sibling chords
 * (a child hull's internal edges never lift; pairs sharing a lifted hull
 * endpoint are excluded) on a synthetic banded-stack trial that packed
 * placement never renders. On the owner's SQS case the counter read 0 for
 * both orders while true scene crossings differed (123 vs 120).
 *
 * This module replaces acceptance with SELECTION: every packed sweep snapshot
 * ({initial, after sweep 1..K} — chained unconditionally, so a neutral
 * intermediate order can still lead to a later win) is trial-placed with the
 * REAL A0 skyline, and the resulting whole layout is scored on real
 * leaf-level geometry, lexicographically:
 *   1. global leaf-level edge-pair crossings (segments between leaf box
 *      centres, pair counted once, pairs sharing an actual leaf endpoint
 *      excluded — the diagnostics kernel's eligibility, not the lifted-unit
 *      one);
 *   2. unrelated edge–box penetrations ("edge tunneling", R9-F4): a segment
 *      passing through a hull box that is an ancestor of NEITHER endpoint;
 *   3. total integer L1 edge length (doubled-centre coordinates, exact).
 * Strictly lower earlier term wins; exact ties keep the EARLIEST candidate
 * (diff-stability, matching every other Strata tiebreak).
 *
 * Determinism: pure integer arithmetic on the doubled-coordinate system, no
 * RNG/clock, stable iteration orders (edgesPrime is C4′-sorted upstream; the
 * hull tree is content-addressed). No module-level consts derived from
 * terraformPipelineLayoutShared (SDEC NaN import-cycle rule) — this module
 * reads no LayoutShared bindings at all.
 */
import { placeStrataHulls } from "./terraformPipelineStrataPlacement";

import type {
  StrataBox,
  StrataEngineOptions,
  StrataHullNode,
  StrataModel,
  StrataPlacementResult,
  StrataPrimeEdge,
  StrataRankResult,
} from "./terraformPipelineStrataTypes";

/** Lexicographic score of one whole-layout candidate (lower is better). */
export type StrataPackedScore = {
  /** Global leaf-level edge-pair crossings (pair counted once). */
  crossings: number;
  /** Unrelated edge–box penetrations (edge tunneling, R9-F4). */
  penetrations: number;
  /** Σ |Δx|+|Δy| over leaf-level edges, in doubled-centre integer units. */
  lengthL1: number;
};

export type StrataPackedScoredPlacement = {
  placement: StrataPlacementResult;
  /** Index of the winning candidate (0 = initial order). */
  winnerIndex: number;
  /** Per-candidate scores in generation order (diagnostics/battery surface). */
  candidateScores: readonly StrataPackedScore[];
};

/** `a` strictly precedes `b` lexicographically (crossings, penetrations, L1). */
export function strataPackedScoreLess(
  a: StrataPackedScore,
  b: StrataPackedScore,
): boolean {
  if (a.crossings !== b.crossings) {
    return a.crossings < b.crossings;
  }
  if (a.penetrations !== b.penetrations) {
    return a.penetrations < b.penetrations;
  }
  return a.lengthL1 < b.lengthL1;
}

/** Orientation sign of (a, b, c): +1 CCW, −1 CW, 0 collinear. Exact integers. */
function orient2(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Two segments PROPERLY intersect (interior crossing; touching excluded). */
function segmentsProperlyCross(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  p3x: number,
  p3y: number,
  p4x: number,
  p4y: number,
): boolean {
  const o1 = orient2(p1x, p1y, p2x, p2y, p3x, p3y);
  const o2 = orient2(p1x, p1y, p2x, p2y, p4x, p4y);
  const o3 = orient2(p3x, p3y, p4x, p4y, p1x, p1y);
  const o4 = orient2(p3x, p3y, p4x, p4y, p2x, p2y);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

/**
 * Segment intersects the OPEN interior of an axis-aligned box (all in the
 * doubled coordinate system). True iff an endpoint lies strictly inside, or
 * the segment properly crosses one of the four box sides. Boundary-touching
 * and collinear-along-a-side passes do NOT count (strict semantics — same
 * convention as the crossing kernel).
 */
function segmentIntersectsBoxInterior(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  // Trivial reject: both endpoints beyond one closed side.
  if (
    (ax <= x0 && bx <= x0) ||
    (ax >= x1 && bx >= x1) ||
    (ay <= y0 && by <= y0) ||
    (ay >= y1 && by >= y1)
  ) {
    return false;
  }
  const inside = (px: number, py: number): boolean =>
    px > x0 && px < x1 && py > y0 && py < y1;
  if (inside(ax, ay) || inside(bx, by)) {
    return true;
  }
  return (
    segmentsProperlyCross(ax, ay, bx, by, x0, y0, x1, y0) || // top
    segmentsProperlyCross(ax, ay, bx, by, x0, y1, x1, y1) || // bottom
    segmentsProperlyCross(ax, ay, bx, by, x0, y0, x0, y1) || // left
    segmentsProperlyCross(ax, ay, bx, by, x1, y0, x1, y1) // right
  );
}

/** One scored leaf-level segment (doubled-centre coordinates). */
type ScoredEdge = {
  source: string;
  target: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
};

/** leaf clusterId → ids of every hull whose subtree contains it. */
function leafAncestorHullIds(root: StrataHullNode): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const walk = (hull: StrataHullNode, ancestors: readonly string[]): void => {
    const chain = [...ancestors, hull.id];
    for (const leaf of hull.leafClusterIds) {
      out.set(leaf, new Set(chain));
    }
    for (const child of hull.children) {
      walk(child, chain);
    }
  };
  walk(root, []);
  return out;
}

/**
 * Score one whole placement on real leaf-level geometry. Edges = E′ in TRUE
 * direction endpoints (direction is irrelevant to all three terms; reversal
 * only swaps endpoints). Edges with a missing leaf box are skipped (defensive
 * — unreachable on the engine path, where every E′ endpoint is a placed leaf).
 */
export function scoreStrataPlacementGeometry(
  placement: StrataPlacementResult,
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
): StrataPackedScore {
  const doubledCentre = (box: StrataBox): readonly [number, number] => [
    2 * box.x + box.width,
    2 * box.y + box.height,
  ];

  const edges: ScoredEdge[] = [];
  let lengthL1 = 0;
  for (const pe of edgesPrime) {
    const sBox = placement.leafBoxes.get(pe.edge.source);
    const tBox = placement.leafBoxes.get(pe.edge.target);
    if (!sBox || !tBox) {
      continue;
    }
    const [ax, ay] = doubledCentre(sBox);
    const [bx, by] = doubledCentre(tBox);
    edges.push({ source: pe.edge.source, target: pe.edge.target, ax, ay, bx, by });
    lengthL1 += Math.abs(ax - bx) + Math.abs(ay - by);
  }

  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    const e1 = edges[i]!;
    for (let j = i + 1; j < edges.length; j++) {
      const e2 = edges[j]!;
      if (
        e1.source === e2.source ||
        e1.source === e2.target ||
        e1.target === e2.source ||
        e1.target === e2.target
      ) {
        continue; // shares an actual leaf endpoint ⇒ ineligible pair
      }
      if (
        segmentsProperlyCross(
          e1.ax,
          e1.ay,
          e1.bx,
          e1.by,
          e2.ax,
          e2.ay,
          e2.bx,
          e2.by,
        )
      ) {
        crossings += 1;
      }
    }
  }

  const ancestorsOf = leafAncestorHullIds(model.hullRoot);
  let penetrations = 0;
  for (const [hullId, boxed] of placement.boxedHulls) {
    const b = boxed.box;
    const x0 = 2 * b.x;
    const y0 = 2 * b.y;
    const x1 = 2 * (b.x + b.width);
    const y1 = 2 * (b.y + b.height);
    for (const e of edges) {
      if (
        ancestorsOf.get(e.source)?.has(hullId) ||
        ancestorsOf.get(e.target)?.has(hullId)
      ) {
        continue; // endpoint's own container/ancestor ⇒ legitimate passage
      }
      if (
        segmentIntersectsBoxInterior(e.ax, e.ay, e.bx, e.by, x0, y0, x1, y1)
      ) {
        penetrations += 1;
      }
    }
  }

  return { crossings, penetrations, lengthL1 };
}

/**
 * A0 placement under whole-layout packed candidate scoring. Runs the FULL
 * placement once per packed snapshot index (K+1 runs at sweep budget K; a
 * single run when K≤0 — identical geometry to the legacy path there, since
 * every packed hull's only snapshot is the initial order and banded hulls are
 * untouched in all runs), scores each, and returns the lexicographic winner
 * (earliest index on exact ties).
 */
export function placeStrataHullsPackedScored(
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
  rank: StrataRankResult,
  options: StrataEngineOptions,
): StrataPackedScoredPlacement {
  const runs = options.sweeps > 0 ? options.sweeps + 1 : 1;
  let winner: StrataPlacementResult | undefined;
  let winnerScore: StrataPackedScore | undefined;
  let winnerIndex = 0;
  const candidateScores: StrataPackedScore[] = [];
  for (let c = 0; c < runs; c++) {
    const placement = placeStrataHulls(model, edgesPrime, rank, options, c);
    const score = scoreStrataPlacementGeometry(placement, model, edgesPrime);
    candidateScores.push(score);
    if (winnerScore === undefined || strataPackedScoreLess(score, winnerScore)) {
      winner = placement;
      winnerScore = score;
      winnerIndex = c;
    }
  }
  return { placement: winner!, winnerIndex, candidateScores };
}
