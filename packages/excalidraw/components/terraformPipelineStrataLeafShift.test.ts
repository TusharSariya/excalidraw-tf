/**
 * Strata A01 leaf X-shift (`strataLeafShift`, default off) — unit tests.
 *
 * Mirrors the shared synthetic-fixture toolkit
 * (placement/frameCluster/edge/prep/rankStub/primeEdges over the real A0
 * `placeStrataHulls`), with the a13 fixture-skeptic amendments: a PARAMETERIZED
 * `rankStub(ranks, colGap)` so cross-rank siblings actually X-overlap (the
 * COL_GAP=600 template renders every skyline-collision / growth / R2 branch
 * VACUOUS), non-vacuity assertions per fixture, and the gap invariant that R2's
 * strict overlap cannot make.
 *
 * Fixtures (a01 §8 A–H + the mandatory right-edge guard, a05 F10):
 *   A  zero-growth win (target column free at the leaf's Y)
 *   B  bounded-growth win (target occupied at top; +136px within the 150 budget)
 *   C  over-budget reject (drop > budget ⇒ byte-identical; larger budget adopts)
 *   D  up-move (leaf low → free upper slot in the target column ⇒ height-neutral)
 *   E  containment cliff: reject-outside-frame then adopt-inside (F3a/F3b)
 *   F  flag-off referential identity
 *   G  multi-source fan-in excluded (degree-1 predicate)
 *   H  transitiveAdopt path adopts the same move
 *   RE right-edge guard: a flush-right region-level loose sink stays put; a
 *      mid-region sink still moves (the guard is specific, not blanket)
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataLeafShift.test.ts
 */
import { describe, expect, it } from "vitest";

import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";

import { refineStrataLeafShift } from "./terraformPipelineStrataLeafShift";
import { buildStrataModel } from "./terraformPipelineStrataModel";
import {
  checkStrataStructure,
  placeStrataHulls,
} from "./terraformPipelineStrataPlacement";
import { scoreStrataPlacementGeometry } from "./terraformPipelineStrataPackedScoring";
import { strataHullImpliedHeights } from "./terraformPipelineStrataHeightGate";
import { strataGapBetween } from "./terraformPipelineStrataSeparation";

