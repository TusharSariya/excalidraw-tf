/**
 * Unit tests for Strata A3 — cycle repair (docs/rcll-v2-spec-v2.md §6-A3),
 * the corrected ELS93 GreedyFAS with per-SCC condensation (OD-4). T7's
 * mandatory fixtures, verbatim:
 *
 *   (i)   acyclic chain ⇒ F = ∅, E′ order-preserving
 *   (ii)  2-cycle + 3-chain ⇒ |F| = 1, the SPECIFIC arc pinned (documented below)
 *   (iii) two disjoint SCCs ⇒ F = union of SCC-local sets
 *   (iv)  E′-consumption: a reversed arc participates forward in a follow-up
 *         Kahn pass
 *   (v)   determinism: run twice, byte-equal result
 *
 * `addressOf` is identity in every fixture (`(id) => id`) purely to make the
 * comparator-least tie-breaks legible in the derivations below; production
 * callers pass the model's real content-address lookup (C4′).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataCycleRepair.test.ts
 */
import { describe, expect, it } from "vitest";

import { repairStrataCycles } from "./terraformPipelineStrataCycleRepair";

import type { StrataEdge } from "./terraformPipelineStrataTypes";

const identity = (id: string): string => id;

function mkEdge(
  source: string,
  target: string,
  relKind = "dep",
  multiplicity = 1,
): StrataEdge {
  return {
    key: `${source}->${target}:${relKind}`,
    source,
    target,
    relKind,
    multiplicity,
  };
}

