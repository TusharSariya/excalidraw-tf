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
 * W8b ε-constraint selection (`strataPackedScoringEpsilon`, default 0):
 * W8 (docs/strata-view-w8-rank-scorer-factorial.md, SDEC-59) showed the strict
 * crossings-first rule is an INFINITE exchange rate — under the rankSeparate
 * substrate it trades the owner's SQS/Dynamo pair locality for a global
 * crossings win. The literature prices a crossing finitely (Ware et al. 2002,
 * corpus doc doi-10-1057-palgrave-ivs-9500013: each crossing costs a bounded
 * response-time increment, comparable to ~38° of path bendiness — a bounded,
 * not lexicographically infinite, priority), and ε-constraint selection is the
 * standard way to bound one objective while optimizing the rest without
 * committing to weighted-sum trade weights (multi-objective drawing framings:
 * corpus docs s2-10-4230-lipics-gd-2025-53, arxiv-2112-01571v1; readability
 * metrics: s2-10-1147-jrd-2015-2411412). Semantics (anti-ratchet, mandatory):
 * a trial may ALSO be adopted when its crossings are within the GLOBAL budget
 * `baselineScore.crossings + delta` (baseline = the legacy acceptance-chain
 * placement, NOT the rolling incumbent — an incumbent-relative budget would
 * re-extend on every adoption and let crossings drift upward across hull
 * visits) AND it strictly improves (penetrations, lengthL1) lexicographically
 * over the incumbent best. delta = epsilon when epsilon >= 1, or
 * ceil(epsilon * baselineScore.crossings) when 0 < epsilon < 1 (relative
 * mode). epsilon <= 0 disables the band entirely — bit-identical to the
 * strict rule. Ties still keep the EARLIEST candidate.
 *
 * Termination: the descent is structurally bounded (≤2 passes × fixed hull
 * list × fixed per-hull candidate count), so it terminates unconditionally
 * — that bound is the ONLY thing guaranteeing termination. Adoption is NOT
 * monotone under a single ordering when delta > 0: an ε-band win only
 * strictly decreases (penetrations, lengthL1), not crossings, so a later
 * strict-lexicographic win at a different hull can raise crossings back up
 * within the [0, baseline + delta] band, after which a further ε-band win
 * is adoptable again. Concrete counterexample (baseline=10, delta=1):
 * (11,9,10) adopts via ε (crossings 11 <= 10+1, penetrations/lengthL1
 * strictly improve) → (10,100,100) adopts via strict crossings (10 < 11)
 * → (11,9,10) is adoptable via ε again. So oscillation between ε-band and
 * strict adoptions across hull visits is possible; there is no well-founded
 * quantity that decreases on every adoption. Determinism does not depend on
 * monotonicity: it comes from the fixed two-pass × hulls × candidates cap
 * (termination) plus stable iteration order and earliest-tie rules (which
 * candidate wins at each step, given the cap).
 *
 * Determinism: pure integer arithmetic on the doubled-coordinate system, no
 * RNG/clock, stable iteration orders (edgesPrime is C4′-sorted upstream; the
 * hull tree is content-addressed). The ONE non-integer step is the relative-
 * mode `Math.ceil(epsilon * baselineCrossings)` (exact for the shipped 0.01
 * granularity; a caller-supplied epsilon >= 1 is used as-is and is expected
 * to be an integer). No module-level consts derived from
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

/**
 * One recorded descent trial (frontier instrumentation, W8b — report-only).
 * The synthetic hullId "__baseline__" tags the legacy baseline placement
 * (candidateIndex −1, pass 0, adopted true); candidateIndex −1 on a real hull
 * tags the pass-2 legacy-retry trial (drop the hull back to legacy order).
 */
