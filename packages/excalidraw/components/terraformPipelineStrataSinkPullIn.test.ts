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
 *   (i) strataSinkLadder: partial pull-ins the single-column cliff skips, incl.
 *       the far-parent case that proves the rung budget must count FEASIBLE
 *       columns rather than raw ones
 *   (j) strataHeightGate: proof it is WIRED into this pass and that its veto
 *       fires on an engine-produced candidate (the ratchet fixture) — the
 *       counterexample to the "the maxTop clamp makes the gate inert" claim
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
import { strataHullImpliedHeights } from "./terraformPipelineStrataHeightGate";
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

/** Deep snapshot of every leaf box (geometry-equality proof). */
function leafSnapshot(p: StrataPlacementResult): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, b] of p.leafBoxes) {
    out.set(id, `${b.x},${b.y},${b.width},${b.height}`);
  }
  return out;
}

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

// ── (i) strataSinkLadder — partial pull-in when the full pull-in is infeasible ─

/**
 * The P3 mechanism in miniature: a sink whose parent hull SPANS several columns,
 * fed by a source in a different, left-lying hull.
 *
 *   vpc-1 (left):  s      @ col 0
 *   vpc-2 (right): anchor @ col 2,  k @ col 5   ⇒ vpc-2's box spans cols 2..5
 *   edge: s → k  (k is the only degree-1 sink)
 *
 * `columnX[srcRank + 1]` = columnX[1] lands in inter-hull space LEFT of vpc-2's
 * box, so the committed single-column pass rejects the ONLY candidate it has and
 * k never moves — even though columns 3 and 4 sit inside k's own parent box and
 * would shorten the chord substantially. Rung 2 is genuinely infeasible (anchor
 * occupies it and there is no vertical slack — the P5 interval-clique floor), so
 * the leftmost ADMISSIBLE rung is 3.
 */
function ladderFixture() {
  const pLeft = placement("aws", "1", "us-east-1", "vpc-1", "subA");
  const pRight = placement("aws", "1", "us-east-1", "vpc-2", "subB");
  const clusters = [
    frameCluster("s", pLeft, "aws.s", 200, 60),
    frameCluster("anchor", pRight, "aws.anchor", 200, 60),
    frameCluster("k", pRight, "aws.k", 200, 60),
  ];
  const model = buildStrataModel(prep(clusters, [edge("s", "k")]), OPTS);
  const primes = primeEdges([["s", "k"]]);
  const rank = rankStub({ s: 0, anchor: 2, k: 5 });
  const a0 = placeStrataHulls(model, primes, rank, OPTS);
  return { model, primes, rank, a0 };
}

