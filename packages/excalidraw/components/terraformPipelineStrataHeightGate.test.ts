/**
 * Strata P5 / Lever C — per-hull implied-height gate (`strataHeightGate`) unit tests.
 *
 * The gate is a pure boolean PRECONDITION on candidate adoption: accept only if
 * EVERY hull's implied content height is maintained-or-decreased. It never enters
 * the packed objective ({crossings, penetrations, lengthL1}) and never trades.
 *
 * The load-bearing tests here are (1) the ANTI-VACUITY ANCHOR — the metric must
 * reproduce `placeStrataHulls`'s own box.height exactly, or the gate silently
 * compares apples to oranges — and (5) the VACUITY REGRESSION test, which is the
 * executable statement of the defect this module replaces: the shipped
 * scene-global `maxBottomOf` check (terraformPipelineStrataBlockClamp.ts:481)
 * ADMITS a non-tallest hull growing, because one scalar max(y+height) over all
 * boxes is dominated by the tallest extent.
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataHeightGate.test.ts
 */
import { describe, expect, it } from "vitest";

import { buildStrataModel } from "./terraformPipelineStrataModel";
import { placeStrataHulls } from "./terraformPipelineStrataPlacement";
import {
  strataHeightGateAdmits,
  strataHeightGateAdmitsWithin,
  strataHeightGateAdmitsWithinBaseline,
  strataHullImpliedHeights,
} from "./terraformPipelineStrataHeightGate";

import type {
  CollapsedPipelineEdge,
  PipelineCluster,
  PipelineLayoutPrep,
  PipelinePlacement,
} from "./terraformPipelineLayoutShared";
import type {
  StrataBox,
  StrataBoxedHull,
  StrataEngineOptions,
  StrataPlacementResult,
  StrataPrimeEdge,
  StrataRankResult,
} from "./terraformPipelineStrataTypes";

const OPTS: StrataEngineOptions = {
  compact: true,
  includeAncillary: false,
  networkSimplexRank: false,
  sweeps: 0,
  coordinateRefine: false,
};

const COL_GAP = 600;

function placement(
  providerFamily: string,
  accountId: string,
  region: string,
  vpcId: string | null = null,
  subnetSignature?: string,
): PipelinePlacement {
  return { providerFamily, accountId, region, vpcId, subnetSignature };
}

function frameCluster(
  id: string,
  p: PipelinePlacement,
  primaryAddress: string,
  frameW: number,
  frameH: number,
): PipelineCluster {
  const frameId = `${id}:frame`;
  const build = {
    skeleton: [
      { type: "frame", id: frameId, x: 0, y: 0, width: frameW, height: frameH },
    ],
    width: frameW,
    height: frameH,
    clusterFrameId: frameId,
  } as unknown as PipelineCluster["build"];
  return {
    id,
    primaryAddress,
    firstSequence: 0,
    depth: 0,
    placement: p,
    build,
  };
}

function edge(source: string, target: string): CollapsedPipelineEdge {
  return {
    source,
    target,
    sequence: 0,
    original: { source, target, sequence: 0, origin: "tfd" },
  };
}

function prep(
  clusters: PipelineCluster[],
  collapsedEdges: CollapsedPipelineEdge[] = [],
): PipelineLayoutPrep {
  return {
    clusters,
    collapsedEdges,
    maxDepth: 0,
    columnX: [],
    depthResult: { depths: new Map(), hasCycle: false },
    networkSimplexApplied: false,
    satelliteOwners: new Map(),
    placementByAddress: new Map(),
  };
}

function rankStub(ranks: Record<string, number>): StrataRankResult {
  const maxRank = Math.max(0, ...Object.values(ranks));
  const columnX = Array.from(
    { length: maxRank + 1 },
    (_, i) => 50 + i * COL_GAP,
  );
  return {
    rank: new Map(Object.entries(ranks)),
    columnX,
    networkSimplexApplied: false,
  };
}

function primeEdges(pairs: [string, string][]): StrataPrimeEdge[] {
  return pairs.map(([source, target]) => ({
    edge: {
      key: `${source.length}:${source}→${target.length}:${target}:tfd`,
      source,
      target,
      relKind: "tfd",
      multiplicity: 1,
    },
    reversed: false,
  }));
}

/**
 * The shipped scene-global check being replaced (verbatim copy of
 * terraformPipelineStrataBlockClamp.ts:109-118) — used ONLY by the vacuity
 * regression test to prove the old gate admits what the new one rejects.
 */
