/**
 * EXPERIMENTAL — round-8 R8-F9 joint constrained network-simplex probe
 * (W5b; default OFF everywhere; not a shipping lever).
 *
 * Question under test: v1's RFC DI-NS-4 showed that running network simplex
 * over the ORIGINAL dependency graph AFTER rankSeparate destroys the sibling
 * X-disjointness (sequential composition fails — the basis for the current
 * "rankSeparate WINS, NS dropped" mutual-exclusion rule). That experiment never
 * tested Gansner's actual device for constraint-only edges: solve ONCE over the
 * AUGMENTED graph — real dependency edges with their multiplicity weights PLUS
 * the all-to-all sibling-separation edges as zero-objective-weight constraints
 * (λ(b) ≥ λ(a)+1 enforced, 0·span in the objective). Any feasible solution of
 * that program preserves the separation by construction, while the simplex
 * compresses REAL edge spans only.
 *
 * Pipeline placement: replaces the rank produced by the sequential separated
 * floor (`computeStrataSeparatedFloor`) when `strataJointNsRank` is requested
 * WITH `strataRankSeparate`. Start floor = the separated longest-path floor
 * (feasible for the augmented edge set whenever RS itself applied). Fallbacks
 * are observable and always land on the sequential RS floor, never worse.
 *
 * SDEC-34: no module-level constant derives from a LayoutShared value — this
 * module imports FUNCTIONS only (it is reachable from the Strata dispatch,
 * inside the terraformPlanParsing → terraformLayoutCore cycle).
 */
import {
  computeNetworkSimplexDepths,
  isDepthFloorValid,
} from "./terraformPipelineLayoutShared";
import { collectStrataSeparationConstraints } from "./terraformPipelineStrataRankSeparate";

import type { StrataHullNode } from "./terraformPipelineStrataTypes";

export type StrataJointNsMeta = {
  /** The joint floor (or the input `separatedFloor` on any fallback). */
  floor: ReadonlyMap<string, number>;
  /** true iff the joint solve produced a valid floor that differs from input. */
  applied: boolean;
  fallbackReason:
    | "none"
    | "no-separation-pairs" // RS itself was a no-op ⇒ nothing joint to solve
    | "constraint-violated" // NS output failed a separation or real-edge check
    | "unchanged"; // valid but byte-identical to the sequential floor
  /** Σ multiplicity·span over REAL edges, before (sequential RS) and after. */
  realSpanBefore: number;
  realSpanAfter: number;
  /** Separation constraints satisfied in the returned floor (validity proof). */
  sepConstraintsChecked: number;
};

const realSpanOf = (
  floor: ReadonlyMap<string, number>,
  effEdges: readonly { source: string; target: string }[],
): number => {
  let span = 0;
  for (const e of effEdges) {
    span += (floor.get(e.target) ?? 0) - (floor.get(e.source) ?? 0);
  }
  return span;
};

/**
 * Joint constrained-NS rank refinement over (real E′ edges ∪ zero-weight
 * separation edges), starting from the SEQUENTIAL separated floor.
 *
 * @param hullRoot       Strata hull tree (separation constraints derive from it).
 * @param separatedFloor the accepted `computeStrataSeparatedFloor(...)` result
 *                       (feasible for the augmented set by construction).
 * @param effEdges       effective E′ edges, ALREADY expanded by multiplicity
 *                       (the same array `rankStrataClusters` builds — the NS
 *                       kernel derives weights by counting pair occurrences).
 */
export function computeStrataJointNsFloor(
  hullRoot: StrataHullNode,
  separatedFloor: ReadonlyMap<string, number>,
  effEdges: readonly { source: string; target: string }[],
): StrataJointNsMeta {
  const { allLeaves, sepEdges, pairCount } = collectStrataSeparationConstraints(
    hullRoot,
    effEdges,
  );
  const spanBefore = realSpanOf(separatedFloor, effEdges);
  const inert = (
    fallbackReason: StrataJointNsMeta["fallbackReason"],
  ): StrataJointNsMeta => ({
    floor: separatedFloor,
    applied: false,
    fallbackReason,
    realSpanBefore: spanBefore,
    realSpanAfter: spanBefore,
    sepConstraintsChecked: sepEdges.length,
  });

  if (pairCount === 0) {
    return inert("no-separation-pairs");
  }

  const zeroWeight = sepEdges.map((e) => ({ source: e.from, target: e.to }));
  const candidate = computeNetworkSimplexDepths(
    effEdges,
    allLeaves,
    separatedFloor,
    zeroWeight,
  );

  // Verify-or-abort (C7 discipline): the joint floor must satisfy BOTH the real
  // E′ edges and every separation constraint — otherwise keep sequential RS.
  if (
    !isDepthFloorValid(candidate, effEdges) ||
    !isDepthFloorValid(candidate, zeroWeight)
  ) {
    return inert("constraint-violated");
  }

  let changed = false;
  for (const id of allLeaves) {
    if ((candidate.get(id) ?? 0) !== (separatedFloor.get(id) ?? 0)) {
      changed = true;
      break;
    }
  }
  if (!changed) {
    return inert("unchanged");
  }

  return {
    floor: candidate,
    applied: true,
    fallbackReason: "none",
    realSpanBefore: spanBefore,
    realSpanAfter: realSpanOf(candidate, effEdges),
    sepConstraintsChecked: sepEdges.length,
  };
}