import type {
  CollapsedPipelineEdge,
  PipelineCluster,
  PipelineLayoutPrep,
  PipelinePlacement,
} from "./terraformPipelineLayoutShared";
import type {
  StrataBox,
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
const ON: StrataEngineOptions = { ...OPTS, strataLeafShift: true };

// NARROW_GAP with 420-wide leaves ⇒ adjacent-rank leaves X-overlap by 220px (the
// a13 non-vacuity device). Wide fixtures (B/C) force the dropY collision branch.
const NARROW_GAP = 200;

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

function rankStub(
  ranks: Record<string, number>,
  colGap = NARROW_GAP,
): StrataRankResult {
  const maxRank = Math.max(0, ...Object.values(ranks));
  const columnX = Array.from(
    { length: maxRank + 1 },
    (_, i) => 50 + i * colGap,
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

const R2_CLEAN = {
  nonAncestorOverlaps: 0,
  titleCollisions: 0,
  contiguityViolations: 0,
};

const xOverlap = (a: StrataBox, b: StrataBox): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width;

/** The hull whose `placed` holds `leafId`. */
function owningHull(p: StrataPlacementResult, leafId: string): string {
  for (const [hullId, bh] of p.boxedHulls) {
    for (const pu of bh.placed) {
      if (pu.unit.kind === "leaf" && pu.unit.clusterId === leafId) {
        return hullId;
      }
    }
  }
  throw new Error(`no owning hull for ${leafId}`);
}

/**
 * WHOLE-PLACEMENT ancestor-propagation self-consistency (the a01 novel-mechanic
 * kill-test). Two invariants that MUST both hold after a leaf-shift regrows an
 * ancestor chain:
 *
 *  (1) ANCHOR — every hull's stored `box.height` equals its recomputed implied
 *      height (`strataHullImpliedHeights`), so the slack height gate and the scene
 *      build read a self-consistent box.
 *  (2) PROPAGATION — every child-hull unit inside a parent's `placed` list carries
 *      the SAME box height as that child's own `boxedHulls` box. This is exactly
 *      the `translateLeaf` parent-sync: without it a grown child (e.g. a vpc that
 *      grew to hold a dropped leaf) leaves its parent region's placed entry stale,
 *      so the region frame is too short to contain the vpc — a descendant escape
 *      R2 cannot see (ancestor↔descendant overlaps are exempt). Deleting the sync
 *      block passes every OWNER-only height assertion but violates (2) here.
 */
function assertHullPropagationConsistent(p: StrataPlacementResult): void {
  const implied = strataHullImpliedHeights(p);
  for (const [id, bh] of p.boxedHulls) {
    expect(bh.box.height).toBe(implied.get(id)); // (1) anchor.
    for (const pu of bh.placed) {
      if (pu.unit.kind === "hull") {
        const child = p.boxedHulls.get(pu.unit.hullId);
        if (child !== undefined) {
          // (2) FULL-BOX propagation — the parent's placed entry box for the child
          // hull must EQUAL the child's ACTUAL current boxedHulls box on EVERY
          // field (x, y, width, height), not just height. translateLeaf's grow-only
          // refit rewrites the entry's `height`; a full-box compare additionally
          // pins that the placer's stored x/y/width stay coherent across the sync,
          // and it still kills the sync-deletion mutant (which leaves the entry's
          // height stale ⇒ pu.box.height !== child.box.height ⇒ this fails).
          expect(pu.box).toEqual(child.box);
        }
      }
    }
  }
}

// ── A — zero-growth win (target column free at the leaf's Y) ──────────────────

describe("leafShift A — zero-growth win", () => {
  it("moves a degree-1 sink onto columnX[srcRank+1] with Y + height unchanged", () => {
    // Narrow (150px) leaves ⇒ columns X-disjoint ⇒ the target column is FREE at
    // the leaf's Y — the explicit zero-growth case (a01 Fixture A).
    const vpc = placement("aws", "1", "us-east-1", "vpc-1");
    const clusters = [
      frameCluster("s", vpc, "aws.1.s", 150, 100),
      frameCluster("l", vpc, "aws.1.l", 150, 100),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "l")]), OPTS);
    const primes = primeEdges([["s", "l"]]);
    const rank = rankStub({ s: 0, l: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const before = scoreStrataPlacementGeometry(a0, model, primes);
    const lY = a0.leafBoxes.get("l")!.y;
    const ownerId = owningHull(a0, "l");
    const hBefore = a0.boxedHulls.get(ownerId)!.box.height;

    const out = refineStrataLeafShift(a0, model, primes, rank, ON);

    expect(out).not.toBe(a0); // non-vacuity: a move was adopted.
    expect(out.leafBoxes.get("l")!.x).toBe(rank.columnX[1]); // srcRank+1.
    expect(out.leafBoxes.get("l")!.y).toBe(lY); // Y unchanged (free column).
    expect(out.boxedHulls.get(ownerId)!.box.height).toBe(hBefore); // no growth.
    expect(scoreStrataPlacementGeometry(out, model, primes).lengthL1).toBeLessThan(
      before.lengthL1,
    );
    // LR law (a13 helper 4): moved leaf left edge ≥ source right edge.
    expect(out.leafBoxes.get("l")!.x).toBeGreaterThanOrEqual(
      out.leafBoxes.get("s")!.x + out.leafBoxes.get("s")!.width,
    );
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);
  });
});

// ── B — bounded-growth win (occupied target; +136px within the 150 budget) ────

describe("leafShift B — bounded-growth win (C2 analog)", () => {
  it("drops the leaf below an occupant, grows the hull within budget, adopts", () => {
    // 150px S/L; a 100-tall occupant at col1 collides ONLY when L moves there.
    const vpc = placement("aws", "1", "us-east-1", "vpc-1");
    const clusters = [
      frameCluster("s", vpc, "aws.1.s", 150, 100),
      frameCluster("occ", vpc, "aws.1.occ", 150, 100), // isolated ⇒ not a candidate
      frameCluster("l", vpc, "aws.1.l", 150, 100),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "l")]), OPTS);
    const primes = primeEdges([["s", "l"]]);
    const rank = rankStub({ s: 0, occ: 1, l: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const ownerId = owningHull(a0, "l");
    const hBefore = strataHullImpliedHeights(a0).get(ownerId)!;
    const occBox = a0.leafBoxes.get("occ")!;

    const out = refineStrataLeafShift(a0, model, primes, rank, ON);

    expect(out).not.toBe(a0);
    const lOut = out.leafBoxes.get("l")!;
    expect(lOut.x).toBe(rank.columnX[1]); // nearest target — largest win.
    // non-vacuity: the destination was OCCUPIED (occ X-overlaps the moved leaf).
    expect(xOverlap(lOut, occBox)).toBe(true);
    // the leaf DROPPED below the occupant (the collision branch fired).
    expect(lOut.y).toBeGreaterThan(occBox.y + occBox.height - 0.5);
    // GAP INVARIANT (a13 helper 1 — the assertion R2's strict overlap cannot make).
    expect(lOut.y - (occBox.y + occBox.height)).toBeGreaterThanOrEqual(
      strataGapBetween("packed", false, false) - 0.5,
    );
    // bounded growth: hull grew, and its box.height matches the implied height.
    const hAfter = strataHullImpliedHeights(out).get(ownerId)!;
    expect(hAfter).toBeGreaterThan(hBefore);
    expect(hAfter - hBefore).toBeLessThanOrEqual(150);
    expect(out.boxedHulls.get(ownerId)!.box.height).toBe(hAfter); // anchor assert.
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);

    // ANCESTOR-CHAIN PROPAGATION (the a01 novel mechanic — kills the sync-deletion
    // mutant): every hull in the WHOLE placement is self-consistent (box.height ==
    // implied) AND every parent's placed entry for a child hull carries the child's
    // CURRENT box height. The owner (vpc-1) is the only vpc under its region, so
    // when it grew, its parent region MUST have grown in lockstep via the sync.
    assertHullPropagationConsistent(out);
    // non-vacuity: the growth actually propagated OFF the owner — at least one
    // strict ANCESTOR of the owner grew relative to the input (so the parent-sync
    // path is genuinely exercised, not trivially satisfied by an owner-only grow).
    const beforeAll = strataHullImpliedHeights(a0);
    const afterAll = strataHullImpliedHeights(out);
    const grownAncestors = [...afterAll.entries()].filter(
      ([id, h]) => id !== ownerId && h > (beforeAll.get(id) ?? 0),
    );
    expect(grownAncestors.length).toBeGreaterThan(0);
  });
});

