/**
 * Strata P4 pure-sink account block clamp (`strataBlockClamp`, default off) —
 * unit tests.
 *
 * Mirrors the shared synthetic-fixture toolkit
 * (placement/frameCluster/edge/prep/rankStub/primeEdges over the real A0
 * `placeStrataHulls`). Covers:
 *   (a) flag-off referential identity (byte-identical proof)
 *   (b) happy path: an over-ranked pure-sink account block rigid-translates left
 *       by exactly kMaxRank columns, external edge non-inverting, R2 all-zero,
 *       height invariant
 *   (b2) rigid carry of an internal block edge (multi-leaf block, inversion-proof)
 *   (c) clamp respect: a block fed by a DEEP external source moves only to
 *       max(srcRank)+1, never past it
 *   (d) a block with an external OUTBOUND edge (not a pure sink) ⇒ untouched
 *   (e) X-containment: a cross-provider target column outside the parent hull box
 *       is rejected (the block never escapes its own frame)
 *   (f) height invariant — every hull box bottom equal before/after
 *   (g) deterministic multi-account: two eligible pure-sink blocks both clamped,
 *       structure clean
 *   (h) kMaxRank < 1 (adjacent source) ⇒ skip (referential identity)
 *   (i) composition/on-grid gate: a block leaf perturbed off its grid column by
 *       an upstream pass ⇒ conservatively skipped (referential identity)
 *   (j) `placed` self-consistency: after a move, no hull's `placed` entry carries
 *       a stale box (parent provider's account hull-unit shifts with the account)
 *   (k) reversed effective edge (A3): a `reversed:true` prime is honored — the
 *       effective sink still clamps
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataBlockClamp.test.ts
 */
import { describe, expect, it } from "vitest";

import { refineStrataBlockClamp } from "./terraformPipelineStrataBlockClamp";
import { buildStrataModel } from "./terraformPipelineStrataModel";
import {
  checkStrataStructure,
  placeStrataHulls,
} from "./terraformPipelineStrataPlacement";
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
const OPTS_ON: StrataEngineOptions = { ...OPTS, strataBlockClamp: true };

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

/**
 * Non-uniform-column rank stub: `columnX` is supplied explicitly so a block can
 * span a destination band whose cumulative spacing differs from its origin band.
 * This is the fixture geometry the uniform `rankStub` (constant COL_GAP) is
 * structurally BLIND to — under uniform columns a per-rank snap and the old
 * single-fixed-ΔX translate are identical, so the entire uniform suite is vacuous
 * for the variable-width bug (a02-xshift-block.md §1d, a13-fixture-skeptic.md).
 */
