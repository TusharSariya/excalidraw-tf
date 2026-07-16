/**
 * Strata engine — post-A7 leaf-sink pull-in (`strataSinkPullIn`, default off).
 *
 * WHY THIS PASS EXISTS (P1: stranded degree-1 sinks):
 *
 *   rankSeparate's longest-path columning over-columns terminal resources.
 *   A degree-1 sink (a DLQ, an SSM param, an S3 bucket, a DynamoDB table) whose
 *   ONLY edge is inbound from a single source is placed at its longest-path
 *   rank, which can land it many columns to the RIGHT of that source — a long
 *   near-horizontal connector chord with nothing between the two ends. The
 *   ranker cannot fix this (its -42% height lever intentionally ignores edge
 *   length), and A7/dropY only price/settle Y, not the sink's column.
 *
 * WHAT IT DOES: for each effective degree-1 sink LEAF (in-degree 1, out-degree
 * 0 over E′, honoring A3 `reversed` disposition), it translates ONLY that leaf
 * (it has no descendants by construction) to the ON-GRID column immediately to
 * the RIGHT of its source (`columnX[srcRank + 1]`), paired with a small
 * deterministic candidate-Y set. Each trial is rejected unless it still
 * satisfies the R2 structural invariant (`checkStrataStructure` all-zero) and is
 * adopted only through `strataRelocateAdoptable` — the SAME weighted-C + hard
 * edge-cross cap + ε gate the vertical-relocate pass uses. A degree-1 pull
 * strictly shortens its own edge; the gate rejects any pull that regresses
 * crossings/penetrations beyond cap.
 *
 * WHY LEAF-ONLY RIGID TRANSLATE, NOT RANK REASSIGNMENT: the removed X-compaction
 * findings forbid global/grid column reindexing, and P5 proves a naive X-pull
 * grows height via the dropY skyline. Rank reassignment + full re-placement is
 * the heavy, risky route. The surgical route is a single-leaf 2D translate to an
 * existing column strictly right of the source, gated by the existing structural
 * + scorer machinery. LR forward-flow is preserved BY CONSTRUCTION: the target
 * column is always right of the source column, so the sink's single edge can
 * never invert.
 *
 * PHASE 1 (this pass): the parent hull box extents are HELD FIXED. The
 * containment clamp (a candidate top can never exceed the parent box bottom) IS
 * the height gate — the hull box height is invariant with zero recompute, coded
 * as an explicit box-height comparison so a future phase-2 box-recompute inherits
 * a real gate. It does NOT shrink the region/account box (that is phase 2).
 *
 * `strataSinkLadder` (U1, default off): relaxes the all-or-nothing single-column
 * cliff into a capped leftmost-first ladder of candidate columns, turning the
 * X-containment rejection from per-sink into per-column. See the rung block below
 * for the mechanism (P3's region-level sinks with in-VPC sources can never
 * satisfy `columnX[srcRank + 1]`).
 *
 * MEASURED STATUS (frozen preset staging-extended-localstack-v2, seed 20260704,
 * composed probe — docs/strata-p5-height-gate-results-2026-07-16.md): the
 * ladder's MARGINAL effect over the already-committed `strataSinkPullIn` is
 * −1,257 px lengthL1 (−0.37% of scene length), with ZERO change to crossings,
 * height, or width. That is a NULL on the metric hierarchy this codebase ranks by
 * (crossings > continuity/angle > pierces >> height). It is retained because it
 * is the correct relaxation of a cliff that provably strands P3-shaped sinks —
 * groundwork for a phase-2 mover — NOT because it wins today. Do not describe it
 * as the pass's fix.
 *
 * `strataHeightGate` (P5 / Lever C, default off): the per-hull implied-height
 * maintain-or-decrease referee (terraformPipelineStrataHeightGate.ts) applied as
 * a conjunct on every adoption.
 *
 * HONEST STATUS — the gate is LIVE here, not inert. An earlier revision of this
 * header claimed the `maxTop` clamp made the gate a provable no-op. That is
 * FALSE and the ratchet suite in the test file is the counterexample: `maxTop`
 * clamps against the STORED frame, while the gate compares ROLLING IMPLIED
 * height, and the candidate-top loop does not break on adoption. So within one
 * pass an early adoption can shrink a hull (a sink that uniquely pinned the floor
 * rises), after which a later candidate that is still inside the stored frame
 * re-grows the implied height and the gate vetoes what gate-off adopts. The gate
 * changes real geometry on such a layout.
 *
 * It is nonetheless EMPIRICALLY INERT at the frozen preset — measured, not
 * argued: gate-on is geometrically identical to gate-off there, and gate-only is
 * byte-identical to baseline. That is a fact about that scene, not a theorem.
 *
 * KNOWN RATCHET COST (open phase-2 decision): comparing against the rolling
 * incumbent is STRICTLY STRONGER than the theorem needs. The contract is only
 * "final height <= BASELINE height" (that is what cannot regress rankSeparate's
 * -42% win); the rolling comparison additionally forbids any per-step re-growth,
 * so one lucky early shrink can permanently lock out later length wins that never
 * exceed baseline. The ratchet test pins exactly this: a vetoed move whose implied
 * height (232) is still well under baseline (268). Comparing against the BASELINE
 * placement instead would preserve the theorem verbatim while admitting that move.
 * Deliberately NOT changed here — the rolling form is the conservative one, it is
 * what the unit-proven monotonicity theorem covers, and the gate is default-off
 * and inert at the preset, so the choice belongs with the phase-2 mover that will
 * actually feel it.
 *
 * It is not a height win today, and it unlocks nothing on its own: no operator
 * currently PROPOSES a height-growing candidate, so on the real engine path the
 * gate has almost nothing to referee. The phase-2 relaxation it exists for
 * (occupant displacement + VPSC Y-repair + box recompute) is NOT BUILT.
 *
 * FLAG OFF ⇒ the input `placement` is returned by reference (byte-identical).
 *
 * Import-cycle rule (SDEC NaN): no module-level consts derived from
 * terraformPipelineLayoutShared — `PIPELINE_FRAME_PAD` is read at call time.
 */
