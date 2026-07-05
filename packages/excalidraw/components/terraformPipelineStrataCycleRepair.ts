/**
 * Strata A3 — cycle repair (docs/rcll-v2-spec-v2.md §6-A3, exact ELS93 with
 * per-SCC condensation OD-4; amended by v3/v3.1 — algorithm text unchanged,
 * "verified exact").
 *
 * Input: the collapsed cluster graph (the same edge set A1 ranks). Self-loops
 * are split out at model build — this only dev-asserts their absence (C1′-style
 * hard assert, no silent drop here). Parallel edges are already deduped by the
 * model with multiplicity retained as a ranking weight (`StrataEdge.multiplicity`,
 * A3 step 0/OD-4) — this module does not re-dedupe.
 *
 * Algorithm (spec v2 §6-A3 steps 1-5, NO deviation):
 *   1. (OD-4, ON) Tarjan-condense; steps 2-4 run inside each nontrivial SCC only.
 *      Adjacency is visited in pinned-comparator order on `addressOf` (C4′) —
 *      NEVER bare id order — so the whole repair is content-address deterministic,
 *      not dependent on cluster-id string shape or edge input order.
 *      Composition: F = ⋃ SCC-local F sets (condensation is a DAG, so inter-SCC
 *      edges can never be feedback arcs — they are never even considered).
 *   2. Per SCC: drain sinks (PREPEND to rightSeq), then sources (APPEND to
 *      leftSeq), else pick argmax(outdeg−indeg) (APPEND to leftSeq); ties always
 *      broken by the comparator-least vertex. outdeg/indeg are WEIGHTED by
 *      `multiplicity` (OD-4) for the argmax step; sink/source existence itself is
 *      unaffected by weight (a live edge is a live edge regardless of multiplicity).
 *   3. s = leftSeq ++ rightSeq — NO reverse (v1.0's bug was reversing this).
 *   4. F = { u→v : index_s(u) > index_s(v) }, scoped per SCC.
 *   5. E′ = (E − F) ∪ reverse(F) — emitted here as `StrataPrimeEdge[]` with a
 *      `reversed` flag; the original `edge` is UNCHANGED (true direction, for A6
 *      draw + back-edge styling, C10′). Downstream ranking/ordering/refinement
 *      must consume the EFFECTIVE direction (swap source/target when `reversed`).
 *
 * Facts this module does not re-litigate (v2 §6-A3 / v3.1 §9): greedy FAS is a
 * heuristic, not minimum; it can reverse an edge that lies on no cycle
 * (acceptable — T7 pins which arc); comparator-least tie handling changes |F|,
 * not just determinism — ties are never "fixed" to something else.
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataCycleRepair.test.ts
 */
import { invariant } from "@excalidraw/common";

import {
  compareStrataContentKeys,
  type StrataCycleRepairResult,
  type StrataEdge,
  type StrataPrimeEdge,
} from "./terraformPipelineStrataTypes";

/**
 * A3 entry point. `addressOf` is the model's canonical content-address lookup
 * (C4′'s only sanctioned ordering key) — used for every tie-break below, NEVER
 * a bare cluster-id compare (cluster ids are internal, not content-addressed).
 */
