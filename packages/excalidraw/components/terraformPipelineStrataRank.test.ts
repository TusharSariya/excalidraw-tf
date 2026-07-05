/**
 * Unit tests for Strata A1 — rank (docs/rcll-v2-spec-v2.md §6-A1): the
 * longest-path floor over E′, the OD-1 network-simplex refinement behind its
 * flag + the S4 pure gate (C7), and `columnX` derivation. Fixtures build a
 * `StrataCycleRepairResult` directly (not via `repairStrataCycles`) so this
 * suite validates A1 in isolation against its own documented contract, not
 * transitively through A3's behavior.
 *
 *   - floor correctness on a small DAG (diamond)
 *   - reversed-edge consumption: a `reversed: true` E′ entry must be read in
 *     its EFFECTIVE (swapped) direction
 *   - NS flag-off ⇒ floor is returned, `nsSkipReason: "flag-off"`
 *   - C1′ hard dev-assert: every cluster must land in `[0, maxRank]` — see the
 *     in-file note on why the literal "corrupted final rank map" shape isn't
 *     independently reachable through the public API, and the adjacent
 *     hard-assert exercised instead
 *   - columnX derived from per-column max `unitWidthOf` + `PIPELINE_COLUMN_GAP`
 *   - (bonus, not in the mandatory list) NS flag-on actually shortens the
 *     "source feeding only a deep node" pathology the spec cites
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataRank.test.ts
 */
import { describe, expect, it } from "vitest";

import { PIPELINE_COLUMN_GAP } from "./terraformPipelineLayoutShared";
import { rankStrataClusters } from "./terraformPipelineStrataRank";

import type {
  StrataCycleRepairResult,
  StrataPrimeEdge,
} from "./terraformPipelineStrataTypes";

function mkPrimeEdge(
  source: string,
  target: string,
  opts: { reversed?: boolean; relKind?: string; multiplicity?: number } = {},
): StrataPrimeEdge {
  const { reversed = false, relKind = "dep", multiplicity = 1 } = opts;
  return {
    edge: {
      key: `${source}->${target}:${relKind}`,
      source,
      target,
      relKind,
      multiplicity,
    },
    reversed,
  };
}

function mkRepair(edgesPrime: StrataPrimeEdge[]): StrataCycleRepairResult {
  const feedbackKeys = new Set(
    edgesPrime.filter((p) => p.reversed).map((p) => p.edge.key),
  );
  return { feedbackKeys, edgesPrime };
}

