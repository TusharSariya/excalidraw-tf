/**
 * Strata engine — post-A7 crossing-aware vertical-slot relocation
 * (OD-15 crossings-≻-length relocate, `strataSiftRelocate`, default off).
 *
 * WHY THIS PASS EXISTS (two measured owner cases that are NOT ordering problems,
 * so neither dropY, the A2 sweep, nor the pre-A7 packed sift can reach them):
 *
 *   Case 1 — account-02 / us-west-2 wants to move DOWN. us-west-2 is X-disjoint
 *   from every sibling region: its column span never overlaps another sibling's,
 *   so the packed skyline `dropY` always lands it at the same top and every A2
 *   insertion boundary is geometrically identical. No sequence permutation moves
 *   an X-disjoint block in Y — it needs an explicit vertical-coordinate move.
 *
 *   Case 3 — us-east-2 wants to stay UP. A7 prices only L1 edge length, so it
 *   pushes us-east-2 ~826px DOWN to shorten a long chord even though that move
 *   ADDS hull crossings. A pre-A7 sift cannot lift it back; only a post-A7 move
 *   that scores hull crossings ≻ length can.
 *
 * THE X-DISJOINT RATIONALE: a child unit (hull or leaf) whose column span does
 * not overlap ANY same-hull sibling's span can be translated freely in Y without
 * colliding with an X-overlapping neighbour — it owns its columns outright. Those
 * are exactly the blocks that ordering/sift cannot budge and that this pass can
 * move safely. X-overlapping blocks are left to A0/A7 (moving them rigidly would
 * risk overlaps the skyline already resolved).
 *
 * WHAT IT DOES: walks hulls deterministically; for each X-disjoint movable block
 * it generates a small deterministic candidate-Y set (current top; every
 * sibling's top and bottom — the occupied rows an X-disjoint block can slot
 * into; and the external-edge median so a block chases the leaves it connects
 * to), clamped inside the parent hull box. Each candidate rigidly translates the
 * whole block (its box + every descendant hull/leaf box), is rejected unless it
 * still satisfies the R2 structural invariant (via `checkStrataStructure`), and
 * is scored on real leaf geometry with the weighted objective
 * `C = penW·penetrations + crossW·edgeEdgeCrossings` (comparator lex on
 * (C, lengthL1)). Adoption goes through `strataRelocateAdoptable`, which also
 * enforces the two owner guardrails: the ε budget on C vs the LEGACY baseline
 * and the hard edge-edge-crossing cap. Per-move adoption (greedy, not
 * all-or-nothing); on adoption the moved layout becomes the new incumbent.
 * Earliest candidate wins ties. Pure function — input maps are never mutated;
 * fully deterministic (fixed hull/candidate iteration, integer coordinates).
 *
 * FLAG OFF ⇒ the input `placement` is returned by reference (byte-identical).
 *
 * Import-cycle rule (SDEC NaN): no module-level consts derived from
 * terraformPipelineLayoutShared — the one geometry constant used
 * (`PIPELINE_FRAME_PAD`) is read at call time inside the helpers below.
 */
import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";
import { checkStrataStructure } from "./terraformPipelineStrataPlacement";
import {
  scoreStrataPlacementGeometry,
  // CONTRACT (terraformPipelineStrataPackedScoring.ts, authored in parallel):
  // the adoption gate encapsulates the weighted comparator + both guardrails.
  // Its sibling helpers `strataWeightedCross` / `strataRelocateScoreLess` are
  // part of the same contract but are NOT called here — `strataRelocateAdoptable`
  // subsumes them — so they are intentionally not imported (avoids unused-symbol
  // errors). If this import is unresolved at typecheck time, the parallel agent
  // has not landed the kernel yet.
  strataRelocateAdoptable,
} from "./terraformPipelineStrataPackedScoring";
import { strataUnitId } from "./terraformPipelineStrataOrdering";

import type { StrataPackedScore } from "./terraformPipelineStrataPackedScoring";
import type {
  StrataBox,
  StrataBoxedHull,
  StrataEngineOptions,
  StrataHullNode,
  StrataModel,
  StrataPlacementResult,
  StrataPrimeEdge,
  StrataRankResult,
  StrataUnit,
} from "./terraformPipelineStrataTypes";

