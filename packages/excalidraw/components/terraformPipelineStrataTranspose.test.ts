/**
 * Strata P2 within-column transpose (`strataTranspose`, default off) — unit tests.
 *
 * Mirrors the synthetic-fixture toolkit of terraformPipelineStrataSinkPullIn.test.ts
 * (placement/frameCluster/edge/prep/rankStub/primeEdges over the real A0
 * `placeStrataHulls`). The transpose operator is the COMPLEMENT of the
 * vertical-relocate: it swaps Y-adjacent X-column-OVERLAPPING sibling pairs, so
 * the driving fixture is two same-rank leaves stacked in one column whose edges
 * cross their sources' order. Covers:
 *   (a) flag-off referential identity (byte-identical proof)
 *   (b) crossing-reduction adoption: an inverted aligned column is transposed so
 *       real crossings strictly drop and the structure stays clean
 *   (c) ENVELOPE PRESERVATION: the column group's min-top / max-bottom and every
 *       hull box height are byte-identical before/after (no P5 perturbation)
 *   (d) already-optimal ⇒ a crossing-RAISING swap is rejected (hard cap) ⇒ the
 *       input placement is returned by reference
 *   (e) PURITY: the input leafBoxes/boxedHulls maps are unchanged after the call
 *   (f) DETERMINISM: two runs produce identical geometry
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataTranspose.test.ts
 */
import { describe, expect, it } from "vitest";

import { buildStrataModel } from "./terraformPipelineStrataModel";
import {
  checkStrataStructure,
  placeStrataHulls,
} from "./terraformPipelineStrataPlacement";
import { transposeStrataColumns } from "./terraformPipelineStrataTranspose";
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
const OPTS_ON: StrataEngineOptions = { ...OPTS, strataTranspose: true };

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

const R2_CLEAN = {
  nonAncestorOverlaps: 0,
  titleCollisions: 0,
  contiguityViolations: 0,
};

/** Total hull-box height signature over all hulls (envelope-preservation proof). */
function hullHeights(p: StrataPlacementResult): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, bh] of p.boxedHulls) {
    out.set(id, bh.box.height);
  }
  return out;
}

/** Deep snapshot of every leaf box (purity proof). */
function leafSnapshot(p: StrataPlacementResult): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, b] of p.leafBoxes) {
    out.set(id, `${b.x},${b.y},${b.width},${b.height}`);
  }
  return out;
}

/**
 * Build the P2 driving fixture: one packed subnet with two same-rank source
 * leaves stacked in column 0 and two same-rank param leaves stacked in column 1,
 * wired s1→p2 / s2→p1 so the initial stacked order crosses. Transposing either
 * column removes the crossing.
 */
function invertedColumnFixture() {
  const p = placement("aws", "1", "us-east-1", "vpc-1", "subA");
  const clusters = [
    frameCluster("s1", p, "aws.s1", 200, 60),
    frameCluster("s2", p, "aws.s2", 200, 60),
    frameCluster("p1", p, "aws.p1", 200, 60),
    frameCluster("p2", p, "aws.p2", 200, 60),
  ];
  const model = buildStrataModel(
    prep(clusters, [edge("s1", "p2"), edge("s2", "p1")]),
    OPTS,
  );
  const primes = primeEdges([
    ["s1", "p2"],
    ["s2", "p1"],
  ]);
  const rank = rankStub({ s1: 0, s2: 0, p1: 1, p2: 1 });
  const a0 = placeStrataHulls(model, primes, rank, OPTS);
  return { model, primes, rank, a0 };
}

// ── (a) flag-off referential identity ─────────────────────────────────────────

describe("transpose flag-off — byte-identical", () => {
  it("returns the input placement by reference when the flag is absent/false", () => {
    const { model, primes, rank, a0 } = invertedColumnFixture();
    // absent flag
    expect(transposeStrataColumns(a0, model, primes, rank, OPTS)).toBe(a0);
    // explicit false
    expect(
      transposeStrataColumns(a0, model, primes, rank, {
        ...OPTS,
        strataTranspose: false,
      }),
    ).toBe(a0);
  });
});

// ── (b) crossing-reduction adoption ───────────────────────────────────────────

describe("transpose adoption — an inverted aligned column is untangled", () => {
  it("strictly reduces real crossings and keeps the structure clean", () => {
    const { model, primes, rank, a0 } = invertedColumnFixture();
    const before = scoreStrataPlacementGeometry(a0, model, primes);
    // sanity: the fixture really starts crossed (otherwise the test is vacuous).
    expect(before.crossings).toBeGreaterThan(0);

    const out = transposeStrataColumns(a0, model, primes, rank, OPTS_ON);
    expect(out).not.toBe(a0); // something was adopted.

    const after = scoreStrataPlacementGeometry(out, model, primes);
    expect(after.crossings).toBeLessThan(before.crossings);
    // real geometry never regresses on length or penetrations either.
    expect(after.lengthL1).toBeLessThanOrEqual(before.lengthL1);
    expect(after.penetrations).toBeLessThanOrEqual(before.penetrations);
    // structural invariant holds after the swap.
    expect(checkStrataStructure(out, model)).toEqual(R2_CLEAN);
    // X is never touched (Y-order-only operator): the column X-set is unchanged.
    const xsBefore = [...a0.leafBoxes.values()].map((b) => b.x).sort();
    const xsAfter = [...out.leafBoxes.values()].map((b) => b.x).sort();
    expect(xsAfter).toEqual(xsBefore);
  });
});

