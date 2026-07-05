/**
 * Unit tests for Strata A0 compound placement @ K=0 + R2 structural checks
 * (WP-2b; spec rcll-v2-spec-v2 §6-A0 + v3.1). Mandatory fixtures:
 *   - constants drift guard: FRAME_PAD=28, LANE_GAP_Y=96, TITLE_RESERVE=56,
 *     COLUMN_GAP=150 (v3.1-frozen)
 *   - banded-hull sanity / ≥2-provider root: providers stacked at root (banded)
 *   - multi-column unit: a subnet hull spanning ≥3 columns is ONE parent unit
 *   - packed skyline: column-sharing sibling hulls stack, overlap-free
 *   - full-mode leaf footprint: a frame with a nonzero local offset & dims larger
 *     than build.width/height reserves the TRUE frame rect (D10 #5)
 *   - R2 all-zero on a rich multi-hull synthetic prep
 *
 * Rank + E′ are the A1/A3 outputs owned by WP-2a; here they are trivial stubs
 * (longest-path-style rank map, all edges forward/unreversed). Wiring the real
 * presets through checkStrataStructure lands once WP-2a's modules exist.
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataPlacement.test.ts
 */
import { describe, expect, it } from "vitest";

import {
  PIPELINE_COLUMN_GAP,
  PIPELINE_FRAME_PAD,
  PIPELINE_LANE_GAP_Y,
} from "./terraformPipelineLayoutShared";
import { buildStrataModel } from "./terraformPipelineStrataModel";
import {
  checkStrataStructure,
  placeStrataHulls,
} from "./terraformPipelineStrataPlacement";
import { topologyRoleAndKeyFromPath } from "./terraformPipelineTopologyFrames";

