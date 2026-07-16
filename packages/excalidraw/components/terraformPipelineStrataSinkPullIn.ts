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
 * FLAG OFF ⇒ the input `placement` is returned by reference (byte-identical).
 *
 * Import-cycle rule (SDEC NaN): no module-level consts derived from
 * terraformPipelineLayoutShared — `PIPELINE_FRAME_PAD` is read at call time.
 */
import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";
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
    const targetColIndex = srcRank + 1;
    // Source at the last column ⇒ no on-grid column to the right ⇒ skip.
    if (targetColIndex >= columnX.length) {
      continue;
    }
    const targetX = columnX[targetColIndex]!;
    const sinkH = sinkBox.height;
    const sinkW = sinkBox.width;

    // X-CONTAINMENT guard (phase 1, BLOCKER fix): the target column must keep
    // the leaf fully inside its parent hull box HORIZONTALLY. `columnX` is a
    // GLOBAL column coord; when the sink's parent hull sits to the right of its
    // source's hull, `columnX[srcRank + 1]` can land LEFT of (or outside) the
    // parent box. `checkStrataStructure` exempts ancestor↔descendant overlaps
    // (placement.ts contains-rel skip), so a leaf pulled out of its own parent
    // box into empty inter-hull space is NOT counted as a structural violation
    // — it would render visibly outside its frame (a containment/hierarchy FAIL)
    // yet pass the R2 gate. Reject any target column that escapes the box.
    const minX = parentBh.box.x + framePad();
    const maxX = parentBh.box.x + parentBh.box.width - framePad() - sinkW;
    if (targetX < minX || targetX > maxX) {
      continue; // target column escapes the parent box — leave the sink put.
    }

    // Containment clamp bounds from the (stationary) parent hull box.
    // maxTop = box bottom − pad − sinkH IS the height gate (phase 1): a
    // candidate can never exceed the parent box bottom, so box height is
    // invariant. Coded as an explicit comparison for the future phase-2 gate.
    const minTop = parentBh.box.y + topInsetOf(parent.role);
    const maxTop = parentBh.box.y + parentBh.box.height - framePad() - sinkH;
    if (maxTop < minTop) {
      continue; // cannot fit vertically — leave the sink where the ranker put it.
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

  return incumbent;
}
