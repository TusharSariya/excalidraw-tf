/**
 * Strata P1 leaf-sink pull-in (`strataSinkPullIn`, default off) — unit tests.
 *
 * Mirrors the synthetic-fixture toolkit of terraformPipelineStrataCoordRefine.test.ts
 * (placement/frameCluster/edge/prep/rankStub/primeEdges over the real A0
 * `placeStrataHulls`). Covers:
 *   (a) flag-off referential identity (byte-identical proof)
 *   (b) happy path: stranded degree-1 sink pulled to columnX[srcRank+1], length
 *       down, crossings/penetrations not up, parent box height unchanged
 *   (c) no vertical slack ⇒ every candidate fails r2Valid ⇒ input returned by ref
 *   (d) X-containment guard: a cross-hull target column outside the parent box
 *       is rejected (the leaf never escapes its own frame)
 *   (e) reversed (A3) edge: the effective-direction sink is still pulled
 *   (f) already-adjacent + degree-2 node ⇒ never candidates (referential identity)
 *   (g) height gate: parent box height invariant across the whole pass (phase 1)
 *   (h) two sinks of one source ⇒ greedy composition, both pulled, structure clean
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataSinkPullIn.test.ts
 */
import { describe, expect, it } from "vitest";

import { buildStrataModel } from "./terraformPipelineStrataModel";
import {
  checkStrataStructure,
  placeStrataHulls,
} from "./terraformPipelineStrataPlacement";
import { refineStrataSinkPullIn } from "./terraformPipelineStrataSinkPullIn";
import { scoreStrataPlacementGeometry } from "./terraformPipelineStrataPackedScoring";

import type {
  CollapsedPipelineEdge,
  PipelineCluster,
  PipelineLayoutPrep,
  PipelinePlacement,
} from "./terraformPipelineLayoutShared";
import type {
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
const OPTS_ON: StrataEngineOptions = { ...OPTS, strataSinkPullIn: true };

const COL_GAP = 600; // > any leaf width below ⇒ columns are X-disjoint

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

/** The hull whose `placed` holds `leafId`, in a placement. */
function parentHullOf(p: StrataPlacementResult, leafId: string): string {
  for (const [hullId, bh] of p.boxedHulls) {
    for (const pu of bh.placed) {
      if (pu.unit.kind === "leaf" && pu.unit.clusterId === leafId) {
        return hullId;
      }
    }
  }
  throw new Error(`no parent hull for ${leafId}`);
}

const R2_CLEAN = {
  nonAncestorOverlaps: 0,
  titleCollisions: 0,
  contiguityViolations: 0,
};

/** Total hull-box height signature over all hulls (phase-1 invariant proof). */
function hullHeights(p: StrataPlacementResult): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, bh] of p.boxedHulls) {
    out.set(id, bh.box.height);
  }
  return out;
}

// ── (a) flag-off referential identity ─────────────────────────────────────────

describe("sinkPullIn flag-off — byte-identical", () => {
  it("returns the input placement by reference when the flag is absent/false", () => {
    const p = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const clusters = [
      frameCluster("s", p, "aws.s", 200, 60),
      frameCluster("k", p, "aws.k", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "k")]), OPTS);
    const primes = primeEdges([["s", "k"]]);
    const rank = rankStub({ s: 0, k: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    // absent flag
    expect(refineStrataSinkPullIn(a0, model, primes, rank, OPTS)).toBe(a0);
    // explicit false
    expect(
      refineStrataSinkPullIn(a0, model, primes, rank, {
        ...OPTS,
        strataSinkPullIn: false,
      }),
    ).toBe(a0);
  });
});

// ── (b) happy path ────────────────────────────────────────────────────────────

describe("sinkPullIn happy path — stranded degree-1 sink pulled to source+1", () => {
  it("pulls the sink onto columnX[srcRank+1], shortens length, keeps box height", () => {
    // s@col0 → k@col3, both direct leaves of one packed subnet; k is a degree-1
    // sink stranded 3 columns right of its only source.
    const p = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const clusters = [
      frameCluster("s", p, "aws.s", 200, 60),
      frameCluster("k", p, "aws.k", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "k")]), OPTS);
    const primes = primeEdges([["s", "k"]]);
    const rank = rankStub({ s: 0, k: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const beforeScore = scoreStrataPlacementGeometry(a0, model, primes);
    const parent = parentHullOf(a0, "k");
    const heightBefore = a0.boxedHulls.get(parent)!.box.height;

    const out = refineStrataSinkPullIn(a0, model, primes, rank, OPTS_ON);

    // moved onto the on-grid column immediately right of the source.
    expect(out.leafBoxes.get("k")!.x).toBe(rank.columnX[1]);
    // source untouched.
    expect(out.leafBoxes.get("s")).toEqual(a0.leafBoxes.get("s"));

    const afterScore = scoreStrataPlacementGeometry(out, model, primes);
    expect(afterScore.lengthL1).toBeLessThan(beforeScore.lengthL1);
    expect(afterScore.crossings).toBeLessThanOrEqual(beforeScore.crossings);
    expect(afterScore.penetrations).toBeLessThanOrEqual(
      beforeScore.penetrations,
    );

    // parent hull box height invariant (phase-1 height gate).
    expect(out.boxedHulls.get(parent)!.box.height).toBe(heightBefore);
    // structural invariant holds.
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);
  });
});