export function repairStrataCycles(
  edges: readonly StrataEdge[],
  addressOf: (id: string) => string,
): StrataCycleRepairResult {
  for (const edge of edges) {
    invariant(
      edge.source !== edge.target,
      `Strata A3: self-loop on "${edge.source}" (relKind "${edge.relKind}") must be split out at model build, not reach cycle repair`,
    );
  }

  const vertices = new Set<string>();
  for (const edge of edges) {
    vertices.add(edge.source);
    vertices.add(edge.target);
  }

  // Step 1 (OD-4, ON): Tarjan-condense over the WHOLE graph, adjacency visited
  // in pinned-comparator order, so SCC membership itself is deterministic.
  const sccRepOf = condenseStronglyConnectedComponents(
    vertices,
    edges,
    addressOf,
  );
  const membersBySccRep = new Map<string, string[]>();
  for (const v of vertices) {
    const rep = sccRepOf.get(v)!;
    const list = membersBySccRep.get(rep);
    if (list) {
      list.push(v);
    } else {
      membersBySccRep.set(rep, [v]);
    }
  }

  // Composition rule: F = ⋃ SCC-local F sets. Trivial (singleton) SCCs have no
  // internal edges (self-loops are already excluded) and are skipped entirely —
  // inter-SCC edges can never be feedback arcs (the condensation is a DAG).
  const feedbackKeys = new Set<string>();
  for (const members of membersBySccRep.values()) {
    if (members.length < 2) {
      continue;
    }
    const memberSet = new Set(members);
    const sccEdges = edges.filter(
      (e) => memberSet.has(e.source) && memberSet.has(e.target),
    );
    const s = orderStronglyConnectedComponent(members, sccEdges, addressOf);
    const indexOf = new Map(s.map((id, i): [string, number] => [id, i]));
    for (const e of sccEdges) {
      if (indexOf.get(e.source)! > indexOf.get(e.target)!) {
        feedbackKeys.add(e.key);
      }
    }
  }

  const edgesPrime: StrataPrimeEdge[] = edges.map((edge) => ({
    edge,
    reversed: feedbackKeys.has(edge.key),
  }));

  return { feedbackKeys, edgesPrime };
}

/**
 * Steps 2-4 of A3, scoped to one nontrivial SCC: the corrected ELS93 GreedyFAS
 * (Eades–Lin–Smyth 1993; verbatim restatement Geladaris/Lionakis/Tollis JGAA
 * 27(8) 2023 Alg. 1 — `s = s1 s2`, NO reverse). Returns `s = leftSeq ++
 * rightSeq`; the caller derives F by comparing `index_s`.
 */
function orderStronglyConnectedComponent(
  members: readonly string[],
  sccEdges: readonly StrataEdge[],
  addressOf: (id: string) => string,
): string[] {
  const addrCmp = (a: string, b: string): number =>
    compareStrataContentKeys(addressOf(a), addressOf(b));

  // Live weighted out/in degree (OD-4: weighted by `multiplicity`) + live
  // adjacency, mutated in place as vertices are removed below.
  const outAdj = new Map<string, Map<string, number>>();
  const inAdj = new Map<string, Map<string, number>>();
  const outWeight = new Map<string, number>();
  const inWeight = new Map<string, number>();
  for (const m of members) {
    outAdj.set(m, new Map());
    inAdj.set(m, new Map());
    outWeight.set(m, 0);
    inWeight.set(m, 0);
  }
  for (const e of sccEdges) {
    const outMap = outAdj.get(e.source)!;
    outMap.set(e.target, (outMap.get(e.target) ?? 0) + e.multiplicity);
    const inMap = inAdj.get(e.target)!;
    inMap.set(e.source, (inMap.get(e.source) ?? 0) + e.multiplicity);
    outWeight.set(e.source, (outWeight.get(e.source) ?? 0) + e.multiplicity);
    inWeight.set(e.target, (inWeight.get(e.target) ?? 0) + e.multiplicity);
  }

  const remaining = new Set(members);
  const leftSeq: string[] = [];
  const rightSeq: string[] = [];

  const removeVertex = (v: string): void => {
    for (const [target, w] of outAdj.get(v)!) {
      if (remaining.has(target)) {
        inWeight.set(target, (inWeight.get(target) ?? 0) - w);
        inAdj.get(target)!.delete(v);
      }
    }
    for (const [source, w] of inAdj.get(v)!) {
      if (remaining.has(source)) {
        outWeight.set(source, (outWeight.get(source) ?? 0) - w);
        outAdj.get(source)!.delete(v);
      }
    }
    remaining.delete(v);
  };

  // comparator-least member of `remaining` satisfying `predicate`, or undefined.
  const findComparatorLeast = (
    predicate: (v: string) => boolean,
  ): string | undefined => {
    let least: string | undefined;
    for (const v of remaining) {
      if (predicate(v) && (least === undefined || addrCmp(v, least) < 0)) {
        least = v;
      }
    }
    return least;
  };

  while (remaining.size > 0) {
    // while exists sink (outdeg=0): comparator-least such; PREPEND to rightSeq.
    let sink = findComparatorLeast((v) => (outWeight.get(v) ?? 0) === 0);
    while (sink !== undefined) {
      rightSeq.unshift(sink);
      removeVertex(sink);
      sink = findComparatorLeast((v) => (outWeight.get(v) ?? 0) === 0);
    }

    // while exists source (indeg=0): comparator-least such; APPEND to leftSeq.
    let source = findComparatorLeast((v) => (inWeight.get(v) ?? 0) === 0);
    while (source !== undefined) {
      leftSeq.push(source);
      removeVertex(source);
      source = findComparatorLeast((v) => (inWeight.get(v) ?? 0) === 0);
    }

    if (remaining.size > 0) {
      // v = argmax(outdeg − indeg), ties comparator-least. Scan-order-independent:
      // a strict score improvement always wins; a tie is resolved by addrCmp
      // regardless of which candidate was seen first.
      let best: string | undefined;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const v of remaining) {
        const score = (outWeight.get(v) ?? 0) - (inWeight.get(v) ?? 0);
        if (
          best === undefined ||
          score > bestScore ||
          (score === bestScore && addrCmp(v, best) < 0)
        ) {
          best = v;
          bestScore = score;
        }
      }
      leftSeq.push(best!);
      removeVertex(best!);
    }
  }

  return [...leftSeq, ...rightSeq]; // *** NO reverse — v1.0's reverse() was the bug ***
}

