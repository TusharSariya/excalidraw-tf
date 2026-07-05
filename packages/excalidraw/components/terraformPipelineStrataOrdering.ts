/**
 * Strata engine — A2 hull-scoped ordering @ K=0 (M1a scope).
 *
 * Spec: docs/rcll-v2-spec-v2.md §6-A2 (Strategy 1) amended by
 * docs/rcll-v2-spec-v3.1.md §1 (weighted bands-skipped acceptance).
 *
 * M1a ships **K=0**: the sequence over units(h) is the initial model order —
 * units sorted by the pinned content key (min canonical address over the unit's
 * leaves, C4′). The sweep generator + best-of-{initial, sweeps 1..K, height-aware
 * greedy seed} selection is WP-3a; a positive sweep budget is accepted here but
 * degrades to K=0 (clearly-marked seam). The acceptance SCORER for banded hulls
 * — {@link weightedBandsSkippedCost} — already ships and is unit-tested now: it is
 * the exact t2 term of F1's cross-band decomposition (v3.1 §1.1), integer px,
 * computed from the candidate sequence + already-fixed child heights via prefix
 * sums (no chord geometry, no trial placement).
 */
import { PIPELINE_LANE_GAP_Y } from "./terraformPipelineLayoutShared";
import { compareStrataContentKeys } from "./terraformPipelineStrataTypes";

import type {
  StrataHullPolicy,
  StrataPrimeEdge,
  StrataUnit,
} from "./terraformPipelineStrataTypes";

/**
 * A lifted E′ edge between two units of one hull (effective direction).
 * `key` is the underlying E′ edge's canonical key — lifted entries are a
 * MULTISET (one entry per E′ edge, never deduped by unit pair); the key pins
 * the iteration order (v3.1 §1.5, C4′).
 */
export type StrataLiftedEdge = { from: string; to: string; key: string };

/** Stable per-hull unit id (namespaced so a hull key never shadows a leaf id). */
export function strataUnitId(unit: StrataUnit): string {
  return unit.kind === "hull" ? `H:${unit.hullId}` : `L:${unit.clusterId}`;
}

/**
 * Lift E′ onto one hull's units: an edge u→w contributes iff its endpoints lie
 * in DIFFERENT units of the hull (endpoints in the same unit — e.g. a packed
 * child-hull's internal dataflow — are excluded, so they never leak to a banded
 * ancestor). A3-reversed edges lift in their EFFECTIVE direction (source/target
 * swapped).
 *
 * MULTISET semantics (normative, v2.0 §6-A2 + v3.1 §1.1): each contributing E′
 * edge yields its OWN lifted entry — entries are NEVER deduped by (from,to), so
 * a 20-edge bundle between two bands weighs 20 terms in the §1.1 cost sum (and
 * 20 adjacencies in the WP-3a barycenters), not 1.
 *
 * Multiplicity ruling (PINNED — WP-3a must not re-litigate): each StrataEdge in
 * E′ (already parallel-deduped by the model with `multiplicity` retained)
 * contributes exactly ONE lifted entry; `multiplicity` does NOT weight the A2
 * cost. Rationale: A3 step 0 scopes multiplicity as "a ranking weight" (A1/A3);
 * v3.1 §1.1 sums over E′ edges, whose elements are the deduped edges.
 *
 * Deterministically ordered by (from, to, E′ key) with the pinned comparator
 * (v3.1 §1.5 — the cost sum is order-independent; the order is C4′ hygiene).
 */
export function liftStrataEdgesToUnits(
  edgesPrime: readonly StrataPrimeEdge[],
  unitOfCluster: (clusterId: string) => string | undefined,
): readonly StrataLiftedEdge[] {
  const out: StrataLiftedEdge[] = [];
  for (const pe of edgesPrime) {
    const effSource = pe.reversed ? pe.edge.target : pe.edge.source;
    const effTarget = pe.reversed ? pe.edge.source : pe.edge.target;
    const from = unitOfCluster(effSource);
    const to = unitOfCluster(effTarget);
    if (from === undefined || to === undefined || from === to) {
      continue;
    }
    out.push({ from, to, key: pe.edge.key });
  }
  out.sort(
    (a, b) =>
      compareStrataContentKeys(a.from, b.from) ||
      compareStrataContentKeys(a.to, b.to) ||
      compareStrataContentKeys(a.key, b.key),
  );
  return out;
}