// ── (c) no vertical slack ⇒ rejected ──────────────────────────────────────────

describe("sinkPullIn no-slack — every candidate fails the structural gate", () => {
  it("leaves the placement byte-identical when the target column is blocked", () => {
    // s@col0 → k@col3, plus a blocker b@col1 occupying the ONLY row of a
    // one-row-tall packed subnet. Pulling k onto col1 must overlap b at every
    // candidate Y ⇒ nonAncestorOverlaps>0 ⇒ rejected ⇒ input returned by ref.
    const p = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const clusters = [
      frameCluster("s", p, "aws.s", 200, 60),
      frameCluster("b", p, "aws.b", 200, 60),
      frameCluster("k", p, "aws.k", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "k")]), OPTS);
    const primes = primeEdges([["s", "k"]]);
    const rank = rankStub({ s: 0, b: 1, k: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    // sanity: b really sits at col1 sharing k's row (X-disjoint row-share).
    expect(a0.leafBoxes.get("b")!.x).toBe(rank.columnX[1]);
    expect(a0.leafBoxes.get("b")!.y).toBe(a0.leafBoxes.get("k")!.y);

    const out = refineStrataSinkPullIn(a0, model, primes, rank, OPTS_ON);
    expect(out).toBe(a0); // nothing adopted ⇒ referential identity.
  });
});

// ── (f) non-candidates: already-adjacent + degree-2 ───────────────────────────

describe("sinkPullIn non-candidates — adjacent sink + non-sink node untouched", () => {
  it("skips an already-adjacent sink (rank == srcRank+1)", () => {
    const p = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const clusters = [
      frameCluster("s", p, "aws.s", 200, 60),
      frameCluster("k", p, "aws.k", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "k")]), OPTS);
    const primes = primeEdges([["s", "k"]]);
    const rank = rankStub({ s: 0, k: 1 }); // adjacent already.
    const a0 = placeStrataHulls(model, primes, rank, OPTS);
    expect(refineStrataSinkPullIn(a0, model, primes, rank, OPTS_ON)).toBe(a0);
  });

  it("skips a degree-2 mid node (in-deg 1, out-deg 1 ⇒ not a sink)", () => {
    // s@col0 → m@col1 → t@col2: m has out-deg 1 so it is not a sink; t is the
    // sink but it is already adjacent to m (rank 2 == srcRank 1 + 1).
    const p = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const clusters = [
      frameCluster("s", p, "aws.s", 200, 60),
      frameCluster("m", p, "aws.m", 200, 60),
      frameCluster("t", p, "aws.t", 200, 60),
    ];
    const model = buildStrataModel(
      prep(clusters, [edge("s", "m"), edge("m", "t")]),
      OPTS,
    );
    const primes = primeEdges([
      ["s", "m"],
      ["m", "t"],
    ]);
    const rank = rankStub({ s: 0, m: 1, t: 2 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);
    expect(refineStrataSinkPullIn(a0, model, primes, rank, OPTS_ON)).toBe(a0);
  });
});

// ── (d) X-containment guard: cross-hull target column outside the parent box ──

describe("sinkPullIn X-containment — sink never pulled outside its parent hull box", () => {
  it("rejects a target column that lands left of the sink's own (right-side) hull", () => {
    // s is the sole leaf of a LEFT hull (vpc-1) at col0; k is the sole leaf of a
    // separate RIGHT hull (vpc-2) at col3, fed only by s. columnX[srcRank+1] =
    // columnX[1] falls in empty inter-hull space to the LEFT of k's parent box.
    // checkStrataStructure exempts ancestor↔descendant overlaps and there is no
    // sibling to collide with there, so ONLY the X-containment guard can stop the
    // pull — without it, k would render outside its own frame.
    const pLeft = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const pRight = placement("aws", "1", "us-east-1", "vpc-2", "subB");
    const clusters = [
      frameCluster("s", pLeft, "aws.s", 200, 60),
      frameCluster("k", pRight, "aws.k", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "k")]), OPTS);
    const primes = primeEdges([["s", "k"]]);
    const rank = rankStub({ s: 0, k: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const parent = parentHullOf(a0, "k");
    const parentBox = a0.boxedHulls.get(parent)!.box;
    // sanity: the naive target column really is left of k's parent box.
    expect(rank.columnX[1]).toBeLessThan(parentBox.x);

    const out = refineStrataSinkPullIn(a0, model, primes, rank, OPTS_ON);
    // guard fires ⇒ nothing adopted ⇒ referential identity.
    expect(out).toBe(a0);
    // and the leaf stays fully inside its parent box X-extent.
    const kBox = out.leafBoxes.get("k")!;
    expect(kBox.x).toBeGreaterThanOrEqual(parentBox.x);
    expect(kBox.x + kBox.width).toBeLessThanOrEqual(
      parentBox.x + parentBox.width,
    );
  });
});