function rankStubX(
  ranks: Record<string, number>,
  columnX: number[],
): StrataRankResult {
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

/** Prime edge stored source→target but flagged `reversed` (effective target→source). */
function reversedPrime(source: string, target: string): StrataPrimeEdge {
  return {
    edge: {
      key: `${source.length}:${source}→${target.length}:${target}:tfd`,
      source,
      target,
      relKind: "tfd",
      multiplicity: 1,
    },
    reversed: true,
  };
}

/**
 * `placed` self-consistency: every hull's `placed` unit box must equal the live
 * box of the thing it references (`leafBoxes` for a leaf unit, `boxedHulls[].box`
 * for a hull unit). Catches the "parent provider retains a stale account box"
 * duplicate-box hazard after a block translate.
 */
function assertPlacedConsistent(p: StrataPlacementResult): void {
  for (const [, bh] of p.boxedHulls) {
    for (const pu of bh.placed) {
      if (pu.unit.kind === "leaf") {
        const lb = p.leafBoxes.get(pu.unit.clusterId);
        if (lb) {
          expect(pu.box.x).toBe(lb.x);
          expect(pu.box.y).toBe(lb.y);
        }
      } else {
        const hb = p.boxedHulls.get(pu.unit.hullId);
        if (hb) {
          expect(pu.box.x).toBe(hb.box.x);
          expect(pu.box.y).toBe(hb.box.y);
        }
      }
    }
  }
}

const R2_CLEAN = {
  nonAncestorOverlaps: 0,
  titleCollisions: 0,
  contiguityViolations: 0,
};

/** Diagram bottom (max box.y + box.height) over all hull + leaf boxes. */
function maxBottom(p: StrataPlacementResult): number {
  let m = Number.NEGATIVE_INFINITY;
  for (const [, bh] of p.boxedHulls) {
    m = Math.max(m, bh.box.y + bh.box.height);
  }
  for (const [, box] of p.leafBoxes) {
    m = Math.max(m, box.y + box.height);
  }
  return m;
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

// ── (a) flag-off referential identity ─────────────────────────────────────────

describe("blockClamp flag-off — byte-identical", () => {
  it("returns the input placement by reference when the flag is absent/false", () => {
    const src = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const sink = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", src, "aws.1.s", 200, 60),
      frameCluster("a", sink, "aws.4.a", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "a")]), OPTS);
    const primes = primeEdges([["s", "a"]]);
    const rank = rankStub({ s: 0, a: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    expect(refineStrataBlockClamp(a0, model, primes, rank, OPTS)).toBe(a0);
    expect(
      refineStrataBlockClamp(a0, model, primes, rank, {
        ...OPTS,
        strataBlockClamp: false,
      }),
    ).toBe(a0);
  });
});

// ── (b) happy path ────────────────────────────────────────────────────────────

describe("blockClamp happy path — pure-sink account block clamped to source+1", () => {
  it("rigid-translates the block onto columnX[srcRank+1], R2 clean, height flat", () => {
    // s@col0 (account 1) feeds a@col3 (the sole leaf of pure-sink account 4).
    // kMaxRank = 3 − 0 − 1 = 2 ⇒ the block lands its leftmost column on col1.
    const src = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const sink = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", src, "aws.1.s", 200, 60),
      frameCluster("a", sink, "aws.4.a", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "a")]), OPTS);
    const primes = primeEdges([["s", "a"]]);
    const rank = rankStub({ s: 0, a: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const beforeScore = scoreStrataPlacementGeometry(a0, model, primes);
    const heightBefore = maxBottom(a0);
    const aY = a0.leafBoxes.get("a")!.y;

    const out = refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON);

    // moved onto the on-grid column immediately right of the source (kMaxRank=2).
    expect(out.leafBoxes.get("a")!.x).toBe(rank.columnX[1]);
    // pure X translate — Y untouched.
    expect(out.leafBoxes.get("a")!.y).toBe(aY);
    // source untouched.
    expect(out.leafBoxes.get("s")).toEqual(a0.leafBoxes.get("s"));
    // external edge non-inverting: sink centre still ≥ source centre.
    expect(
      out.leafBoxes.get("a")!.x + out.leafBoxes.get("a")!.width / 2,
    ).toBeGreaterThanOrEqual(
      out.leafBoxes.get("s")!.x + out.leafBoxes.get("s")!.width / 2,
    );

    const afterScore = scoreStrataPlacementGeometry(out, model, primes);
    expect(afterScore.lengthL1).toBeLessThan(beforeScore.lengthL1);
    expect(afterScore.crossings).toBeLessThanOrEqual(beforeScore.crossings);
    expect(afterScore.penetrations).toBeLessThanOrEqual(
      beforeScore.penetrations,
    );

    // height maintained-or-decreased + structural invariant holds.
    expect(maxBottom(out)).toBeLessThanOrEqual(heightBefore);
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);

    // the whole account subtree box translated by the same ΔX (rigid).
    const accountHull = parentHullOf(out, "a"); // subnet hull, moved too
    const dx = out.leafBoxes.get("a")!.x - a0.leafBoxes.get("a")!.x;
    expect(dx).toBeLessThan(0);
    expect(out.boxedHulls.get(accountHull)!.box.x).toBe(
      a0.boxedHulls.get(accountHull)!.box.x + dx,
    );
  });
});

// ── (b2) rigid carry of an internal block edge ────────────────────────────────

