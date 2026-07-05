/**
 * Strata engine — A2 hull-scoped ordering (full sweep pass, WP-3a / M1b).
 *
 * Spec: docs/rcll-v2-spec-v2.md §6-A2 (Strategy 1 sweep machinery) amended by
 * docs/rcll-v2-spec-v3.1.md §1 (weighted bands-skipped acceptance).
 *
 * **K=0** (M1a checkpoint): the sequence over units(h) is the initial model order
 * — units sorted by the pinned content key (min canonical address over the unit's
 * leaves, C4′). {@link orderStrataUnits} returns that order BYTE-IDENTICAL at K=0
 * (the frozen Q2 strata@K0 arm must not move).
 *
 * **K>0** (WP-3a): the candidate set is {initial, sweep results 1..K, height-aware
 * greedy seed} in that pinned order (v3.1 §1.3). Selection keys on `policy`:
 *   - **banded** — score EVERY candidate with {@link weightedBandsSkippedCost}
 *     (v3.1 §1.1, the exact t2 term of F1's decomposition, integer px, no chord
 *     geometry); best cost wins; on EQUAL cost the deterministic crossings count
 *     of a banded-stack trial placement is the tiebreak (strictly fewer wins);
 *     remaining ties → the earliest candidate (initial/model order — diff-stable).
 *   - **packed** — the v2.0 per-sweep strict-crossings-decrease acceptance chain
 *     (accept a re-sorted sweep iff its trial-placement chord crossings strictly
 *     decrease, else keep the previous; final = last accepted). Packed IGNORES
 *     the bands-skipped scorer AND the greedy seed — both are banded-objective
 *     devices (the seed inserts to minimize §1.1 cost; packed places by skyline,
 *     not a banded stack, so a bands-skipped-optimal insertion is meaningless for
 *     it — documented reading of v3.1 §1.1/§1.3).
 *
 * The barycenter sweeps (§6-A2) are height-BLIND while the banded objective is
 * height-weighted (generator/selector mismatch) — hence the height-aware greedy
 * seed is a mandatory extra candidate so the height-optimal order is reachable.
 *
 * Trial-placement geometry (v3.1 §1.2): the crossings tiebreak (banded) and the
 * packed acceptance BOTH count chord crossings on the SAME banded-stack trial —
 * units stacked in sequence order at cumulative y (Σ prior heights + LANE_GAP_Y),
 * chord = the segment between two unit box-centres. x-centre comes from the
 * caller-supplied `unitXSpanOf`; absent it, a nominal colSpan.min x is used, and
 * absent even that, all x collapse to 0 (a degenerate but deterministic fallback
 * — real geometry is wired by the placement caller / WP-3b).
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
  /** Directional sweep budget K. M1a ships 0; M1b default 4. */
  sweeps: number;
  /**
   * ADDITIVE-OPTIONAL (WP-3a). A unit's global x-extent `[x0, x1]` by its
   * {@link strataUnitId}, supplying box-centre x for the crossings TRIAL
   * placement (banded tiebreak + packed acceptance, v3.1 §1.2). The caller
   * (placement / WP-3b integration) wires this from the same `UnitInfo` it
   * already computes; unit tests pass it directly. When ABSENT, x falls back to
   * a nominal colSpan.min column x ({@link unitColSpanOf}); absent even that, all
   * x collapse to 0 — a deterministic degenerate fallback (all chords collinear ⇒
   * 0 crossings ⇒ banded tiebreak degrades to earliest-wins, packed keeps
   * initial). The banded OBJECTIVE ({@link weightedBandsSkippedCost}) needs no
   * geometry, so banded selection is unaffected by its absence.
   */
  unitXSpanOf?: (unitId: string) => readonly [number, number];
  /**
   * ADDITIVE-OPTIONAL (WP-3a). A unit's rank span `[min, max]` by its
   * {@link strataUnitId}; `min` = the unit's sweep LAYER (§6-A2). Determines each
   * sweep's swept-direction neighbours (down = IN, up = OUT) and the SAME-LAYER
   * neighbour set (equal colSpan.min, either edge direction — §6-A2's dominant
   * term inside banded/top-level hulls). ABSENT ⇒ every unit is treated as layer 0
   * (all lifted edges become same-layer, so down/up sweeps coincide) and the
   * nominal-x fallback uses column 0 for all — a valid degenerate default; the
   * banded top-level hull, where most units DO share layer 0, is close to this
   * already.
   */
  unitColSpanOf?: (unitId: string) => readonly [number, number];
};