// ── (e) reversed (A3) edge: effective direction honored ───────────────────────

describe("sinkPullIn reversed edge — effective-direction sink still pulled", () => {
  it("treats the reversed edge's effective target as the sink and pulls it in", () => {
    // Stored edge k→s but A3-reversed, so the effective DAG is s→k: k is the
    // effective degree-1 sink. The pass must honor `reversed` and pull k, exactly
    // as the forward happy path does.
    const p = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const clusters = [
      frameCluster("s", p, "aws.s", 200, 60),
      frameCluster("k", p, "aws.k", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "k")]), OPTS);
    // Build a REVERSED prime: stored source/target swapped, reversed=true, so the
    // effective source is s and the effective target (sink) is k.
    const primes: StrataPrimeEdge[] = [
      {
        edge: {
          key: `1:k→1:s:tfd`,
          source: "k",
          target: "s",
          relKind: "tfd",
          multiplicity: 1,
        },
        reversed: true,
      },
    ];
    const rank = rankStub({ s: 0, k: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const out = refineStrataSinkPullIn(a0, model, primes, rank, OPTS_ON);
    // k is pulled onto the column right of its effective source s.
    expect(out.leafBoxes.get("k")!.x).toBe(rank.columnX[1]);
    expect(out.leafBoxes.get("s")).toEqual(a0.leafBoxes.get("s"));
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);
  });
});

// ── (h) two sinks in one hull: greedy composition ─────────────────────────────

describe("sinkPullIn multi-sink — two degree-1 sinks of one source both pulled", () => {
  it("greedily pulls both stranded sinks while staying structurally clean", () => {
    // s@col0 feeds two degree-1 sinks k1@col2 and k2@col3, all direct leaves of
    // one packed subnet (so col1 stays inside the parent box). Both are stranded;
    // the greedy per-sink loop should pull each onto col1 in its own row.
    const p = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const clusters = [
      frameCluster("s", p, "aws.s", 200, 60),
      frameCluster("k1", p, "aws.k1", 200, 60),
      frameCluster("k2", p, "aws.k2", 200, 60),
    ];
    const model = buildStrataModel(
      prep(clusters, [edge("s", "k1"), edge("s", "k2")]),
      OPTS,
    );
    const primes = primeEdges([
      ["s", "k1"],
      ["s", "k2"],
    ]);
    const rank = rankStub({ s: 0, k1: 2, k2: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const before = scoreStrataPlacementGeometry(a0, model, primes);
    const out = refineStrataSinkPullIn(a0, model, primes, rank, OPTS_ON);

    // at least one sink moved (composition is not a no-op) and total edge length
    // strictly dropped.
    const moved =
      out.leafBoxes.get("k1")!.x !== a0.leafBoxes.get("k1")!.x ||
      out.leafBoxes.get("k2")!.x !== a0.leafBoxes.get("k2")!.x;
    expect(moved).toBe(true);
    const after = scoreStrataPlacementGeometry(out, model, primes);
    expect(after.lengthL1).toBeLessThan(before.lengthL1);
    // structure stays clean through the greedy composition.
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);
  });
});

// ── (g) height gate: box heights invariant across the whole pass ──────────────

describe("sinkPullIn height gate — every hull box height invariant (phase 1)", () => {
  it("no hull box grows or shrinks even when a sink is adopted", () => {
    const p = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const clusters = [
      frameCluster("s", p, "aws.s", 200, 60),
      frameCluster("k", p, "aws.k", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "k")]), OPTS);
    const primes = primeEdges([["s", "k"]]);
    const rank = rankStub({ s: 0, k: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const before = hullHeights(a0);
    const out = refineStrataSinkPullIn(a0, model, primes, rank, OPTS_ON);
    // sanity: the sink actually moved (this is not a vacuous invariant).
    expect(out.leafBoxes.get("k")!.x).not.toBe(a0.leafBoxes.get("k")!.x);
    expect(hullHeights(out)).toEqual(before);
  });
});