describe("rankStrataClusters", () => {
  it("floor correctness on a small DAG (diamond)", () => {
    const repair = mkRepair([
      mkPrimeEdge("a", "b"),
      mkPrimeEdge("a", "c"),
      mkPrimeEdge("b", "d"),
      mkPrimeEdge("c", "d"),
    ]);
    const result = rankStrataClusters(["a", "b", "c", "d"], repair, {
      networkSimplexRank: false,
      unitWidthOf: () => 100,
    });

    expect(result.rank.get("a")).toBe(0);
    expect(result.rank.get("b")).toBe(1);
    expect(result.rank.get("c")).toBe(1);
    expect(result.rank.get("d")).toBe(2);
    expect(result.networkSimplexApplied).toBe(false);
    expect(result.nsSkipReason).toBe("flag-off");
  });

  it("reversed-edge consumption: a reversed E′ entry is read in its effective (swapped) direction", () => {
    // A3 already decided b->a is the feedback arc of an {a,b} 2-cycle (see
    // terraformPipelineStrataCycleRepair.test.ts (ii)). Its effective direction
    // must agree with the untouched a->b edge, not its true (drawn) direction.
    const repair = mkRepair([
      mkPrimeEdge("a", "b"),
      mkPrimeEdge("b", "a", { reversed: true }),
    ]);
    const result = rankStrataClusters(["a", "b"], repair, {
      networkSimplexRank: false,
      unitWidthOf: () => 10,
    });

    // No dev-assert thrown (would fire if the reversed arc were consumed in its
    // TRUE direction, reintroducing a 2-cycle into the ranked graph).
    expect(result.rank.get("a")).toBe(0);
    expect(result.rank.get("b")).toBe(1);
  });

  it('NS flag-off ⇒ floor is returned with nsSkipReason "flag-off"', () => {
    const repair = mkRepair([mkPrimeEdge("a", "b"), mkPrimeEdge("b", "c")]);
    const result = rankStrataClusters(["a", "b", "c"], repair, {
      networkSimplexRank: false,
      unitWidthOf: () => 50,
    });

    expect(result.networkSimplexApplied).toBe(false);
    expect(result.nsSkipReason).toBe("flag-off");
    expect(result.rank.get("a")).toBe(0);
    expect(result.rank.get("b")).toBe(1);
    expect(result.rank.get("c")).toBe(2);
  });

  /**
   * C1′ (a rank outside [0, maxRank] or missing is a hard dev-assert) is not
   * independently reachable as a "corrupted final rank map" through this
   * public API: the floor's map is built directly from `clusterIds` with
   * Kahn's algorithm (values only ever increase from 0, so always finite and
   * ≥0), and the reused NS kernel (`computeNetworkSimplexDepths`) also always
   * returns exactly one entry per `clusterIds` member and explicitly
   * normalizes every weakly-connected component's minimum rank to 0 as its
   * final step (terraformPipelineLayoutShared.ts, the "Normalize each
   * weakly-connected component" pass). So this exercises the adjacent hard
   * dev-assert guarding the same class of bug — trusting an incomplete
   * cluster/edge universe instead of failing loud — which the public API DOES
   * let a test reach.
   */
  it("C1′-class hard dev-assert: an edge endpoint outside the supplied cluster universe throws instead of silently degrading", () => {
    const repair = mkRepair([mkPrimeEdge("a", "b"), mkPrimeEdge("b", "c")]);
    expect(() =>
      rankStrataClusters(["a", "b"] /* missing "c" */, repair, {
        networkSimplexRank: false,
        unitWidthOf: () => 50,
      }),
    ).toThrow(/cluster universe/);
  });

  it("columnX derived from per-column max unitWidthOf + PIPELINE_COLUMN_GAP", () => {
    const repair = mkRepair([
      mkPrimeEdge("a", "b"),
      mkPrimeEdge("a", "c"),
      mkPrimeEdge("b", "d"),
      mkPrimeEdge("c", "d"),
    ]);
    const widths: Record<string, number> = { a: 50, b: 200, c: 80, d: 60 };
    const result = rankStrataClusters(["a", "b", "c", "d"], repair, {
      networkSimplexRank: false,
      unitWidthOf: (id) => widths[id]!,
    });

    // col0 = {a}: max 50; col1 = {b,c}: max(200,80) = 200; col2 = {d}: max 60.
    const col0 = 0;
    const col1 = col0 + 50 + PIPELINE_COLUMN_GAP;
    const col2 = col1 + 200 + PIPELINE_COLUMN_GAP;
    expect(result.columnX).toEqual([col0, col1, col2]);
  });

  it("(bonus) NS flag-on shortens the 'source feeding only a deep node' pathology", () => {
    // m1->m2->m3->m4 is a tight chain (floor: 0,1,2,3); src->m4 is the only
    // edge touching src, so longest-path leaves it at column 0 — a full-width
    // edge spanning all 3 columns. NS should slide src rightward (it has no
    // other constraint) to shrink that edge's span.
    const repair = mkRepair([
      mkPrimeEdge("m1", "m2"),
      mkPrimeEdge("m2", "m3"),
      mkPrimeEdge("m3", "m4"),
      mkPrimeEdge("src", "m4"),
    ]);
    const clusterIds = ["src", "m1", "m2", "m3", "m4"];
    const floor = rankStrataClusters(clusterIds, repair, {
      networkSimplexRank: false,
      unitWidthOf: () => 10,
    });
    expect(floor.rank.get("src")).toBe(0);
    expect(floor.rank.get("m4")).toBe(3);

    const ns = rankStrataClusters(clusterIds, repair, {
      networkSimplexRank: true,
      unitWidthOf: () => 10,
    });
    expect(ns.networkSimplexApplied).toBe(true);
    expect(ns.nsSkipReason).toBeUndefined();
    expect(ns.rank.get("m4")).toBe(3);
    expect(ns.rank.get("src")!).toBeGreaterThan(floor.rank.get("src")!);
    expect(ns.rank.get("src")!).toBeLessThan(ns.rank.get("m4")!);
  });
});
