/**
 * Unit tests for Strata A2 ordering @ K=0 (WP-2b; spec rcll-v2-spec-v2 §6-A2 +
 * v3.1 §1.1):
 *   - orderStrataUnits: K=0 initial sequence = content-key sort (pinned comparator)
 *   - liftStrataEdgesToUnits: same-unit endpoints excluded (packed-hull internal
 *     dataflow does not leak to a banded ancestor); reversed E′ lifts in the
 *     effective direction; MULTISET semantics (one entry per E′ edge, no
 *     (from,to) dedup — v2.0 §6-A2 + v3.1 §1.1) with multiplicity NOT weighting
 *     the entry count (pinned ruling in the lift's doc comment)
 *   - weightedBandsSkippedCost: hand-computed cases incl. heterogeneous heights
 *     (one 1000px band vs two 50px bands), adjacency ⇒ 0, integer exactness
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataOrdering.test.ts
 */
import { describe, expect, it } from "vitest";

import {
  liftStrataEdgesToUnits,
  orderStrataUnits,
  weightedBandsSkippedCost,
} from "./terraformPipelineStrataOrdering";

import type { StrataLiftedEdge } from "./terraformPipelineStrataOrdering";
import type {
  StrataPrimeEdge,
  StrataUnit,
} from "./terraformPipelineStrataTypes";

const LANE_GAP_Y = 96; // PIPELINE_LANE_GAP_Y (asserted against the import elsewhere)

const leaf = (clusterId: string): StrataUnit => ({ kind: "leaf", clusterId });

const edgeKey = (source: string, target: string): string =>
  `${source.length}:${source}→${target.length}:${target}:tfd`;

const primeEdge = (
  source: string,
  target: string,
  reversed = false,
  multiplicity = 1,
): StrataPrimeEdge => ({
  edge: {
    key: edgeKey(source, target),
    source,
    target,
    relKind: "tfd",
    multiplicity,
  },
  reversed,
});

// ── orderStrataUnits (K=0) ────────────────────────────────────────────────────

describe("orderStrataUnits @ K=0", () => {
  it("returns the initial sequence sorted by content key (model order)", () => {
    const units = [leaf("c"), leaf("a"), leaf("b")];
    const ordered = orderStrataUnits({
      units,
      contentKeyOf: (u) => (u.kind === "leaf" ? u.clusterId : u.hullId),
      liftedEdges: [],
      unitHeightOf: () => 0,
      policy: "banded",
      sweeps: 0,
    });
    expect(
      ordered.map((u) => (u.kind === "leaf" ? u.clusterId : u.hullId)),
    ).toEqual(["a", "b", "c"]);
  });

  it("degrades a positive sweep budget to K=0 (WP-3a seam, not silently swept)", () => {
    const units = [leaf("b"), leaf("a")];
    const ordered = orderStrataUnits({
      units,
      contentKeyOf: (u) => (u.kind === "leaf" ? u.clusterId : u.hullId),
      liftedEdges: [{ from: "L:a", to: "L:b", key: edgeKey("a", "b") }],
      unitHeightOf: () => 10,
      policy: "banded",
      sweeps: 4, // accepted; M1a still emits pure model order
    });
    expect(ordered.map((u) => (u.kind === "leaf" ? u.clusterId : "?"))).toEqual(
      ["a", "b"],
    );
  });
});

// ── liftStrataEdgesToUnits ────────────────────────────────────────────────────