describe("blockClamp rigid carry — internal block edge stays inversion-proof", () => {
  it("carries a 2-leaf block (internal a→c) rigidly by one ΔX", () => {
    // account 4 holds a@col3 and c@col4 with internal edge a→c; external s→a only.
    const src = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const sink = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", src, "aws.1.s", 200, 60),
      frameCluster("a", sink, "aws.4.a", 200, 60),
      frameCluster("c", sink, "aws.4.c", 200, 60),
    ];
    const model = buildStrataModel(
      prep(clusters, [edge("s", "a"), edge("a", "c")]),
      OPTS,
    );
    const primes = primeEdges([
      ["s", "a"],
      ["a", "c"],
    ]);
    const rank = rankStub({ s: 0, a: 3, c: 4 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const out = refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON);

    // both block leaves shifted by the SAME ΔX (rigid).
    const dxA = out.leafBoxes.get("a")!.x - a0.leafBoxes.get("a")!.x;
    const dxC = out.leafBoxes.get("c")!.x - a0.leafBoxes.get("c")!.x;
    expect(dxA).toBeLessThan(0);
    expect(dxC).toBe(dxA);
    // internal edge a→c stays forward (c centre ≥ a centre).
    expect(out.leafBoxes.get("c")!.x).toBeGreaterThan(
      out.leafBoxes.get("a")!.x,
    );
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);
  });
});

// ── (c) clamp respect: deep source ⇒ only to srcRank+1 ────────────────────────

describe("blockClamp clamp respect — never moves past max(source rank)+1", () => {
  it("clamps a block fed by a deep source to columnX[srcRank+1]", () => {
    // s@col2 (account 1) feeds a@col5 (account 4). kMaxRank = 5 − 2 − 1 = 2 ⇒
    // the block lands its leftmost column on col3 (= srcRank+1), NOT further left.
    const src = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const sink = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", src, "aws.1.s", 200, 60),
      frameCluster("a", sink, "aws.4.a", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "a")]), OPTS);
    const primes = primeEdges([["s", "a"]]);
    const rank = rankStub({ s: 2, a: 5 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const out = refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON);
    expect(out.leafBoxes.get("a")!.x).toBe(rank.columnX[3]); // srcRank+1, clamped.
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);
  });
});

// ── (d) not a pure sink: external outbound edge ⇒ untouched ────────────────────

describe("blockClamp non-pure-sink — a block with an external outbound edge is untouched", () => {
  it("skips a block whose leaf feeds a node outside the block", () => {
    // account 4 leaf a receives s→a (external in) but ALSO emits a→t to account 1
    // (external out) ⇒ not a pure sink ⇒ referential identity.
    const acc1 = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const acc4 = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", acc1, "aws.1.s", 200, 60),
      frameCluster("t", acc1, "aws.1.t", 200, 60),
      frameCluster("a", acc4, "aws.4.a", 200, 60),
    ];
    const model = buildStrataModel(
      prep(clusters, [edge("s", "a"), edge("a", "t")]),
      OPTS,
    );
    const primes = primeEdges([
      ["s", "a"],
      ["a", "t"],
    ]);
    const rank = rankStub({ s: 0, a: 3, t: 4 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    expect(refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON)).toBe(a0);
  });
});

// ── (e) X-containment: block never escapes its parent hull box ─────────────────

describe("blockClamp X-containment — block never pulled outside its parent hull box", () => {
  it("rejects a cross-provider target column left of the block's own provider box", () => {
    // s is in provider AWS (col0); the pure-sink block is account 4 in a SEPARATE
    // provider GCP (col3). columnX[srcRank+1] = columnX[1] falls in empty space to
    // the LEFT of the GCP provider box, so ONLY the X-containment guard can stop
    // the pull — without it, the block would render outside its own provider frame.
    const aws = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const gcp = placement("gcp", "4", "us-central1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", aws, "aws.1.s", 200, 60),
      frameCluster("a", gcp, "gcp.4.a", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "a")]), OPTS);
    const primes = primeEdges([["s", "a"]]);
    const rank = rankStub({ s: 0, a: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    // find the GCP provider hull box (parent of account 4's subtree).
    const subnetHull = parentHullOf(a0, "a");
    // walk up is not exposed; assert the naive target column is left of the
    // subnet's box (the whole GCP subtree sits to the right of col1).
    expect(rank.columnX[1]).toBeLessThan(a0.boxedHulls.get(subnetHull)!.box.x);

    const out = refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON);
    expect(out).toBe(a0); // guard fires ⇒ nothing adopted ⇒ referential identity.
  });
});