/** A lifted-edge endpoint incident to a unit, tagged for sweep relevance. */
type Incidence = { other: string; kind: "in" | "out"; sameLayer: boolean };

/** Sweep direction (down = layers ascending, IN neighbours; up = OUT). */
type SweepDir = "down" | "up";

/**
 * Orientation sign of the ordered triple (a, b, c): +1 CCW, −1 CW, 0 collinear.
 * Exact integer cross product (all trial coordinates are integers in the doubled
 * coordinate system, see {@link trialChordCrossings}).
 */
function orient2(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
): number {
  const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/** Two segments PROPERLY intersect (cross at an interior point of both). */
function segmentsProperlyCross(
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  p4: readonly [number, number],
): boolean {
  const o1 = orient2(p1, p2, p3);
  const o2 = orient2(p1, p2, p4);
  const o3 = orient2(p3, p4, p1);
  const o4 = orient2(p3, p4, p2);
  // Proper crossing only: collinear/touching (any orientation 0) does NOT count.
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

/**
 * Deterministic chord-crossing count of a candidate `sequence` under the
 * banded-stack TRIAL placement (v3.1 §1.2). Each unit is placed at cumulative
 * y = Σ prior (height + LANE_GAP_Y); its chord-attachment point is the box
 * centre. All coordinates are computed in a DOUBLED integer system (centre×2)
 * so the orientation cross products are exact integers (heights + LANE_GAP_Y +
 * x-extents are integer px). Two lifted edges that share an endpoint unit never
 * count as a crossing (they meet at the shared unit — the "sharing no endpoint"
 * eligibility, v3.1 §2/§9). O(|edges|²) — hull edge counts are small.
 */
function trialChordCrossings(
  sequence: readonly string[],
  liftedEdges: readonly StrataLiftedEdge[],
  unitHeightOf: (unitId: string) => number,
  xCentreDoubledOf: (unitId: string) => number,
): number {
  // Doubled box-centre y per unit: cy2 = 2*top + height; top accumulates the
  // integer stack. (Doubling keeps the +height/2 centre exact.)
  const cy2 = new Map<string, number>();
  let top = 0;
  for (const id of sequence) {
    const h = unitHeightOf(id);
    cy2.set(id, 2 * top + h);
    top += h + PIPELINE_LANE_GAP_Y;
  }
  const centre = (id: string): [number, number] => [
    xCentreDoubledOf(id),
    cy2.get(id) ?? 0,
  ];
  let crossings = 0;
  for (let i = 0; i < liftedEdges.length; i++) {
    const e1 = liftedEdges[i]!;
    for (let j = i + 1; j < liftedEdges.length; j++) {
      const e2 = liftedEdges[j]!;
      if (
        e1.from === e2.from ||
        e1.from === e2.to ||
        e1.to === e2.from ||
        e1.to === e2.to
      ) {
        continue; // shares an endpoint unit ⇒ not an eligible crossing pair
      }
      if (
        segmentsProperlyCross(
          centre(e1.from),
          centre(e1.to),
          centre(e2.from),
          centre(e2.to),
        )
      ) {
        crossings += 1;
      }
    }
  }
  return crossings;
}

/**
 * One directional barycenter sweep (§6-A2): compute each unit's barycenter
 * over its swept-direction neighbours (down = IN, up = OUT) UNION its
 * same-layer neighbours — counted PER-EDGE (the lift is a multiset) and each
 * incident edge AT MOST ONCE (an edge that is both swept-direction AND
 * same-layer contributes its endpoint a single time), then re-sort the WHOLE
 * sequence by (bary, key, unitId) in one batch. A unit with no relevant
 * incident edge for this sweep holds its own position (⊇ the spec's
 * no-neighbour float case), so it never poisons the mean with NaN. Pure
 * function of (sequence, adjacency, keys) — no previous-layout anchoring.
 *
 * EXACT rational comparison (round-7 float-ULP-tie hazard fix, v3.1 §12): the
 * barycenter is kept as a `(sumOfIndices, count)` pair over the sequence's RAW
 * INTEGER indices — never normalized to [0,1]. Normalizing by (n−1) is a
 * per-sweep monotone positive constant, so it cannot change the induced order;
 * working in raw integers instead makes every comparison EXACT integer
 * arithmetic (no float division, hence no ULP hazard bypassing the (key,
 * unitId) tiebreak chain). Two barycenters compare via cross-multiplication
 * (`a.sum * b.count` vs `b.sum * a.count`, both counts > 0 so the sign is
 * preserved) instead of float `<`/`>` — mathematically equal barycenters now
 * compare EXACTLY equal and fall through to the content-key tiebreak, never a
 * false ULP-driven order.
 */
function applyStrataSweep(
  sequence: readonly string[],
  adjacency: ReadonlyMap<string, readonly Incidence[]>,
  keyOf: ReadonlyMap<string, string>,
  direction: SweepDir,
): string[] {
  const indexOf = new Map<string, number>();
  sequence.forEach((id, i) => indexOf.set(id, i));
  const bary = new Map<string, { sum: number; count: number }>();
  for (const u of sequence) {
    const incident = adjacency.get(u) ?? [];
    let sum = 0;
    let count = 0;
    for (const inc of incident) {
      const swept =
        direction === "down" ? inc.kind === "in" : inc.kind === "out";
      if (swept || inc.sameLayer) {
        sum += indexOf.get(inc.other) ?? 0;
        count += 1;
      }
    }
    // No relevant neighbour ⇒ hold own position: (ownIndex, 1) — exact
    // equivalent of the old float fallback `pos.get(u)!`.
    bary.set(
      u,
      count > 0 ? { sum, count } : { sum: indexOf.get(u)!, count: 1 },
    );
  }
  const next = [...sequence];
  next.sort((a, b) => {
    const ba = bary.get(a)!;
    const bb = bary.get(b)!;
    // Exact rational compare: sum_a/count_a vs sum_b/count_b via integer
    // cross-multiplication (both counts are ≥ 1, so sign is preserved).
    const cross = ba.sum * bb.count - bb.sum * ba.count;
    if (cross !== 0) {
      return cross < 0 ? -1 : 1;
    }
    // EXACT tie: key breaks it (stability anchor); unitId is the final total
    // order.
    return (
      compareStrataContentKeys(keyOf.get(a)!, keyOf.get(b)!) ||
      compareStrataContentKeys(a, b)
    );
  });
  return next;
}

/**
 * Height-aware greedy seed (v3.1 §1.3): insert units one at a time in pinned key
 * order, each at the partial-sequence position minimizing the §1.1 weighted
 * bands-skipped cost. Ties on cost break to the EARLIEST insertion position
 * (determinism / diff-stability). Edges whose other endpoint isn't inserted yet
 * are ignored by {@link weightedBandsSkippedCost} (absent-position ⇒ skipped), so
 * the partial cost is exact for the placed prefix. O(n² · degree).
 */
function heightAwareGreedySeed(
  keyOrder: readonly string[],
  liftedEdges: readonly StrataLiftedEdge[],
  unitHeightOf: (unitId: string) => number,
): string[] {
  const partial: string[] = [];
  for (const u of keyOrder) {
    let bestPos = 0;
    let bestCost = Number.POSITIVE_INFINITY;
    for (let p = 0; p <= partial.length; p++) {
      const candidate = [...partial.slice(0, p), u, ...partial.slice(p)];
      const cost = weightedBandsSkippedCost(
        candidate,
        liftedEdges,
        unitHeightOf,
      );
      if (cost < bestCost) {
        bestCost = cost; // strict ⇒ earliest position wins on ties
        bestPos = p;
      }
    }
    partial.splice(bestPos, 0, u);
  }
  return partial;
}

/**
 * Order one hull's units (A0 step 3). At K=0 returns the initial model order:
 * units sorted by content key with the unit-id as the pinned tiebreak (C4′) —
 * BYTE-IDENTICAL to the M1a checkpoint. At K>0 runs the §6-A2 sweeps + §1.3
 * candidate selection keyed on `policy` (see the module header). The returned
 * sequence IS the placement order.
 */
export function orderStrataUnits(
  params: StrataOrderParams,
): readonly StrataUnit[] {
  const {
    units,
    contentKeyOf,
    liftedEdges,
    unitHeightOf,
    policy,
    sweeps,
    unitXSpanOf,
    unitColSpanOf,
  } = params;

  // Per-unit pinned metadata, keyed by strataUnitId (the sweep/trial namespace).
  const keyOf = new Map<string, string>();
  const unitById = new Map<string, StrataUnit>();
  for (const unit of units) {
    const id = strataUnitId(unit);
    keyOf.set(id, contentKeyOf(unit));
    unitById.set(id, unit);
  }

  // Initial model order (C4′): content key, unit-id tiebreak. This IS the K=0
  // output and the first (earliest-wins) candidate.
  const initialUnits = [...units].sort(
    (a, b) =>
      compareStrataContentKeys(
        keyOf.get(strataUnitId(a))!,
        keyOf.get(strataUnitId(b))!,
      ) || compareStrataContentKeys(strataUnitId(a), strataUnitId(b)),
  );

  // K=0 (M1a) or a trivial hull: pure model order, byte-identical to today.
  if (sweeps <= 0 || units.length <= 1) {
    return initialUnits;
  }

  const initialIds = initialUnits.map(strataUnitId);
  const layerOf = (id: string): number =>
    unitColSpanOf ? unitColSpanOf(id)[0] : 0;

  // Sweep adjacency: per-edge (multiset) incidences tagged IN/OUT + same-layer.
  const adjacency = new Map<string, Incidence[]>();
  const pushInc = (id: string, inc: Incidence): void => {
    const list = adjacency.get(id);
    if (list) {
      list.push(inc);
    } else {
      adjacency.set(id, [inc]);
    }
  };
  for (const e of liftedEdges) {
    const sameLayer = layerOf(e.from) === layerOf(e.to);
    pushInc(e.from, { other: e.to, kind: "out", sameLayer });
    pushInc(e.to, { other: e.from, kind: "in", sameLayer });
  }

  // Doubled box-centre x for the crossings trial (v3.1 §1.2). unitXSpanOf wins;
  // else a nominal colSpan.min column x; else 0 (degenerate but deterministic).
  const xCentreDoubledOf = (id: string): number => {
    if (unitXSpanOf) {
      const [x0, x1] = unitXSpanOf(id);
      return x0 + x1;
    }
    if (unitColSpanOf) {
      return 2 * unitColSpanOf(id)[0];
    }
    return 0;
  };

  const costOf = (seq: readonly string[]): number =>
    weightedBandsSkippedCost(seq, liftedEdges, unitHeightOf);
  const crossingsOf = (seq: readonly string[]): number =>
    trialChordCrossings(seq, liftedEdges, unitHeightOf, xCentreDoubledOf);
  const toUnits = (seq: readonly string[]): readonly StrataUnit[] =>
    seq.map((id) => unitById.get(id)!);

  // Sweep chain: sweep k alternates down/up starting with DOWN (OD-2). For
  // BANDED every sweep result is a candidate (no per-sweep gate); for PACKED the
  // v2.0 strict-crossings-decrease acceptance advances the chain only on a win.
  if (policy === "packed") {
    // v2.0 acceptance: accept the re-sorted sweep iff trial crossings strictly
    // decrease, else keep the previous sequence; final = last accepted. Packed
    // ignores the bands-skipped scorer AND the greedy seed (banded-only devices).
    let current = initialIds;
    let currentCrossings = crossingsOf(current);
    for (let k = 1; k <= sweeps; k++) {
      const direction: SweepDir = k % 2 === 1 ? "down" : "up";
      const trial = applyStrataSweep(current, adjacency, keyOf, direction);
      const trialCrossings = crossingsOf(trial);
      if (trialCrossings < currentCrossings) {
        current = trial;
        currentCrossings = trialCrossings;
      }
    }
    return toUnits(current);
  }

  // BANDED: candidate set = {initial, sweep results 1..K, greedy seed}, in that
  // pinned order. Score all by weighted bands-skipped cost; on equal cost the
  // banded-stack trial crossings decide (strictly fewer wins); remaining ties →
  // the earliest candidate (initial wins — diff-stability default).
  const candidates: string[][] = [initialIds];
  let chain = initialIds;
  for (let k = 1; k <= sweeps; k++) {
    const direction: SweepDir = k % 2 === 1 ? "down" : "up";
    chain = applyStrataSweep(chain, adjacency, keyOf, direction);
    candidates.push(chain);
  }
  candidates.push(heightAwareGreedySeed(initialIds, liftedEdges, unitHeightOf));

  let best = candidates[0]!;
  let bestCost = costOf(best);
  let bestCrossings: number | undefined; // lazily computed only on a cost tie
  for (let i = 1; i < candidates.length; i++) {
    const cand = candidates[i]!;
    const cost = costOf(cand);
    if (cost < bestCost) {
      best = cand;
      bestCost = cost;
      bestCrossings = undefined;
    } else if (cost === bestCost) {
      if (bestCrossings === undefined) {
        bestCrossings = crossingsOf(best);
      }
      const candCrossings = crossingsOf(cand);
      if (candCrossings < bestCrossings) {
        best = cand;
        bestCrossings = candCrossings;
      }
      // equal crossings ⇒ keep `best` (earliest candidate wins remaining ties)
    }
  }
  return toUnits(best);
}
