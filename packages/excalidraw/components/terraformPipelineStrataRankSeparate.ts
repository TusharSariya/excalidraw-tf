/**
 * Strata OD-14 — sibling-separation ranking (`strataRankSeparate`, default OFF).
 *
 * The height lever (v3.1 §7 OD-14, DEC-12 class): the Strata port of v1's
 * `rankSeparate` (RFC §9.6 / DEC-13; measured −42% height in v1). This is the
 * WHOLE-MODEL-GLOBAL Sander base-node layering, ported to the Strata model:
 * rank EVERY leaf cluster in ONE longest-path pass over the whole-model leaf DAG
 * augmented with sibling-separation constraints, so every real leaf edge
 * (including cross-container) is a constraint in the SAME frame and CANNOT
 * invert.
 *
 * ## Portability — what is reused vs adapted
 *
 * The v1 driver `computeGlobalSeparatedFloor` (terraformPipelineRcllRankSeparate)
 * is COUPLED to the RCLL model: it walks a `CompoundNode` tree (leaves are child
 * nodes; `node.cluster.id`/`node.key`) and consumes a PRECOMPUTED per-container
 * `lattice.hullEdges` map that the Strata model never builds. It cannot run
 * against `StrataHullNode` as-is. Its condensation PRIMITIVE
 * `buildSeparationConstraintGraph` is, however, structure-agnostic (generic
 * `string[]` child keys + `{from,to}`-shaped edges) and lives in the neutral
 * `terraformPipelineLayoutShared` module (promoted out of
 * `terraformPipelineRcllRankSeparate` for hermeticity — Strata never imports
 * RCLL) — so this module REUSES it verbatim (SCC-quotient + one-way-pair
 * condensation + infeasibility gate) and re-implements ONLY the whole-model
 * driver against the Strata structures:
 *
 *   1. tree walk over `StrataHullNode` (units at a hull = child hulls ∪ direct
 *      leaves — exactly `StrataUnit`), not `CompoundNode`;
 *   2. per-hull sibling-unit edges DERIVED on the fly from E′ (the Strata model
 *      has no `lattice.hullEdges`), lifting leaf edges to unit keys;
 *   3. leaf adjacency built from the effective E′ edges (post-reversal, C10′),
 *      not `lattice.fanout`.
 *
 * The Sander separated-floor contract is otherwise identical to v1: all-to-all
 * leaf precedence per one-way quotient pair, co-axial mutual cycles collapse to
 * one SCC (no separation), the `pairCount===0` no-op short-circuit keeps the
 * base floor byte-identical, and an augmented-graph cycle keeps the base floor
 * observably.
 *
 * ## How the separated floor compresses HEIGHT (the crux mapping)
 *
 * The separated floor is an X-COLUMN rank assignment (the same axis the NS
 * refinement rewrites) — it does NOT assign Y-bands directly. It compresses the
 * vertical extent INDIRECTLY: re-ranking one-way-dependent sibling units into
 * DISJOINT column ranges lets Strata's A0 **packed** skyline (`dropY` over each
 * unit's ACTUAL x-extent) place those siblings SIDE-BY-SIDE (same Y-band)
 * instead of stacking them down the page — the structural equivalent of v1's M4
 * lane rise "lift B beside A" (trade width for height). Under **banded** hulls
 * (root/provider/account) units stack full-width regardless of columns, so
 * separation does not compress those levels (it only widens them); the win comes
 * through the deep packed hulls (region/vpc/subnetZone) where the tall stacks
 * and the long cross-container edges live. Strata's always-on packed skyline is
 * the analog of the lane-rise that v1's rankSeparate had to compose with.
 *
 * ## Determinism / NaN import-cycle
 *
 * Pure + deterministic: SCC reps lexicographically smallest (Tarjan, via
 * `buildSeparationConstraintGraph`); the shared `longestPath`'s max-relaxation
 * result is a pure function of the edge SET (independent of ready-queue order —
 * so no reliance on input-array stability, C4′). NO module-level constant is
 * derived from a `LayoutShared` value (this module is reachable from the Strata
 * dispatch, inside the `terraformPlanParsing → terraformLayoutCore` cycle, where
 * such a derivation would freeze as NaN) — it only imports FUNCTIONS.
 */