/**
 * Tarjan SCC (iterative — avoids recursion depth on large graphs), scoped to
 * this module so adjacency order and the representative pick both go through
 * `addressOf` + the C4′ pinned comparator (OD-4's "deterministic adjacency").
 * The shared `stronglyConnectedComponents` in terraformPipelineLayoutShared.ts
 * sorts on bare cluster ids, which is exactly the ordering C4′ forbids for this
 * engine — hence a fresh, address-pinned implementation rather than reuse.
 *
 * Returns `vertex → representative` (the address-comparator-least member of its
 * SCC); an acyclic vertex is its own singleton SCC.
 */
function condenseStronglyConnectedComponents(
  vertices: ReadonlySet<string>,
  edges: readonly StrataEdge[],
  addressOf: (id: string) => string,
): Map<string, string> {
  const addrCmp = (a: string, b: string): number =>
    compareStrataContentKeys(addressOf(a), addressOf(b));

  const adj = new Map<string, string[]>();
  for (const v of vertices) {
    adj.set(v, []);
  }
  for (const e of edges) {
    adj.get(e.source)!.push(e.target);
  }
  for (const list of adj.values()) {
    list.sort(addrCmp); // OD-4: neighbors visited in pinned-comparator order
  }

  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const rep = new Map<string, string>();

  const orderedVertices = [...vertices].sort(addrCmp);
  for (const start of orderedVertices) {
    if (idx.has(start)) {
      continue;
    }
    const work: { node: string; i: number }[] = [{ node: start, i: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const v = frame.node;
      if (frame.i === 0) {
        idx.set(v, index);
        low.set(v, index);
        index += 1;
        stack.push(v);
        onStack.add(v);
      }
      const neighbors = adj.get(v) ?? [];
      if (frame.i < neighbors.length) {
        const w = neighbors[frame.i]!;
        frame.i += 1;
        if (!idx.has(w)) {
          work.push({ node: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, idx.get(w)!));
        }
      } else {
        if (low.get(v) === idx.get(v)) {
          const sccMembers: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            sccMembers.push(w);
          } while (w !== v);
          const r = sccMembers.reduce((a, b) => (addrCmp(a, b) <= 0 ? a : b));
          for (const m of sccMembers) {
            rep.set(m, r);
          }
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) {
          low.set(parent.node, Math.min(low.get(parent.node)!, low.get(v)!));
        }
      }
    }
  }
  return rep;
}