// ── (f) height invariant across the whole pass ────────────────────────────────

describe("blockClamp height gate — diagram bottom invariant (rigid X translate)", () => {
  it("no box grows or shrinks in Y even when a block is adopted", () => {
    const src = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const sink = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", src, "aws.1.s", 200, 60),
      frameCluster("a", sink, "aws.4.a", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "a")]), OPTS);
    const primes = primeEdges([["s", "a"]]);
    const rank = rankStub({ s: 0, a: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const before = maxBottom(a0);
    const out = refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON);
    // sanity: the block actually moved (this is not a vacuous invariant).
    expect(out.leafBoxes.get("a")!.x).not.toBe(a0.leafBoxes.get("a")!.x);
    expect(maxBottom(out)).toBe(before);
  });
});

// ── (g) deterministic multi-account composition ───────────────────────────────

describe("blockClamp multi-account — two eligible pure-sink blocks both clamped", () => {
  it("clamps both address-sorted blocks while staying structurally clean", () => {
    // Two independent providers, each a self-contained source→pure-sink pair:
    //   AWS: s1@col0 (account 1) → a@col3 (pure-sink account 4)
    //   GCP: s2@col0 (account 1) → p@col3 (pure-sink account 4)
    // The providers occupy disjoint Y bands, so neither block's edges can reach
    // the other — the address-sorted greedy loop clamps BOTH to col1 against the
    // rolling incumbent (a genuine two-move composition).
    const awsSrc = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const awsSink = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const gcpSrc = placement("gcp", "1", "us-central1", "vpc-1", "subA");
    const gcpSink = placement("gcp", "4", "us-central1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s1", awsSrc, "aws.1.s1", 200, 60),
      frameCluster("a", awsSink, "aws.4.a", 200, 60),
      frameCluster("s2", gcpSrc, "gcp.1.s2", 200, 60),
      frameCluster("p", gcpSink, "gcp.4.p", 200, 60),
    ];
    const model = buildStrataModel(
      prep(clusters, [edge("s1", "a"), edge("s2", "p")]),
      OPTS,
    );
    const primes = primeEdges([
      ["s1", "a"],
      ["s2", "p"],
    ]);
    const rank = rankStub({ s1: 0, s2: 0, p: 3, a: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const out = refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON);
    // both independent sink blocks moved left to col1.
    expect(out.leafBoxes.get("a")!.x).toBe(rank.columnX[1]);
    expect(out.leafBoxes.get("p")!.x).toBe(rank.columnX[1]);
    // sources untouched.
    expect(out.leafBoxes.get("s1")).toEqual(a0.leafBoxes.get("s1"));
    expect(out.leafBoxes.get("s2")).toEqual(a0.leafBoxes.get("s2"));
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);

    // determinism: a second run yields byte-equal leaf coordinates.
    const out2 = refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON);
    expect(out2.leafBoxes.get("a")).toEqual(out.leafBoxes.get("a"));
    expect(out2.leafBoxes.get("p")).toEqual(out.leafBoxes.get("p"));
  });
});

// ── (h) no leftward slack (adjacent source) ⇒ skip ────────────────────────────

describe("blockClamp no-slack — adjacent source ⇒ kMaxRank < 1 ⇒ skip", () => {
  it("leaves the placement byte-identical when the block is already at source+1", () => {
    const src = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const sink = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", src, "aws.1.s", 200, 60),
      frameCluster("a", sink, "aws.4.a", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "a")]), OPTS);
    const primes = primeEdges([["s", "a"]]);
    const rank = rankStub({ s: 0, a: 1 }); // already adjacent ⇒ margin 0 < 1.
    const a0 = placeStrataHulls(model, primes, rank, OPTS);
    expect(refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON)).toBe(a0);
  });
});

// ── (i) composition / on-grid gate: perturbed block leaf ⇒ skip ───────────────

