/**
 * Strata engine — post-A7 degree-1 pure-sink LEAF X-shift (`strataLeafShift`,
 * default off). A01 design memo (overnight 2026-07-17).
 *
 * WHY THIS PASS EXISTS (C2 DLQ stranding): rankSeparate's longest-path columning
 * strands a degree-1 sink leaf (one inbound edge, no outbound) far to the RIGHT of
 * its single source — the DLQ `sqs_queue.dlq[0]` sits at rank 15 while its SQS
 * source sits at rank 5, so the single incident edge is a long chord. Nothing
 * co-moves a lone leaf: block-clamp only moves whole pure-sink ACCOUNT subtrees,
 * and the barycenter sweeps can only reorder within a rank, never across ranks.
 *
 * WHAT IT DOES: for each degree-1 pure-sink leaf L (in-deg 1, out-deg 0 over the
 * effective E′) with single source S, it tries to move L's pixel box LEFT onto an
 * existing grid column `columnX[t]` for `t ∈ [rank(S)+1, rank(L)-1]`, nearest-to-
 * source first (the largest length + pierce win). It RE-DROPS L's Y within its
 * owning hull via the shared `dropY` skyline (seeded at the hull content top, so
 * the same call lands L "up into a free upper slot" for P3 OR "down below an
 * occupant" for C2 — chosen by geometry), then GROWS (never shrinks) L's ancestor
 * hull chain to contain the new bottom, syncing each grown child's box into its
 * parent's `placed` entry so the placement stays self-consistent.
 *
 * WHY A PURE PIXEL TRANSLATE + Y-REDROP, NOT RE-RANK: `rank.rank` and every
 * `colSpan` are read-only — rankSeparate's -42% height lever is preserved verbatim
 * (the leaf's rank map still says 15 while its box sits at `columnX[8]`; R2's
 * contiguity referee keys columns on EXACT `box.x`, not on the rank map, so this is
 * consistent with the proven block-clamp model). It does NOT reintroduce grid
 * X-compaction (forbidden by docs/strata-xcompact-removed-findings.md).
 *
 * MANDATORY RIGHT-EDGE GUARD (a05 F10 / commit e7ae739f0): the unguarded sink-pull
 * (`strataSinkPullIn`) was owner-REMOVED because it dragged us-west-2 region-level
 * loose sinks (Parameter Store, S3, DynamoDB) off the region's right edge,
 * dissolving the emergent right-edge column the owner wants. So a region-level
 * loose sink (owning hull role `region`) whose box right edge sits within
 * `strataLeafShiftRightEdgeGuardPx` (default 300px) of its parent region hull's
 * content right edge is EXCLUDED as a candidate. The six protected us-west-2 sinks
 * (distFromRight=250) are thereby ineligible; the DLQ (mid-graph, inside a VPC
 * hull, not region-level) stays eligible. Moving a leaf LEFT onto a lower-rank grid
 * column also can never EXTEND its owning hull's right edge or the scene width
 * (`columnX` is strictly increasing, so `columnX[t] < columnX[rank(L)]`), and the
 * X-containment gate's upper bound backstops that invariant.
 *
 * FLAG OFF ⇒ the input `placement` is returned by reference (byte-identical).
 *
 * Import-cycle rule (SDEC NaN): no module-level consts derived from
 * terraformPipelineLayoutShared — `PIPELINE_FRAME_PAD` is read at call time.
 */
import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";
import { strataHeightGateAdmitsWithin } from "./terraformPipelineStrataHeightGate";
import {
  checkStrataStructure,
  dropY,
} from "./terraformPipelineStrataPlacement";
import {
  scoreStrataPlacementGeometry,
  strataRelocateAdoptable,
  strataTransitiveEligible,
  strataTransitiveLess,
} from "./terraformPipelineStrataPackedScoring";

import type { SkylineRect } from "./terraformPipelineStrataPlacement";
import type { StrataPackedScore } from "./terraformPipelineStrataPackedScoring";
import type {
  StrataBox,
  StrataBoxedHull,
  StrataEngineOptions,
  StrataHullNode,
  StrataHullRole,
  StrataModel,
  StrataPlacedUnit,
  StrataPlacementResult,
  StrataPrimeEdge,
  StrataRankResult,
} from "./terraformPipelineStrataTypes";

/** Call-time reads (never module-level — pre-existing LayoutShared import cycle). */
const framePad = (): number => PIPELINE_FRAME_PAD;
/** Title strip reserved at the top of a non-root hull box (HULL_TITLE_BAND). */
const titleReserve = (): number => PIPELINE_FRAME_PAD * 2;
/** Content top inset of a hull box (root carries no title strip) — must match
 * `strataHullImpliedHeights` / placeStrataHulls step 5 EXACTLY. */