/**
 * Per-unit cap on how many sibling slot boundaries (tops/bottoms) are trial-
 * placed: only the N NEAREST to the unit's current top. Each candidate runs a
 * full `checkStrataStructure` + whole-layout `scoreStrataPlacementGeometry`
 * (O(E²)), so an uncapped 2U-boundary set makes relocation O(U²) layouts per
 * hull — UI-freeze territory on the 123-cluster / 145-edge target. Capping to
 * the nearest N bounds it to O(U·N). Deterministic (nearest-by-distance, no
 * sampling); the external-edge-median candidate is always kept on TOP of this
 * budget.
 */
const STRATA_RELOCATE_SLOT_BUDGET = 8;

/** Call-time reads (never module-level — pre-existing LayoutShared import cycle). */
const framePad = (): number => PIPELINE_FRAME_PAD;
/** Title strip reserved at the top of a non-root hull box (HULL_TITLE_BAND). */
const titleReserve = (): number => PIPELINE_FRAME_PAD * 2;
/** Content top inset of a hull box (root carries no title strip). */
const topInsetOf = (role: StrataHullNode["role"]): number =>
  framePad() + (role === "root" ? 0 : titleReserve());

/** A box translated rigidly in Y (new object; input untouched). */
const shiftBox = (b: StrataBox, dy: number): StrataBox => ({
  x: b.x,
  y: b.y + dy,
  width: b.width,
  height: b.height,
});

/** Two closed integer column spans overlap (touching counts as overlap). */
const colSpanOverlap = (
  a: readonly [number, number],
  b: readonly [number, number],
): boolean => a[0] <= b[1] && b[0] <= a[1];