describe("blockClamp on-grid gate — a leaf nudged off its column is not carried off-grid", () => {
  it("skips a block whose leaf an upstream pass moved off its grid column", () => {
    // Happy-path geometry, but simulate an upstream pass having nudged
    // leaf `a` +7px off columnX[3] WITHOUT changing its rank. A rigid grid-ΔX
    // would then land it at columnX[1]+7 (off-grid), where checkStrataStructure's
    // exact-`box.x`-keyed contiguity referee could miss an interleave — so the
    // on-grid gate must conservatively skip (referential identity).
    const src = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const sink = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", src, "aws.1.s", 200, 60),
      frameCluster("a", sink, "aws.4.a", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "a")]), OPTS);
    const primes = primeEdges([["s", "a"]]);
    const rank = rankStub({ s: 0, a: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    // sanity: the un-perturbed block WOULD move (isolates the gate as the cause).
    expect(refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON)).not.toBe(
      a0,
    );

    // perturb leaf `a` off its grid column (new placement object, a0 untouched).
    const aBox = a0.leafBoxes.get("a")!;
    const leafBoxes = new Map(a0.leafBoxes);
    leafBoxes.set("a", { ...aBox, x: aBox.x + 7 });
    const perturbed: StrataPlacementResult = {
      boxedHulls: a0.boxedHulls,
      leafBoxes,
    };

    expect(
      refineStrataBlockClamp(perturbed, model, primes, rank, OPTS_ON),
    ).toBe(perturbed);
  });
});

// ── (j) placed self-consistency after a move ──────────────────────────────────

describe("blockClamp placed consistency — no stale box survives a translate", () => {
  it("shifts every referencing hull's placed unit (incl. the parent provider)", () => {
    const src = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const sink = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", src, "aws.1.s", 200, 60),
      frameCluster("a", sink, "aws.4.a", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "a")]), OPTS);
    const primes = primeEdges([["s", "a"]]);
    const rank = rankStub({ s: 0, a: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);
    assertPlacedConsistent(a0); // precondition — A0 is already consistent.

    const out = refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON);
    expect(out.leafBoxes.get("a")!.x).not.toBe(a0.leafBoxes.get("a")!.x); // moved.
    assertPlacedConsistent(out); // no hull retains a stale box for the account.
  });
});

// ── (k) reversed effective edge (A3) is honored ───────────────────────────────