export type StrataPackedTrialRecord = {
  hullId: string;
  candidateIndex: number;
  pass: number;
  score: StrataPackedScore;
  adopted: boolean;
  /** How the trial was adopted: strict lexicographic win vs ε-band admission. */
  adoptedVia?: "strict" | "epsilon";
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
  /**
   * Score of the winning selection (pre-A7 geometry). With epsilon 0 it is
   * never worse than baseline; with epsilon > 0 its crossings may exceed
   * baseline by at most `effectiveDelta` (bought only with a strict
   * (penetrations, lengthL1) improvement).
   */
  score: StrataPackedScore;
  /** The requested ε (echo; 0 = strict rule, today's behavior). */
  epsilon: number;
  /** The resolved crossings budget above baseline (see resolve helper). */
  effectiveDelta: number;
  /**
   * Winning per-hull snapshot selection (hull id → candidate index). A packed
   * hull absent here kept the legacy acceptance-chain order. Empty ⇒ legacy
   * won outright.
   */
  selections: ReadonlyMap<string, number>;
  /** Full trial placements evaluated (cost observability). */
  trialCount: number;
  /**
   * G-DESCENT converge (report-only, present ONLY when `packedConverge` is
   * on — the default return object shape is byte-identical): true when the
   * best-seen adopted snapshot strictly beat the final rolling incumbent
   * under the active comparator (i.e. the descent held-then-dropped a
   * dominant order and converge recovered it).
   */
  convergeRecovered?: boolean;
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

/** `a` strictly precedes `b` on the (penetrations, lengthL1) suffix only. */
function strataPenLengthLess(
  a: StrataPackedScore,
  b: StrataPackedScore,
): boolean {
  if (a.penetrations !== b.penetrations) {
    return a.penetrations < b.penetrations;
  }
  return a.lengthL1 < b.lengthL1;
}

/**
 * Resolve the ε-constraint crossings budget above the LEGACY BASELINE.
 * epsilon <= 0 ⇒ 0 (strict rule); epsilon >= 1 ⇒ epsilon (absolute integer
 * crossings); 0 < epsilon < 1 ⇒ ceil(epsilon * baselineCrossings) (relative
 * mode — the single non-integer step in the selector, see module header).
 */
export function resolveStrataPackedEpsilonDelta(
  epsilon: number,
  baselineCrossings: number,
): number {
  if (!Number.isFinite(epsilon) || epsilon <= 0) {
    return 0;
  }
  // Defensive integer normalization: absolute mode (>= 1) is an integer
  // crossings budget by contract. Callers upstream of this resolver (e.g.
  // the demo URL parser) should already reject fractional epsilon >= 1, but
  // this is the single choke point every caller routes through, so floor it
  // here too rather than trusting every call site.
  return epsilon >= 1
    ? Math.floor(epsilon)
    : Math.ceil(epsilon * baselineCrossings);
}

/**
 * ε-constraint adoption rule (W8b). A trial is adopted iff EITHER
 *  (a) it wins under the strict lexicographic rule vs the incumbent
 *      (unchanged, `strataPackedScoreLess`), OR
 *  (b) delta > 0 AND `trial.crossings <= baselineCrossings + delta` (the
 *      GLOBAL anti-ratchet budget — vs the legacy baseline, never the rolling
 *      incumbent) AND the trial strictly improves (penetrations, lengthL1)
 *      lexicographically over the incumbent.
 * delta = 0 makes (b) unreachable ⇒ bit-identical to the strict rule.
 */
export function strataPackedScoreAdoptable(
  trial: StrataPackedScore,
  incumbent: StrataPackedScore,
  baselineCrossings: number,
  delta: number,
): false | "strict" | "epsilon" {
  if (strataPackedScoreLess(trial, incumbent)) {
    return "strict";
  }
  if (
    delta > 0 &&
    trial.crossings <= baselineCrossings + delta &&
    strataPenLengthLess(trial, incumbent)
  ) {
    return "epsilon";
  }
  return false;
}

/**
 * Coerce an objective weight to a safe, finite, non-negative value. A
 * non-finite or negative weight (never expected on the engine path, but the
 * URL/session surface is untrusted) falls back to the default 1. FRACTIONAL
 * weights are allowed and preserved — the owner wants e.g. 1.5 as a future
 * setting — the fractional-ness is absorbed by the integer ROUNDING in
 * `strataWeightedCross`, not rejected here.
 */
function safeStrataWeight(w: number): number {
  return Number.isFinite(w) && w >= 0 ? w : 1;
}

/**
 * OD-15 relocate objective (`strataSiftRelocate`, default off). Combined
 * crossing score `C = penW·penetrations + crossW·edgeEdgeCrossings` — the owner
 * priority "hull-crossings ≻ edge-length" priced as a weighted sum (default
 * 1/1). ALWAYS returns an INTEGER (`Math.round`), so every downstream
 * comparison (`!==`/`<`) and the ε budget stay in a clean integer domain with
 * NO float-equality hazard — even for non-dyadic fractional weights the owner
 * may set (e.g. 1.5, rounded). Default 1/1 rounding is a no-op. Bad (non-finite/
 * negative) weights are coerced to 1 via `safeStrataWeight`.
 */
export function strataWeightedCross(
  score: { crossings: number; penetrations: number },
  penW: number,
  crossW: number,
): number {
  return Math.round(
    safeStrataWeight(penW) * score.penetrations +
      safeStrataWeight(crossW) * score.crossings,
  );
}

/**
 * `a` strictly precedes `b` under the relocate objective: lexicographic on
 * (weightedCross, lengthL1). All integer comparisons.
 */
export function strataRelocateScoreLess(
  a: StrataPackedScore,
  b: StrataPackedScore,
  w: { penW: number; crossW: number },
): boolean {
  const wa = strataWeightedCross(a, w.penW, w.crossW);
  const wb = strataWeightedCross(b, w.penW, w.crossW);
  if (wa !== wb) {
    return wa < wb;
  }
  return a.lengthL1 < b.lengthL1;
}

/**
 * OD-15 relocate adoption rule — the two owner guardrails, BOTH required:
 *  (1) HARD CAP on RAW edge-edge crossings: reject any candidate whose
 *      `crossings` exceed `baseline.crossings + edgeCrossCap` regardless of any
 *      weighted-`C`/length win (bounds edge-edge blow-up).
 *  (2) The candidate is adopted iff it EITHER strictly beats the incumbent on
 *      (weightedCross, lengthL1) [the strict rule], OR wins within the ε budget
 *      on weightedCross vs the LEGACY baseline (anti-ratchet, mirror of
 *      `strataPackedScoreAdoptable`/`resolveStrataPackedEpsilonDelta` but on
 *      weightedCross instead of raw crossings): delta > 0 AND candidate's
 *      weightedCross <= baseline's weightedCross + delta AND its lengthL1
 *      strictly improves the incumbent (the (weightedCross, lengthL1) suffix
 *      after the budgeted lead term).
 * Integer/fixed-point throughout (delta resolution's single non-integer step is
 * the shared relative-mode ceil, exact for the shipped granularity). Cap failure
 * always vetoes; ties keep the incumbent (diff stability).
 */
export function strataRelocateAdoptable(
  candidate: StrataPackedScore,
  baseline: StrataPackedScore,
  incumbent: StrataPackedScore,
  cfg: { penW: number; crossW: number; epsilon: number; edgeCrossCap: number },
): boolean {
  // Guardrail (1): hard cap on raw edge-edge crossing regression.
  if (candidate.crossings > baseline.crossings + cfg.edgeCrossCap) {
    return false;
  }
  const w = { penW: cfg.penW, crossW: cfg.crossW };
  // Guardrail (2a): strict lexicographic win on (weightedCross, lengthL1).
  if (strataRelocateScoreLess(candidate, incumbent, w)) {
    return true;
  }
  // Guardrail (2b): ε-band anti-ratchet on weightedCross vs the LEGACY baseline.
  const baselineWeighted = strataWeightedCross(baseline, cfg.penW, cfg.crossW);
  const candidateWeighted = strataWeightedCross(
    candidate,
    cfg.penW,
    cfg.crossW,
  );
  const delta = resolveStrataPackedEpsilonDelta(cfg.epsilon, baselineWeighted);
  if (
    delta > 0 &&
    candidateWeighted <= baselineWeighted + delta &&
    candidate.lengthL1 < incumbent.lengthL1
  ) {
    return true;
  }
  return false;
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
 * Segment intersects the OPEN interior of an axis-aligned box (typically the
 * doubled coordinate system, but any numeric inputs are accepted). True iff the
 * segment shares a positive-length overlap with the box whose midpoint lies
 * STRICTLY inside the open box. Boundary-touching, corner-grazing and
 * collinear-along-a-side passes do NOT count (strict semantics — same intent as
 * the crossing kernel).
 *
 * Implemented as an exact Liang–Barsky slab clip: compute the parameter
 * interval [t0,t1] of the segment inside the CLOSED box, intersected with the
 * segment's own [0,1] range, then report true iff that interval has positive
 * length AND its clipped midpoint is strictly interior. The old
 * proper-crossing-of-a-side test missed corner-to-corner diagonal passes: at a
 * corner the orientation is collinear, so no side "properly crosses" and an
 * interior diagonal went undetected (router accepted a detour through a raw
 * foreign box). The t-bounds are kept as exact rationals (numerator/denominator
 * integer pairs, all comparisons by cross-multiplication — no division), so
 * integer inputs are decided exactly, including the measure-zero diagonal.
 */
export function segmentIntersectsStrataBoxInterior(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  // Liang–Barsky: p[k] < 0 ⇒ segment entering slab k (raises lower bound t0);
  // p[k] > 0 ⇒ leaving (lowers upper bound t1); p[k] === 0 ⇒ parallel to slab.
  const p = [-dx, dx, -dy, dy];
  const q = [ax - x0, x1 - ax, ay - y0, y1 - ay];

  // t0 = t0n/t0d (lower bound, starts 0), t1 = t1n/t1d (upper bound, starts 1);
  // denominators are kept strictly positive so cross-multiplied comparisons hold.
  let t0n = 0;
  let t0d = 1;
  let t1n = 1;
  let t1d = 1;

  for (let k = 0; k < 4; k++) {
    const pk = p[k]!;
    const qk = q[k]!;
    if (pk === 0) {
      // Parallel to this slab and outside it ⇒ no interior overlap at all.
      if (qk < 0) {
        return false;
      }
      continue;
    }
    // r = qk / pk, normalised to a positive denominator. Cross-multiplied
    // comparisons are exact only while products stay within Number's 2^53
    // integer range — safe for engine coordinates (|doubled coords| << 2^26),
    // NOT for arbitrary inputs (a ±1e8 segment can misclassify; BigInt oracle
    // verified 83,521-case agreement inside engine bounds — codex re-review).
    let rn = qk;
    let rd = pk;
    if (rd < 0) {
      rn = -rn;
      rd = -rd;
    }
    if (pk < 0) {
      // Entering: t0 = max(t0, r) ⇔ r > t0 ⇔ rn*t0d > t0n*rd (rd,t0d > 0).
      if (rn * t0d > t0n * rd) {
        t0n = rn;
        t0d = rd;
      }
    } else if (rn * t1d < t1n * rd) {
      // Leaving: t1 = min(t1, r) ⇔ r < t1 ⇔ rn*t1d < t1n*rd (rd,t1d > 0).
      t1n = rn;
      t1d = rd;
    }
  }

  // Positive-length interior overlap required: t0 < t1 strictly
  // (t0n/t0d < t1n/t1d ⇔ t0n*t1d < t1n*t0d). Equal bounds = a boundary graze.
  if (t0n * t1d >= t1n * t0d) {
    return false;
  }

  // Midpoint tm = (t0 + t1)/2 = (t0n*t1d + t1n*t0d) / (2*t0d*t1d), mden > 0.
  const mnum = t0n * t1d + t1n * t0d;
  const mden = 2 * t0d * t1d;
  // Point = A + tm·d. Strictly inside the OPEN box on both axes
  // (x0 < ax + (mnum/mden)·dx < x1, ×mden > 0 ⇒ integer comparisons).
  const mx = ax * mden + mnum * dx;
  const my = ay * mden + mnum * dy;
  return x0 * mden < mx && mx < x1 * mden && y0 * mden < my && my < y1 * mden;
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
    edges.push({
      source: pe.edge.source,
      target: pe.edge.target,
      ax,
      ay,
      bx,
      by,
    });
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
        segmentIntersectsStrataBoxInterior(
          e.ax,
          e.ay,
          e.bx,
          e.by,
          x0,
          y0,
          x1,
          y1,
        )
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
 *
 * W8b δ-band (`delta`, default 0 = exactly the rule above): the guard uses the
 * SAME ε-constraint semantics as the descent — the scored arm is ALSO kept
 * when its final crossings are within `legacy final crossings + delta` AND its
 * (penetrations, lengthL1) suffix is not worse than legacy's. `delta` is the
 * descent's resolved `effectiveDelta` (one budget for the whole pipeline).
 * With delta = 0 the band clause is a subset of the no-worse rule, so the
 * default is bit-identical to the pre-W8b guard.
 *
 * OD-15 relocate (`relocate` provided ⇒ `strataSiftRelocate` on): the guard
 * uses the SAME weighted objective + hard cap as the descent instead of the
 * raw-crossing lex rule. Keep the scored arm iff it is within the raw
 * edge-edge crossing cap (baseline = legacyFinal, the fallback arm) AND it is
 * no worse than legacy on (weightedCross, lengthL1) OR wins within the ε budget
 * on weightedCross — so a strictly-better pre-A7 arm is preserved rather than
 * discarded wholesale (the measured all-or-nothing failure). Ties keep the
 * scored arm. `relocate` absent ⇒ the flag-off path above is byte-identical.
 */
export function chooseStrataRefinedPlacement(
  scoredFinal: StrataPlacementResult,
  legacyFinal: StrataPlacementResult,
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
  delta = 0,
  relocate?: {
    penW: number;
    crossW: number;
    epsilon: number;
    edgeCrossCap: number;
  },
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
  if (relocate) {
    const w = { penW: relocate.penW, crossW: relocate.crossW };
    // Guardrail (1): hard cap on raw edge-edge crossings vs the legacy arm.
    const withinCap =
      scoredScore.crossings <= legacyScore.crossings + relocate.edgeCrossCap;
    // Guardrail (2a): no worse than legacy on (weightedCross, lengthL1).
    const noWorse = !strataRelocateScoreLess(legacyScore, scoredScore, w);
    // Guardrail (2b): ε-band anti-ratchet on weightedCross vs the legacy arm.
    const legacyWeighted = strataWeightedCross(
      legacyScore,
      relocate.penW,
      relocate.crossW,
    );
    const scoredWeighted = strataWeightedCross(
      scoredScore,
      relocate.penW,
      relocate.crossW,
    );
    const relocateDelta = resolveStrataPackedEpsilonDelta(
      relocate.epsilon,
      legacyWeighted,
    );
    // The ε arm must BUY length: require a STRICT length improvement (P1-b),
    // matching `strataRelocateAdoptable`'s strict-length rule. With `<=` a
    // scored arm that is strictly worse on weightedCross (e.g. C 11 vs legacy
    // 10) but equal on length would be kept for no benefit.
    const withinEpsilon =
      relocateDelta > 0 &&
      scoredWeighted <= legacyWeighted + relocateDelta &&
      scoredScore.lengthL1 < legacyScore.lengthL1;
    const keepScored = withinCap && (noWorse || withinEpsilon);
    return keepScored
      ? { placement: scoredFinal, fellBack: false }
      : { placement: legacyFinal, fellBack: true };
  }
  const keepScored =
    !strataPackedScoreLess(legacyScore, scoredScore) ||
    (delta > 0 &&
      scoredScore.crossings <= legacyScore.crossings + delta &&
      !strataPenLengthLess(legacyScore, scoredScore));
  return keepScored
    ? { placement: scoredFinal, fellBack: false }
    : { placement: legacyFinal, fellBack: true };
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
 * Adoption uses `strataPackedScoreAdoptable`: the strict lexicographic rule,
 * plus (when `options.packedScoringEpsilon` > 0) the ε-band admission against
 * the GLOBAL baseline crossings budget (module header). Ties keep the
 * incumbent, so legacy wins ties — diff stability.
 *
 * Guarantees: with epsilon 0 the returned selection's PRE-A7 score is never
 * worse than legacy's (the incumbent only ever improves). With epsilon > 0
 * crossings may exceed baseline by at most the resolved delta, bought only
 * with a strict (penetrations, lengthL1) improvement. K≤0 skips the descent —
 * the candidate set degenerates to the initial order, which IS the legacy
 * order at K=0.
 */
export function placeStrataHullsPackedScored(
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
  rank: StrataRankResult,
  options: StrataEngineOptions,
  /**
   * ADDITIVE-OPTIONAL (W8b frontier instrumentation, report-only): invoked
   * once for the legacy baseline (hullId "__baseline__") and once per descent
   * trial. Absent ⇒ zero extra work — the flag-off path is byte-identical.
   */
  onPackedTrial?: (record: StrataPackedTrialRecord) => void,
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
  onPackedTrial?.({
    hullId: "__baseline__",
    candidateIndex: -1,
    pass: 0,
    score: baselineScore,
    adopted: true,
  });

  // W8b ε-constraint budget — resolved ONCE against the legacy baseline
  // (anti-ratchet: never re-derived from the rolling incumbent).
  const epsilon = options.packedScoringEpsilon ?? 0;
  const effectiveDelta = resolveStrataPackedEpsilonDelta(
    epsilon,
    baselineScore.crossings,
  );

  // OD-15 relocate (`strataSiftRelocate`, default off ⇒ byte-identical). When
  // on, the descent scores the widened candidate set (WP-SIFT's
  // external-incidence sift candidates flow through the reported counts) with
  // the weighted objective + hard cap instead of the raw-crossing rule, and
  // dedups geometrically-identical trial placements (WP-SIFT emits ~40% skyline
  // no-ops) before paying the O(edges²) scorer.
  const siftRelocate = options.strataSiftRelocate === true;
  const relocateCfg = {
    penW: options.strataCrossWeightPenetration ?? 1,
    crossW: options.strataCrossWeightEdge ?? 1,
    epsilon,
    edgeCrossCap:
      options.strataEdgeCrossCap ?? options.packedScoringEpsilon ?? 0,
  };
  // Cheap deterministic geometry fingerprint: sorted leaf + hull box extents.
  // Score depends only on leaf centres (crossings/length) and hull boxes
  // (penetrations), so identical fingerprints ⇒ identical score.
  const fingerprintPlacement = (p: StrataPlacementResult): string => {
    const parts: string[] = [];
    for (const id of [...p.leafBoxes.keys()].sort()) {
      const b = p.leafBoxes.get(id)!;
      parts.push(`${id}:${b.x},${b.y},${b.width},${b.height}`);
    }
    for (const id of [...p.boxedHulls.keys()].sort()) {
      const b = p.boxedHulls.get(id)!.box;
      parts.push(`#${id}:${b.x},${b.y},${b.width},${b.height}`);
    }
    return parts.join("|");
  };
  // fingerprint → cached score. Dedup skips only the O(edges²) RE-SCORING of a
  // geometry already evaluated; the ADOPTION decision still runs on every trial
  // (P2-b): adoption depends on the rolling incumbent, so a geometry rejected
  // earlier can become a strict weighted-C win after a later ε-band move rolls
  // the incumbent. `scoreForTrial` returns the fresh-or-cached score (never
  // touched flag-off ⇒ byte-identical).
  const scoreCache = new Map<string, StrataPackedScore>();
  const scoreForTrial = (
    placement: StrataPlacementResult,
  ): StrataPackedScore => {
    if (!siftRelocate) {
      return scoreStrataPlacementGeometry(placement, model, edgesPrime);
    }
    const fp = fingerprintPlacement(placement);
    const cached = scoreCache.get(fp);
    if (cached !== undefined) {
      return cached;
    }
    const fresh = scoreStrataPlacementGeometry(placement, model, edgesPrime);
    scoreCache.set(fp, fresh);
    return fresh;
  };
  if (siftRelocate) {
    scoreCache.set(fingerprintPlacement(baselinePlacement), baselineScore);
  }
  // Unified adoption decision (returns the observability tag). Flag-off routes
  // to the untouched `strataPackedScoreAdoptable`; flag-on to the relocate rule.
  const decideAdoption = (
    score: StrataPackedScore,
    incumbent: StrataPackedScore,
  ): false | "strict" | "epsilon" => {
    if (!siftRelocate) {
      return strataPackedScoreAdoptable(
        score,
        incumbent,
        baselineScore.crossings,
        effectiveDelta,
      );
    }
    if (
      !strataRelocateAdoptable(score, baselineScore, incumbent, relocateCfg)
    ) {
      return false;
    }
    return strataRelocateScoreLess(score, incumbent, relocateCfg)
      ? "strict"
      : "epsilon";
  };

  let bestPlacement = baselinePlacement;
  let bestScore = baselineScore;
  const selection = new Map<string, number>();

  // G-DESCENT converge (`packedConverge`, default off ⇒ the tracker is never
  // allocated and the return below is byte-identical). When on, every ADOPTION
  // snapshots the FULL rolling selection map (a `new Map(selection)` copy) +
  // its placement + score, and the descent returns the best-seen snapshot
  // under the ACTIVE comparator (relocate-weighted when `strataSiftRelocate`,
  // else the strict lexicographic rule) instead of the rolling incumbent. The
  // descent TRAJECTORY (trials, adoption decisions, trialCount, frontier
  // records) is untouched — only the return changes. Strict-better replaces;
  // ties keep the EARLIEST snapshot (never replace on tie — diff stability).
  // At ε=0 adoption is strictly monotone, so best-seen ≡ rolling incumbent
  // and converge is inert by construction.
  // Off-path discipline: when the flag is off, NONE of the best-seen
  // machinery exists — no closures allocated, no per-adoption calls — so the
  // default path does literally no extra work beyond an optional-call null
  // check at the two adoption sites.
  const packedConverge = options.packedConverge === true;
  let bestSeen: {
    score: StrataPackedScore;
    selection: Map<string, number>;
    placement: StrataPlacementResult;
  } | null = null;
  let seenLess:
    | ((a: StrataPackedScore, b: StrataPackedScore) => boolean)
    | null = null;
  let considerBestSeen:
    | ((score: StrataPackedScore, placement: StrataPlacementResult) => void)
    | null = null;
  if (packedConverge) {
    const less = (a: StrataPackedScore, b: StrataPackedScore): boolean =>
      siftRelocate
        ? strataRelocateScoreLess(a, b, relocateCfg)
        : strataPackedScoreLess(a, b);
    seenLess = less;
    bestSeen = {
      score: baselineScore,
      selection: new Map<string, number>(),
      placement: baselinePlacement,
    };
    considerBestSeen = (score, placement) => {
      if (bestSeen !== null && less(score, bestSeen.score)) {
        bestSeen = { score, selection: new Map(selection), placement };
      }
    };
  }

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
          // OD-15 dedup reuses the cached score (skips re-scoring only); the
          // adoption decision below still runs for every trial (P2-b).
          const score = scoreForTrial(placement);
          const adoptedVia = decideAdoption(score, bestScore);
          onPackedTrial?.({
            hullId,
            candidateIndex: c,
            pass,
            score,
            adopted: adoptedVia !== false,
            ...(adoptedVia !== false ? { adoptedVia } : {}),
          });
          if (adoptedVia !== false) {
            bestPlacement = placement;
            bestScore = score;
            selection.set(hullId, c);
            changed = true;
            considerBestSeen?.(score, placement);
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
          // OD-15 dedup (see the c-loop site above): cached score, adoption
          // still runs every trial (P2-b). Flag-off is byte-identical.
          const score = scoreForTrial(placement);
          const adoptedVia = decideAdoption(score, bestScore);
          onPackedTrial?.({
            hullId,
            candidateIndex: LEGACY,
            pass,
            score,
            adopted: adoptedVia !== false,
            ...(adoptedVia !== false ? { adoptedVia } : {}),
          });
          if (adoptedVia !== false) {
            bestPlacement = placement;
            bestScore = score;
            selection.delete(hullId);
            changed = true;
            considerBestSeen?.(score, placement);
          }
        }
      }
      if (!changed) {
        break;
      }
    }
  }

  // G-DESCENT converge return: the best-seen adopted snapshot's OWN placement/
  // score/selection map (never the rolling values re-forced onto the final map
  // — the winner can differ from the incumbent in several hulls). Default off
  // returns the rolling incumbent EXACTLY as before (byte-identical).
  if (bestSeen !== null && seenLess !== null) {
    const recovered = seenLess(bestSeen.score, bestScore);
    return {
      placement: recovered ? bestSeen.placement : bestPlacement,
      baselinePlacement,
      baselineScore,
      score: recovered ? bestSeen.score : bestScore,
      epsilon,
      effectiveDelta,
      selections: recovered ? bestSeen.selection : selection,
      trialCount,
      convergeRecovered: recovered,
    };
  }

  return {
    placement: bestPlacement,
    baselinePlacement,
    baselineScore,
    score: bestScore,
    epsilon,
    effectiveDelta,
    selections: selection,
    trialCount,
  };
}