// ── C — over-budget reject (byte-identical; a larger budget then adopts) ──────

describe("leafShift C — over-budget reject", () => {
  it("rejects a >budget drop byte-identically, and a larger budget adopts it", () => {
    // A 390-wide, 200-tall occupant at col1 spans cols 1–2 (not col3) and is the
    // hull's tallest box. L (150px tall) is disjoint at col3 originally; dropping
    // it below the occupant adds gap(36)+L.height(150) = 186px of new bottom —
    // over the default 150 budget at every reachable target.
    const vpc = placement("aws", "1", "us-east-1", "vpc-1");
    const clusters = [
      frameCluster("s", vpc, "aws.1.s", 150, 100),
      frameCluster("occ", vpc, "aws.1.occ", 390, 200),
      frameCluster("l", vpc, "aws.1.l", 150, 150),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "l")]), OPTS);
    const primes = primeEdges([["s", "l"]]);
    const rank = rankStub({ s: 0, occ: 1, l: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    // default budget 150 ⇒ both targets over budget ⇒ referential identity.
    expect(refineStrataLeafShift(a0, model, primes, rank, ON)).toBe(a0);

    // non-vacuity: the SAME candidate adopts under a larger budget — proving the
    // reject above was the height budget, not an absent candidate.
    const outBig = refineStrataLeafShift(a0, model, primes, rank, {
      ...ON,
      strataLeafShiftHeightBudgetPx: 400,
    });
    expect(outBig).not.toBe(a0);
    expect(outBig.leafBoxes.get("l")!.x).toBe(rank.columnX[1]);
    expect(checkStrataStructure(outBig, model)).toEqual(R2_CLEAN);
  });
});