const legacyMaxBottomOf = (p: StrataPlacementResult): number => {
  let maxBottom = Number.NEGATIVE_INFINITY;
  for (const [, bh] of p.boxedHulls) {
    maxBottom = Math.max(maxBottom, bh.box.y + bh.box.height);
  }
  for (const [, box] of p.leafBoxes) {
    maxBottom = Math.max(maxBottom, box.y + box.height);
  }
  return maxBottom;
};

/**
 * Move one leaf by (dx, dy) in a fresh placement — both its `leafBoxes` entry and
 * its owning hull's `placed` entry. Hull boxes are left FIXED, exactly as the
 * phase-1 operators do, so the implied height diverges from the stored height
 * precisely when the leaf's Y moves.
 */
function moveLeaf(
  from: StrataPlacementResult,
  leafId: string,
  dx: number,
  dy: number,
): StrataPlacementResult {
  const old = from.leafBoxes.get(leafId)!;
  const next: StrataBox = {
    x: old.x + dx,
    y: old.y + dy,
    width: old.width,
    height: old.height,
  };
  const leafBoxes = new Map<string, StrataBox>();
  for (const [id, box] of from.leafBoxes) {
    leafBoxes.set(id, id === leafId ? next : box);
  }
  const boxedHulls = new Map<string, StrataBoxedHull>();
  for (const [id, bh] of from.boxedHulls) {
    boxedHulls.set(id, {
      hull: bh.hull,
      box: bh.box,
      placed: bh.placed.map((pu) =>
        pu.unit.kind === "leaf" && pu.unit.clusterId === leafId
          ? { unit: pu.unit, box: next, colSpan: pu.colSpan }
          : pu,
      ),
    });
  }
  return { boxedHulls, leafBoxes };
}

/**
 * Two sibling VPC hulls under one region. `vpc-2` is deliberately built MUCH
 * taller than `vpc-1` so the scene-global max is pinned by vpc-2 — that is what
 * lets the vacuity test grow vpc-1 invisibly.
 *
 * `a3` shares a RANK (and therefore a column, and therefore an X-extent) with
 * `a2`, so `dropY` is forced to stack it BELOW a2 — making a3 the uniquely
 * bottom-most unit of its hull. That is required for the height-DECREASING test:
 * X-disjoint leaves (different ranks) share the top row, so raising one of those
 * cannot shrink the hull — its sibling still pins maxBottom.
 */
function twoHullFixture() {
  const p1 = placement("aws", "1", "us-east-1", "vpc-1", "subA");
  const p2 = placement("aws", "1", "us-east-1", "vpc-2", "subB");
  const clusters = [
    frameCluster("a1", p1, "aws.a1", 200, 60),
    frameCluster("a2", p1, "aws.a2", 200, 60),
    frameCluster("a3", p1, "aws.a3", 200, 60),
    frameCluster("b1", p2, "aws.b1", 200, 400),
    frameCluster("b2", p2, "aws.b2", 200, 400),
  ];
  const model = buildStrataModel(
    prep(clusters, [edge("a1", "a2"), edge("a1", "a3"), edge("b1", "b2")]),
    OPTS,
  );
  const primes = primeEdges([
    ["a1", "a2"],
    ["a1", "a3"],
    ["b1", "b2"],
  ]);
  const rank = rankStub({ a1: 0, a2: 1, a3: 1, b1: 0, b2: 1 });
  const a0 = placeStrataHulls(model, primes, rank, OPTS);
  return { model, primes, rank, a0 };
}

/** The hull id owning a given leaf. */
function hullOfLeaf(p: StrataPlacementResult, leafId: string): string {
  for (const [id, bh] of p.boxedHulls) {
    for (const pu of bh.placed) {
      if (pu.unit.kind === "leaf" && pu.unit.clusterId === leafId) {
        return id;
      }
    }
  }
  throw new Error(`no hull owns ${leafId}`);
}

// ── (1) ANTI-VACUITY ANCHOR ───────────────────────────────────────────────────

describe("implied height mirrors placeStrataHulls exactly", () => {
  it("reproduces every hull's own stored box.height on a real placement", () => {
    const { a0 } = twoHullFixture();
    const implied = strataHullImpliedHeights(a0);
    expect(implied.size).toBe(a0.boxedHulls.size);
    for (const [id, bh] of a0.boxedHulls) {
      expect(implied.get(id)).toBe(bh.box.height);
    }
  });
});

// ── (2)-(4) reject / admit semantics ──────────────────────────────────────────

