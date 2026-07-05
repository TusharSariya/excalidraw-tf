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
  strataUnitId,
  weightedBandsSkippedCost,
} from "./terraformPipelineStrataOrdering";

import type {
  StrataLiftedEdge,
  StrataOrderParams,
} from "./terraformPipelineStrataOrdering";
import type {
  StrataHullPolicy,
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

// ── orderStrataUnits: shared fixture builders (WP-3a) ─────────────────────────

const hull = (hullId: string): StrataUnit => ({ kind: "hull", hullId });

/** A lifted edge; `n` disambiguates parallel MULTISET entries (distinct keys). */
const liftEdge = (from: string, to: string, n = 0): StrataLiftedEdge => ({
  from,
  to,
  key: `${from}->${to}#${n}`,
});

/** Pure bands-skipped COUNT (v3.1 §2's count, unweighted) — a local oracle for
 *  the height-weighted-vs-count counterexample. */
const bandsSkippedCount = (
  seq: readonly string[],
  edges: readonly StrataLiftedEdge[],
): number => {
  const pos = new Map(seq.map((id, i) => [id, i] as const));
  let n = 0;
  for (const e of edges) {
    const d = Math.abs(pos.get(e.from)! - pos.get(e.to)!) - 1;
    if (d > 0) {
      n += d;
    }
  }
  return n;
};

type OrderFixture = {
  units: readonly StrataUnit[];
  edges: readonly StrataLiftedEdge[];
  heights: Record<string, number>;
  keys: Record<string, string>;
  policy: StrataHullPolicy;
  sweeps: number;
  /** x-extent [x0,x1] by unit id; box-centre x2 = x0+x1 (see impl §1.2). */
  xspan?: Record<string, readonly [number, number]>;
  /** rank span [min,max] by unit id; min = sweep layer. */
  cols?: Record<string, readonly [number, number]>;
};

const buildParams = (f: OrderFixture): StrataOrderParams => ({
  units: f.units,
  contentKeyOf: (u) => f.keys[strataUnitId(u)]!,
  liftedEdges: f.edges,
  unitHeightOf: (id) => f.heights[id] ?? 0,
  policy: f.policy,
  sweeps: f.sweeps,
  unitXSpanOf: f.xspan ? (id) => f.xspan![id]! : undefined,
  unitColSpanOf: f.cols ? (id) => f.cols![id]! : undefined,
});

/** Run the pass and project to the unit-id sequence (the placement Y order). */
const orderIds = (f: OrderFixture): string[] =>
  orderStrataUnits(buildParams(f)).map(strataUnitId);

// ── orderStrataUnits @ K=0 (M1a byte-identity) ────────────────────────────────

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

  it("K=0 is pure content-key model order — edges/heights ignored (byte-identical to M1a)", () => {
    const units = [leaf("c"), leaf("a"), leaf("b")];
    // Non-trivial: a real edge + heterogeneous heights that WOULD move a K>0
    // banded selection — K=0 must ignore all of it and emit the content sort.
    expect(
      orderIds({
        units,
        edges: [liftEdge("L:a", "L:c")],
        heights: { "L:a": 10, "L:b": 50, "L:c": 999 },
        keys: { "L:a": "a", "L:b": "b", "L:c": "c" },
        policy: "banded",
        sweeps: 0,
      }),
    ).toEqual(["L:a", "L:b", "L:c"]);
  });

  it("K=0 preserves the input unit object references (sorted, not rebuilt)", () => {
    const a = leaf("a");
    const b = leaf("b");
    const c = leaf("c");
    const ordered = orderStrataUnits(
      buildParams({
        units: [c, a, b],
        edges: [],
        heights: {},
        keys: { "L:a": "a", "L:b": "b", "L:c": "c" },
        policy: "banded",
        sweeps: 0,
      }),
    );
    expect(ordered[0]).toBe(a);
    expect(ordered[1]).toBe(b);
    expect(ordered[2]).toBe(c);
  });
});

// ── orderStrataUnits @ K>0 — banded acceptance (v3.1 §1) ───────────────────────