// ── D — up-move (leaf low → free upper slot; height-neutral) ──────────────────

describe("leafShift D — up-move into a free upper slot (P3 analog)", () => {
  it("re-drops the leaf HIGHER when its target column top is free", () => {
    // `hi` and `l` share col3 (l stacks below hi). Moving l to a free col1 lands
    // it at the hull top (up-move), decreasing the hull height.
    const vpc = placement("aws", "1", "us-east-1", "vpc-1");
    const clusters = [
      frameCluster("s", vpc, "aws.1.s", 150, 100),
      frameCluster("hi", vpc, "aws.1.hi", 150, 100), // isolated, shares col3
      frameCluster("l", vpc, "aws.1.l", 150, 100),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "l")]), OPTS);
    const primes = primeEdges([["s", "l"]]);
    const rank = rankStub({ s: 0, hi: 3, l: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const lBefore = a0.leafBoxes.get("l")!;
    const hiBox = a0.leafBoxes.get("hi")!;
    // non-vacuity: hi and l X-overlap (same column) and l is BELOW hi originally.
    expect(xOverlap(lBefore, hiBox)).toBe(true);
    expect(lBefore.y).toBeGreaterThan(hiBox.y);
    const ownerId = owningHull(a0, "l");
    const hBefore = strataHullImpliedHeights(a0).get(ownerId)!;

    const out = refineStrataLeafShift(a0, model, primes, rank, ON);

    expect(out).not.toBe(a0);
    const lOut = out.leafBoxes.get("l")!;
    expect(lOut.x).toBe(rank.columnX[1]);
    expect(lOut.y).toBeLessThan(lBefore.y); // moved UP.
    // height-neutral or decreased (never grows on an up-move).
    expect(strataHullImpliedHeights(out).get(ownerId)!).toBeLessThanOrEqual(
      hBefore,
    );
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);
  });
});

// ── E — containment cliff: reject outside the frame, adopt inside (F3a/F3b) ────

