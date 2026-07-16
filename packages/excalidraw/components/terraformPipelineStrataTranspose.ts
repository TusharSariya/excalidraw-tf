/**
 * Strata engine — post-placement within-column TRANSPOSE crossing reduction
 * (`strataTranspose`, default off ⇒ byte-identical).
 *
 * WHY THIS PASS EXISTS (P2 — the SSM fan-in ordering defect that neither the A2
 * median sweeps, the pre-A7 packed sift, nor `refineStrataVerticalSlots` reach):
 *
 *   A fan-in column (e.g. the 7 SSM params, all rank 15, x=7440) has a
 *   within-rank Y-order that does not match its sources — api6/api7's sources
 *   are one rank deeper (r13) and sit high-Y, while their params land at the
 *   column bottom, producing diagonal crossings. (1) The A2 median sweeps score
 *   on the BANDED-STACK trial proxy (`trialChordCrossings`), not real placed Y,
 *   so the within-hull barycenter never lifts these params. (2)
 *   `refineStrataVerticalSlots` EXPLICITLY skips them — it only translates
 *   X-DISJOINT blocks (its `colSpanOverlap` test `continue`s on any overlap),
 *   but the 7 params are all X-OVERLAPPING (same rank/column). They are exactly
 *   the units the relocate pass cannot touch.
 *
 * THE OPERATOR (Gansner/Koutsofios/North/Vo 1993 dot `transpose`, adapted to
 * strata's placed-box model): an ENVELOPE-PRESERVING adjacent Y-exchange of two
 * X-column-OVERLAPPING sibling units inside one hull. For an adjacent pair
 * (upper u at top T, lower w with gap g = w.y − (u.y + u.height)), the exchange
 * places w at T and u at T + w.height + g. The new pair bottom
 * `T + w.height + g + u.height` equals the old pair bottom
 * `T + u.height + g + w.height` EXACTLY (independent of heights), so the pair's
 * union span, every downstream unit, and the hull box height are all unchanged —
 * nothing re-packs and the packed-height gate (P5) cannot be perturbed. This is
 * the complementary operator to `refineStrataVerticalSlots`: that pass Y-moves
 * X-disjoint blocks; this pass Y-swaps X-overlapping adjacent pairs.
 *
 * WHAT IT DOES: walks hulls deterministically; within each hull it partitions
 * the placed siblings into COLUMN GROUPS (connected components over X-column
 * overlap), and for up to MAX_PASSES (direction-alternating, dot's `reverse`)
 * walks each group's Y-adjacent pairs, trialing the adjacent exchange. Each
 * candidate is implemented by composing the pure `translateUnit` twice on the
 * rolling incumbent (shift w up, then u down), rejected unless it still
 * satisfies the R2 structural invariant (`checkStrataStructure` == 0 on all
 * three counts — the hard backstop against any accidental overlap with a
 * between-unit), and scored on real leaf geometry via
 * `scoreStrataPlacementGeometry`. Adoption goes through `strataRelocateAdoptable`
 * (the two owner guardrails: hard raw-edge-cross cap + ε anti-ratchet vs the
 * LEGACY baseline). Per-move greedy adoption; a hull stops early when a full
 * pass adopts nothing. Earliest candidate wins ties. Pure function — input maps
 * are never mutated; fully deterministic.
 *
 * KEY P2 RESULT: moving api6/api7 UP toward their high-Y sources shortens their
 * diagonal edges, so each upward adjacent exchange STRICTLY reduces lengthL1.
 * `strataRelocateAdoptable`'s strict-lex arm (weightedCross, lengthL1) therefore
 * adopts even crossing-NEUTRAL upward swaps (L1 drops), and crossing-reducing
 * swaps adopt outright — greedy multi-pass bubbles them to the top; the hard cap
 * blocks any exchange that would blow up crossings elsewhere.
 *
 * FLAG OFF ⇒ the input `placement` is returned by reference (byte-identical).
 *
 * Import-cycle rule (SDEC NaN): no module-level consts derived from
 * terraformPipelineLayoutShared — the one geometry constant (`PIPELINE_FRAME_PAD`)
 * is read at call time inside the helpers below. Helpers (shiftBox,
 * colSpanOverlap, translateUnit, subtree*Ids, framePad/topInsetOf) are duplicated
 * from `refineStrataVerticalSlots` rather than shared, to keep the flag-OFF
 * byte-identity and A/B isolation clean and avoid any new import cycle.
 */
