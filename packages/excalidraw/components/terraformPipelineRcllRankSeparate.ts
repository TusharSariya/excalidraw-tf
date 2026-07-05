/**
 * RCLL — sibling-separation ranking (`rankSeparate`, default OFF). RFC §9.6 / DEC-13.
 *
 * Source of truth: docs/pipeline-rcll-layout-design.md §9.6. The /plan-eng-review +
 * Codex pass (2026-06-20) reframed this as the **whole-model-global Sander base-node
 * layering** (Sander, *Layout of Compound Directed Graphs*; the dagre/ELK construction):
 * rank EVERY leaf cluster in ONE longest-path pass over the whole-model leaf DAG,
 * augmented with sibling-separation constraints. The container span is *derived* from
 * its leaves — never assigned in an independent local frame.
 *
 * ## Why global (the round-3 NO-GO)
 *
 * Round 3 ran the ranker PER swimlane group with INDEPENDENT per-container shifts. The
 * co-axial 2-cycle account pair `0002⇄0003` had its two interiors re-ranked in separate
 * frames, so a cross-account leaf edge linked differently-shifted leaves and inverted
 * (7 backward + 1 same-column on v2). Codex proved a lane-local pass is not truly
 * global either (it loses boundary edges). The fix: ONE pass over ALL leaves + ALL leaf
 * edges, so every real edge (incl. cross-account) is a constraint in the SAME frame and
 * forwardness is a property of the single layering, not of any shift.
 *
 * ## What it does
 *
 *   - **No hull edge between two sibling containers** → independent → no separation →
 *     they keep their natural floor → overlap → the M4 lane rise Y-stacks them. OFF.
 *   - **One-way hull edge A→B** between siblings → add ALL-TO-ALL leaf precedence
 *     `a→b ∀ a∈leaves(A),b∈leaves(B)` → B's leaves rank strictly after A's → disjoint
 *     column ranges → the lane rise can lift B beside A (trade width for height).
 *   - **Mutual cycle A⇄B** → collapses to ONE SCC quotient → NO separation, stays
 *     co-axial. The cross-cycle set the heuristic probes proved is unreclaimable.
 *
 * ## CON-12 (the iron rule)
 *
 * Leaf X **changes** with the new ranks. The pass is a *valid forward layering* of the
 * whole leaf DAG (every real leaf edge points strictly right), proven on the placed
 * boxes by `backwardEdgeGate`. Two observable fallbacks keep the base floor instead of
 * a silent expansion: `pairCount===0` (no one-way pairs ⇒ OFF byte-identical) and an
 * augmented-graph cycle (`fallbackReason="augmented-cycle"`).
 *
 * Pure + deterministic: SCC reps lexicographically smallest (Tarjan); `longestPath`'s
 * `(rank, key)` tiebreak; edge order = model + container-walk order.
 */
import {
  buildSeparationConstraintGraph,
  longestPath,
} from "./terraformPipelineLayoutShared";

import type { CompoundNode, HullEdge } from "./terraformPipelineRcllTypes";

// `buildSeparationConstraintGraph` (SCC-quotient + one-way-pair condensation +
// infeasibility gate) and its `constraintGraphHasCycle` helper now live in the
// neutral `terraformPipelineLayoutShared` module (structure-agnostic, pure
// `string[]` child keys + `{from,to}`-shaped edges) alongside `longestPath` /
// `stronglyConnectedComponents`, which this module already imported from
// there. Re-exported here so existing callers/tests of this module (which
// import them from "./terraformPipelineRcllRankSeparate") keep working
// unchanged.
export {
  buildSeparationConstraintGraph,
  constraintGraphHasCycle,
  type SeparationConstraintGraph,
} from "./terraformPipelineLayoutShared";

/**
 * Result of the whole-model-global Sander pass. `floor` is the separated layering
 * (or the base floor on a no-op / fallback). The remaining fields make the fallback
 * OBSERVABLE so the probe/gate can tell "fixed it" from "silently did nothing":
 *
 *   - `applied`        — true iff separation changed the floor.
 *   - `pairCount`      — one-way sibling-container pairs found across ALL containers
 *                        (the separation that COULD fire). 0 ⇒ no-op short-circuit.
 *   - `changedRankCount` — leaf clusters whose rank moved vs the base floor.
 *   - `fallbackReason` — `none` (applied), `no-pairs` (byte-identical OFF), or
 *                        `augmented-cycle` (adding `A<B` closed a path `B→…→A` —
 *                        e.g. through the co-axial pair — so we kept the base floor).
 */
export type RankSeparateMeta = {
  floor: ReadonlyMap<string, number>;
  applied: boolean;
  pairCount: number;
  changedRankCount: number;
  fallbackReason: "none" | "no-pairs" | "augmented-cycle";
};