import {
  buildSeparationConstraintGraph,
  longestPath,
} from "./terraformPipelineLayoutShared";

import type { StrataHullNode } from "./terraformPipelineStrataTypes";

/**
 * Result of the whole-model Strata separated-floor pass. `floor` is the
 * separated layering (or the base floor on a no-op / fallback). The remaining
 * fields make the fallback OBSERVABLE (mirrors `RankSeparateMeta`):
 *
 *   - `applied`          — true iff separation changed the floor.
 *   - `pairCount`        — one-way sibling-unit pairs found across ALL hulls.
 *                          0 ⇒ no-op short-circuit (base floor byte-identical).
 *   - `changedRankCount` — leaf clusters whose rank moved vs the base floor.
 *   - `fallbackReason`   — `none` (applied), `no-pairs` (byte-identical OFF), or
 *                          `augmented-cycle` (adding `A<B` closed a path
 *                          `B→…→A` — e.g. through a co-axial pair — base kept).
 */
export type StrataRankSeparateMeta = {
  floor: ReadonlyMap<string, number>;
  applied: boolean;
  pairCount: number;
  changedRankCount: number;
  fallbackReason: "none" | "no-pairs" | "augmented-cycle";
};

/** Unit key for a child hull at its parent (mirrors placement's `H:`/`L:`). */
const hullUnitKey = (hullId: string): string => `H:${hullId}`;
/** Unit key for a direct leaf at its owning hull. */
const leafUnitKey = (clusterId: string): string => `L:${clusterId}`;

/** Collect every descendant leaf cluster id under `hull` (deepest-hull leaves). */
function collectStrataLeafIds(hull: StrataHullNode, out: string[]): void {
  for (const leaf of hull.leafClusterIds) {
    out.push(leaf);
  }
  for (const child of hull.children) {
    collectStrataLeafIds(child, out);
  }
}

/**
 * Whole-model-global sibling-separation layering for the Strata model (OD-14,
 * the Sander base-node construction). Ranks EVERY leaf cluster in ONE
 * longest-path pass over the whole-model leaf DAG (`effEdges`) augmented with
 * separation constraints, so every real leaf edge is a constraint in the SAME
 * frame and CANNOT invert.
 *
 * - **Co-axial cycles stay co-axial.** A mutual cycle between two sibling units
 *   collapses to ONE SCC quotient (`buildSeparationConstraintGraph`) ⇒ no
 *   separation edge between them.
 * - **All-to-all** (not one rep→rep edge): for each one-way quotient pair A→B
 *   add `a→b ∀ a∈leaves(A), b∈leaves(B)`, so the rightward push holds even when
 *   another constraint moves a different extreme leaf.
 * - **No-op short-circuit:** `pairCount === 0` returns the base floor DIRECTLY
 *   (does NOT re-run `longestPath`) ⇒ OFF geometry is byte-identical.
 * - **Observable fallback:** an augmented-graph cycle keeps the base floor and
 *   reports `fallbackReason="augmented-cycle"` — never a silent rank expansion.
 *
 * @param hullRoot  the Strata hull tree (units per hull = child hulls ∪ leaves).
 * @param baseFloor the longest-path floor (A1) — returned verbatim on a no-op.
 * @param effEdges  effective E′ leaf edges (post-A3 reversal, C10′); the DAG
 *                  that produced `baseFloor`. Self-loops are excluded upstream.
 */