describe("liftStrataEdgesToUnits", () => {
  // c1,c2 in the same packed child hull (unit U1); c3 in unit U2.
  const unitOfCluster = (id: string): string | undefined =>
    (({ c1: "U1", c2: "U1", c3: "U2" } as Record<string, string>)[id]);

  it("excludes same-unit endpoints (packed-hull internal edge doesn't leak up)", () => {
    const lifted = liftStrataEdgesToUnits(
      [primeEdge("c1", "c2"), primeEdge("c1", "c3")],
      unitOfCluster,
    );
    // c1→c2 dropped; the surviving entry carries its E′ edge key.
    expect(lifted).toEqual([
      { from: "U1", to: "U2", key: edgeKey("c1", "c3") },
    ]);
  });

  it("lifts a reversed E′ edge in its effective (swapped) direction", () => {
    // drawn c3→c1 but reversed by A3 ⇒ effective c1→c3 ⇒ U1→U2; the key stays
    // the E′ edge's true-direction key.
    const lifted = liftStrataEdgesToUnits(
      [primeEdge("c3", "c1", true)],
      unitOfCluster,
    );
    expect(lifted).toEqual([
      { from: "U1", to: "U2", key: edgeKey("c3", "c1") },
    ]);
  });

  it("keeps MULTISET entries: two distinct E′ edges between the same unit pair produce 2 entries", () => {
    const lifted = liftStrataEdgesToUnits(
      [primeEdge("c2", "c3"), primeEdge("c1", "c3")], // both U1→U2, distinct E′ edges
      unitOfCluster,
    );
    // No (from,to) dedup — one entry per E′ edge, in pinned (from,to,key) order.
    expect(lifted).toEqual([
      { from: "U1", to: "U2", key: edgeKey("c1", "c3") },
      { from: "U1", to: "U2", key: edgeKey("c2", "c3") },
    ]);
  });

  it("doubles the weightedBandsSkippedCost contribution for a 2-edge bundle", () => {
    const single = liftStrataEdgesToUnits(
      [primeEdge("c1", "c3")],
      unitOfCluster,
    );
    const bundle = liftStrataEdgesToUnits(
      [primeEdge("c1", "c3"), primeEdge("c2", "c3")],
      unitOfCluster,
    );
    // U1 and U2 separated by one 40px band ⇒ per-edge cost 40 + LANE_GAP_Y.
    const heights = (id: string): number =>
      (({ U1: 10, M: 40, U2: 10 } as Record<string, number>)[id] ?? 0);
    const costSingle = weightedBandsSkippedCost(
      ["U1", "M", "U2"],
      single,
      heights,
    );
    const costBundle = weightedBandsSkippedCost(
      ["U1", "M", "U2"],
      bundle,
      heights,
    );
    expect(costSingle).toBe(40 + LANE_GAP_Y);
    expect(costBundle).toBe(2 * costSingle); // exactly double — multiset weighting
  });

  it("emits ONE entry for a multiplicity>1 E′ edge (multiplicity does not weight A2)", () => {
    const lifted = liftStrataEdgesToUnits(
      [primeEdge("c1", "c3", false, 20)], // 20 parallel raw edges, one E′ element
      unitOfCluster,
    );
    expect(lifted).toEqual([
      { from: "U1", to: "U2", key: edgeKey("c1", "c3") },
    ]);
  });
});

// ── weightedBandsSkippedCost ─────────────────────────────────────────────────

describe("weightedBandsSkippedCost", () => {
  const heightOf = (heights: Record<string, number>) => (id: string) =>
    heights[id] ?? 0;

  it("is 0 for adjacent endpoints (no band skipped)", () => {
    expect(
      weightedBandsSkippedCost(
        ["a", "b"],
        [{ from: "a", to: "b", key: "e1" }],
        heightOf({ a: 10, b: 10 }),
      ),
    ).toBe(0);
  });

  it("charges skipped band heights + one lane gap per skipped band", () => {
    // seq [x, m, y]; edge x→y skips m. cost = height(m) + LANE_GAP_Y.
    expect(
      weightedBandsSkippedCost(
        ["x", "m", "y"],
        [{ from: "x", to: "y", key: "e1" }],
        heightOf({ x: 10, m: 40, y: 10 }),
      ),
    ).toBe(40 + LANE_GAP_Y);
  });

  it("prefers skipping two short bands over one tall band (heterogeneous heights)", () => {
    // A: skip one 1000px band. B: skip two 50px bands. B must be cheaper.
    const costTall = weightedBandsSkippedCost(
      ["x", "T", "y"],
      [{ from: "x", to: "y", key: "e1" }],
      heightOf({ x: 10, T: 1000, y: 10 }),
    );
    const costTwoShort = weightedBandsSkippedCost(
      ["x", "s1", "s2", "y"],
      [{ from: "x", to: "y", key: "e1" }],
      heightOf({ x: 10, s1: 50, s2: 50, y: 10 }),
    );
    expect(costTall).toBe(1000 + LANE_GAP_Y); // 1096
    expect(costTwoShort).toBe(50 + LANE_GAP_Y + (50 + LANE_GAP_Y)); // 292
    expect(costTwoShort).toBeLessThan(costTall);
  });

  it("sums over multiple lifted edges and stays integer", () => {
    const edges: StrataLiftedEdge[] = [
      { from: "a", to: "c", key: "e1" }, // skips b
      { from: "a", to: "d", key: "e2" }, // skips b, c
    ];
    const cost = weightedBandsSkippedCost(
      ["a", "b", "c", "d"],
      edges,
      heightOf({ a: 5, b: 30, c: 70, d: 5 }),
    );
    // edge a→c: (30+96). edge a→d: (30+96)+(70+96). total = 126 + 126 + 166 = 418.
    expect(cost).toBe(126 + (126 + 166));
    expect(Number.isInteger(cost)).toBe(true);
  });
});
