/**
 * Strata A1 — rank (X column) (docs/rcll-v2-spec-v2.md §6-A1, amended by
 * v3/v3.1 — "A1... verified exact" and OD-1′'s gate is a default-ship policy,
 * not an algorithm change; the algorithm text implemented here is unamended).
 *
 * ```
 * floor(v) = longest-path rank over E′ (Kahn; SELF-CONTAINED sequence-free
 *            implementation — NOT the shared `computeDepths`, whose edge type
 *            embeds `sequence` and would reintroduce the C4′ file-position
 *            ordering this engine forbids)
 * OPTION (OD-1, flag): rank = computeNetworkSimplexDepths(floor, E′)
 *            [reuse, terraformPipelineLayoutShared.ts ~:638 — exact Gansner
 *            TSE93 §2], committed ONLY through the S4 pure gate
 *            `isDepthFloorValid` (C7); infeasible ⇒ keep the floor.
 * X(v) = columnX[rank(v)]
 * ```
 *
 * E′ consumption (C10′): every edge in `repair.edgesPrime` is read in its
 * EFFECTIVE direction — source/target swapped when `reversed` — never its true
 * (drawn) direction. Since A3 already makes E′ acyclic by construction (the
 * GreedyFAS order `s` it computes is, by definition, a topological order E′
 * respects), a cycle surviving into this phase is an engine bug, not a
 * reachable input shape — hence a dev-assert rather than a `"cyclic-skip"`
 * runtime path (that string stays in `StrataRankResult.nsSkipReason` purely so
 * the type mirrors the legacy engine's enum; this engine never produces it).
 *
 * C1′: every cluster must land in `[0, maxRank]` with no missing rank — a hard
 * dev-assert, never a `?? PIPELINE_MARGIN`-style silent fallback.
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataRank.test.ts
 */
import { invariant } from "@excalidraw/common";

import {
  columnOffsetsFromWidths,
  isDepthFloorValid,
  PIPELINE_COLUMN_GAP,
  computeNetworkSimplexDepths,
} from "./terraformPipelineLayoutShared";

import type {
  StrataCycleRepairResult,
  StrataRankResult,
} from "./terraformPipelineStrataTypes";

export function rankStrataClusters(
  clusterIds: readonly string[],
  repair: StrataCycleRepairResult,
  opts: {
    networkSimplexRank: boolean;
    unitWidthOf: (clusterId: string) => number;
  },
): StrataRankResult {
  // Effective (E′) edges: true-direction edges kept as-is; F-edges consumed
  // reversed (C10′). OD-4's multiplicity weight is preserved here by repeating
  // the pair once per unit of multiplicity — `computeNetworkSimplexDepths`
  // derives its edge weight purely by counting array occurrences of a pair, so
  // this is how a StrataEdge's `multiplicity` field reaches that reused kernel
  // without modifying it.
  const clusterIdSet = new Set(clusterIds);
  const effEdges: { source: string; target: string }[] = [];
  for (const { edge, reversed } of repair.edgesPrime) {
    const source = reversed ? edge.target : edge.source;
    const target = reversed ? edge.source : edge.target;
    invariant(
      source !== target,
      `Strata A1: effective E′ edge must not be a self-loop (cluster "${source}")`,
    );
    invariant(
      clusterIdSet.has(source) && clusterIdSet.has(target),
      `Strata A1: edge endpoint outside the supplied cluster universe ("${source}" -> "${target}")`,
    );
    const copies = Math.max(1, edge.multiplicity);
    for (let i = 0; i < copies; i++) {
      effEdges.push({ source, target });
    }
  }

  const { rank: floorRank, hasCycle } = longestPathFloor(clusterIds, effEdges);
  invariant(
    !hasCycle,
    "Strata A1: E′ must be acyclic after A3 cycle repair (engine invariant, not a reachable input shape)",
  );

  let rank = floorRank;
  let networkSimplexApplied = false;
  let nsSkipReason: StrataRankResult["nsSkipReason"];

  if (!opts.networkSimplexRank) {
    nsSkipReason = "flag-off";
  } else {
    const candidate = computeNetworkSimplexDepths(
      effEdges,
      clusterIds,
      floorRank,
    );
    if (isDepthFloorValid(candidate, effEdges)) {
      rank = candidate;
      networkSimplexApplied = true;
    } else {
      nsSkipReason = "infeasible-fallback";
    }
  }

  // C1′: every cluster lands in [0, maxRank], none missing — hard dev-assert.
  const maxRank = Math.max(0, ...rank.values());
  for (const id of clusterIds) {
    const r = rank.get(id);
    invariant(
      r !== undefined && Number.isFinite(r) && r >= 0 && r <= maxRank,
      `Strata A1 (C1′): missing or out-of-range rank for cluster "${id}"`,
    );
  }

  const columnCount = clusterIds.length === 0 ? 0 : maxRank + 1;
  const columnWidths = Array.from({ length: columnCount }, (_, col) =>
    Math.max(
      0,
      ...clusterIds
        .filter((id) => rank.get(id) === col)
        .map((id) => opts.unitWidthOf(id)),
    ),
  );
  const columnX = columnOffsetsFromWidths(columnWidths, 0, PIPELINE_COLUMN_GAP);

  return { rank, columnX, networkSimplexApplied, nsSkipReason };
}

/**
 * Kahn longest-path floor, written fresh for the Strata engine (NOT the shared
 * `computeDepths` — see file header for why). `column(v)` is a pure function of
 * the graph (the max-relaxation recurrence settles to the same value regardless
 * of traversal order — Kahn's algorithm guarantees every predecessor of `v` has
 * already relaxed into it by the time `v`'s indegree reaches 0), so this uses a
 * plain FIFO queue: no comparator is needed for the RESULT to be deterministic,
 * only a deterministic ready-queue order for the traversal itself, which a FIFO
 * over the caller-supplied `clusterIds` order already gives for free.
 */
function longestPathFloor(
  clusterIds: readonly string[],
  effEdges: readonly { source: string; target: string }[],
): { rank: Map<string, number>; hasCycle: boolean } {
  const indegree = new Map<string, number>(clusterIds.map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const { source, target } of effEdges) {
    const list = outgoing.get(source);
    if (list) {
      list.push(target);
    } else {
      outgoing.set(source, [target]);
    }
    indegree.set(target, (indegree.get(target) ?? 0) + 1);
    if (!indegree.has(source)) {
      indegree.set(source, 0);
    }
  }

  const rank = new Map<string, number>(clusterIds.map((id) => [id, 0]));
  const queue = clusterIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  let head = 0;
  let visited = 0;
  while (head < queue.length) {
    const id = queue[head]!;
    head += 1;
    visited += 1;
    for (const to of outgoing.get(id) ?? []) {
      rank.set(to, Math.max(rank.get(to) ?? 0, (rank.get(id) ?? 0) + 1));
      const nextIndegree = (indegree.get(to) ?? 0) - 1;
      indegree.set(to, nextIndegree);
      if (nextIndegree === 0) {
        queue.push(to);
      }
    }
  }

  return { rank, hasCycle: visited < clusterIds.length };
}