import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";
import { strataHeightGateAdmits } from "./terraformPipelineStrataHeightGate";
import { checkStrataStructure } from "./terraformPipelineStrataPlacement";
import {
  scoreStrataPlacementGeometry,
  strataRelocateAdoptable,
} from "./terraformPipelineStrataPackedScoring";

import type { StrataPackedScore } from "./terraformPipelineStrataPackedScoring";
import type {
  StrataBox,
  StrataBoxedHull,
  StrataEngineOptions,
  StrataHullRole,
  StrataModel,
  StrataPlacementResult,
  StrataPrimeEdge,
  StrataRankResult,
} from "./terraformPipelineStrataTypes";

/**
 * Per-sink cap on how many sibling slot boundaries (tops/bottoms) are trial-
 * placed as candidate Ys — only the N nearest to the sink's current top. Each
 * candidate runs a full `checkStrataStructure` + whole-layout
 * `scoreStrataPlacementGeometry` (O(E²)), so an uncapped set is UI-freeze
 * territory. Mirrors the vertical-relocate budget. Deterministic (nearest-by-
 * distance, ties by raw value).
 */
const STRATA_SINK_SLOT_BUDGET = 8;

/**
 * `strataSinkLadder` (U1): per-sink cap on how many COLUMN rungs are attempted,
 * counted leftmost-first from `srcRank + 1`. Each rung re-runs the whole
 * candidate-top loop (R2 O(entries²) + scorer O(E²) per top), so an uncapped
 * ladder multiplies per-sink cost by (sinkRank − srcRank − 1) — at the frozen
 * preset a DLQ is +9 columns off its floor. 6 keeps the worst case ≈ 6× the
 * single-column pass while still reaching well past the columns that matter
 * (the shortening is monotone in how far left the sink lands, so the leftmost
 * rungs carry nearly all the win).
 */
const STRATA_SINK_LADDER_BUDGET = 6;

/** Call-time reads (never module-level — pre-existing LayoutShared import cycle). */
const framePad = (): number => PIPELINE_FRAME_PAD;
/** Title strip reserved at the top of a non-root hull box (HULL_TITLE_BAND). */
const titleReserve = (): number => PIPELINE_FRAME_PAD * 2;
/** Content top inset of a hull box (root carries no title strip). */
const topInsetOf = (role: StrataHullRole): number =>
  framePad() + (role === "root" ? 0 : titleReserve());

/**
 * Post-A7 leaf-sink pull-in. Flag off ⇒ returns `placement` by reference
 * (byte-identical). Otherwise per-sink greedy adoption of length-shortening,
 * structurally-clean, gate-approved single-leaf translations toward the source.
 */