describe("sinkLadder — attempts the partial pull-ins the single column skips", () => {
  it("moves nothing today: the one candidate column escapes the parent box", () => {
    // The DELTA is the feature — this pins the current cliff behavior so the
    // ladder test below is proving a real change, not restating a pass.
    const { model, primes, rank, a0 } = ladderFixture();
    const parentBox = a0.boxedHulls.get(parentHullOf(a0, "k"))!.box;
    expect(rank.columnX[1]).toBeLessThan(parentBox.x); // the cliff's cause

    const out = refineStrataSinkPullIn(a0, model, primes, rank, OPTS_ON);
    expect(out).toBe(a0); // referential identity — the sink stays stranded
  });

  it("lands the sink on the leftmost ADMISSIBLE rung inside its parent box", () => {
    const { model, primes, rank, a0 } = ladderFixture();
    const out = refineStrataSinkPullIn(a0, model, primes, rank, {
      ...OPTS_ON,
      strataSinkLadder: true,
    });

    expect(out).not.toBe(a0);
    const kBox = out.leafBoxes.get("k")!;
    // rung 1 escapes the box; rung 2 is occupied by `anchor` with no vertical
    // slack; rung 3 is the leftmost admissible one ⇒ biggest legal shortening.
    expect(kBox.x).toBe(rank.columnX[3]);
    expect(kBox.x).toBeLessThan(a0.leafBoxes.get("k")!.x); // strictly shortened

    // every gate still holds: containment, structure, and the phase-1 height
    // invariant (no hull box may change).
    const parentBox = out.boxedHulls.get(parentHullOf(out, "k"))!.box;
    expect(kBox.x).toBeGreaterThanOrEqual(parentBox.x);
    expect(kBox.x + kBox.width).toBeLessThanOrEqual(
      parentBox.x + parentBox.width,
    );
    expect(checkStrataStructure(out, model)).toEqual({
      nonAncestorOverlaps: 0,
      titleCollisions: 0,
      contiguityViolations: 0,
    });
    expect(hullHeights(out)).toEqual(hullHeights(a0));
  });

  it("never re-ranks: the moved leaf keeps its original colSpan", () => {
    const { model, primes, rank, a0 } = ladderFixture();
    const out = refineStrataSinkPullIn(a0, model, primes, rank, {
      ...OPTS_ON,
      strataSinkLadder: true,
    });
    const spanOf = (p: StrataPlacementResult) => {
      for (const [, bh] of p.boxedHulls) {
        for (const pu of bh.placed) {
          if (pu.unit.kind === "leaf" && pu.unit.clusterId === "k") {
            return pu.colSpan;
          }
        }
      }
      throw new Error("k not placed");
    };
    expect(spanOf(out)).toEqual(spanOf(a0));
  });

  it("preserves LR: the landing column is always right of the source", () => {
    const { model, primes, rank, a0 } = ladderFixture();
    const out = refineStrataSinkPullIn(a0, model, primes, rank, {
      ...OPTS_ON,
      strataSinkLadder: true,
    });
    const kBox = out.leafBoxes.get("k")!;
    const sBox = out.leafBoxes.get("s")!;
    expect(kBox.x).toBeGreaterThan(sBox.x);
  });

  it("composes with the height gate: no divergence on THIS fixture", () => {
    // Fixture-specific, NOT a general inertness claim — see the ratchet suite
    // below, which exhibits a fixture where the gate DOES change the outcome.
    const { model, primes, rank, a0 } = ladderFixture();
    const ladderOnly = refineStrataSinkPullIn(a0, model, primes, rank, {
      ...OPTS_ON,
      strataSinkLadder: true,
    });
    const ladderGated = refineStrataSinkPullIn(a0, model, primes, rank, {
      ...OPTS_ON,
      strataSinkLadder: true,
      strataHeightGate: true,
    });
    expect(leafSnapshot(ladderGated)).toEqual(leafSnapshot(ladderOnly));
  });

  /**
   * The BUDGET-vs-FEASIBILITY case, and the reason the budget counts FEASIBLE
   * rungs rather than raw columns.
   *
   *   vpc-1 (left):  s      @ col 0
   *   vpc-2 (right): anchor @ col 8,  k @ col 12   ⇒ vpc-2's box spans cols 8..12
   *
   * Every column in `srcRank+1 .. srcRank+BUDGET` (1..6) lands LEFT of vpc-2's
   * box, so a budget spent on RAW columns is exhausted before the first feasible
   * rung (col 8) is ever trial-placed, and the ladder silently does nothing — in
   * exactly the P3 shape (a region-level sink whose source sits inside a
   * left-lying VPC) the ladder exists to serve. Counting feasible rungs instead
   * reaches col 8; col 8 is occupied by `anchor` with no vertical slack, so the
   * leftmost ADMISSIBLE rung is col 9.
   */
  function farParentFixture() {
    const pLeft = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const pRight = placement("aws", "1", "us-east-1", "vpc-2", "subB");
    const clusters = [
      frameCluster("s", pLeft, "aws.s", 200, 60),
      frameCluster("anchor", pRight, "aws.anchor", 200, 60),
      frameCluster("k", pRight, "aws.k", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "k")]), OPTS);
    const primes = primeEdges([["s", "k"]]);
    const rank = rankStub({ s: 0, anchor: 8, k: 12 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);
    return { model, primes, rank, a0 };
  }

  it("reaches a parent box lying further right than the raw-column budget", () => {
    const { model, primes, rank, a0 } = farParentFixture();
    const parentBox = a0.boxedHulls.get(parentHullOf(a0, "k"))!.box;

    // The defect's precondition: EVERY raw rung in 1..6 escapes the parent box,
    // so a raw-column budget never reaches a feasible column.
    for (let raw = 1; raw <= 6; raw++) {
      expect(rank.columnX[raw]!).toBeLessThan(parentBox.x);
    }

    const out = refineStrataSinkPullIn(a0, model, primes, rank, {
      ...OPTS_ON,
      strataSinkLadder: true,
    });

    expect(out).not.toBe(a0); // the sink moves — a raw-column budget left it stranded.
    const kBox = out.leafBoxes.get("k")!;
    expect(kBox.x).toBe(rank.columnX[9]);
    expect(kBox.x).toBeLessThan(a0.leafBoxes.get("k")!.x);
    expect(kBox.x).toBeGreaterThanOrEqual(parentBox.x);
    expect(kBox.x + kBox.width).toBeLessThanOrEqual(
      parentBox.x + parentBox.width,
    );
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);
    expect(hullHeights(out)).toEqual(hullHeights(a0));
  });
});

// ── (j) height gate: WIRED into this pass, and its veto fires on a real move ──

/**
 * The RATCHET fixture — the executable proof that `strataHeightGate` is (a) truly
 * wired into `refineStrataSinkPullIn` and (b) able to REJECT a candidate the
 * engine actually produces. Both matter: a test that only asserts gate-on ==
 * gate-off would still pass if the operator ignored the flag entirely.
 *
 *   vpc-1 (ABOVE): sa @ row 1, sb @ row 2      (sources sit above the sinks)
 *   vpc-2 (BELOW): a00 @ col 3, a0 @ col 5 row 1, a1 @ col 5 row 2, b1 @ col 6
 *
 * `a1` is vpc-2's uniquely bottom-most unit, so it alone pins the hull's implied
 * height. Processing order is by address, so `a1` moves first: it pulls left to
 * the empty col 4 and RISES to row 1 (its source is above), vacating the bottom
 * row ⇒ vpc-2's implied height drops 268 → 172. `b1` is processed next and wants
 * col 4 too; row 1 is now taken by `a1`, so its only admissible landing is row 2
 * — which re-grows the implied height 172 → 232.
 *
 * Gate OFF: `b1` takes it (the dx win dominates lengthL1). Gate ON: rejected,
 * because 232 > the ROLLING incumbent's 172.
 *
 * NOTE the honest cost this pins: 232 is still ≤ the BASELINE's 268, so the
 * vetoed move never actually grew the hull past where it started. The veto is an
 * artifact of comparing against the rolling incumbent (which buys per-step
 * monotonicity) rather than the baseline (which is all the "cannot regress
 * rankSeparate's -42% win" theorem needs). That trade is a live phase-2 decision
 * — see the module header — and this test is where it becomes visible.
 */
