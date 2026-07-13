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
  /**
   * The untouched legacy (acceptance-chain) placement — the descent baseline.
   * Same object as `placement` when no hull selection improved on legacy.
   */
  baselinePlacement: StrataPlacementResult;
  /** Score of the legacy baseline (pre-A7 geometry). */
  baselineScore: StrataPackedScore;
  /** Score of the winning selection (pre-A7 geometry). ≤ baseline always. */
  score: StrataPackedScore;
  /**
   * Winning per-hull snapshot selection (hull id → candidate index). A packed
   * hull absent here kept the legacy acceptance-chain order. Empty ⇒ legacy
   * won outright.
   */
  selections: ReadonlyMap<string, number>;
  /** Full trial placements evaluated (cost observability). */
  trialCount: number;
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
 * Post-A7 never-worse guard (round-9 iteration 2). The descent's never-worse
 * guarantee is on pre-A7 geometry; A7 can invert the ranking. Given both arms
 * refined to FINAL geometry, keep the scored arm only if it is
 * lexicographically no worse — otherwise fall back to legacy entirely. Ties
 * keep the scored arm (it already won pre-A7; falling back on a tie would
 * churn geometry for no metric gain).
 */
export function chooseStrataRefinedPlacement(
  scoredFinal: StrataPlacementResult,
  legacyFinal: StrataPlacementResult,
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
): { placement: StrataPlacementResult; fellBack: boolean } {
  const scoredScore = scoreStrataPlacementGeometry(
    scoredFinal,
    model,
    edgesPrime,
  );
  const legacyScore = scoreStrataPlacementGeometry(
    legacyFinal,
    model,
    edgesPrime,
  );
  return strataPackedScoreLess(legacyScore, scoredScore)
    ? { placement: legacyFinal, fellBack: true }
    : { placement: scoredFinal, fellBack: false };
}

/** Pre-order list of packed hulls that can actually reorder (≥2 units). */
function reorderablePackedHullIds(root: StrataHullNode): readonly string[] {
  const out: string[] = [];
  const walk = (hull: StrataHullNode): void => {
    if (
      hull.policy === "packed" &&
      hull.children.length + hull.leafClusterIds.length >= 2
    ) {
      out.push(hull.id);
    }
    for (const child of hull.children) {
      walk(child);
    }
  };
  walk(root);
  return out;
}

/**
 * A0 placement under whole-layout packed candidate scoring — per-hull
 * coordinate descent (round-9 remedy, iteration 2).
 *
 * Baseline = the legacy acceptance-chain placement (every packed hull absent
 * from the selection map). Then packed hulls with ≥2 units are visited in
 * stable pre-order; for each, every unconditional sweep snapshot {0..K} is
 * trial-placed as a FULL layout with all other hulls held at their current
 * selection, and a snapshot is adopted only when the whole-layout score
 * strictly improves (exact ties keep the incumbent, so legacy wins ties —
 * diff stability). A second pass runs only if the first changed anything; on
 * that pass each hull also retries LEGACY plus the other snapshots, so a
 * pass-1 adoption invalidated by a later hull's move can be undone. Capped at
 * two passes (deterministic, bounded cost).
 *
 * Guarantees: the returned selection's PRE-A7 score is never worse than
 * legacy's (the incumbent only ever improves). K≤0 skips the descent — the
 * candidate set degenerates to the initial order, which IS the legacy order
 * at K=0.
 */
export function placeStrataHullsPackedScored(
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
  rank: StrataRankResult,
  options: StrataEngineOptions,
): StrataPackedScoredPlacement {
  const candidateCounts = new Map<string, number>();
  const baselinePlacement = placeStrataHulls(
    model,
    edgesPrime,
    rank,
    options,
    new Map<string, number>(),
    (hullId, count) => candidateCounts.set(hullId, count),
  );
  const baselineScore = scoreStrataPlacementGeometry(
    baselinePlacement,
    model,
    edgesPrime,
  );
  let trialCount = 1;

  let bestPlacement = baselinePlacement;
  let bestScore = baselineScore;
  const selection = new Map<string, number>();

  if (options.sweeps > 0) {
    const hullIds = reorderablePackedHullIds(model.hullRoot);
    const LEGACY = -1;
    for (let pass = 0; pass < 2; pass++) {
      let changed = false;
      for (const hullId of hullIds) {
        const current = selection.get(hullId) ?? LEGACY;
        const count = candidateCounts.get(hullId) ?? options.sweeps + 1;
        for (let c = 0; c < count; c++) {
          // Pass 1 incumbents are all LEGACY; pass 2 also retries LEGACY via
          // the c === current skip below only excluding the incumbent value.
          if (c === current) {
            continue;
          }
          const trial = new Map(selection);
          trial.set(hullId, c);
          const placement = placeStrataHulls(
            model,
            edgesPrime,
            rank,
            options,
            trial,
          );
          trialCount += 1;
          const score = scoreStrataPlacementGeometry(
            placement,
            model,
            edgesPrime,
          );
          if (strataPackedScoreLess(score, bestScore)) {
            bestPlacement = placement;
            bestScore = score;
            selection.set(hullId, c);
            changed = true;
          }
        }
        // Pass 2: also retry dropping this hull back to legacy.
        if (pass > 0 && selection.has(hullId)) {
          const trial = new Map(selection);
          trial.delete(hullId);
          const placement = placeStrataHulls(
            model,
            edgesPrime,
            rank,
            options,
            trial,
          );
          trialCount += 1;
          const score = scoreStrataPlacementGeometry(
            placement,
            model,
            edgesPrime,
          );
          if (strataPackedScoreLess(score, bestScore)) {
            bestPlacement = placement;
            bestScore = score;
            selection.delete(hullId);
            changed = true;
          }
        }
      }
      if (!changed) {
        break;
      }
    }
  }

  return {
    placement: bestPlacement,
    baselinePlacement,
    baselineScore,
    score: bestScore,
    selections: selection,
    trialCount,
  };
}