describe("gate semantics", () => {
  it("REJECTS a candidate that grows a hull's implied height", () => {
    const { a0 } = twoHullFixture();
    // a3 is the bottom-most unit of its hull, so pushing it down grows the box.
    const grown = moveLeaf(a0, "a3", 0, 1);
    expect(strataHeightGateAdmits(grown, a0)).toBe(false);
  });

  it("ADMITS a height-neutral (sideways) move", () => {
    const { a0 } = twoHullFixture();
    const sideways = moveLeaf(a0, "a2", 25, 0);
    expect(strataHeightGateAdmits(sideways, a0)).toBe(true);
  });

  it("ADMITS a height-decreasing move (bottom-most leaf pulled up)", () => {
    const { a0 } = twoHullFixture();
    // a3 is stacked below a2 (same rank ⇒ same column ⇒ dropY forces the drop),
    // so it uniquely pins its hull's maxBottom and raising it strictly shrinks.
    const hullId = hullOfLeaf(a0, "a3");
    const before = strataHullImpliedHeights(a0).get(hullId)!;
    const raised = moveLeaf(a0, "a3", 0, -20);
    const after = strataHullImpliedHeights(raised).get(hullId)!;
    expect(after).toBeLessThan(before);
    expect(strataHeightGateAdmits(raised, a0)).toBe(true);
  });

  it("is reflexive — a placement always admits itself", () => {
    const { a0 } = twoHullFixture();
    expect(strataHeightGateAdmits(a0, a0)).toBe(true);
  });
});

// ── (5) VACUITY REGRESSION — the executable statement of the defect ───────────

describe("vacuity regression vs the scene-global maxBottom check", () => {
  it("rejects a NON-TALLEST hull growing that scene-global maxBottom admits", () => {
    const { a0 } = twoHullFixture();
    // vpc-1 (60px leaves) is far shorter than vpc-2 (400px leaves), so growing
    // it cannot move the scene bottom. a3 is vpc-1's bottom-most unit.
    const grown = moveLeaf(a0, "a3", 0, 8);

    // (a) the OLD gate is blind: the scene-global scalar is unchanged ⇒ admits.
    expect(legacyMaxBottomOf(grown)).toBe(legacyMaxBottomOf(a0));

    // (b) the NEW per-hull gate catches it.
    expect(strataHeightGateAdmits(grown, a0)).toBe(false);
  });
});

// ── (6) edge cases ────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("handles the root hull (no title reserve) and every nested hull", () => {
    const { a0 } = twoHullFixture();
    const implied = strataHullImpliedHeights(a0);
    const root = [...a0.boxedHulls.values()].find(
      (bh) => bh.hull.role === "root",
    );
    expect(root).toBeDefined();
    expect(implied.get(root!.hull.id)).toBe(root!.box.height);
  });

  it("computes an empty hull as topInset + FRAME_PAD", () => {
    const { a0 } = twoHullFixture();
    const anyHull = [...a0.boxedHulls.values()][0]!;
    const emptied: StrataPlacementResult = {
      leafBoxes: a0.leafBoxes,
      boxedHulls: new Map([
        [anyHull.hull.id, { hull: anyHull.hull, box: anyHull.box, placed: [] }],
      ]),
    };
    const implied = strataHullImpliedHeights(emptied);
    // root: PAD + PAD = 56; non-root: PAD + 2*PAD + PAD = 112.
    const expected = anyHull.hull.role === "root" ? 56 : 112;
    expect(implied.get(anyHull.hull.id)).toBe(expected);
  });
});

// ── (7) monotonicity over an adoption sequence ────────────────────────────────

describe("monotonicity theorem", () => {
  it("keeps every hull's implied height non-increasing across gated adoptions", () => {
    const { a0 } = twoHullFixture();
    let incumbent = a0;
    const baseline = strataHullImpliedHeights(a0);

    // A scripted mix of admissible and inadmissible candidates; only gated
    // adoptions are taken, against the ROLLING incumbent.
    const script: [string, number, number][] = [
      ["a3", 0, -10], // shrinks  ⇒ adopt
      ["a3", 0, 40], // grows     ⇒ reject
      ["a1", 10, 0], // sideways  ⇒ adopt
      ["b2", 0, 30], // grows     ⇒ reject
      ["a3", 0, -5], // shrinks   ⇒ adopt
    ];
    for (const [leaf, dx, dy] of script) {
      const cand = moveLeaf(incumbent, leaf, dx, dy);
      if (strataHeightGateAdmits(cand, incumbent)) {
        incumbent = cand;
      }
    }

    const final = strataHullImpliedHeights(incumbent);
    for (const [id, h0] of baseline) {
      expect(final.get(id)!).toBeLessThanOrEqual(h0);
    }
  });
});