describe("blockClamp reversed prime — effective sink still clamps", () => {
  it("treats a reversed a→s prime as effective s→a and clamps the sink block", () => {
    // Stored edge is a→s but flagged reversed ⇒ effective direction s→a, so `a`
    // is the effective pure sink. It must clamp exactly as the forward case.
    const src = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const sink = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", src, "aws.1.s", 200, 60),
      frameCluster("a", sink, "aws.4.a", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "a")]), OPTS);
    const primes = [reversedPrime("a", "s")];
    const rank = rankStub({ s: 0, a: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const out = refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON);
    expect(out.leafBoxes.get("a")!.x).toBe(rank.columnX[1]); // clamped to src+1.
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// NON-UNIFORM COLUMN FIXTURES (a02-xshift-block.md §5, a13-fixture-skeptic.md F4)
// The uniform COL_GAP suite above is VACUOUS for the variable-width bug: under
// uniform columns per-rank snap ≡ single-fixed-ΔX. These fixtures give the block
// a destination band whose cumulative spacing differs from the origin band, the
// growth-path the frozen preset actually exercises, so k>smallest becomes
// reachable exactly where the old translate scattered non-min leaves off-grid.
// ════════════════════════════════════════════════════════════════════════════

// Packed-provider option: bandDepth "root" ⇒ provider/account/… all PACKED, so
// sibling account hulls share a dropY Y-row (banded accounts each own a Y-band
// and can NEVER Y-overlap, making the R2 wall structurally unreachable for a
// whole-account X-move — the honest reason blockClamp's real-preset veto is the
// SCORER, not R2). Only under a packed provider can an occupied destination
// column actually collide, so fixture (ii) needs it.
const OPTS_ROOT_ON: StrataEngineOptions = {
  ...OPTS,
  strataBandDepth: "root",
  strataBlockClamp: true,
};

// ── (i) headline: 3-rank block, non-uniform columns, empty dest ⇒ k=3 on-grid ─

describe("blockClamp non-uniform — per-rank snap reaches k=3 where fixed-ΔX cannot", () => {
  it("lands every leaf of a 3-rank block exactly on columnX[rank−3] and adopts", () => {
    // Account 4 is a pure sink of THREE leaves a@r5, b@r6, c@r7 (one shared
    // subnet). Sole external inbound s→a (s@r1, account 1) ⇒ kMaxRank = 5−1−1 =3.
    // Columns are NON-UNIFORM: destination band (cols 2,3,4) is NARROWER than the
    // origin band (cols 5,6,7), so a rigid-width account hull still contains its
    // snapped leaves (overhang) and R2 stays clean. A single fixed ΔX keyed off
    // blockMinRank (=col2−col5) would carry b to col5+ΔX and c to col6+ΔX — both
    // OFF-grid under non-uniform spacing (asserted below) — which the old on-grid
    // gate rejected. The per-rank snap lands all three exactly.
    const src = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const sink = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", src, "aws.1.s", 150, 60),
      frameCluster("a", sink, "aws.4.a", 150, 60),
      frameCluster("b", sink, "aws.4.b", 150, 60),
      frameCluster("c", sink, "aws.4.c", 150, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "a")]), OPTS);
    const primes = primeEdges([["s", "a"]]);
    // indices:      0    1     2     3      4      5      6      7
    const columnX = [0, 300, 700, 950, 1200, 1900, 2500, 3100];
    const rank = rankStubX({ s: 1, a: 5, b: 6, c: 7 }, columnX);
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    // NON-VACUITY / regression pin: a single fixed ΔX (= col2 − col5) applied to
    // b and c would NOT land them on their true destination columns.
    const fixedDx = columnX[2] - columnX[5];
    expect(a0.leafBoxes.get("b")!.x + fixedDx).not.toBeCloseTo(columnX[3], 1);
    expect(a0.leafBoxes.get("c")!.x + fixedDx).not.toBeCloseTo(columnX[4], 1);

    const beforeScore = scoreStrataPlacementGeometry(a0, model, primes);
    const out = refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON);

    // (a) EVERY block leaf lands EXACTLY on columnX[rank−3] — the assertion the
    //     old single-ΔX path fails for b and c under non-uniform columns.
    expect(out.leafBoxes.get("a")!.x).toBe(columnX[2]);
    expect(out.leafBoxes.get("b")!.x).toBe(columnX[3]);
    expect(out.leafBoxes.get("c")!.x).toBe(columnX[4]);
    // pure X translate — Y untouched for every block leaf.
    expect(out.leafBoxes.get("a")!.y).toBe(a0.leafBoxes.get("a")!.y);
    expect(out.leafBoxes.get("c")!.y).toBe(a0.leafBoxes.get("c")!.y);
    // (b) structurally clean + (c) adopted (shorter chord, no crossing regress).
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);
    const afterScore = scoreStrataPlacementGeometry(out, model, primes);
    expect(afterScore.lengthL1).toBeLessThan(beforeScore.lengthL1);
    expect(afterScore.crossings).toBeLessThanOrEqual(beforeScore.crossings);
    expect(afterScore.penetrations).toBeLessThanOrEqual(
      beforeScore.penetrations,
    );
    expect(out).not.toBe(a0); // a real adoption, not a no-op.
  });
});

// ── (ii) occupied destination (packed provider) ⇒ R2 vetoes ⇒ honest no-op ────