// ── (c) envelope preservation + height invariance ─────────────────────────────

describe("transpose envelope — group span + hull heights invariant", () => {
  it("keeps every column group's min-top/max-bottom and hull box heights byte-identical", () => {
    const { model, primes, rank, a0 } = invertedColumnFixture();

    // The two param leaves form the transposable column (same X). Their union
    // span [min top, max bottom] must be identical before and after the swap.
    const spanOf = (p: StrataPlacementResult, ids: string[]) => {
      const tops = ids.map((id) => p.leafBoxes.get(id)!.y);
      const bottoms = ids.map(
        (id) => p.leafBoxes.get(id)!.y + p.leafBoxes.get(id)!.height,
      );
      return [Math.min(...tops), Math.max(...bottoms)];
    };

    const paramSpanBefore = spanOf(a0, ["p1", "p2"]);
    const sourceSpanBefore = spanOf(a0, ["s1", "s2"]);
    const heightsBefore = hullHeights(a0);

    const out = transposeStrataColumns(a0, model, primes, rank, OPTS_ON);

    expect(spanOf(out, ["p1", "p2"])).toEqual(paramSpanBefore);
    expect(spanOf(out, ["s1", "s2"])).toEqual(sourceSpanBefore);
    // no hull box grew or shrank — the packed-height gate cannot be perturbed.
    expect(hullHeights(out)).toEqual(heightsBefore);
  });
});

// ── (d) already-optimal ⇒ crossing-raising swap rejected (hard cap) ────────────

describe("transpose hard cap — a crossing-raising swap is never adopted", () => {
  it("returns the input by reference when the column is already untangled", () => {
    // Same aligned columns but wired s1→p1 / s2→p2 (parallel, uncrossed). Any
    // adjacent swap would CREATE a crossing, so the ε=0 hard cap
    // (candidate.crossings <= baseline.crossings + 0) rejects every candidate.
    const p = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const clusters = [
      frameCluster("s1", p, "aws.s1", 200, 60),
      frameCluster("s2", p, "aws.s2", 200, 60),
      frameCluster("p1", p, "aws.p1", 200, 60),
      frameCluster("p2", p, "aws.p2", 200, 60),
    ];
    const model = buildStrataModel(
      prep(clusters, [edge("s1", "p1"), edge("s2", "p2")]),
      OPTS,
    );
    const primes = primeEdges([
      ["s1", "p1"],
      ["s2", "p2"],
    ]);
    const rank = rankStub({ s1: 0, s2: 0, p1: 1, p2: 1 });
    const a0 = placeStrataHulls(model, primes, rank, OPTS);

    const before = scoreStrataPlacementGeometry(a0, model, primes);
    expect(before.crossings).toBe(0); // sanity: already untangled.

    const out = transposeStrataColumns(a0, model, primes, rank, OPTS_ON);
    // nothing beats baseline within the cap ⇒ referential identity.
    expect(out).toBe(a0);
  });
});

// ── (e) purity ────────────────────────────────────────────────────────────────

describe("transpose purity — input maps never mutated", () => {
  it("leaves the input leafBoxes/boxedHulls byte-identical after the call", () => {
    const { model, primes, rank, a0 } = invertedColumnFixture();
    const leavesBefore = leafSnapshot(a0);
    const heightsBefore = hullHeights(a0);

    const out = transposeStrataColumns(a0, model, primes, rank, OPTS_ON);
    expect(out).not.toBe(a0); // proves the operator actually ran.

    // the INPUT placement is unchanged (fresh maps were produced for the output).
    expect(leafSnapshot(a0)).toEqual(leavesBefore);
    expect(hullHeights(a0)).toEqual(heightsBefore);
  });
});

// ── (f) determinism ───────────────────────────────────────────────────────────

describe("transpose determinism — repeated runs are identical", () => {
  it("produces byte-identical geometry across two independent runs", () => {
    const runOne = invertedColumnFixture();
    const runTwo = invertedColumnFixture();
    const outA = transposeStrataColumns(
      runOne.a0,
      runOne.model,
      runOne.primes,
      runOne.rank,
      OPTS_ON,
    );
    const outB = transposeStrataColumns(
      runTwo.a0,
      runTwo.model,
      runTwo.primes,
      runTwo.rank,
      OPTS_ON,
    );
    expect(leafSnapshot(outA)).toEqual(leafSnapshot(outB));
  });
});