/**
 * Weighted bands-skipped cost of a candidate sequence (v3.1 §1.1 — the banded
 * acceptance objective). For each lifted edge e=(uᵢ,uⱼ) with i<j in `sequence`,
 * add Σ_{k=i+1..j−1} (height(unit_k) + PIPELINE_LANE_GAP_Y): the heights of the
 * bands strictly skipped, plus one lane gap per skipped band. Adjacent endpoints
 * (index distance ≤ 1) contribute 0. Integer px, exact (all inputs integer),
 * computed via prefix sums in O(|seq| + |edges|). Endpoints are oriented by
 * position — edge direction is irrelevant to the skipped-band count.
 */
export function weightedBandsSkippedCost(
  sequence: readonly string[],
  liftedEdges: readonly StrataLiftedEdge[],
  unitHeightOf: (unitId: string) => number,
): number {
  const pos = new Map<string, number>();
  sequence.forEach((id, i) => pos.set(id, i));
  // prefix[k] = Σ_{m<k} (height(seq[m]) + LANE_GAP_Y)
  const prefix = new Array<number>(sequence.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < sequence.length; i++) {
    prefix[i + 1] =
      prefix[i]! + unitHeightOf(sequence[i]!) + PIPELINE_LANE_GAP_Y;
  }
  let cost = 0;
  for (const e of liftedEdges) {
    const pa = pos.get(e.from);
    const pb = pos.get(e.to);
    if (pa === undefined || pb === undefined) {
      continue;
    }
    const i = Math.min(pa, pb);
    const j = Math.max(pa, pb);
    if (j - i <= 1) {
      continue; // adjacent (or same) ⇒ zero bands skipped
    }
    cost += prefix[j]! - prefix[i + 1]!; // Σ_{k=i+1..j-1} (h_k + gap)
  }
  return cost;
}

/** Inputs for one hull's A2 ordering pass. */
export type StrataOrderParams = {
  units: readonly StrataUnit[];
  /** Content key of a unit (min canonical address over its leaves). */
  contentKeyOf: (unit: StrataUnit) => string;
  /** E′ lifted to `units` (effective direction), for sweeps/acceptance. */
  liftedEdges: readonly StrataLiftedEdge[];
  /** Fixed height of a unit by its {@link strataUnitId} (children laid out first). */
  unitHeightOf: (unitId: string) => number;
  policy: StrataHullPolicy;
  /** Directional sweep budget K. M1a ships 0; WP-3a turns on K=4. */
  sweeps: number;
};

/**
 * Order one hull's units. M1a (K=0) returns the initial model order: units sorted
 * by content key with the unit-id as the pinned tiebreak (C4′). The sequence IS
 * the placement order (A0 step 3).
 */
export function orderStrataUnits(
  params: StrataOrderParams,
): readonly StrataUnit[] {
  const initial = [...params.units].sort(
    (a, b) =>
      compareStrataContentKeys(
        params.contentKeyOf(a),
        params.contentKeyOf(b),
      ) || compareStrataContentKeys(strataUnitId(a), strataUnitId(b)),
  );

  // SEAM (WP-3a): the K directional sweeps + height-aware greedy seed generator
  // and the best-of-{initial, sweeps 1..K, seed} selection (banded acceptance via
  // weightedBandsSkippedCost, packed via crossings) land in WP-3a. Until then a
  // positive sweep budget degrades deterministically to K=0 (pure model order) —
  // accepted, never silently pretended to run.
  // TODO(WP-3a): run sweeps + seed, then select by weightedBandsSkippedCost.
  return initial;
}