describe("blockClamp non-uniform — occupied destination column is R2-vetoed", () => {
  it("no-ops (byte-identical) when the sole feasible snap lands on an occupied column", () => {
    // Packed provider (bandDepth root) ⇒ account hulls are placed by dropY, so
    // when their padded hulls are X-disjoint they share ONE Y-row. Columns are
    // spaced wide enough (>~290, the padded account-hull width) that s@col2,
    // o@col3, a@col4 all land on row 0 (same Y). Account 4 (a@r4) is a pure sink
    // of s→a (s@r2, account 1); kMaxRank = 4−2−1 = 1, so the ONLY candidate is
    // k=1 landing a on col3 — exactly where account 3's isolated leaf `o` already
    // sits, in the SAME row ⇒ the snapped subtree X/Y-overlaps `o`,
    // nonAncestorOverlaps>0, gate (c) vetoes, and — no smaller k exists — the pass
    // is a genuine no-op (referential identity). This is the honest R2 wall (and
    // proves a whole-account X-move CAN be R2-vetoed only when accounts co-habit a
    // packed row; under the default banded provider each account owns its Y-band).
    const acc1 = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const acc3 = placement("aws", "3", "us-east-1", "vpc-3", "subM");
    const acc4 = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", acc1, "aws.1.s", 150, 60),
      frameCluster("o", acc3, "aws.3.o", 150, 60),
      frameCluster("a", acc4, "aws.4.a", 150, 60),
    ];
    // Model built with the PACKED-provider option so its accounts share dropY rows
    // (the model's resolved policy — not placeStrataHulls — decides banded/packed).
    const model = buildStrataModel(
      prep(clusters, [edge("s", "a")]),
      OPTS_ROOT_ON,
    );
    const primes = primeEdges([["s", "a"]]);
    // indices:      0    1      2      3      4     (spacing 400 > padded hull ~374)
    const columnX = [0, 400, 800, 1200, 1600];
    const rank = rankStubX({ s: 2, o: 3, a: 4 }, columnX);
    const a0 = placeStrataHulls(model, primes, rank, OPTS_ROOT_ON);

    // sanity: `o` sits on col3 = a's sole destination column (the collision).
    expect(a0.leafBoxes.get("o")!.x).toBe(columnX[3]);

    const out = refineStrataBlockClamp(a0, model, primes, rank, OPTS_ROOT_ON);
    expect(out).toBe(a0); // R2 veto on the only k ⇒ referential identity.
  });
});

// ── (iii) perturbed input under non-uniform columns ⇒ skip ────────────────────

describe("blockClamp non-uniform — a leaf nudged off its column skips the block", () => {
  it("returns referential identity when an upstream pass moved a block leaf off-grid", () => {
    const src = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const sink = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", src, "aws.1.s", 150, 60),
      frameCluster("a", sink, "aws.4.a", 150, 60),
      frameCluster("b", sink, "aws.4.b", 150, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "a")]), OPTS);
    const primes = primeEdges([["s", "a"]]);
    const columnX = [0, 300, 700, 950, 1200, 1900, 2500];
    const rank = rankStubX({ s: 1, a: 5, b: 6 }, columnX);
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    // sanity: the UN-perturbed non-uniform block WOULD move (isolates the gate).
    expect(refineStrataBlockClamp(a0, model, primes, rank, OPTS_ON)).not.toBe(
      a0,
    );

    // nudge leaf `b` +9px off its (non-uniform) grid column, rank unchanged.
    const bBox = a0.leafBoxes.get("b")!;
    const leafBoxes = new Map(a0.leafBoxes);
    leafBoxes.set("b", { ...bBox, x: bBox.x + 9 });
    const perturbed: StrataPlacementResult = {
      boxedHulls: a0.boxedHulls,
      leafBoxes,
    };
    expect(
      refineStrataBlockClamp(perturbed, model, primes, rank, OPTS_ON),
    ).toBe(perturbed);
  });
});

// ── (iv) toggle-off byte-identity under non-uniform columns ───────────────────

describe("blockClamp non-uniform — flag off is byte-identical", () => {
  it("returns the input placement by reference on a non-uniform block when the flag is off", () => {
    const src = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const sink = placement("aws", "4", "us-east-1", "vpc-4", "subZ");
    const clusters = [
      frameCluster("s", src, "aws.1.s", 150, 60),
      frameCluster("a", sink, "aws.4.a", 150, 60),
      frameCluster("b", sink, "aws.4.b", 150, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "a")]), OPTS);
    const primes = primeEdges([["s", "a"]]);
    const columnX = [0, 300, 700, 950, 1200, 1900, 2500];
    const rank = rankStubX({ s: 1, a: 5, b: 6 }, columnX);
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    expect(refineStrataBlockClamp(a0, model, primes, rank, OPTS)).toBe(a0);
  });
});