describe("leafShift E — X-containment cliff", () => {
  it("keeps the leaf inside its frame (reject-outside), then adopts once interior", () => {
    // REJECT-OUTSIDE (F3a): vpc-l spans cols 2–3 only (leftmost leaf `mid`@rank2),
    // so the nearest target col1 is LEFT of the vpc interior. `s` lives in a
    // DIFFERENT region (banded sibling — no X-interference with vpc-l's packing).
    const srcReg = placement("aws", "1", "us-east-2", "vpc-src");
    const sink = placement("aws", "1", "us-east-1", "vpc-l");
    const cluster = (id: string, p: PipelinePlacement, addr: string) =>
      frameCluster(id, p, addr, 150, 100);
    const rejectClusters = [
      cluster("s", srcReg, "aws.1.s"),
      cluster("mid", sink, "aws.1.mid"),
      cluster("l", sink, "aws.1.l"),
    ];
    const model = buildStrataModel(
      prep(rejectClusters, [edge("s", "l")]),
      OPTS,
    );
    const primes = primeEdges([["s", "l"]]);
    const rank = rankStub({ s: 0, mid: 2, l: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);
    const ownerId = owningHull(a0, "l");
    // non-vacuity: columnX[1] (nearest target) is LEFT of vpc-l's interior.
    const interiorLeft = a0.boxedHulls.get(ownerId)!.box.x + 28;
    expect(rank.columnX[1]).toBeLessThan(interiorLeft);

    const out = refineStrataLeafShift(a0, model, primes, rank, ON);
    // l never escapes left of its frame interior (X-containment held).
    expect(out.leafBoxes.get("l")!.x).toBeGreaterThanOrEqual(interiorLeft);
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);

    // ADOPT-INSIDE (F3b): a single vpc with s@0 + anchor@1 + l@3 (no sibling hull
    // to overlap on growth), so columnX[1] IS interior ⇒ the move MUST be adopted
    // (a silent no-op on a legal win would be a vacuous-operator bug).
    const oneVpc = placement("aws", "1", "us-east-1", "vpc-l");
    const wideClusters = [
      cluster("s2", oneVpc, "aws.1.s2"),
      cluster("anchor", oneVpc, "aws.1.anchor"),
      cluster("l", oneVpc, "aws.1.l"),
    ];
    const model2 = buildStrataModel(
      prep(wideClusters, [edge("s2", "l")]),
      OPTS,
    );
    const primes2 = primeEdges([["s2", "l"]]);
    const rank2 = rankStub({ s2: 0, anchor: 1, l: 3 });
    const b0 = placeStrataHulls(model2, primes2, rank2, OPTS);
    const out2 = refineStrataLeafShift(b0, model2, primes2, rank2, ON);
    expect(out2).not.toBe(b0);
    expect(out2.leafBoxes.get("l")!.x).toBe(rank2.columnX[1]);
    expect(checkStrataStructure(out2, model2)).toEqual(R2_CLEAN);
  });
});

// ── F — flag-off referential identity ─────────────────────────────────────────

describe("leafShift F — flag-off byte-identical", () => {
  it("returns the input by reference when the flag is absent/false", () => {
    const vpc = placement("aws", "1", "us-east-1", "vpc-1");
    const clusters = [
      frameCluster("s", vpc, "aws.1.s", 150, 100),
      frameCluster("l", vpc, "aws.1.l", 150, 100),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "l")]), OPTS);
    const primes = primeEdges([["s", "l"]]);
    const rank = rankStub({ s: 0, l: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    expect(refineStrataLeafShift(a0, model, primes, rank, OPTS)).toBe(a0);
    expect(
      refineStrataLeafShift(a0, model, primes, rank, {
        ...OPTS,
        strataLeafShift: false,
      }),
    ).toBe(a0);
  });
});

// ── G — multi-source fan-in excluded (degree-1 predicate) ─────────────────────