const topInsetOf = (role: StrataHullRole): number =>
  framePad() + (role === "root" ? 0 : titleReserve());

/**
 * Post-A7 degree-1 pure-sink leaf X-shift. Flag off ⇒ returns `placement` by
 * reference (byte-identical). Otherwise per-leaf, largest-move-first adoption of
 * length-shortening, LR-feasible, structurally-clean, gate-approved single-leaf
 * X-moves + Y-redrops of degree-1 pure-sink leaves toward their sources.
 */
export function refineStrataLeafShift(
  placement: StrataPlacementResult,
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
  rank: StrataRankResult,
  options: StrataEngineOptions,
): StrataPlacementResult {
  if (!options.strataLeafShift) {
    return placement; // byte-identical path — referential identity preserved.
  }

  const penW = options.strataCrossWeightPenetration ?? 1;
  const crossW = options.strataCrossWeightEdge ?? 1;
  const epsilon = options.packedScoringEpsilon ?? 0;
  const edgeCrossCap =
    options.strataEdgeCrossCap ?? options.packedScoringEpsilon ?? 0;
  const weights = { penW, crossW, epsilon, edgeCrossCap };
  const useTransitive = options.transitiveAdopt === true;

  const heightBudget = {
    absPx: options.strataLeafShiftHeightBudgetPx ?? 150,
    relFrac: options.strataLeafShiftHeightBudgetFrac ?? 0.01,
  };
  const rankBudget = options.strataLeafShiftRankBudget ?? 8;
  const rightEdgeGuardPx = options.strataLeafShiftRightEdgeGuardPx ?? 300;

  const columnX = rank.columnX;

  // Effective-direction adjacency over E′ (honor A3 `reversed`: a reversed edge
  // participates with source/target swapped, matching the ranker's effective
  // DAG). Per leaf: its effective outbound targets + inbound sources.
  const outTargets = new Map<string, string[]>();
  const inSources = new Map<string, string[]>();
  const pushInto = (m: Map<string, string[]>, k: string, v: string): void => {
    const list = m.get(k);
    if (list === undefined) {
      m.set(k, [v]);
    } else {
      list.push(v);
    }
  };
  for (const pe of edgesPrime) {
    const effSource = pe.reversed ? pe.edge.target : pe.edge.source;
    const effTarget = pe.reversed ? pe.edge.source : pe.edge.target;
    pushInto(outTargets, effSource, effTarget);
    pushInto(inSources, effTarget, effSource);
  }

  // leaf id → owning hull id (the deepest hull whose leafClusterIds contains it);
  // hull id → node; hull id → parent hull id. One walk of the tree.
  const owningHullOf = new Map<string, string>();
  const parentHullOf = new Map<string, string>();
  const walk = (node: StrataHullNode): void => {
    for (const leaf of node.leafClusterIds) {
      owningHullOf.set(leaf, node.id);
    }
    for (const child of node.children) {
      parentHullOf.set(child.id, node.id);
      walk(child);
    }
  };
  walk(model.hullRoot);

  // Enumerate degree-1 pure-sink leaves (in-deg 1 over E′, out-deg 0), sorted by
  // canonical address for determinism (the same device block-clamp uses).
  const candidateLeaves: string[] = [];
  for (const leafId of owningHullOf.keys()) {
    const outs = outTargets.get(leafId) ?? [];
    if (outs.length !== 0) {
      continue; // not a pure sink.
    }
    const ins = inSources.get(leafId) ?? [];
    if (ins.length !== 1) {
      continue; // multi-source fan-in hub (block-clamp territory) or isolated.
    }
    candidateLeaves.push(leafId);
  }
  candidateLeaves.sort((a, b) =>
    model.addressOf(a) < model.addressOf(b) ? -1 : 1,
  );

  const baselineScore = scoreStrataPlacementGeometry(
    placement,
    model,
    edgesPrime,
  );
  let incumbent = placement;
  let incumbentScore: StrataPackedScore = baselineScore;

  const r2Valid = (candidate: StrataPlacementResult): boolean => {
    const s = checkStrataStructure(candidate, model);
    return (
      s.nonAncestorOverlaps === 0 &&
      s.titleCollisions === 0 &&
      s.contiguityViolations === 0
    );
  };

  const scoreAdoptable = (candScore: StrataPackedScore): boolean => {
    if (useTransitive) {
      // P0.2 transitive path: ε-feasibility (raw crossings within the legacy
      // baseline budget — `edgeCrossCap` already resolves cap→ε→0) then
      // strict-total-order adoption vs the incumbent.
      return (
        strataTransitiveEligible(
          candScore,
          baselineScore.crossings,
          edgeCrossCap,
        ) && strataTransitiveLess(candScore, incumbentScore, { penW, crossW })
      );
    }
    return strataRelocateAdoptable(
      candScore,
      baselineScore,
      incumbentScore,
      weights,
    );
  };

  // Ancestor chain [H, parent(H), …, root] for the owning hull id.
  const ancestorChain = (hullId: string): string[] => {
    const chain: string[] = [];
    let cur: string | undefined = hullId;
    while (cur !== undefined) {
      chain.push(cur);
      cur = parentHullOf.get(cur);
    }
    return chain;
  };

  /**
   * Build a fresh placement moving leaf L (in owning hull H) to `newBox`,
   * growing (never shrinking) H's ancestor chain to contain the new bottom and
   * syncing each grown child's box into its parent's `placed` entry. Everything
   * outside the chain is copied by reference; the source is never mutated.
   *
   * Grows are computed bottom-up (deepest first) using the SAME arithmetic as
   * `strataHullImpliedHeights`, so every touched hull's `box.height` equals its
   * recomputed implied height — the candidate is self-consistent for R2, the
   * slack height gate, and the scene build.
   */
  const translateLeaf = (
    from: StrataPlacementResult,
    ownerId: string,
    leafId: string,
    newBox: StrataBox,
  ): StrataPlacementResult | null => {
    const chain = ancestorChain(ownerId); // [H, …, root], deepest first.
    const workBox = new Map<string, StrataBox>();
    const workPlaced = new Map<string, StrataPlacedUnit[]>();
    for (const id of chain) {
      const bh = from.boxedHulls.get(id);
      if (bh === undefined) {
        return null; // defensive — a chain hull with no box.
      }
      workBox.set(id, {
        x: bh.box.x,
        y: bh.box.y,
        width: bh.box.width,
        height: bh.box.height,
      });
      workPlaced.set(id, bh.placed.slice());
    }

    // Replace L's leaf-unit box in H's placed.
    const ownerPlaced = workPlaced.get(ownerId)!;
    const leafIdx = ownerPlaced.findIndex(
      (pu) => pu.unit.kind === "leaf" && pu.unit.clusterId === leafId,
    );
    if (leafIdx < 0) {
      return null; // L is not a direct placed leaf of H — skip.
    }
    ownerPlaced[leafIdx] = {
      unit: ownerPlaced[leafIdx]!.unit,
      box: newBox,
      colSpan: ownerPlaced[leafIdx]!.colSpan,
    };

    // Bottom-up grow-only refit (chain is deepest-first already).
    for (let i = 0; i < chain.length; i++) {
      const id = chain[i]!;
      const box = workBox.get(id)!;
      const placed = workPlaced.get(id)!;
      const role = from.boxedHulls.get(id)!.hull.role;
      let maxBottom = topInsetOf(role);
      for (const pu of placed) {
        const localBottom = pu.box.y + pu.box.height - box.y;
        if (localBottom > maxBottom) {
          maxBottom = localBottom;
        }
      }
      const impliedHeight = maxBottom + framePad();
      if (impliedHeight > box.height) {
        box.height = impliedHeight;
        // Sync this hull's entry inside its parent's placed list (the parent is
        // the next chain element — it reads this child's box for its own implied
        // height and the scene build reads it too).
        if (i + 1 < chain.length) {
          const parentId = chain[i + 1]!;
          const parr = workPlaced.get(parentId)!;
          const pidx = parr.findIndex(
            (pu) => pu.unit.kind === "hull" && pu.unit.hullId === id,
          );
          if (pidx >= 0) {
            parr[pidx] = {
              unit: parr[pidx]!.unit,
              box: { ...parr[pidx]!.box, height: box.height },
              colSpan: parr[pidx]!.colSpan,
            };
          }
        }
      }
    }

    const leafBoxes = new Map<string, StrataBox>(from.leafBoxes);
    leafBoxes.set(leafId, newBox);

    const boxedHulls = new Map<string, StrataBoxedHull>();
    for (const [id, bh] of from.boxedHulls) {
      if (workBox.has(id)) {
        boxedHulls.set(id, {
          hull: bh.hull,
          box: workBox.get(id)!,
          placed: workPlaced.get(id)!,
        });
      } else {
        boxedHulls.set(id, bh); // untouched — preserve referential identity.
      }
    }
    return { boxedHulls, leafBoxes };
  };

  for (const leafId of candidateLeaves) {
    const ownerId = owningHullOf.get(leafId)!;
    const ownerBh = incumbent.boxedHulls.get(ownerId);
    if (ownerBh === undefined) {
      continue;
    }
    const leafBox = incumbent.leafBoxes.get(leafId);
    if (leafBox === undefined) {
      continue;
    }
    const sourceId = (inSources.get(leafId) ?? [])[0]!;
    const rL = rank.rank.get(leafId);
    const rS = rank.rank.get(sourceId);
    if (rL === undefined || rS === undefined) {
      continue; // defensive.
    }
    if (rL <= rS + 1) {
      continue; // already adjacent to the source — no gain.
    }

    // MANDATORY right-edge guard (a05 F10 / e7ae739f0): exclude region-level loose
    // sinks flush against their region's right edge (the owner's protected
    // emergent column). A region-level loose sink's owning hull role is "region".
    if (ownerBh.hull.role === "region") {
      const contentRight = ownerBh.box.x + ownerBh.box.width - framePad();
      const leafRight = leafBox.x + leafBox.width;
      if (contentRight - leafRight <= rightEdgeGuardPx) {
        continue; // flush right-edge cohort member — do not dissolve the column.
      }
    }

    const srcBox = incumbent.leafBoxes.get(sourceId);

    // Target ranks: t ∈ [rS+1, rL-1], nearest-to-source first (largest win),
    // capped to rankBudget. Adopt the first t that passes every gate, then break.
    const tMax = Math.min(rL - 1, rS + rankBudget);
    for (let t = rS + 1; t <= tMax; t++) {
      const newX = columnX[t];
      if (newX === undefined) {
        continue;
      }

      // Gate (a): X-CONTAINMENT — L must stay inside its owning hull box
      // horizontally (R2 exempts ancestor↔descendant overlaps, so an escaped leaf
      // would pass R2 yet render outside its frame). The upper bound also
      // backstops the right-edge-extension invariant (a leftward move can never
      // extend the hull right edge).
      const pad = framePad();
      const minX = ownerBh.box.x + pad;
      const maxX = ownerBh.box.x + ownerBh.box.width - pad - leafBox.width;
      if (newX < minX || newX > maxX) {
        continue;
      }

      // Gate (b): PIXEL LR feasibility — the moved leaf's left edge must stay ≥
      // the source's right edge (a13 helper 4). Holds by construction for t > rS,
      // but guard explicitly against variable column widths.
      if (srcBox !== undefined && newX < srcBox.x + srcBox.width) {
        continue;
      }

      // Y-REDROP within the owning hull: seed at the hull content top so `dropY`
      // finds the TOPMOST free slot in the target column (up for P3, down for C2).
      const topInset = ownerBh.box.y + topInsetOf(ownerBh.hull.role);
      const others: SkylineRect[] = [];
      for (const pu of ownerBh.placed) {
        if (pu.unit.kind === "leaf" && pu.unit.clusterId === leafId) {
          continue; // skip L's own placed entry.
        }
        others.push({
          x0: pu.box.x,
          x1: pu.box.x + pu.box.width,
          y1: pu.box.y + pu.box.height,
          isHull: pu.unit.kind === "hull",
        });
      }
      const x1 = newX + leafBox.width;
      const newY = dropY(others, newX, x1, topInset, false);
      const newBox: StrataBox = {
        x: newX,
        y: newY,
        width: leafBox.width,
        height: leafBox.height,
      };

      const candidate = translateLeaf(incumbent, ownerId, leafId, newBox);
      if (candidate === null) {
        continue;
      }

      // Gate (c): SLACK height gate (budget max(absPx, relFrac·h)) — cheap
      // integer reject BEFORE the O(entries²) R2 and O(E²) scorer.
      if (
        !strataHeightGateAdmitsWithin(candidate, incumbent, heightBudget)
      ) {
        continue;
      }

      // Gate (d): R2 structural — the load-bearing overlap/interleave/pierce
      // referee. Catches the leaf overlapping any non-ancestor box (incl. a VPC
      // frame it must not pierce) at its new Y, and any contiguity interleave.
      if (!r2Valid(candidate)) {
        continue;
      }

      // Gate (e): SCORER — weighted-C + hard edge-cross cap + ε (or the transitive
      // strict-total-order key when `transitiveAdopt` is on).
      const candScore = scoreStrataPlacementGeometry(
        candidate,
        model,
        edgesPrime,
      );
      if (scoreAdoptable(candScore)) {
        incumbent = candidate;
        incumbentScore = candScore;
        break; // largest adoptable move wins — roll to the next leaf.
      }
    }
  }

  return incumbent;
}