/** Integer median of a non-empty list (even length ⇒ rounded mean of the two). */
function integerMedian(values: readonly number[]): number {
  const sorted = [...values].sort((p, q) => p - q);
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/**
 * Post-A7 vertical-slot relocation. Flag off ⇒ returns `placement` by reference
 * (byte-identical). Otherwise per-move greedy adoption of crossing-improving
 * vertical translations of X-disjoint child blocks.
 */
export function refineStrataVerticalSlots(
  placement: StrataPlacementResult,
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
  rank: StrataRankResult,
  options: StrataEngineOptions,
): StrataPlacementResult {
  void rank; // rank is part of the shared signature; geometry here reads boxes.
  if (!options.strataSiftRelocate) {
    return placement; // byte-identical path — referential identity preserved.
  }

  const penW = options.strataCrossWeightPenetration ?? 1;
  const crossW = options.strataCrossWeightEdge ?? 1;
  const epsilon = options.packedScoringEpsilon ?? 0;
  const edgeCrossCap =
    options.strataEdgeCrossCap ?? options.packedScoringEpsilon ?? 0;
  const weights = { penW, crossW, epsilon, edgeCrossCap };

  // Baseline = the incoming (post-A7 legacy) placement. `baseline` anchors both
  // owner guardrails inside `strataRelocateAdoptable` (ε budget on C and the raw
  // edge-edge-crossing cap); `incumbent` is the rolling per-move winner.
  const baselineScore = scoreStrataPlacementGeometry(
    placement,
    model,
    edgesPrime,
  );

  let incumbent = placement;
  let incumbentScore: StrataPackedScore = baselineScore;

  // Content-addressed hull lookup + a stable pre-order hull list (determinism).
  const hullById = new Map<string, StrataHullNode>();
  const hullOrder: StrataHullNode[] = [];
  const indexHulls = (hull: StrataHullNode): void => {
    hullById.set(hull.id, hull);
    hullOrder.push(hull);
    for (const child of hull.children) {
      indexHulls(child);
    }
  };
  indexHulls(model.hullRoot);

  // leaf ids under a unit (leaf ⇒ itself; hull ⇒ its whole subtree).
  const subtreeLeafIds = (unit: StrataUnit): Set<string> => {
    const leaves = new Set<string>();
    if (unit.kind === "leaf") {
      leaves.add(unit.clusterId);
      return leaves;
    }
    const walk = (h: StrataHullNode): void => {
      for (const leaf of h.leafClusterIds) {
        leaves.add(leaf);
      }
      for (const child of h.children) {
        walk(child);
      }
    };
    walk(hullById.get(unit.hullId)!);
    return leaves;
  };

  // hull ids under a unit (empty for a leaf; the subtree hull ids for a hull).
  const subtreeHullIds = (unit: StrataUnit): Set<string> => {
    const hulls = new Set<string>();
    if (unit.kind === "hull") {
      const walk = (h: StrataHullNode): void => {
        hulls.add(h.id);
        for (const child of h.children) {
          walk(child);
        }
      };
      walk(hullById.get(unit.hullId)!);
    }
    return hulls;
  };

  /**
   * Rigidly translate `unit` (and its whole subtree) by `dy` within a fresh
   * placement. The moved subtree's hull boxes + their `placed` boxes + descendant
   * leaf boxes all ride along; the parent hull's box stays put but its single
   * `placed` entry for the moved unit shifts. Ancestors above the parent are
   * untouched (the parent box did not move). New maps — `from` is never mutated.
   */
  const translateUnit = (
    from: StrataPlacementResult,
    parentHullId: string,
    unit: StrataUnit,
    movedLeafIds: Set<string>,
    movedHullIds: Set<string>,
    dy: number,
  ): StrataPlacementResult => {
    const movedUnitId = strataUnitId(unit);

    const leafBoxes = new Map<string, StrataBox>();
    for (const [id, box] of from.leafBoxes) {
      leafBoxes.set(id, movedLeafIds.has(id) ? shiftBox(box, dy) : box);
    }

    const boxedHulls = new Map<string, StrataBoxedHull>();
    for (const [id, bh] of from.boxedHulls) {
      if (movedHullIds.has(id)) {
        // Whole hull rides along: its box and every placed child box shift.
        boxedHulls.set(id, {
          hull: bh.hull,
          box: shiftBox(bh.box, dy),
          placed: bh.placed.map((pu) => ({
            unit: pu.unit,
            box: shiftBox(pu.box, dy),
            colSpan: pu.colSpan,
          })),
        });
      } else if (id === parentHullId) {
        // Parent stays; only the placed entry for the moved unit shifts.
        boxedHulls.set(id, {
          hull: bh.hull,
          box: bh.box,
          placed: bh.placed.map((pu) =>
            strataUnitId(pu.unit) === movedUnitId
              ? {
                  unit: pu.unit,
                  box: shiftBox(pu.box, dy),
                  colSpan: pu.colSpan,
                }
              : pu,
          ),
        });
      } else {
        boxedHulls.set(id, bh);
      }
    }

    return { boxedHulls, leafBoxes };
  };

  // A candidate is R2-valid iff it is STRICTLY structurally clean — all three
  // counts exactly 0. A valid post-A7 strata placement always has
  // nonAncestorOverlaps == 0 && titleCollisions == 0 && contiguityViolations == 0
  // (the pipeline's final checkStrataStructure throws otherwise), so the sound
  // gate is "== 0", not "<= baseline": an equal-count comparison would admit a
  // move that merely SWAPS one violation for a different one at the same count.
  // If the incoming baseline is itself dirty (unreachable on the real path), no
  // candidate clears this gate and the input is returned unchanged — the
  // downstream final check handles the dirty baseline exactly as it does today.
  const r2Valid = (candidate: StrataPlacementResult): boolean => {
    const s = checkStrataStructure(candidate, model);
    return (
      s.nonAncestorOverlaps === 0 &&
      s.titleCollisions === 0 &&
      s.contiguityViolations === 0
    );
  };

  for (const hull of hullOrder) {
    const bh = incumbent.boxedHulls.get(hull.id);
    if (bh === undefined || bh.placed.length < 2) {
      continue; // nothing to relocate within a 0/1-unit hull.
    }
    const placedUnits = bh.placed;

    for (let i = 0; i < placedUnits.length; i++) {
      const target = placedUnits[i]!;

      // X-disjoint test: the unit's column span overlaps NO sibling's span.
      let disjoint = true;
      for (let j = 0; j < placedUnits.length; j++) {
        if (
          j !== i &&
          colSpanOverlap(target.colSpan, placedUnits[j]!.colSpan)
        ) {
          disjoint = false;
          break;
        }
      }
      if (!disjoint) {
        continue;
      }

      const unit = target.unit;
      const height = target.box.height;
      const movedLeafIds = subtreeLeafIds(unit);
      const movedHullIds = subtreeHullIds(unit);

      // Containment clamp bounds from the (stationary) parent hull box.
      const minTop = bh.box.y + topInsetOf(hull.role);
      const maxTop = bh.box.y + bh.box.height - framePad() - height;
      if (maxTop < minTop) {
        continue; // block cannot fit with any Y — leave it where A0/A7 put it.
      }

      // Deterministic candidate TOP set (bounded — see STRATA_RELOCATE_SLOT_BUDGET).
      // Sibling tops/bottoms are the occupied rows an X-disjoint block can slot
      // into; the external-edge median lets the block chase the far leaves it
      // actually connects to.
      const currentTop = target.box.y;

      // All sibling slot boundaries (tops + bottoms), then keep only the NEAREST
      // STRATA_RELOCATE_SLOT_BUDGET to the unit's current top. Bounding this to N
      // makes candidate evaluation O(U·N) per hull instead of O(U²): every
      // candidate runs a full checkStrataStructure + whole-layout scorer (O(E²)),
      // which is UI-freeze territory on the 123-cluster / 145-edge target. The
      // pick is deterministic (sort by |distance to currentTop|, ties by raw
      // value) — no random sampling.
      const boundaries: number[] = [];
      for (let j = 0; j < placedUnits.length; j++) {
        if (j === i) {
          continue;
        }
        const sib = placedUnits[j]!.box;
        boundaries.push(sib.y);
        boundaries.push(sib.y + sib.height);
      }
      boundaries.sort(
        (a, b) => Math.abs(a - currentTop) - Math.abs(b - currentTop) || a - b,
      );
      const nearestBoundaries = boundaries.slice(
        0,
        STRATA_RELOCATE_SLOT_BUDGET,
      );

      // External edges: exactly one endpoint inside the moved block. Median of
      // the FAR (outside) leaf-box centre Ys → target for the block's centre.
      const farCentres: number[] = [];
      for (const pe of edgesPrime) {
        const sIn = movedLeafIds.has(pe.edge.source);
        const tIn = movedLeafIds.has(pe.edge.target);
        if (sIn === tIn) {
          continue; // internal or wholly external — not a boundary chord.
        }
        const farId = sIn ? pe.edge.target : pe.edge.source;
        const farBox = incumbent.leafBoxes.get(farId);
        if (farBox) {
          farCentres.push(farBox.y + farBox.height / 2);
        }
      }

      // Fixed evaluation order: current top (no-op anchor), the external-edge
      // median, then the nearest slot boundaries. Clamp to containment,
      // integer-round, dedupe preserving first-seen order.
      const rawTops: number[] = [currentTop];
      if (farCentres.length > 0) {
        rawTops.push(integerMedian(farCentres) - Math.round(height / 2));
      }
      rawTops.push(...nearestBoundaries);

      const seen = new Set<number>();
      const candidateTops: number[] = [];
      for (const raw of rawTops) {
        const clamped = Math.round(Math.min(maxTop, Math.max(minTop, raw)));
        if (!seen.has(clamped)) {
          seen.add(clamped);
          candidateTops.push(clamped);
        }
      }

      // Per-move greedy adoption. dy is measured from the unit's CURRENT top in
      // the rolling incumbent (recomputed each candidate so a prior adoption on
      // this same block is respected). Earliest adoptable candidate wins ties.
      for (const candTop of candidateTops) {
        const liveBox =
          unit.kind === "leaf"
            ? incumbent.leafBoxes.get(unit.clusterId)
            : incumbent.boxedHulls.get(unit.hullId)?.box;
        if (liveBox === undefined) {
          break; // unreachable on the engine path; defensive.
        }
        const dy = candTop - liveBox.y;
        if (dy === 0) {
          continue;
        }
        const candidate = translateUnit(
          incumbent,
          hull.id,
          unit,
          movedLeafIds,
          movedHullIds,
          dy,
        );
        if (!r2Valid(candidate)) {
          continue;
        }
        const candScore = scoreStrataPlacementGeometry(
          candidate,
          model,
          edgesPrime,
        );
        if (
          strataRelocateAdoptable(
            candScore,
            baselineScore,
            incumbentScore,
            weights,
          )
        ) {
          incumbent = candidate;
          incumbentScore = candScore;
        }
      }
    }
  }

  return incumbent;
}