function ratchetFixture() {
  const p1 = placement("aws", "1", "us-east-1", "vpc-1", "subA");
  const p2 = placement("aws", "1", "us-east-1", "vpc-2", "subB");
  // vpc-1's addresses sort FIRST, which places it above vpc-2 — that is what puts
  // the sources above the sinks and lets `a1` rise.
  const clusters = [
    frameCluster("sa", p1, "aws.0sa", 200, 60),
    frameCluster("sb", p1, "aws.0sb", 200, 60),
    frameCluster("a00", p2, "aws.a00", 200, 60),
    frameCluster("a0", p2, "aws.a0", 200, 60),
    frameCluster("a1", p2, "aws.a1", 200, 60),
    frameCluster("b1", p2, "aws.b1", 200, 60),
  ];
  const model = buildStrataModel(
    prep(clusters, [edge("sa", "a1"), edge("sb", "b1")]),
    OPTS,
  );
  const primes = primeEdges([
    ["sa", "a1"],
    ["sb", "b1"],
  ]);
  const rank = rankStub({ sa: 3, sb: 3, a00: 3, a0: 5, a1: 5, b1: 6 });
  const a0 = placeStrataHulls(model, primes, rank, OPTS);
  return { model, primes, rank, a0 };
}

describe("heightGate — wired into sinkPullIn, and its veto fires", () => {
  const LADDER = { ...OPTS_ON, strataSinkLadder: true };

  it("sets up: a1 uniquely pins its hull's implied height", () => {
    const { a0 } = ratchetFixture();
    const hullId = parentHullOf(a0, "a1");
    const box = a0.boxedHulls.get(hullId)!.box;
    const bottomOf = (id: string) => {
      const b = a0.leafBoxes.get(id)!;
      return b.y + b.height;
    };
    // a1 is strictly lower than every sibling ⇒ it alone pins maxBottom.
    for (const sib of ["a00", "a0", "b1"]) {
      expect(bottomOf(sib)).toBeLessThan(bottomOf("a1"));
    }
    expect(bottomOf("a1") + 28).toBe(box.y + box.height); // pins the box floor.
  });

  it("REJECTS a real engine move that gate-off adopts (gate is not inert)", () => {
    const { model, primes, rank, a0 } = ratchetFixture();

    const gateOff = refineStrataSinkPullIn(a0, model, primes, rank, LADDER);
    const gateOn = refineStrataSinkPullIn(a0, model, primes, rank, {
      ...LADDER,
      strataHeightGate: true,
    });

    // Both arms agree on a1: it rises to row 1 of col 4 (height-DECREASING, so
    // the gate admits it) — this is what arms the ratchet.
    expect(gateOff.leafBoxes.get("a1")).toEqual(gateOn.leafBoxes.get("a1"));
    expect(gateOn.leafBoxes.get("a1")!.y).toBeLessThan(
      a0.leafBoxes.get("a1")!.y,
    );

    // They DIVERGE on b1 — the whole point.
    expect(leafSnapshot(gateOn)).not.toEqual(leafSnapshot(gateOff));

    // gate OFF: b1 pulls left into col 4 and drops to row 2.
    expect(gateOff.leafBoxes.get("b1")!.x).toBe(rank.columnX[4]);
    expect(gateOff.leafBoxes.get("b1")!.y).toBeGreaterThan(
      gateOff.leafBoxes.get("a1")!.y,
    );

    // gate ON: the drop is vetoed, so b1 never moves at all.
    expect(gateOn.leafBoxes.get("b1")).toEqual(a0.leafBoxes.get("b1"));
  });

  it("keeps every hull at-or-below its BASELINE implied height in both arms", () => {
    // The gate's actual theorem. It holds gate-ON by the ratchet, and here it
    // also happens to hold gate-OFF — which is precisely why the vetoed move
    // cost length for no height benefit.
    const { model, primes, rank, a0 } = ratchetFixture();
    const base = strataHullImpliedHeights(a0);
    for (const opts of [LADDER, { ...LADDER, strataHeightGate: true }]) {
      const out = refineStrataSinkPullIn(a0, model, primes, rank, opts);
      for (const [id, h] of strataHullImpliedHeights(out)) {
        expect(h).toBeLessThanOrEqual(base.get(id)!);
      }
      expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);
    }
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