describe("repairStrataCycles", () => {
  it("(i) acyclic chain: F = ∅, E′ is order-preserving", () => {
    const edges = [mkEdge("a", "b"), mkEdge("b", "c")];
    const result = repairStrataCycles(edges, identity);

    expect(result.feedbackKeys.size).toBe(0);
    expect(result.edgesPrime).toHaveLength(2);
    result.edgesPrime.forEach((primeEdge, i) => {
      expect(primeEdge.edge).toBe(edges[i]); // same reference, same order
      expect(primeEdge.reversed).toBe(false);
    });
  });

  /**
   * (ii) 2-cycle {a,b} (a->b, b->a) + a disjoint 3-chain c->d->e.
   *
   * Derivation (SCC {a,b}, ELS93 steps 2-4): neither vertex is a sink or a
   * source (outWeight=inWeight=1 for both while both edges are live), so the
   * FIRST removal is the argmax(outdeg−indeg) tie-break: score(a)=1-1=0,
   * score(b)=1-1=0 — a tie, broken by comparator-least ⇒ "a" (identity
   * comparator, "a" < "b"). `a` is appended to leftSeq and removed, which
   * zeroes `b`'s live outdeg (its only outgoing edge b->a targeted the
   * now-removed `a`), making `b` a sink next: prepended to rightSeq.
   * s = leftSeq ++ rightSeq = [a, b] (index a=0, index b=1).
   * F = { u→v : index_s(u) > index_s(v) }: a->b is 0>1 false (kept forward);
   * b->a is 1>0 true ⇒ REVERSED. So the pinned arc is b->a, not a->b — the
   * arc that runs against comparator order is the one A3 flips.
   * The disjoint chain c->d->e is three trivial (singleton) SCCs — no
   * internal edges are ever considered, so it contributes nothing to F.
   */
  it("(ii) 2-cycle + 3-chain: |F| = 1, the b->a arc is the pinned reversal", () => {
    const ab = mkEdge("a", "b");
    const ba = mkEdge("b", "a");
    const cd = mkEdge("c", "d");
    const de = mkEdge("d", "e");
    const edges = [ab, ba, cd, de];

    const result = repairStrataCycles(edges, identity);

    expect(result.feedbackKeys.size).toBe(1);
    expect(result.feedbackKeys.has(ba.key)).toBe(true);
    expect(result.feedbackKeys.has(ab.key)).toBe(false);

    const byKey = new Map(
      result.edgesPrime.map((p) => [p.edge.key, p.reversed]),
    );
    expect(byKey.get(ab.key)).toBe(false);
    expect(byKey.get(ba.key)).toBe(true);
    expect(byKey.get(cd.key)).toBe(false);
    expect(byKey.get(de.key)).toBe(false);
  });

  /**
   * (iii) two disjoint 2-cycles {a,b} and {p,q} — structurally identical to
   * (ii)'s cycle, so by the same derivation each SCC independently reverses
   * the arc running against comparator order: b->a and q->p. F must be the
   * UNION of both SCC-local sets, proving per-SCC composition (not, say, a
   * whole-graph GreedyFAS pass that could pick a different pair under a
   * shared global sequence).
   */
  it("(iii) two disjoint SCCs: F = union of SCC-local sets", () => {
    const ab = mkEdge("a", "b");
    const ba = mkEdge("b", "a");
    const pq = mkEdge("p", "q");
    const qp = mkEdge("q", "p");
    const edges = [ab, ba, pq, qp];

    const result = repairStrataCycles(edges, identity);

    expect(result.feedbackKeys.size).toBe(2);
    expect(result.feedbackKeys.has(ba.key)).toBe(true);
    expect(result.feedbackKeys.has(qp.key)).toBe(true);
    expect(result.feedbackKeys.has(ab.key)).toBe(false);
    expect(result.feedbackKeys.has(pq.key)).toBe(false);
  });

  /**
   * (iv) E′-consumption: a chain x->a feeds the {a,b} 2-cycle, which drains
   * to b->y. b->a reverses (per (ii)'s derivation — the SCC-local edges are
   * unaffected by the extra inter-SCC edges x->a/b->y, which are never
   * candidates for F). Consuming E′ in EFFECTIVE direction (swap on
   * `reversed`) must yield a proper DAG: x->a->b->y, with the
   * reversed arc's effective direction (a->b) agreeing with the untouched
   * forward arc — i.e. it "participates forward" in a follow-up topological
   * pass, not as a residual back-edge.
   */
  it("(iv) E′-consumption: the reversed arc participates forward in a follow-up Kahn pass", () => {
    const xa = mkEdge("x", "a");
    const ab = mkEdge("a", "b");
    const ba = mkEdge("b", "a");
    const by = mkEdge("b", "y");
    const edges = [xa, ab, ba, by];

    const result = repairStrataCycles(edges, identity);
    expect(result.feedbackKeys.has(ba.key)).toBe(true);

    const effEdges = result.edgesPrime.map(({ edge, reversed }) => ({
      source: reversed ? edge.target : edge.source,
      target: reversed ? edge.source : edge.target,
    }));

    // The reversed edge's effective direction matches the untouched a->b edge.
    const reversedEff = effEdges.find(
      (e) => e.source === "a" && e.target === "b",
    );
    expect(
      effEdges.filter((e) => e.source === "a" && e.target === "b"),
    ).toHaveLength(2);
    expect(reversedEff).toBeDefined();
    expect(effEdges.some((e) => e.source === "b" && e.target === "a")).toBe(
      false,
    );

    // Minimal Kahn toposort over the effective edges: must settle every node.
    const nodes = ["x", "a", "b", "y"];
    const indegree = new Map(nodes.map((n) => [n, 0]));
    const outgoing = new Map<string, string[]>();
    for (const { source, target } of effEdges) {
      outgoing.set(source, [...(outgoing.get(source) ?? []), target]);
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
    const queue = nodes.filter((n) => indegree.get(n) === 0);
    const order: string[] = [];
    while (queue.length > 0) {
      const n = queue.shift()!;
      order.push(n);
      for (const to of outgoing.get(n) ?? []) {
        indegree.set(to, indegree.get(to)! - 1);
        if (indegree.get(to) === 0) {
          queue.push(to);
        }
      }
    }
    expect(order).toHaveLength(nodes.length); // no cycle survives into E′
    expect(order.indexOf("x")).toBeLessThan(order.indexOf("a"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("y"));
  });

  it("(v) determinism: run twice, byte-equal result", () => {
    const edges = [
      mkEdge("a", "b"),
      mkEdge("b", "a"),
      mkEdge("b", "c"),
      mkEdge("c", "d"),
      mkEdge("d", "b"),
    ];
    const run1 = repairStrataCycles(edges, identity);
    const run2 = repairStrataCycles(edges, identity);

    expect([...run1.feedbackKeys].sort()).toEqual(
      [...run2.feedbackKeys].sort(),
    );
    expect(
      run1.edgesPrime.map((p) => ({ key: p.edge.key, reversed: p.reversed })),
    ).toEqual(
      run2.edgesPrime.map((p) => ({ key: p.edge.key, reversed: p.reversed })),
    );
  });

  it("dev-asserts on a self-loop instead of silently dropping it", () => {
    const edges = [mkEdge("a", "a")];
    expect(() => repairStrataCycles(edges, identity)).toThrow(/self-loop/);
  });
});