describe("leafShift G — multi-source hub excluded", () => {
  it("never moves a leaf with two inbound sources", () => {
    const vpc = placement("aws", "1", "us-east-1", "vpc-1");
    const clusters = [
      frameCluster("s1", vpc, "aws.1.s1", 150, 100),
      frameCluster("s2", vpc, "aws.1.s2", 150, 100),
      frameCluster("l", vpc, "aws.1.l", 150, 100),
    ];
    const model = buildStrataModel(
      prep(clusters, [edge("s1", "l"), edge("s2", "l")]),
      OPTS,
    );
    const primes = primeEdges([
      ["s1", "l"],
      ["s2", "l"],
    ]);
    const rank = rankStub({ s1: 0, s2: 1, l: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const out = refineStrataLeafShift(a0, model, primes, rank, ON);
    expect(out).toBe(a0); // fan-in hub is not a degree-1 sink ⇒ untouched.
  });
});

// ── H — transitiveAdopt path adopts the same move ─────────────────────────────

describe("leafShift H — transitiveAdopt path", () => {
  it("adopts the bounded-growth move under the strict-total-order key", () => {
    const vpc = placement("aws", "1", "us-east-1", "vpc-1");
    const clusters = [
      frameCluster("s", vpc, "aws.1.s", 150, 100),
      frameCluster("occ", vpc, "aws.1.occ", 150, 100),
      frameCluster("l", vpc, "aws.1.l", 150, 100),
    ];
    const model = buildStrataModel(prep(clusters, [edge("s", "l")]), OPTS);
    const primes = primeEdges([["s", "l"]]);
    const rank = rankStub({ s: 0, occ: 1, l: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const out = refineStrataLeafShift(a0, model, primes, rank, {
      ...ON,
      transitiveAdopt: true,
    });
    expect(out).not.toBe(a0);
    expect(out.leafBoxes.get("l")!.x).toBe(rank.columnX[1]);
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);
  });
});

// ── RE — mandatory right-edge column guard (a05 F10 / e7ae739f0) ──────────────

describe("leafShift RE — right-edge column guard", () => {
  it("keeps a flush-right region-level loose sink put but moves a mid-region one", () => {
    // Region-direct leaves (vpcId=null ⇒ owning hull role "region"). `l` is the
    // rightmost content (flush right, distFromRight < 300) ⇒ GUARDED (the owner's
    // protected column). Assert it stays even with the flag ON.
    const reg = (id: string) => placement("aws", "1", "us-west-2");
    const clustersFlush = [
      frameCluster("s", reg("s"), "aws.1.s", 150, 100),
      frameCluster("l", reg("l"), "aws.1.l", 150, 100),
    ];
    const model = buildStrataModel(
      prep(clustersFlush, [edge("s", "l")]),
      OPTS,
    );
    const primes = primeEdges([["s", "l"]]);
    const rank = rankStub({ s: 0, l: 3 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);
    // non-vacuity: l's owning hull is a REGION and l is flush against its right
    // inset (the cohort the guard protects).
    const ownerId = owningHull(a0, "l");
    expect(a0.boxedHulls.get(ownerId)!.hull.role).toBe("region");
    const lBox = a0.leafBoxes.get("l")!;
    const contentRight =
      a0.boxedHulls.get(ownerId)!.box.x +
      a0.boxedHulls.get(ownerId)!.box.width -
      28;
    expect(contentRight - (lBox.x + lBox.width)).toBeLessThanOrEqual(300);

    const out = refineStrataLeafShift(a0, model, primes, rank, ON);
    expect(out).toBe(a0); // guarded ⇒ referential identity (column preserved).

    // The guard is SPECIFIC, not blanket: a `filler` at rank 5 pushes the region
    // right edge far past `l`, so `l` (distFromRight > 300) is no longer guarded
    // and DOES move — proving the guard keys on the right-edge cohort, not on
    // "region-level" alone.
    const clustersMid = [
      frameCluster("s", reg("s"), "aws.1.s", 150, 100),
      frameCluster("l", reg("l"), "aws.1.l", 150, 100),
      frameCluster("filler", reg("filler"), "aws.1.filler", 150, 100),
    ];
    const model2 = buildStrataModel(
      prep(clustersMid, [edge("s", "l")]),
      OPTS,
    );
    const rank2 = rankStub({ s: 0, l: 3, filler: 5 });
    const b0 = placeStrataHulls(model2, primes, rank2, OPTS);
    const out2 = refineStrataLeafShift(b0, model2, primes, rank2, ON);
    expect(out2).not.toBe(b0);
    expect(out2.leafBoxes.get("l")!.x).toBe(rank2.columnX[1]);
  });

  it("clamps unsafe overrides to the cohort floor — cannot move a region-level sink ~250px from the content edge", () => {
    // The guard is MANDATORY: `strataLeafShiftRightEdgeGuardPx` may only RAISE it,
    // never disable it. A caller passing a value below the historical cohort
    // distance (~250px), a negative, or a NaN would otherwise restore the
    // owner-removed unguarded sink-pull (e7ae739f0). The clamp floors the guard at
    // 250px (finite override) or the 300px default (non-finite override), so the
    // ~250px flush-right cohort stays protected regardless of the override.
    //
    // CRUCIAL non-vacuity (the a05-F10 re-judge fix): the sink here sits ~200px
    // from its region's content edge — INSIDE the ≤250px protected cohort band but
    // comfortably ABOVE the `tiny=100` unsafe override. An UNCLAMPED guard of 100
    // (or 0, or negative) satisfies `distFromRight(200) <= guard` = false ⇒ the
    // sink WOULD move; ONLY the 250 floor keeps it put. (The prior fixture used a
    // FLUSH sink at distFromRight≈0, where even a 1px guard protects it — that
    // proved nothing about the floor VALUE, only that the guard is non-zero.)
    const reg = () => placement("aws", "1", "us-west-2");
    const cohortClusters = [
      frameCluster("s", reg(), "aws.1.s", 150, 100),
      frameCluster("l", reg(), "aws.1.l", 150, 100),
      // A rank-4 filler pushes the region's content right edge ~200px past `l`,
      // seating `l` in the protected cohort band (100 < distFromRight <= 250).
      frameCluster("filler", reg(), "aws.1.filler", 150, 100),
    ];
    const model = buildStrataModel(prep(cohortClusters, [edge("s", "l")]), OPTS);
    const primes = primeEdges([["s", "l"]]);
    const rank = rankStub({ s: 0, l: 3, filler: 4 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);
    const ownerId = owningHull(a0, "l");
    const owner = a0.boxedHulls.get(ownerId)!;
    expect(owner.hull.role).toBe("region");

    // distFromRight computed EXACTLY as the guard does (contentRight is one
    // FRAME_PAD inside the region box). The floor is only load-bearing when this is
    // ABOVE the `tiny=100` unsafe value AND at-or-below the 250 floor — pin that
    // band so the fixture cannot silently regress into a vacuous flush-sink case.
    const lBox = a0.leafBoxes.get("l")!;
    const contentRight = owner.box.x + owner.box.width - PIPELINE_FRAME_PAD;
    const distFromRight = contentRight - (lBox.x + lBox.width);
    expect(distFromRight).toBeGreaterThan(100); // an unclamped tiny=100 would EXPOSE it.
    expect(distFromRight).toBeLessThanOrEqual(250); // the 250 floor still PROTECTS it.

    // Every unsafe override keeps the cohort sink PUT (referential identity): the
    // floor prevented the disable in all four shapes. Without the clamp, each of
    // negative / 0 / tiny=100 would move this distFromRight≈200 sink.
    for (const unsafe of [-1000, 0, 100, Number.NaN]) {
      expect(
        refineStrataLeafShift(a0, model, primes, rank, {
          ...ON,
          strataLeafShiftRightEdgeGuardPx: unsafe,
        }),
      ).toBe(a0);
    }

    // The guard is a real GATE, not a blanket block, and the knob still works in
    // the safe direction: the SAME region-level sink pushed FAR from the right edge
    // (distFromRight > the 300 default) DOES move under the default guard, and a
    // large override re-covers it. This proves the cohort sink above stays put
    // BECAUSE of the floored guard, not because leaf-shift never moves such sinks.
    const farClusters = [
      frameCluster("s", reg(), "aws.1.s", 150, 100),
      frameCluster("l", reg(), "aws.1.l", 150, 100),
      frameCluster("filler", reg(), "aws.1.filler", 150, 100),
    ];
    const model2 = buildStrataModel(prep(farClusters, [edge("s", "l")]), OPTS);
    const rank2 = rankStub({ s: 0, l: 3, filler: 5 }); // filler@5 ⇒ distFromRight≈400
    const b0 = placeStrataHulls(model2, primes, rank2, OPTS);
    // default guard (300) ⇒ `l` (distFromRight≈400 > 300) moves…
    expect(refineStrataLeafShift(b0, model2, primes, rank2, ON)).not.toBe(b0);
    // …a large override raises the guard to cover it ⇒ `l` stays put.
    expect(
      refineStrataLeafShift(b0, model2, primes, rank2, {
        ...ON,
        strataLeafShiftRightEdgeGuardPx: 100000,
      }),
    ).toBe(b0);
  });
});