describe("orderStrataUnits @ K>0 — banded", () => {
  it("≥2-provider banded root: the banded acceptance path fires (cost-optimal, distinct from packed)", () => {
    // Two provider hulls (aws=key a, gcp=key c) separated in model order by a
    // leaf (mid=key b); a heavy aws↔gcp bundle wants them adjacent. The mandatory
    // v3.1 §1.4 fixture: root.policy = banded ⇒ acceptance keys on bands-skipped.
    const units = [hull("aws"), leaf("mid"), hull("gcp")];
    const edges = [
      liftEdge("H:aws", "H:gcp", 0),
      liftEdge("H:aws", "H:gcp", 1),
      liftEdge("H:aws", "L:mid"),
    ];
    const heights = { "H:aws": 10, "L:mid": 10, "H:gcp": 10 };
    const fixture = (policy: StrataHullPolicy): OrderFixture => ({
      units,
      edges,
      heights,
      keys: { "H:aws": "a", "L:mid": "b", "H:gcp": "c" },
      policy,
      sweeps: 4,
      xspan: { "H:aws": [0, 0], "L:mid": [1, 1], "H:gcp": [2, 2] },
    });

    const banded = orderIds(fixture("banded"));
    // banded acceptance pulls the two providers adjacent — cost 212 → 0.
    expect(banded).toEqual(["L:mid", "H:aws", "H:gcp"]);
    const h = (id: string): number => heights[id as keyof typeof heights];
    expect(weightedBandsSkippedCost(banded, edges, h)).toBe(0);
    expect(
      weightedBandsSkippedCost(["H:aws", "L:mid", "H:gcp"], edges, h),
    ).toBe(212);

    // The SAME fixture under packed keeps model order (crossings path; the
    // aws-hub edges share an endpoint ⇒ no eligible crossing pair ⇒ no gain).
    const packed = orderIds(fixture("packed"));
    expect(packed).toEqual(["H:aws", "L:mid", "H:gcp"]);
    expect(banded).not.toEqual(packed);
  });

  it("band-adjacency: K=4 brings two heavily-connected bands adjacent (cost strictly drops)", () => {
    // model order [a,b,c] separates the heavy a↔c pair by b; the K=4 pass
    // (greedy seed, the height-aware candidate) makes them adjacent.
    const units = [leaf("a"), leaf("b"), leaf("c")];
    const edges = [
      liftEdge("L:a", "L:c", 0),
      liftEdge("L:a", "L:c", 1),
      liftEdge("L:a", "L:b"),
    ];
    const heights = { "L:a": 10, "L:b": 10, "L:c": 10 };
    const seq = orderIds({
      units,
      edges,
      heights,
      keys: { "L:a": "a", "L:b": "b", "L:c": "c" },
      policy: "banded",
      sweeps: 4,
      xspan: { "L:a": [0, 0], "L:b": [1, 1], "L:c": [2, 2] },
    });
    expect(seq).toEqual(["L:b", "L:a", "L:c"]);
    const h = (id: string): number => heights[id as keyof typeof heights];
    expect(weightedBandsSkippedCost(seq, edges, h)).toBe(0);
    expect(weightedBandsSkippedCost(["L:a", "L:b", "L:c"], edges, h)).toBe(212);
    // a and c are adjacent in the winner.
    expect(Math.abs(seq.indexOf("L:a") - seq.indexOf("L:c"))).toBe(1);
  });

  it("heterogeneous heights: the height-WEIGHTED winner is selected over the count-optimal", () => {
    // tall node c (1000px) vs shorts. The count-optimal order skips ONE (tall)
    // band; the height-weighted optimum skips THREE short bands — far cheaper px.
    const units = [leaf("a"), leaf("b"), leaf("c"), leaf("d"), leaf("e")];
    const edges = [
      liftEdge("L:a", "L:b"),
      liftEdge("L:a", "L:c"),
      liftEdge("L:a", "L:e"),
      liftEdge("L:b", "L:c"),
      liftEdge("L:b", "L:d"),
    ];
    const heights = { "L:a": 20, "L:b": 20, "L:c": 1000, "L:d": 20, "L:e": 20 };
    const seq = orderIds({
      units,
      edges,
      heights,
      keys: { "L:a": "a", "L:b": "b", "L:c": "c", "L:d": "d", "L:e": "e" },
      policy: "banded",
      sweeps: 4,
      xspan: {
        "L:a": [0, 0],
        "L:b": [1, 1],
        "L:c": [2, 2],
        "L:d": [3, 3],
        "L:e": [4, 4],
      },
    });
    const h = (id: string): number => heights[id as keyof typeof heights];
    const countOpt = ["L:d", "L:b", "L:c", "L:a", "L:e"]; // 1 band skipped, but it's the tall one
    expect(seq).toEqual(["L:c", "L:b", "L:a", "L:e", "L:d"]);
    // Selected skips MORE bands (3) than the count-optimal (1) — but far fewer px.
    expect(bandsSkippedCount(countOpt, edges)).toBe(1);
    expect(bandsSkippedCount(seq, edges)).toBe(3);
    expect(weightedBandsSkippedCost(seq, edges, h)).toBe(348);
    expect(weightedBandsSkippedCost(countOpt, edges, h)).toBe(1096);
    expect(weightedBandsSkippedCost(seq, edges, h)).toBeLessThan(
      weightedBandsSkippedCost(countOpt, edges, h),
    );
  });

  it("equal-cost candidates: the crossings tiebreak decides (flipping x flips the winner)", () => {
    // Both [b,a,c,d,e] and [b,d,e,a,c] are cost-464 candidates. Only the trial
    // chord crossings — driven by x-geometry — separate them.
    const units = [leaf("a"), leaf("b"), leaf("c"), leaf("d"), leaf("e")];
    const edges = [
      liftEdge("L:a", "L:d"),
      liftEdge("L:a", "L:e"),
      liftEdge("L:c", "L:d"),
      liftEdge("L:c", "L:e"),
    ];
    const heights = { "L:a": 20, "L:b": 20, "L:c": 20, "L:d": 20, "L:e": 20 };
    const keys = { "L:a": "a", "L:b": "b", "L:c": "c", "L:d": "d", "L:e": "e" };
    const h = (id: string): number => heights[id as keyof typeof heights];

    const seqNormal = orderIds({
      units,
      edges,
      heights,
      keys,
      policy: "banded",
      sweeps: 4,
      xspan: {
        "L:a": [0, 0],
        "L:b": [1, 1],
        "L:c": [2, 2],
        "L:d": [3, 3],
        "L:e": [4, 4],
      },
    });
    expect(seqNormal).toEqual(["L:b", "L:a", "L:c", "L:d", "L:e"]);

    const seqFlipped = orderIds({
      units,
      edges,
      heights,
      keys,
      policy: "banded",
      sweeps: 4,
      xspan: {
        "L:a": [3, 3],
        "L:b": [1, 1],
        "L:c": [4, 4],
        "L:d": [0, 0],
        "L:e": [2, 2],
      },
    });
    expect(seqFlipped).toEqual(["L:b", "L:d", "L:e", "L:a", "L:c"]);

    // Cost is identical (464) both ways — ONLY the x-geometry (crossings) moved.
    expect(weightedBandsSkippedCost(seqNormal, edges, h)).toBe(464);
    expect(weightedBandsSkippedCost(seqFlipped, edges, h)).toBe(464);
    expect(seqNormal).not.toEqual(seqFlipped);
  });

  it("full tie (equal cost AND crossings): the earliest candidate (initial) wins", () => {
    // initial [a,b,c,d] is cost 0; the greedy seed [d,c,b,a] is a DISTINCT cost-0
    // candidate. Both edges share endpoint b (⇒ no eligible crossing pair) and d
    // is isolated ⇒ crossings tie at 0 ⇒ the earliest (initial/model order) wins.
    const units = [leaf("a"), leaf("b"), leaf("c"), leaf("d")];
    const edges = [liftEdge("L:a", "L:b"), liftEdge("L:b", "L:c")];
    const seq = orderIds({
      units,
      edges,
      heights: { "L:a": 20, "L:b": 20, "L:c": 20, "L:d": 20 },
      keys: { "L:a": "a", "L:b": "b", "L:c": "c", "L:d": "d" },
      policy: "banded",
      sweeps: 4,
      xspan: {
        "L:a": [0, 0],
        "L:b": [1, 1],
        "L:c": [2, 2],
        "L:d": [3, 3],
      },
    });
    expect(seq).toEqual(["L:a", "L:b", "L:c", "L:d"]);
  });

  it("greedy seed beats every sweep on an interleaved two-heavy-pair fixture", () => {
    // a↔c ×3 and b↔d ×3, interleaved in model order. The barycenter sweeps only
    // MIRROR the sequence (cost stays 636); the height-aware greedy seed is the
    // ONLY candidate reaching cost 0 (v3.1 §1.3's generator/selector mismatch).
    const units = [leaf("a"), leaf("b"), leaf("c"), leaf("d")];
    const edges = [
      liftEdge("L:a", "L:c", 0),
      liftEdge("L:a", "L:c", 1),
      liftEdge("L:a", "L:c", 2),
      liftEdge("L:b", "L:d", 0),
      liftEdge("L:b", "L:d", 1),
      liftEdge("L:b", "L:d", 2),
    ];
    const heights = { "L:a": 10, "L:b": 10, "L:c": 10, "L:d": 10 };
    const h = (id: string): number => heights[id as keyof typeof heights];
    const seq = orderIds({
      units,
      edges,
      heights,
      keys: { "L:a": "a", "L:b": "b", "L:c": "c", "L:d": "d" },
      policy: "banded",
      sweeps: 4,
      xspan: {
        "L:a": [0, 0],
        "L:b": [1, 1],
        "L:c": [2, 2],
        "L:d": [3, 3],
      },
    });
    expect(seq).toEqual(["L:d", "L:b", "L:c", "L:a"]);
    expect(weightedBandsSkippedCost(seq, edges, h)).toBe(0);
    // initial AND every sweep snapshot score 636 — greedy strictly beats them.
    expect(
      weightedBandsSkippedCost(["L:a", "L:b", "L:c", "L:d"], edges, h),
    ).toBe(636);
    expect(
      weightedBandsSkippedCost(["L:c", "L:d", "L:a", "L:b"], edges, h),
    ).toBe(636); // the sweep mirror
  });
});

