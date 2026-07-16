/**
 * Strata P4 pure-sink account block clamp (`strataBlockClamp`, default off) —
 * unit tests.
 *
 * Mirrors the synthetic-fixture toolkit of terraformPipelineStrataSinkPullIn.test.ts
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
    // Happy-path geometry, but simulate `refineStrataSinkPullIn` having nudged
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