import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";
import { checkStrataStructure } from "./terraformPipelineStrataPlacement";
import {
  scoreStrataPlacementGeometry,
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
 * Bounded number of full direction-alternating passes per hull. dot's transpose
 * iterates to convergence; each pass runs a full whole-layout scorer (O(E²)) per
 * candidate, so we cap the passes and stop a hull early when a pass adopts
 * nothing. 4 mirrors the A2 sweep count and is enough for the P2 bubble.
 */
const STRATA_TRANSPOSE_MAX_PASSES = 4;

/** Call-time reads (never module-level — pre-existing LayoutShared import cycle). */
const framePad = (): number => PIPELINE_FRAME_PAD;

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

/**
 * Post-placement within-column transpose. Flag off ⇒ returns `placement` by
 * reference (byte-identical). Otherwise per-move greedy adoption of
 * crossing-/length-improving adjacent Y-exchanges of X-overlapping sibling pairs.
 */
export function transposeStrataColumns(
  placement: StrataPlacementResult,
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
  rank: StrataRankResult,
  options: StrataEngineOptions,
): StrataPlacementResult {
  void rank; // rank is part of the shared signature; geometry here reads boxes.
  if (!options.strataTranspose) {
    return placement; // byte-identical path — referential identity preserved.
  }

  const penW = options.strataCrossWeightPenetration ?? 1;
  const crossW = options.strataCrossWeightEdge ?? 1;
  const epsilon = options.packedScoringEpsilon ?? 0;
  const edgeCrossCap =
    options.strataEdgeCrossCap ?? options.packedScoringEpsilon ?? 0;
  const weights = { penW, crossW, epsilon, edgeCrossCap };

  // Baseline = the incoming placement. It anchors both owner guardrails inside
  // `strataRelocateAdoptable` (ε budget on C and the raw edge-edge-crossing cap);
  // `incumbent` is the rolling per-move winner.
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
   * placement. Identical to `refineStrataVerticalSlots.translateUnit` — the
   * moved subtree's hull boxes + their `placed` boxes + descendant leaf boxes
   * all ride along; the parent hull box stays put but its single `placed` entry
   * for the moved unit shifts. New maps — `from` is never mutated.
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
  // counts exactly 0 (a valid strata placement always is; the pipeline's final
  // check throws otherwise). "== 0" (not "<= baseline") rejects any move that
  // merely swaps one violation for another at the same count and is the hard
  // backstop against an adjacent exchange that would overlap a between-unit.
  const r2Valid = (candidate: StrataPlacementResult): boolean => {
    const s = checkStrataStructure(candidate, model);
    return (
      s.nonAncestorOverlaps === 0 &&
      s.titleCollisions === 0 &&
      s.contiguityViolations === 0
    );
  };

  // Live box of a unit in the rolling incumbent (leaf box or hull box).
  const liveBoxOf = (unit: StrataUnit): StrataBox | undefined =>
    unit.kind === "leaf"
      ? incumbent.leafBoxes.get(unit.clusterId)
      : incumbent.boxedHulls.get(unit.hullId)?.box;

  for (const hull of hullOrder) {
    const bh = incumbent.boxedHulls.get(hull.id);
    if (bh === undefined || bh.placed.length < 2) {
      continue; // nothing to transpose within a 0/1-unit hull.
    }

    // Partition placed siblings into COLUMN GROUPS = connected components over
    // the X-column-overlap relation (union-find on colSpan overlap). Only
    // members that share columns can change crossings by swapping Y order;
    // X-disjoint blocks are `refineStrataVerticalSlots`'s domain. Deterministic:
    // iterate in placement order, earliest index is the component root.
    const n = bh.placed.length;
    const parentIdx = Array.from({ length: n }, (_, k) => k);
    const findRoot = (k: number): number => {
      let r = k;
      while (parentIdx[r] !== r) {
        r = parentIdx[r]!;
      }
      // Path-halving (still deterministic — pure structure compression).
      let cur = k;
      while (parentIdx[cur] !== r) {
        const next = parentIdx[cur]!;
        parentIdx[cur] = r;
        cur = next;
      }
      return r;
    };
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (colSpanOverlap(bh.placed[a]!.colSpan, bh.placed[b]!.colSpan)) {
          const ra = findRoot(a);
          const rb = findRoot(b);
          if (ra !== rb) {
            parentIdx[Math.max(ra, rb)] = Math.min(ra, rb);
          }
        }
      }
    }
    // Group members (units) keyed by component root, in ascending root order.
    const groupsByRoot = new Map<number, StrataUnit[]>();
    for (let k = 0; k < n; k++) {
      const root = findRoot(k);
      const arr = groupsByRoot.get(root);
      if (arr) {
        arr.push(bh.placed[k]!.unit);
      } else {
        groupsByRoot.set(root, [bh.placed[k]!.unit]);
      }
    }
    const columnGroups = [...groupsByRoot.keys()]
      .sort((p, q) => p - q)
      .map((root) => groupsByRoot.get(root)!)
      .filter((members) => members.length >= 2);
    if (columnGroups.length === 0) {
      continue; // every column group is a singleton — nothing to swap.
    }

    for (let pass = 0; pass < STRATA_TRANSPOSE_MAX_PASSES; pass++) {
      let adoptedThisPass = false;
      const reverse = pass % 2 === 1; // dot's direction alternation.

      for (const group of columnGroups) {
        // Re-sort by live top (ascending; ties by content key) at pass start so
        // prior-pass adoptions are respected. Skip units whose live box vanished
        // (unreachable on the engine path; defensive).
        const members = group
          .filter((u) => liveBoxOf(u) !== undefined)
          .sort((u, w) => {
            const dy = liveBoxOf(u)!.y - liveBoxOf(w)!.y;
            return dy !== 0
              ? dy
              : strataUnitId(u).localeCompare(strataUnitId(w));
          });
        if (members.length < 2) {
          continue;
        }

        // Walk Y-adjacent pairs (upper = members[k], lower = members[k+1]).
        // Direction alternation picks the scan order; on adoption we swap the
        // two entries in `members` so subsequent adjacencies see the new order.
        const start = reverse ? members.length - 2 : 0;
        const step = reverse ? -1 : 1;
        for (
          let k = start;
          reverse ? k >= 0 : k <= members.length - 2;
          k += step
        ) {
          const upper = members[k]!;
          const lower = members[k + 1]!;
          const upBox = liveBoxOf(upper);
          const loBox = liveBoxOf(lower);
          if (upBox === undefined || loBox === undefined) {
            continue;
          }
          // Guard the sort invariant (upper.y <= lower.y). If a prior adoption
          // in this scan reordered things unexpectedly, skip rather than risk a
          // non-envelope-preserving move.
          if (upBox.y > loBox.y) {
            continue;
          }

          const T = upBox.y; // anchor = upper's current top.
          const g = loBox.y - (upBox.y + upBox.height); // inter-pair gap.

          // Compose the exchange on the rolling incumbent: shift `lower` up to
          // T, then shift `upper` down to T + lower.height + g. Envelope-
          // preserving: new pair bottom == old pair bottom exactly.
          const lowerLeafIds = subtreeLeafIds(lower);
          const lowerHullIds = subtreeHullIds(lower);
          const step1 = translateUnit(
            incumbent,
            hull.id,
            lower,
            lowerLeafIds,
            lowerHullIds,
            T - loBox.y,
          );

          const upperLeafIds = subtreeLeafIds(upper);
          const upperHullIds = subtreeHullIds(upper);
          // `upper` has not moved in step1, so its live top is still T. Shift it
          // DOWN by lower.height + g to land at T + lower.height + g.
          const dyUp = loBox.height + g;
          const candidate = translateUnit(
            step1,
            hull.id,
            upper,
            upperLeafIds,
            upperHullIds,
            dyUp,
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
            adoptedThisPass = true;
            // Reflect the swap in the local ordering so subsequent adjacencies
            // in this scan see the new Y order.
            members[k] = lower;
            members[k + 1] = upper;
          }
        }
      }

      if (!adoptedThisPass) {
        break; // converged for this hull.
      }
    }
  }

  return incumbent;
}