/** Collect every descendant leaf cluster id under `node`. */
function collectLeafIds(node: CompoundNode, out: string[]): void {
  if (node.children.length === 0) {
    if (node.cluster) {
      out.push(node.cluster.id);
    }
    return;
  }
  for (const child of node.children) {
    collectLeafIds(child, out);
  }
}

/**
 * Whole-model-global sibling-separation layering (RFC §9.6 / DEC-13 — the Sander
 * base-node construction). Ranks EVERY leaf cluster in ONE longest-path pass over the
 * whole-model leaf DAG augmented with separation constraints, so every real leaf edge
 * (including cross-account) is a constraint in the SAME frame and CANNOT invert.
 *
 * ```
 *  base leaf DAG (lattice.fanout, whole model)   ─┐
 *                                                  ├─►  one longestPath  ─►  floor
 *  separation edges: ∀ one-way pair A→B, add      ─┘     (all leaves)
 *      a→b  for every a∈leaves(A), b∈leaves(B)         (Sander border, all-to-all)
 * ```
 *
 * - **Co-axial cycles stay co-axial.** A mutual cycle `A⇄B` collapses to ONE SCC
 *   quotient (`buildSeparationConstraintGraph`) ⇒ no separation edge between them.
 * - **All-to-all** (not max-leaf→min-leaf): one edge between preselected reps does NOT
 *   enforce `all-A < all-B` once other constraints move a different extreme leaf.
 * - **No-op short-circuit:** `pairCount === 0` returns the base floor DIRECTLY (does
 *   NOT re-run longestPath) ⇒ OFF geometry is byte-identical.
 * - **Observable fallback:** an augmented-graph cycle keeps the base floor and reports
 *   `fallbackReason="augmented-cycle"` — never a silent rank expansion.
 *
 * Pure + deterministic (SCC reps lexicographically smallest; `longestPath`'s
 * `(rank, key)` tiebreak; edge order is model + container walk order).
 */
export function computeGlobalSeparatedFloor(
  tree: CompoundNode,
  baseFloor: ReadonlyMap<string, number>,
  leafAdjacency: ReadonlyMap<string, readonly string[]>,
  hullEdges: ReadonlyMap<string, readonly HullEdge[]>,
): RankSeparateMeta {
  // 1. Every leaf cluster id in the whole model.
  const allLeaves: string[] = [];
  collectLeafIds(tree, allLeaves);
  const leafSet = new Set(allLeaves);

  // 2. Whole-model leaf→leaf TFD edges (the DAG that produced the base floor).
  const leafEdges: { from: string; to: string }[] = [];
  for (const [from, tos] of leafAdjacency) {
    if (!leafSet.has(from)) {
      continue;
    }
    for (const to of tos) {
      if (leafSet.has(to)) {
        leafEdges.push({ from, to });
      }
    }
  }

  // 3. Separation edges: walk every container; for each one-way quotient pair A→B add
  //    an ALL-TO-ALL strict precedence a→b ∀ a∈leaves(A), b∈leaves(B).
  let pairCount = 0;
  const sepEdges: { from: string; to: string }[] = [];
  const walk = (node: CompoundNode): void => {
    if (node.children.length === 0) {
      return;
    }
    const childKeys = node.children.map((c) => c.key);
    const { condEdges, membersByQuotient, infeasible } =
      buildSeparationConstraintGraph(childKeys, hullEdges.get(node.key) ?? []);
    if (!infeasible && condEdges.length > 0) {
      // Leaves under each quotient rep (all members' descendants).
      const leavesByRep = new Map<string, string[]>();
      for (const [rep, memberKeys] of membersByQuotient) {
        const ids: string[] = [];
        for (const key of memberKeys) {
          const child = node.children.find((c) => c.key === key);
          if (child) {
            collectLeafIds(child, ids);
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
    for (const child of node.children) {
      walk(child);
    }
  };
  walk(tree);

  // 4. No one-way pairs ⇒ separation is a no-op ⇒ return the base floor verbatim
  //    (OFF byte-identical; do NOT re-rank — a re-ranked floor could re-zero/compress).
  if (pairCount === 0) {
    return {
      floor: baseFloor,
      applied: false,
      pairCount: 0,
      changedRankCount: 0,
      fallbackReason: "no-pairs",
    };
  }

  // 5. ONE global longest-path over (leaf edges ∪ separation edges).
  const { column, hasCycle } = longestPath(
    allLeaves,
    [...leafEdges, ...sepEdges],
    () => 0,
  );
  if (hasCycle) {
    // Adding `A<B` closed a path `B→…→A` (e.g. through the co-axial pair). Caught,
    // never silent — keep the base floor.
    return {
      floor: baseFloor,
      applied: false,
      pairCount,
      changedRankCount: 0,
      fallbackReason: "augmented-cycle",
    };
  }

  // 6. Did the ranks actually move? (separation only pushes right ⇒ column ≥ floor).
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