export function refineStrataSinkPullIn(
  placement: StrataPlacementResult,
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
  rank: StrataRankResult,
  options: StrataEngineOptions,
): StrataPlacementResult {
  if (!options.strataSinkPullIn) {
    return placement; // byte-identical path — referential identity preserved.
  }

  const penW = options.strataCrossWeightPenetration ?? 1;
  const crossW = options.strataCrossWeightEdge ?? 1;
  const epsilon = options.packedScoringEpsilon ?? 0;
  const edgeCrossCap =
    options.strataEdgeCrossCap ?? options.packedScoringEpsilon ?? 0;
  const weights = { penW, crossW, epsilon, edgeCrossCap };

  const columnX = rank.columnX;

  // Effective-direction degree over E′ (honor A3 `reversed`: a reversed edge
  // participates in ranking/ordering with source/target swapped, so "sink"
  // matches the ranker's effective DAG). Track the unique inbound source per
  // node so a degree-1 sink resolves its source without a second scan.
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  const inSource = new Map<string, string>();
  for (const pe of edgesPrime) {
    const effSource = pe.reversed ? pe.edge.target : pe.edge.source;
    const effTarget = pe.reversed ? pe.edge.source : pe.edge.target;
    outDeg.set(effSource, (outDeg.get(effSource) ?? 0) + 1);
    inDeg.set(effTarget, (inDeg.get(effTarget) ?? 0) + 1);
    inSource.set(effTarget, effSource);
  }

  // Degree-1 sinks: leaf clusters (in model.clusters, never a hull) with
  // in-degree 1, out-degree 0. Deterministic order by canonical address.
  const sinks: { sink: string; sourceId: string }[] = [];
  for (const clusterId of model.clusters.keys()) {
    if (
      (inDeg.get(clusterId) ?? 0) === 1 &&
      (outDeg.get(clusterId) ?? 0) === 0
    ) {
      const sourceId = inSource.get(clusterId);
      if (sourceId !== undefined) {
        sinks.push({ sink: clusterId, sourceId });
      }
    }
  }
  sinks.sort((a, b) =>
    model.addressOf(a.sink) < model.addressOf(b.sink) ? -1 : 1,
  );

  // leaf clusterId → parent hull id (the hull whose `placed` holds the leaf).
  const leafParent = new Map<
    string,
    { hullId: string; role: StrataHullRole }
  >();
  for (const [hullId, bh] of placement.boxedHulls) {
    for (const pu of bh.placed) {
      if (pu.unit.kind === "leaf") {
        leafParent.set(pu.unit.clusterId, { hullId, role: bh.hull.role });
      }
    }
  }

  const baselineScore = scoreStrataPlacementGeometry(
    placement,
    model,
    edgesPrime,
  );
  let incumbent = placement;
  let incumbentScore: StrataPackedScore = baselineScore;

  // A candidate is R2-valid iff STRICTLY structurally clean — all three counts
  // exactly 0 (mirrors the vertical-relocate gate + the pipeline's final check).
  const r2Valid = (candidate: StrataPlacementResult): boolean => {
    const s = checkStrataStructure(candidate, model);
    return (
      s.nonAncestorOverlaps === 0 &&
      s.titleCollisions === 0 &&
      s.contiguityViolations === 0
    );
  };

  /**
   * Build a fresh placement translating ONLY the sink leaf to absolute
   * (targetX, top) and moving it to column index `colIndex`. Every other entry
   * copied by reference; `from` never mutated. Parent hull box unchanged
   * (phase 1 — box extents held fixed).
   */
  const translateSinkLeaf = (
    from: StrataPlacementResult,
    parentHullId: string,
    sink: string,
    targetX: number,
    top: number,
    w: number,
    h: number,
  ): StrataPlacementResult => {
    const newBox: StrataBox = { x: targetX, y: top, width: w, height: h };

    const leafBoxes = new Map<string, StrataBox>();
    for (const [id, box] of from.leafBoxes) {
      leafBoxes.set(id, id === sink ? newBox : box);
    }

    const boxedHulls = new Map<string, StrataBoxedHull>();
    for (const [id, bh] of from.boxedHulls) {
      if (id === parentHullId) {
        boxedHulls.set(id, {
          hull: bh.hull,
          box: bh.box, // parent box held fixed (phase 1 height/width invariant)
          placed: bh.placed.map((pu) =>
            // colSpan is the unit's rank span (its home column); this pass moves
            // ONLY the pixel box, never the rank, so the original colSpan is
            // retained (matches the vertical-relocate pass, and honors the
            // "never re-ranks" contract — rewriting it to the target column
            // would falsely re-rank the leaf).
            pu.unit.kind === "leaf" && pu.unit.clusterId === sink
              ? { unit: pu.unit, box: newBox, colSpan: pu.colSpan }
              : pu,
          ),
        });
      } else {
        boxedHulls.set(id, bh);
      }
    }

    return { boxedHulls, leafBoxes };
  };

  for (const { sink, sourceId } of sinks) {
    const parent = leafParent.get(sink);
    if (parent === undefined) {
      continue;
    }
    const parentBh = incumbent.boxedHulls.get(parent.hullId);
    if (parentBh === undefined) {
      continue;
    }
    const sinkBox = incumbent.leafBoxes.get(sink);
    const srcBox = incumbent.leafBoxes.get(sourceId);
    if (sinkBox === undefined || srcBox === undefined) {
      continue;
    }
    const srcRank = rank.rank.get(sourceId);
    const sinkRank = rank.rank.get(sink);
    if (srcRank === undefined || sinkRank === undefined) {
      continue;
    }

    // STRANDED test: already adjacent (or left of the target column) ⇒ skip.
    if (sinkRank <= srcRank + 1) {
      continue;
    }
    const sinkH = sinkBox.height;
    const sinkW = sinkBox.width;

    // COLUMN RUNGS. Default (ladder off): the single column `srcRank + 1` — the
    // sink's fully-pulled-in floor, all-or-nothing (byte-identical to the
    // committed pass).
    //
    // `strataSinkLadder` (U1) relaxes the ALL-OR-NOTHING CLIFF, not any gate.
    // Today a stranded sink gets exactly ONE candidate column; if it fails
    // X-containment, R2, or the scorer, the pass gives up and the sink stays
    // where the ranker put it (rank 15 for P1's DLQ, rank 26 for P3's SSM/S3/
    // Dynamo) with no fallback to rank 14/13/12. The cliff bites hardest exactly
    // where the problem is worst: P3's stranded sinks are region-level
    // (vpc=none) while their sources sit INSIDE vpc-5b587, so
    // `columnX[srcRank + 1]` is derived from a source in a different, left-lying
    // hull and lands outside the sink's own region box ⇒ `continue` ⇒ the sink
    // never moves at all, even though nearer columns are inside its parent and
    // would still shorten the chord substantially.
    //
    // With the ladder the X-containment `continue` becomes PER-COLUMN instead of
    // per-sink, so every partial pull-in is attempted. Nothing is removed: every
    // rung still faces X-containment, R2 all-zero, the weighted-C + edgeCrossCap
    // + ε gate, the "never re-ranks" contract (colSpan retained), and LR by
    // construction (every rung k > srcRank ⇒ the sink's single edge cannot
    // invert).
    //
    // RUNG ORDER is leftmost-first and adoption BREAKS on the first rung that
    // adopts, so the winner is the leftmost rung that clears every gate. That
    // maximizes this sink's own edge shortening (monotone in how far left it
    // lands) but is NOT a claim of packed-objective optimality across rungs: a
    // marginal early rung can pre-empt a later one that would have scored better
    // on crossings. Deliberate — leftmost carries nearly all the length win, the
    // scorer still vetoes any rung that regresses crossings past cap, and
    // scoring every rung would multiply the O(E²) cost by the budget.

    // X-CONTAINMENT bounds (phase 1, BLOCKER fix): a target column is FEASIBLE
    // only if it keeps the leaf fully inside its parent hull box HORIZONTALLY.
    // `columnX` is a GLOBAL column coord; when the sink's parent hull sits to
    // the right of its source's hull, `columnX[srcRank + 1]` can land LEFT of
    // (or outside) the parent box. `checkStrataStructure` exempts
    // ancestor↔descendant overlaps (placement.ts contains-rel skip), so a leaf
    // pulled out of its own parent box into empty inter-hull space is NOT
    // counted as a structural violation — it would render visibly outside its
    // frame (a containment/hierarchy FAIL) yet pass the R2 gate. Bounds are
    // rung-independent (the parent box is held fixed in phase 1), so they are
    // hoisted out of the rung loop and double as the ladder's feasibility filter.
    const minX = parentBh.box.x + framePad();
    const maxX = parentBh.box.x + parentBh.box.width - framePad() - sinkW;
    const xFeasible = (colIndex: number): boolean => {
      if (colIndex >= columnX.length) {
        return false; // no on-grid column there.
      }
      const x = columnX[colIndex]!;
      return x >= minX && x <= maxX;
    };

    const rungs: number[] = [];
    if (options.strataSinkLadder === true) {
      // The budget counts X-FEASIBLE rungs, NOT raw columns. Counting raw
      // columns spends the entire budget on columns that provably escape the
      // parent box before a single one is trial-placed — which silently
      // disables the ladder in exactly its motivating case: P3's region-level
      // sinks, whose sources sit inside a left-lying VPC, so the parent box can
      // start many columns right of `srcRank + 1` and the first feasible rung is
      // well past rung 6. The filter applies the SAME predicate as the per-rung
      // guard below, so skipping ahead removes no check; it only stops the
      // budget from being burned on known-infeasible columns. The scan itself is
      // O(sinkRank − srcRank) integer compares; the budget still bounds the
      // EXPENSIVE part (trial placements: R2 O(entries²) + scorer O(E²) per top).
      for (
        let k = srcRank + 1;
        k < sinkRank && rungs.length < STRATA_SINK_LADDER_BUDGET;
        k++
      ) {
        if (xFeasible(k)) {
          rungs.push(k);
        }
      }
    } else {
      rungs.push(srcRank + 1);
    }

    for (const targetColIndex of rungs) {
      // Ladder-off pushes `srcRank + 1` unfiltered, so the guard still runs here
      // (byte-identical to the committed single-column pass). Ladder-on rungs
      // are pre-filtered by the same predicate, making this a cheap no-op.
      if (!xFeasible(targetColIndex)) {
        continue; // this column escapes the parent box — try the next rung.
      }
      const targetX = columnX[targetColIndex]!;

      // Containment clamp bounds from the (stationary) parent hull box.
      // maxTop = box bottom − pad − sinkH keeps every candidate inside the
      // STORED frame, so the stored box height is invariant under phase 1.
      //
      // It is NOT equivalent to `strataHeightGate` below, and the two can
      // disagree: this clamp is an absolute bound against a frozen frame, while
      // the gate is a relative bound against the ROLLING IMPLIED height. Once an
      // adoption shrinks a hull, candidates well inside this clamp still re-grow
      // the implied height and the gate vetoes them. See the module header's
      // ratchet note and the ratchet suite in the test file.
      const minTop = parentBh.box.y + topInsetOf(parent.role);
      const maxTop = parentBh.box.y + parentBh.box.height - framePad() - sinkH;
      if (maxTop < minTop) {
        continue; // cannot fit vertically — try the next rung.
      }

      // Deterministic candidate TOP set: pure X-pull (current Y), source-centre
      // alignment, source top, then the nearest sibling slot boundaries.
      const currentTop = sinkBox.y;
      const rawTops: number[] = [
        currentTop,
        srcBox.y + srcBox.height / 2 - sinkH / 2,
        srcBox.y,
      ];

      const boundaries: number[] = [];
      for (const pu of parentBh.placed) {
        if (pu.unit.kind === "leaf" && pu.unit.clusterId === sink) {
          continue;
        }
        boundaries.push(pu.box.y);
        boundaries.push(pu.box.y + pu.box.height);
      }
      boundaries.sort(
        (a, b) => Math.abs(a - currentTop) - Math.abs(b - currentTop) || a - b,
      );
      rawTops.push(...boundaries.slice(0, STRATA_SINK_SLOT_BUDGET));

      const seen = new Set<number>();
      const candidateTops: number[] = [];
      for (const raw of rawTops) {
        const clamped = Math.round(Math.min(maxTop, Math.max(minTop, raw)));
        if (!seen.has(clamped)) {
          seen.add(clamped);
          candidateTops.push(clamped);
        }
      }

      // Per-sink greedy adoption against the rolling incumbent. Earliest
      // adoptable candidate wins ties; the live incumbent box is re-read each
      // candidate so a prior adoption on this sink is respected.
      let adoptedOnRung = false;
      for (const candTop of candidateTops) {
        const liveBox = incumbent.leafBoxes.get(sink);
        if (liveBox === undefined) {
          break; // unreachable on the engine path; defensive.
        }
        if (liveBox.x === targetX && liveBox.y === candTop) {
          continue; // no-op (would not change geometry).
        }
        const candidate = translateSinkLeaf(
          incumbent,
          parent.hullId,
          sink,
          targetX,
          candTop,
          sinkW,
          sinkH,
        );
        // HEIGHT GATE (P5 / Lever C) — cheapest-first: O(Σ|placed|) ≈ 150 ops,
        // ahead of r2Valid's O(entries²) and the scorer's O(E²), so it strictly
        // saves work on rejected candidates. Compared against the ROLLING
        // incumbent (never the baseline) — that is what makes the per-hull
        // height non-increasing by induction over adoptions.
        if (
          options.strataHeightGate === true &&
          !strataHeightGateAdmits(candidate, incumbent)
        ) {
          continue;
        }
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
          adoptedOnRung = true;
        }
      }

      // Leftmost admissible rung wins: stop laddering this sink once a rung has
      // adopted. (Ladder off ⇒ a single rung ⇒ the loop ends anyway, so the
      // committed pass's semantics are preserved byte-for-byte.)
      if (adoptedOnRung) {
        break;
      }
    }
  }

  return incumbent;
}