import type {
  CollapsedPipelineEdge,
  PipelineCluster,
  PipelineLayoutPrep,
  PipelinePlacement,
} from "./terraformPipelineLayoutShared";
import type {
  StrataEngineOptions,
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

const COL_GAP = 600; // > any leaf width below ⇒ columns never collide

function placement(
  providerFamily: string,
  accountId: string,
  region: string,
  vpcId: string | null = null,
  subnetSignature?: string,
): PipelinePlacement {
  return { providerFamily, accountId, region, vpcId, subnetSignature };
}

/** A cluster whose built skeleton carries a real frame rect (for A0 geometry). */
function frameCluster(
  id: string,
  p: PipelinePlacement,
  primaryAddress: string,
  frameW: number,
  frameH: number,
  frameOffset: { x: number; y: number } = { x: 0, y: 0 },
  buildDims?: { w: number; h: number },
): PipelineCluster {
  const frameId = `${id}:frame`;
  const build = {
    skeleton: [
      {
        type: "frame",
        id: frameId,
        x: frameOffset.x,
        y: frameOffset.y,
        width: frameW,
        height: frameH,
      },
    ],
    width: buildDims?.w ?? frameW,
    height: buildDims?.h ?? frameH,
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

/** Trivial A1 stub: explicit rank map + a wide, non-colliding columnX grid. */
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

/** Trivial A3 stub: every collapsed edge forward (unreversed). */
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

const keyOf = (...path: string[]): string =>
  topologyRoleAndKeyFromPath(path)!.key;

// ── constants drift guard ─────────────────────────────────────────────────────

describe("Strata geometry constants (v3.1-frozen)", () => {
  it("matches the as-built values 28 / 96 / 56 / 150", () => {
    expect(PIPELINE_FRAME_PAD).toBe(28);
    expect(PIPELINE_LANE_GAP_Y).toBe(96);
    expect(PIPELINE_FRAME_PAD * 2).toBe(56); // HULL_TITLE_BAND / TITLE_RESERVE
    expect(PIPELINE_COLUMN_GAP).toBe(150);
  });
});

// ── banded-hull sanity / ≥2-provider root ─────────────────────────────────────

describe("placeStrataHulls — banded root (≥2 providers)", () => {
  it("stacks providers vertically at the banded root, in content order, no overlap", () => {
    const clusters = [
      frameCluster(
        "g",
        placement("gcp", "9", "us-c1", "vpc-9", "z"),
        "gcp.g",
        200,
        100,
      ),
      frameCluster(
        "a",
        placement("aws", "1", "us-east-1", "vpc-1", "a"),
        "aws.a",
        200,
        100,
      ),
    ];
    const model = buildStrataModel(prep(clusters), OPTS);
    const placement2 = placeStrataHulls(
      model,
      primeEdges([]),
      rankStub({ a: 0, g: 0 }),
      OPTS,
    );

    expect(model.hullRoot.policy).toBe("banded");
    const rootBox = placement2.boxedHulls.get(model.hullRoot.id)!;
    expect(rootBox.placed).toHaveLength(2); // two provider bands

    const aws = placement2.boxedHulls.get("aws")!;
    const gcp = placement2.boxedHulls.get("gcp")!;
    // aws.a < gcp.g by address ⇒ aws band is above (smaller y), disjoint in Y.
    expect(aws.box.y).toBeLessThan(gcp.box.y);
    expect(aws.box.y + aws.box.height).toBeLessThanOrEqual(gcp.box.y);

    expect(checkStrataStructure(placement2, model)).toEqual({
      nonAncestorOverlaps: 0,
      titleCollisions: 0,
      contiguityViolations: 0,
    });
  });
});

// ── multi-column unit ─────────────────────────────────────────────────────────

describe("placeStrataHulls — multi-column unit", () => {
  it("gives a subnet hull spanning ≥3 columns exactly ONE position in its parent", () => {
    const p = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const clusters = [
      frameCluster("l0", p, "aws.l0", 200, 80),
      frameCluster("l1", p, "aws.l1", 200, 80),
      frameCluster("l2", p, "aws.l2", 200, 80),
    ];
    const model = buildStrataModel(prep(clusters), OPTS);
    const placed = placeStrataHulls(
      model,
      primeEdges([]),
      rankStub({ l0: 0, l1: 1, l2: 2 }),
      OPTS,
    );

    const vpcId = keyOf("aws", "1", "us-east-1", "vpc-1");
    const subnetId = keyOf("aws", "1", "us-east-1", "vpc-1", "subA");
    const vpc = placed.boxedHulls.get(vpcId)!;
    // The vpc sees the subnet as ONE unit, even though it spans 3 columns.
    expect(vpc.placed).toHaveLength(1);
    expect(vpc.placed[0]!.unit).toEqual({ kind: "hull", hullId: subnetId });
    expect(vpc.placed[0]!.colSpan).toEqual([0, 2]);

    // The subnet itself holds all three leaves.
    expect(placed.boxedHulls.get(subnetId)!.placed).toHaveLength(3);
    expect(checkStrataStructure(placed, model).nonAncestorOverlaps).toBe(0);
  });
});

// ── packed skyline ────────────────────────────────────────────────────────────

describe("placeStrataHulls — packed skyline", () => {
  it("stacks column-sharing sibling vpcs (overlap-free) under a packed region", () => {
    // Two vpcs, each a single leaf in column 0 ⇒ x-extents overlap ⇒ they stack.
    const clusters = [
      frameCluster(
        "v1",
        placement("aws", "1", "us-east-1", "vpc-1", "s1"),
        "aws.v1",
        200,
        120,
      ),
      frameCluster(
        "v2",
        placement("aws", "1", "us-east-1", "vpc-2", "s2"),
        "aws.v2",
        200,
        120,
      ),
    ];
    const model = buildStrataModel(prep(clusters), OPTS);
    const placed = placeStrataHulls(
      model,
      primeEdges([]),
      rankStub({ v1: 0, v2: 0 }),
      OPTS,
    );

    const regionId = keyOf("aws", "1", "us-east-1");
    const region = placed.boxedHulls.get(regionId)!;
    expect(region.hull.policy).toBe("packed");
    expect(region.placed).toHaveLength(2);
    const [u0, u1] = region.placed;
    // same column ⇒ vertically separated (skyline drop, monotone).
    expect(u0!.box.y + u0!.box.height).toBeLessThanOrEqual(u1!.box.y);

    expect(checkStrataStructure(placed, model)).toEqual({
      nonAncestorOverlaps: 0,
      titleCollisions: 0,
      contiguityViolations: 0,
    });
  });
});

// ── full-mode leaf footprint (D10 #5) ─────────────────────────────────────────

describe("placeStrataHulls — full-mode leaf footprint", () => {
  it("reserves the TRUE frame rect (not build.width/height) for an offset frame", () => {
    // frame 300×250 at local (20,-30); build reports a smaller 200×100 skeleton.
    const c = frameCluster(
      "f",
      placement("aws", "1", "us-east-1", "vpc-1", "subA"),
      "aws.f",
      300,
      250,
      { x: 20, y: -30 },
      { w: 200, h: 100 },
    );
    const model = buildStrataModel(prep([c]), OPTS);
    const placed = placeStrataHulls(
      model,
      primeEdges([]),
      rankStub({ f: 0 }),
      OPTS,
    );

    const leafBox = placed.leafBoxes.get("f")!;
    // TRUE frame dims (300×250), not the 200×100 build skeleton box.
    expect(leafBox.width).toBe(300);
    expect(leafBox.height).toBe(250);

    // the enclosing subnet hull reserves that height (frame-pad + title + 250).
    const subnetId = keyOf("aws", "1", "us-east-1", "vpc-1", "subA");
    expect(placed.boxedHulls.get(subnetId)!.box.height).toBeGreaterThanOrEqual(
      250,
    );
    expect(checkStrataStructure(placed, model).nonAncestorOverlaps).toBe(0);
  });
});

// ── R2 all-zero on a rich synthetic prep ──────────────────────────────────────

describe("placeStrataHulls — R2 on a rich multi-hull prep", () => {
  it("emits zero non-ancestor overlaps, title collisions, and contiguity violations", () => {
    const clusters = [
      // aws / 111 / us-east-1 / vpc-1
      frameCluster(
        "a1",
        placement("aws", "111", "us-east-1", "vpc-1", "subA"),
        "aws.a1",
        220,
        90,
      ),
      frameCluster(
        "a2",
        placement("aws", "111", "us-east-1", "vpc-1", "subA"),
        "aws.a2",
        220,
        90,
      ),
      frameCluster(
        "b1",
        placement("aws", "111", "us-east-1", "vpc-1", "subB"),
        "aws.b1",
        220,
        90,
      ),
      // aws / 111 / us-west-2 / vpc-2
      frameCluster(
        "c1",
        placement("aws", "111", "us-west-2", "vpc-2", "subC"),
        "aws.c1",
        220,
        140,
      ),
      // aws / 222 / eu-west-1 / vpc-3
      frameCluster(
        "d1",
        placement("aws", "222", "eu-west-1", "vpc-3", "subD"),
        "aws.d1",
        220,
        90,
      ),
      // gcp / 333 / us-central1 / vpc-4
      frameCluster(
        "e1",
        placement("gcp", "333", "us-central1", "vpc-4", "subE"),
        "gcp.e1",
        220,
        110,
      ),
    ];
    const ranks = { a1: 0, a2: 1, b1: 1, c1: 2, d1: 0, e1: 0 };
    const model = buildStrataModel(
      prep(clusters, [
        edge("a1", "a2"),
        edge("a2", "b1"),
        edge("b1", "c1"),
        edge("d1", "c1"),
        edge("e1", "a1"),
      ]),
      OPTS,
    );
    const placed = placeStrataHulls(
      model,
      primeEdges([
        ["a1", "a2"],
        ["a2", "b1"],
        ["b1", "c1"],
        ["d1", "c1"],
        ["e1", "a1"],
      ]),
      rankStub(ranks),
      OPTS,
    );

    expect(placed.leafBoxes.size).toBe(6);
    expect(checkStrataStructure(placed, model)).toEqual({
      nonAncestorOverlaps: 0,
      titleCollisions: 0,
      contiguityViolations: 0,
    });
  });
});