// ── orderStrataUnits @ K>0 — packed acceptance (v2.0 crossings-decrease) ───────

describe("orderStrataUnits @ K>0 — packed", () => {
  // 2 sources (a,b @ layer 0) → 2 sinks (s,t @ layer 1), boxes at x=0 / x=20.
  const units = [leaf("a"), leaf("b"), leaf("s"), leaf("t")];
  const heights = { "L:a": 10, "L:b": 10, "L:s": 10, "L:t": 10 };
  const keys = { "L:a": "a", "L:b": "b", "L:s": "s", "L:t": "t" };
  const cols = {
    "L:a": [0, 0] as const,
    "L:b": [0, 0] as const,
    "L:s": [1, 1] as const,
    "L:t": [1, 1] as const,
  };
  const xspan = {
    "L:a": [0, 0] as const,
    "L:b": [0, 0] as const,
    "L:s": [10, 10] as const,
    "L:t": [10, 10] as const,
  };

  it("ACCEPTS a sweep that strictly reduces trial crossings", () => {
    // a→t, b→s cross in model order [a,b,s,t]; a down-sweep untangles them to
    // [a,t,b,s] (crossings 1 → 0) and the v2.0 acceptance keeps it.
    const seq = orderIds({
      units,
      edges: [liftEdge("L:a", "L:t"), liftEdge("L:b", "L:s")],
      heights,
      keys,
      policy: "packed",
      sweeps: 4,
      cols,
      xspan,
    });
    expect(seq).toEqual(["L:a", "L:t", "L:b", "L:s"]);
  });

  it("REJECTS every sweep when no re-sort reduces crossings (keeps model order)", () => {
    // a→s, b→t do NOT cross in model order [a,b,s,t] (crossings 0); no sweep can
    // strictly decrease below 0, so all four are rejected and the final = initial.
    const seq = orderIds({
      units,
      edges: [liftEdge("L:a", "L:s"), liftEdge("L:b", "L:t")],
      heights,
      keys,
      policy: "packed",
      sweeps: 4,
      cols,
      xspan,
    });
    expect(seq).toEqual(["L:a", "L:b", "L:s", "L:t"]);
  });
});

// ── orderStrataUnits — determinism ────────────────────────────────────────────

describe("orderStrataUnits — determinism", () => {
  const fixture = (policy: StrataHullPolicy): OrderFixture => ({
    units: [leaf("a"), leaf("b"), leaf("c"), leaf("d"), leaf("e")],
    edges: [
      liftEdge("L:a", "L:d"),
      liftEdge("L:a", "L:e"),
      liftEdge("L:c", "L:d"),
      liftEdge("L:c", "L:e"),
    ],
    heights: { "L:a": 20, "L:b": 20, "L:c": 20, "L:d": 20, "L:e": 20 },
    keys: { "L:a": "a", "L:b": "b", "L:c": "c", "L:d": "d", "L:e": "e" },
    policy,
    sweeps: 4,
    xspan: {
      "L:a": [0, 0],
      "L:b": [1, 1],
      "L:c": [2, 2],
      "L:d": [3, 3],
      "L:e": [4, 4],
    },
  });

  it("run-twice deep-equal (banded and packed)", () => {
    for (const policy of ["banded", "packed"] as const) {
      const f = fixture(policy);
      const a = orderStrataUnits(buildParams(f));
      const b = orderStrataUnits(buildParams(f));
      expect(a).toEqual(b);
    }
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