export function computeStrataSeparatedFloor(
  hullRoot: StrataHullNode,
  baseFloor: ReadonlyMap<string, number>,
  effEdges: readonly { source: string; target: string }[],
): StrataRankSeparateMeta {
  // 1. Every leaf cluster id in the whole model.
  const allLeaves: string[] = [];
  collectStrataLeafIds(hullRoot, allLeaves);
  const leafSet = new Set(allLeaves);

  // 2. Whole-model leaf→leaf edges (the DAG that produced the base floor).
  const leafEdges: { from: string; to: string }[] = [];
  for (const e of effEdges) {
    if (leafSet.has(e.source) && leafSet.has(e.target) && e.source !== e.target) {
      leafEdges.push({ from: e.source, to: e.target });
    }
  }

  // 3. Separation edges: walk every hull; for each one-way sibling-unit quotient
  //    pair A→B add an ALL-TO-ALL strict precedence a→b ∀ a∈leaves(A),b∈leaves(B).
  let pairCount = 0;
  const sepEdges: { from: string; to: string }[] = [];

  const walk = (hull: StrataHullNode): void => {
    const unitKeys: string[] = [];
    // memberLeaves(unitKey) — the descendant leaves under that unit.
    const memberLeavesByUnit = new Map<string, string[]>();
    // clusterId → owning unit key AT THIS hull.
    const unitOfCluster = new Map<string, string>();

    for (const child of hull.children) {
      const uk = hullUnitKey(child.id);
      unitKeys.push(uk);
      const leaves: string[] = [];
      collectStrataLeafIds(child, leaves);
      memberLeavesByUnit.set(uk, leaves);
      for (const cid of leaves) {
        unitOfCluster.set(cid, uk);
      }
    }
    for (const leafId of hull.leafClusterIds) {
      const uk = leafUnitKey(leafId);
      unitKeys.push(uk);
      memberLeavesByUnit.set(uk, [leafId]);
      unitOfCluster.set(leafId, uk);
    }

    // A container with <2 units cannot host sibling separation.
    if (unitKeys.length >= 2) {
      // Lift E′ leaf edges to sibling-unit {from,to} edges (both endpoints
      // under a unit of THIS hull; cross-unit only).
      // `buildSeparationConstraintGraph` reads from/to only — no RCLL-specific
      // `HullEdge` shape (weight/declared) needed here.
      const hullEdges: { from: string; to: string }[] = [];
      for (const e of effEdges) {
        const uf = unitOfCluster.get(e.source);
        const ut = unitOfCluster.get(e.target);
        if (uf !== undefined && ut !== undefined && uf !== ut) {
          hullEdges.push({ from: uf, to: ut });
        }
      }

      const { condEdges, membersByQuotient, infeasible } =
        buildSeparationConstraintGraph(unitKeys, hullEdges);
      if (!infeasible && condEdges.length > 0) {
        // Leaves under each quotient rep (all member units' descendants).
        const leavesByRep = new Map<string, string[]>();
        for (const [rep, memberUnitKeys] of membersByQuotient) {
          const ids: string[] = [];
          for (const uk of memberUnitKeys) {
            for (const cid of memberLeavesByUnit.get(uk) ?? []) {
              ids.push(cid);
            }
          }
          leavesByRep.set(rep, ids);
        }
        for (const ce of condEdges) {
          pairCount += 1;
          for (const a of leavesByRep.get(ce.from) ?? []) {
            for (const b of leavesByRep.get(ce.to) ?? []) {
              sepEdges.push({ from: a, to: b });
            }
          }
        }
      }
    }

    for (const child of hull.children) {
      walk(child);
    }
  };
  walk(hullRoot);

  // 4. No one-way pairs ⇒ separation is a no-op ⇒ return the base floor verbatim
  //    (OFF byte-identical; do NOT re-rank — a re-ranked floor could re-zero).
  if (pairCount === 0) {
    return {
      floor: baseFloor,
      applied: false,
      pairCount: 0,
      changedRankCount: 0,
      fallbackReason: "no-pairs",
    };
  }

  // 5. ONE global longest-path over (leaf edges ∪ separation edges). The result
  //    is a pure function of the edge set (C4′-safe: order-independent).
  const { column, hasCycle } = longestPath(
    allLeaves,
    [...leafEdges, ...sepEdges],
    () => 0,
  );
  if (hasCycle) {
    // Adding `A<B` closed a path `B→…→A` (e.g. through a co-axial pair). Caught,
    // never silent — keep the base floor.
    return {
      floor: baseFloor,
      applied: false,
      pairCount,
      changedRankCount: 0,
      fallbackReason: "augmented-cycle",
    };
  }

  // 6. Did the ranks actually move? (separation only pushes right ⇒ col ≥ floor).
  let changedRankCount = 0;
  for (const id of allLeaves) {
    if ((column.get(id) ?? 0) !== (baseFloor.get(id) ?? 0)) {
      changedRankCount += 1;
    }
  }

  return {
    floor: column,
    applied: changedRankCount > 0,
    pairCount,
    changedRankCount,
    fallbackReason: "none",
  };
}