// ── (8) SLACK gate (A01 leaf X-shift) ─────────────────────────────────────────

describe("strataHeightGateAdmitsWithin — bounded slack (A01)", () => {
  it("admits a within-budget grow, rejects an over-budget grow, and {0,0} is strict", () => {
    const { a0 } = twoHullFixture();
    // grow vpc-1 by dropping a3 +120px (its owning hull's bottom moves +120).
    const grown120 = moveLeaf(a0, "a3", 0, 120);
    const owner = hullOfLeaf(a0, "a3");
    expect(strataHullImpliedHeights(grown120).get(owner)!).toBe(
      strataHullImpliedHeights(a0).get(owner)! + 120,
    );

    // default budget max(150, 1%) admits +120; the strict gate rejects it.
    expect(
      strataHeightGateAdmitsWithin(grown120, a0, { absPx: 150, relFrac: 0.01 }),
    ).toBe(true);
    expect(strataHeightGateAdmits(grown120, a0)).toBe(false);

    // an over-budget grow (+200 > 150) is rejected by the slack gate too.
    const grown200 = moveLeaf(a0, "a3", 0, 200);
    expect(
      strataHeightGateAdmitsWithin(grown200, a0, { absPx: 150, relFrac: 0.01 }),
    ).toBe(false);

    // {absPx:0, relFrac:0} recovers the strict maintain-or-decrease gate exactly.
    expect(
      strataHeightGateAdmitsWithin(grown120, a0, { absPx: 0, relFrac: 0 }),
    ).toBe(strataHeightGateAdmits(grown120, a0));
    const shrunk = moveLeaf(a0, "a3", 0, -10);
    expect(
      strataHeightGateAdmitsWithin(shrunk, a0, { absPx: 0, relFrac: 0 }),
    ).toBe(strataHeightGateAdmits(shrunk, a0));
  });
});

// ── (9) GLOBALLY-BOUNDED slack gate (A2 fix — total growth cap) ────────────────

describe("strataHeightGateAdmitsWithinBaseline — globally bounded total growth", () => {
  it("caps a hull's TOTAL growth at one slack allowance across N adoptions where the rolling-incumbent gate would not", () => {
    const { a0 } = twoHullFixture();
    const owner = hullOfLeaf(a0, "a3");
    const baseline = strataHullImpliedHeights(a0);
    const budget = { absPx: 150, relFrac: 0.01 };

    // Two successive +100px grows of the SAME hull (a3 is its bottom-most unit).
    const cand1 = moveLeaf(a0, "a3", 0, 100);
    const cand2 = moveLeaf(cand1, "a3", 0, 100); // +200 total from the baseline.
    expect(strataHullImpliedHeights(cand2).get(owner)!).toBe(
      baseline.get(owner)! + 200,
    );

    // ROLLING-INCUMBENT gate (the DEFECT this fix replaces): each step is within
    // one slack of the PREVIOUS incumbent, so BOTH adopt and the hull cumulatively
    // grows +200 — twice the intended bound. Documented here as the contrast.
    expect(strataHeightGateAdmitsWithin(cand1, a0, budget)).toBe(true);
    expect(strataHeightGateAdmitsWithin(cand2, cand1, budget)).toBe(true);

    // BASELINE-ANCHORED gate (the FIX): step 1 admits (+100 <= 150), step 2 is
    // REJECTED (+200 > baseline+150). Total growth can never exceed one slack
    // allowance no matter how many candidates are checked against the fixed ceiling.
    expect(strataHeightGateAdmitsWithinBaseline(cand1, baseline, budget)).toBe(
      true,
    );
    expect(strataHeightGateAdmitsWithinBaseline(cand2, baseline, budget)).toBe(
      false,
    );

    // A hull absent from the baseline is rejected (new content — defensive).
    expect(strataHeightGateAdmitsWithinBaseline(a0, new Map(), budget)).toBe(
      false,
    );

    // {absPx:0, relFrac:0} recovers the strict maintain-or-decrease gate against
    // the baseline: any grow rejects, a shrink/hold admits.
    expect(
      strataHeightGateAdmitsWithinBaseline(cand1, baseline, {
        absPx: 0,
        relFrac: 0,
      }),
    ).toBe(false);
    const shrunk = moveLeaf(a0, "a3", 0, -10);
    expect(
      strataHeightGateAdmitsWithinBaseline(shrunk, baseline, {
        absPx: 0,
        relFrac: 0,
      }),
    ).toBe(true);
  });
});
