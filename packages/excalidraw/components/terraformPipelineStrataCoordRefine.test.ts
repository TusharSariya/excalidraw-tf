/**
 * Strata A7 coordinate refinement (WP-3b) — spec rcll-v2-spec-v2 §6-A7 +
 * v3.1, with the orchestrator-pinned resolutions P1–P7.
 *
 * Layers:
 *  1. Pure math units — {@link isotonicWithGaps} (PAV projection: order + min-gap
 *     + fixed clamps + empty-feasible reject) and {@link l1Median} (even = mean).
 *  2. {@link refineStrataCoordinates} over placements built by the real A0
 *     ({@link placeStrataHulls}) on synthetic preps: acceptance (strict decrease
 *     moves; non-strict is byte-identical), Jacobi/same-column exclusion (P2),
 *     bottom-up rigidity, cross-hull LCA chords, re-anchor extents + the R2
 *     dev-assert, objective improvement, and run-twice determinism.
 *  3. Full engine on the committed presets: flag OFF ≡ flag-absent (byte-equal),
 *     flag ON succeeds with R2 zero and run-twice-deterministic frame geometry.
 *
 * Hand-derived fixtures use the v3.1-frozen constants FRAME_PAD=28,
 * LANE_GAP_Y=96, CLUSTER_GAP_Y=36, TITLE_RESERVE=56; subnetZone topInset =
 * FRAME_PAD + TITLE_RESERVE = 84 (packed, non-root).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataCoordRefine.test.ts
 */
import { describe, expect, it } from "vitest";

import graphlibDot from "@dagrejs/graphlib-dot";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { buildStrataModel } from "./terraformPipelineStrataModel";
import {
  checkStrataStructure,
  placeStrataHulls,
} from "./terraformPipelineStrataPlacement";
import {
  assertStrataR2,
  isotonicWithGaps,
  l1Median,
  refineStrataCoordinates,
} from "./terraformPipelineStrataCoordRefine";
import { buildTerraformStrataExcalidrawScene } from "./terraformPipelineStrata";
import { topologyRoleAndKeyFromPath } from "./terraformPipelineTopologyFrames";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
} from "./terraformPlanParsing";
import { DECLARED_DATAFLOW_ORDERED_KEY } from "./terraformDeclaredDataFlow";

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
import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";
import type { TerraformPlanNodesMap } from "./terraformPlanParsing";

const OPTS: StrataEngineOptions = {
  compact: true,
  includeAncillary: false,
  networkSimplexRank: false,
  sweeps: 0,
  coordinateRefine: false,
};

const COL_GAP = 600; // > any leaf width below ⇒ columns are X-disjoint

// ── synthetic prep helpers (mirrors terraformPipelineStrataPlacement.test.ts) ──

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

const keyOf = (...path: string[]): string =>
  topologyRoleAndKeyFromPath(path)!.key;

/** Σ over `pairs` of |yCentre(src) − yCentre(tgt)| from a leafBox map. */
function objectiveOf(
  leafBoxes: ReadonlyMap<string, StrataBox>,
  heights: Record<string, number>,
  pairs: [string, string][],
): number {
  const centre = (id: string) => leafBoxes.get(id)!.y + heights[id]! / 2;
  return pairs.reduce((s, [a, b]) => s + Math.abs(centre(a) - centre(b)), 0);
}

/** Deep-equal serialization of a placement (leaf boxes + hull boxes). */
function fingerprint(p: StrataPlacementResult): string {
  const leaves = [...p.leafBoxes.entries()]
    .map(([id, b]) => `L:${id}|${b.x},${b.y},${b.width},${b.height}`)
    .sort();
  const hulls = [...p.boxedHulls.entries()]
    .map(([id, bh]) => {
      const b = bh.box;
      const placed = bh.placed
        .map(
          (pu) =>
            `${pu.unit.kind}:${
              pu.unit.kind === "hull" ? pu.unit.hullId : pu.unit.clusterId
            }@${pu.box.x},${pu.box.y},${pu.box.width},${pu.box.height}`,
        )
        .join(";");
      return `H:${id}|${b.x},${b.y},${b.width},${b.height}|${placed}`;
    })
    .sort();
  return JSON.stringify({ leaves, hulls });
}

// ── 1. isotonicWithGaps (PAV projection) — test 4 ─────────────────────────────

describe("A7 isotonicWithGaps — PAV order/gap/clamp/feasibility", () => {
  it("preserves order + min gap by pooling crossed targets", () => {
    // targets cross (100 then 0); gap 10 forbids equality → pool to the mean.
    const out = isotonicWithGaps([100, 0], [10], [0, 0], [Infinity, Infinity])!;
    expect(out).not.toBeNull();
    // mean of (100, 0) in gap-removed coords = 45 ⇒ [45, 55], gap exactly 10.
    expect(out[0]).toBeCloseTo(45, 9);
    expect(out[1]).toBeCloseTo(55, 9);
    expect(out[1]! - out[0]!).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(out[0]!).toBeLessThanOrEqual(out[1]!);
  });

  it("respects a fixed-neighbour upper clamp", () => {
    // block 0 wants 100 but is capped at 50; block 1 wants 200 (free).
    const out = isotonicWithGaps([100, 200], [10], [0, 0], [50, Infinity])!;
    expect(out[0]).toBeCloseTo(50, 9); // clamped to hi
    expect(out[1]).toBeCloseTo(200, 9);
    expect(out[1]! - out[0]!).toBeGreaterThanOrEqual(10 - 1e-9);
  });

  it("respects a fixed-neighbour lower clamp + topInset floor", () => {
    const out = isotonicWithGaps(
      [-100, 5],
      [10],
      [84, 84],
      [Infinity, Infinity],
    )!;
    expect(out[0]).toBeCloseTo(84, 9); // floored at topInset
    expect(out[1]).toBeCloseTo(94, 9); // 84 + gap 10
  });

  it("returns null when box + monotone constraints are jointly infeasible", () => {
    // block 0 ≥ 100, block 1 ≤ 50, but block 1 ≥ block 0 + 80 ≥ 180 > 50.
    expect(isotonicWithGaps([0, 0], [80], [100, 0], [Infinity, 50])).toBeNull();
  });

  it("is identity on already-feasible monotone targets", () => {
    const out = isotonicWithGaps(
      [84, 200, 400],
      [96, 36],
      [84, 84, 84],
      [Infinity, Infinity, Infinity],
    )!;
    expect(out).toEqual([84, 200, 400]);
  });
});

describe("A7 l1Median — even-count MEAN convention", () => {
  it("odd = middle, even = mean of the two central order statistics", () => {
    expect(l1Median([5, 1, 3])).toBe(3);
    expect(l1Median([1, 2, 3, 4])).toBe(2.5); // (2+3)/2
    expect(l1Median([10, 0])).toBe(5);
    expect(l1Median([])).toBe(0);
  });
});

// ── 2. refinement over real A0 placements ─────────────────────────────────────

/** Fixture B: subnetZone subA with leaves a(200)/b(100)/c(60) at cols 0/1/2,
 * edges a→c and b→c. Hand-derived local tops after A7: a 84, b 109, c 129
 * (a is floor-clamped, b + c align their centres to c's neighbours). */
function fixtureB(): {
  model: ReturnType<typeof buildStrataModel>;
  primes: StrataPrimeEdge[];
  a0: StrataPlacementResult;
  heights: Record<string, number>;
  pairs: [string, string][];
} {
  const p = placement("aws", "1", "us-east-1", "vpc-1", "subA");
  const clusters = [
    frameCluster("a", p, "aws.a", 200, 200),
    frameCluster("b", p, "aws.b", 200, 100),
    frameCluster("c", p, "aws.c", 200, 60),
  ];
  const pairs: [string, string][] = [
    ["a", "c"],
    ["b", "c"],
  ];
  const model = buildStrataModel(
    prep(
      clusters,
      pairs.map(([s, t]) => edge(s, t)),
    ),
    OPTS,
  );
  const primes = primeEdges(pairs);
  const a0 = placeStrataHulls(
    model,
    primes,
    rankStub({ a: 0, b: 1, c: 2 }),
    OPTS,
  );
  return { model, primes, a0, heights: { a: 200, b: 100, c: 60 }, pairs };
}

describe("A7 acceptance — strict-decrease moves, non-strict is byte-identical", () => {
  it("accepts a straightening column: objective drops 90 → 25, blocks move", () => {
    const { model, primes, a0, heights, pairs } = fixtureB();
    const before = objectiveOf(a0.leafBoxes, heights, pairs);
    expect(before).toBe(90);

    const refined = refineStrataCoordinates(a0, model, primes);
    const after = objectiveOf(refined.leafBoxes, heights, pairs);
    expect(after).toBe(25);
    expect(after).toBeLessThan(before);

    // c and b straighten onto their neighbours; a is pinned at the subnet top.
    const bY = refined.leafBoxes.get("b")!.y;
    const cY = refined.leafBoxes.get("c")!.y;
    const aY = refined.leafBoxes.get("a")!.y;
    expect(bY + 100 / 2).toBeCloseTo(cY + 60 / 2, 9); // b, c centres aligned
    expect(aY + 200 / 2 - (cY + 60 / 2)).toBeCloseTo(25, 9);
    // a floor-clamped ⇒ its box is untouched from A0.
    expect(refined.leafBoxes.get("a")).toEqual(a0.leafBoxes.get("a"));
    expect(refined.leafBoxes.get("c")!.y).not.toBe(a0.leafBoxes.get("c")!.y);

    expect(checkStrataStructure(refined, model)).toEqual({
      nonAncestorOverlaps: 0,
      titleCollisions: 0,
      contiguityViolations: 0,
    });
  });

  it("rejects a same-column-only chord: positions byte-identical to A0 (P2)", () => {
    // P and Q in one column, connected P→Q, no other edges. Same-column
    // partners are EXCLUDED from the median (P2) ⇒ both hold ⇒ no strict
    // decrease ⇒ every box byte-identical. A naive Gauss-Seidel that let the
    // same-column neighbour into the median would pull them together (differs).
    const pl = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const clusters = [
      frameCluster("p", pl, "aws.p", 200, 60),
      frameCluster("q", pl, "aws.q", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("p", "q")]), OPTS);
    const primes = primeEdges([["p", "q"]]);
    const a0 = placeStrataHulls(model, primes, rankStub({ p: 0, q: 0 }), OPTS);
    const refined = refineStrataCoordinates(a0, model, primes);
    expect(fingerprint(refined)).toBe(fingerprint(a0));
  });
});

describe("A7 Jacobi batch semantics (P2) — one snapshot, symmetric pooling", () => {
  it("pools two same-column blocks symmetrically (Gauss-Seidel would not)", () => {
    // s (col0, tall ⇒ deep centre) → ma AND s → mb, with ma/mb the two blocks of
    // col1 (no ma↔mb chord). Both targets are s's centre, computed from ONE
    // pre-projection snapshot, so the batch PAV pools them SYMMETRICALLY around
    // s: cₘₐ = cₛ − 48, cₘᵦ = cₛ + 48 (min gap 60+36=96 split evenly). A
    // Gauss-Seidel that moved ma to its target first would land ma EXACTLY on
    // cₛ and push mb to cₛ+96 — a different result. Asserting the symmetric
    // split proves the single-snapshot batch (Jacobi) projection.
    const pl = placement("aws", "1", "us-east-1", "vpc-1", "subA");
    const clusters = [
      frameCluster("s0", pl, "aws.s0", 200, 400), // col0, centre = top+200
      frameCluster("ma", pl, "aws.ma", 200, 60), // col1 top
      frameCluster("mb", pl, "aws.mb", 200, 60), // col1 bottom
    ];
    const pairs: [string, string][] = [
      ["s0", "ma"],
      ["s0", "mb"],
    ];
    const model = buildStrataModel(
      prep(
        clusters,
        pairs.map(([a, b]) => edge(a, b)),
      ),
      OPTS,
    );
    const primes = primeEdges(pairs);
    const a0 = placeStrataHulls(
      model,
      primes,
      rankStub({ s0: 0, ma: 1, mb: 1 }),
      OPTS,
    );
    const refined = refineStrataCoordinates(a0, model, primes);
    const cS = refined.leafBoxes.get("s0")!.y + 400 / 2;
    const cA = refined.leafBoxes.get("ma")!.y + 60 / 2;
    const cB = refined.leafBoxes.get("mb")!.y + 60 / 2;
    // symmetric pool around s: NOT cA === cS (which is the Gauss-Seidel result).
    expect(cA).toBeCloseTo(cS - 48, 6);
    expect(cB).toBeCloseTo(cS + 48, 6);
    expect(cB - cA).toBeCloseTo(96, 6); // exactly the min top-to-top gap
    expect(cA).not.toBeCloseTo(cS, 3);
    expect(checkStrataStructure(refined, model).nonAncestorOverlaps).toBe(0);
  });
});

describe("A7 bottom-up rigidity + cross-hull LCA chords", () => {
  // vpc-1 (packed) with two single-leaf subnet hulls subA{a@col0, tall} and
  // subB{b@col1, short}; edge a→b lifts to H:subA ↔ H:subB at the vpc LCA.
  function twoSubnets() {
    const pa = placement("aws", "1", "us-east-1", "vpc-1", "sA");
    const pb = placement("aws", "1", "us-east-1", "vpc-1", "sB");
    const clusters = [
      frameCluster("a", pa, "aws.a", 200, 200),
      frameCluster("b", pb, "aws.b", 200, 60),
    ];
    const model = buildStrataModel(prep(clusters, [edge("a", "b")]), OPTS);
    const primes = primeEdges([["a", "b"]]);
    const a0 = placeStrataHulls(model, primes, rankStub({ a: 0, b: 1 }), OPTS);
    const subA = keyOf("aws", "1", "us-east-1", "vpc-1", "sA");
    const subB = keyOf("aws", "1", "us-east-1", "vpc-1", "sB");
    return { model, primes, a0, subA, subB };
  }

  it("a cross-hull chord moves the child-hull boxes at their LCA (test 7)", () => {
    const { model, primes, a0, subA, subB } = twoSubnets();
    const centre = (p: StrataPlacementResult, id: string) => {
      const b = p.boxedHulls.get(id)!.box;
      return b.y + b.height / 2;
    };
    const gapBefore = Math.abs(centre(a0, subA) - centre(a0, subB));
    const refined = refineStrataCoordinates(a0, model, primes);
    const gapAfter = Math.abs(centre(refined, subA) - centre(refined, subB));
    // the LCA-level chord pulled subB's box to align its centre with subA's.
    expect(gapBefore).toBeGreaterThan(0);
    expect(gapAfter).toBeLessThan(gapBefore);
    expect(gapAfter).toBeCloseTo(0, 6);
    // subB actually moved (down); subA (taller ⇒ deeper centre) stayed.
    expect(refined.boxedHulls.get(subB)!.box.y).toBeGreaterThan(
      a0.boxedHulls.get(subB)!.box.y,
    );
  });

  it("keeps a child hull's INTERNAL geometry rigid as the LCA moves it (test 6)", () => {
    const { model, primes, a0, subB } = twoSubnets();
    const rel = (p: StrataPlacementResult) =>
      p.leafBoxes.get("b")!.y - p.boxedHulls.get(subB)!.box.y;
    const refined = refineStrataCoordinates(a0, model, primes);
    // leaf b rides subB rigidly: its offset inside subB is unchanged, even
    // though subB's absolute box moved.
    expect(rel(refined)).toBe(rel(a0));
    const dHull =
      refined.boxedHulls.get(subB)!.box.y - a0.boxedHulls.get(subB)!.box.y;
    const dLeaf = refined.leafBoxes.get("b")!.y - a0.leafBoxes.get("b")!.y;
    expect(dLeaf).toBe(dHull);
    expect(dHull).not.toBe(0);
  });
});

describe("A7 re-anchor extents + R2 dev-assert (test 8)", () => {
  it("every hull box equals its blocks' bbox + FRAME_PAD/TITLE_RESERVE pads", () => {
    const { model, primes, a0 } = fixtureB();
    const refined = refineStrataCoordinates(a0, model, primes);
    const FRAME_PAD = 28;
    for (const [hullId, bh] of refined.boxedHulls) {
      if (bh.placed.length === 0) {
        continue;
      }
      const topInset = FRAME_PAD + (bh.hull.role === "root" ? 0 : 56);
      let minX = Infinity;
      let maxX = -Infinity;
      let maxBottom = -Infinity;
      for (const pu of bh.placed) {
        minX = Math.min(minX, pu.box.x);
        maxX = Math.max(maxX, pu.box.x + pu.box.width);
        maxBottom = Math.max(maxBottom, pu.box.y + pu.box.height);
      }
      // X: box hugs the widest block ± FRAME_PAD.
      expect(bh.box.x, `hull ${hullId} x`).toBeCloseTo(minX - FRAME_PAD, 6);
      expect(bh.box.width, `hull ${hullId} width`).toBeCloseTo(
        maxX - minX + 2 * FRAME_PAD,
        6,
      );
      // Y: content top sits topInset below the box top; box bottom = deepest
      // block + FRAME_PAD.
      expect(bh.box.height, `hull ${hullId} height`).toBeCloseTo(
        maxBottom - bh.box.y + FRAME_PAD,
        6,
      );
      expect(
        bh.box.y + topInset,
        `hull ${hullId} content top`,
      ).toBeLessThanOrEqual(
        Math.min(...bh.placed.map((pu) => pu.box.y)) + 1e-6,
      );
    }
  });

  it("assertStrataR2 throws a 'Strata A7'-prefixed error on a violating placement", () => {
    // two leaves in different vpcs (non-ancestor) forced onto the same box.
    const clusters = [
      frameCluster(
        "x",
        placement("aws", "1", "us-east-1", "vpc-1", "sX"),
        "aws.x",
        200,
        80,
      ),
      frameCluster(
        "y",
        placement("aws", "1", "us-east-1", "vpc-2", "sY"),
        "aws.y",
        200,
        80,
      ),
    ];
    const model = buildStrataModel(prep(clusters), OPTS);
    const a0 = placeStrataHulls(
      model,
      primeEdges([]),
      rankStub({ x: 0, y: 0 }),
      OPTS,
    );
    // healthy placement passes.
    expect(() => assertStrataR2(a0, model)).not.toThrow();
    // overlap the two leaf boxes ⇒ nonAncestorOverlaps > 0 ⇒ throw.
    const clash: StrataBox = { x: 999, y: 999, width: 200, height: 80 };
    const broken: StrataPlacementResult = {
      boxedHulls: a0.boxedHulls,
      leafBoxes: new Map([...a0.leafBoxes, ["x", clash], ["y", clash]]),
    };
    expect(() => assertStrataR2(broken, model)).toThrow(/^Strata A7/);
  });
});

describe("A7 determinism (test 10)", () => {
  it("run-twice deep-equal on a synthetic fixture", () => {
    const { model, primes, a0 } = fixtureB();
    const r1 = refineStrataCoordinates(a0, model, primes);
    const r2 = refineStrataCoordinates(a0, model, primes);
    expect(fingerprint(r1)).toBe(fingerprint(r2));
    // A7 does not mutate its input placement.
    expect(fingerprint(a0)).toBe(
      fingerprint(
        placeStrataHulls(model, primes, rankStub({ a: 0, b: 1, c: 2 }), OPTS),
      ),
    );
  });
});

// ── 3. full engine on the committed presets ───────────────────────────────────

const PRESETS = [
  "staging-extended-localstack-v2",
  "staging-localstack",
] as const;

function loadNodes(preset: string): {
  nodes: TerraformPlanNodesMap;
  plan: unknown;
} {
  const raw = getTerraformImportPresetSourcesFromDb(preset);
  const sources = resolveSourcesWithTfdComposition(
    raw! as TerraformImportPresetSources,
  );
  const bundle = sources.planDotBundles[0]!;
  const graph = graphlibDot.read("digraph G {}\n");
  const nodes = buildTerraformLocalImportNodesMap(bundle.plan, graph, [], {});
  applyTfdOverlayToNodes(nodes, sources.tfdTexts, sources.tfdLabels);
  return { nodes, plan: bundle.plan };
}

/** Content-keyed frame geometry (1px tolerance for the shared kernel's sub-pixel
 * label jitter — same helper the scene-build suite uses). */
function frameGeomByKey(
  elements: readonly ExcalidrawElement[],
): Map<string, { x: number; y: number; w: number; h: number }> {
  const out = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const el of elements) {
    if (el.type !== "frame" || el.isDeleted) {
      continue;
    }
    const cd = el.customData as
      | {
          terraformTopologyRole?: string;
          terraformTopologyKey?: string;
          terraformPrimaryAddress?: string;
        }
      | undefined;
    const role = cd?.terraformTopologyRole;
    let key: string | null = null;
    if (role === "primaryCluster" && cd?.terraformPrimaryAddress) {
      key = `C:${cd.terraformPrimaryAddress}`;
    } else if (role && cd?.terraformTopologyKey) {
      key = `H:${cd.terraformTopologyKey}`;
    }
    if (key) {
      out.set(key, { x: el.x, y: el.y, w: el.width, h: el.height });
    }
  }
  return out;
}

function expectFramesDeterministic(
  a: readonly ExcalidrawElement[],
  b: readonly ExcalidrawElement[],
): void {
  const ma = frameGeomByKey(a);
  const mb = frameGeomByKey(b);
  expect([...ma.keys()].sort()).toEqual([...mb.keys()].sort());
  for (const [key, ga] of ma) {
    const gb = mb.get(key)!;
    expect(Math.abs(ga.x - gb.x), `${key} x`).toBeLessThan(1);
    expect(Math.abs(ga.y - gb.y), `${key} y`).toBeLessThan(1);
    expect(Math.abs(ga.w - gb.w), `${key} w`).toBeLessThan(1);
    expect(Math.abs(ga.h - gb.h), `${key} h`).toBeLessThan(1);
  }
}

describe("A7 full engine — flag OFF ≡ flag-absent, flag ON succeeds", () => {
  for (const preset of PRESETS) {
    it(
      `${preset}: flag OFF is byte-identical to flag-absent`,
      async () => {
        const { nodes, plan } = loadNodes(preset);
        const absent = await buildTerraformStrataExcalidrawScene(nodes, plan, {
          compact: true,
        });
        const off = await buildTerraformStrataExcalidrawScene(nodes, plan, {
          compact: true,
          strataCoordinateRefine: false,
        });
        // OFF and ABSENT drive the exact SAME code path (A7 never runs), so
        // ids/versions/meta are byte-identical; geometry is compared at whole-
        // pixel (the shared kernel adds a documented <0.5px label jitter under
        // accumulated jsdom state to a couple of frames — identical to what the
        // scene-build suite tolerates — so A7 being a no-op is what this proves).
        expect(off.meta).toEqual(absent.meta);
        expect(off.elements.map((el) => `${el.id}|${el.version}`)).toEqual(
          absent.elements.map((el) => `${el.id}|${el.version}`),
        );
        const round = (els: readonly ExcalidrawElement[]) =>
          els.map(
            (el) =>
              `${el.id}|${el.type}|${Math.round(el.x)},${Math.round(
                el.y,
              )},${Math.round(el.width)},${Math.round(el.height)}`,
          );
        expect(round(off.elements)).toEqual(round(absent.elements));
      },
      STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
    );

    it(
      `${preset}: flag ON succeeds, R2 zero, run-twice deterministic`,
      async () => {
        const { nodes, plan } = loadNodes(preset);
        expect(
          nodes[DECLARED_DATAFLOW_ORDERED_KEY]?.length ?? 0,
        ).toBeGreaterThan(0);
        const on1 = await buildTerraformStrataExcalidrawScene(nodes, plan, {
          compact: true,
          strataCoordinateRefine: true,
        });
        const on2 = await buildTerraformStrataExcalidrawScene(nodes, plan, {
          compact: true,
          strataCoordinateRefine: true,
        });

        // engine ran end to end; A7 flag echoed; no degradation.
        expect(on1.meta.rcllV2Degraded).toBeUndefined();
        expect(on1.meta.strataCoordinateRefine).toBe(true);
        expect(on1.meta.pipelineLayoutVariant).toBe("strata");
        // R2 evidence still all-zero on the FINAL (post-A7) geometry.
        expect(on1.meta.strataStructural).toEqual({
          nonAncestorOverlaps: 0,
          titleCollisions: 0,
          contiguityViolations: 0,
        });
        expect(on1.elements.length).toBeGreaterThan(0);
        expectFramesDeterministic(on1.elements, on2.elements);
      },
      STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
    );
  }
});

// ── W10 Stage 2: bandCompact — constraintPolicy resolution + gap parity ───────
//
// A7 must mirror the A0 skyline a bandCompact placement was built with:
// `constraintPolicy` resolves to "packed" for banded NON-ROOT hulls when the
// option is live, at BOTH blocksConstrain (geometric x-overlap, not all-pairs)
// AND minGap (leaf-leaf CLUSTER, not LANE). Fixing only blocksConstrain would
// let seedCompact re-inflate leaf-leaf gaps from CLUSTER back to LANE — the
// contrast arms below pin exactly that failure mode.

describe("A7 bandCompact — constraintPolicy resolution + gap parity (W10 Stage 2)", () => {
  const BC: StrataEngineOptions = { ...OPTS, bandCompact: true };

  /** Account 111 with two X-overlapping DIRECT leaves (same column). */
  function leafBearingAccount() {
    const acct = (id: string, addr: string): PipelineCluster => ({
      ...frameCluster(id, placement("aws", "111", "r1"), addr, 200, 80),
      ancillaryScopeRole: "account",
    });
    const clusters = [acct("l1", "aws.l1"), acct("l2", "aws.l2")];
    const model = buildStrataModel(prep(clusters), OPTS);
    const primes = primeEdges([]);
    const a0 = placeStrataHulls(model, primes, rankStub({ l1: 0, l2: 0 }), BC);
    return { model, primes, a0 };
  }

  it("keeps the CLUSTER leaf-leaf gap through A7 (minGap parity, not re-inflated to LANE)", () => {
    const { model, primes, a0 } = leafBearingAccount();
    const gapOf = (p: StrataPlacementResult): number =>
      p.leafBoxes.get("l2")!.y -
      (p.leafBoxes.get("l1")!.y + p.leafBoxes.get("l1")!.height);
    expect(gapOf(a0)).toBe(36); // A0 skyline: CLUSTER between two leaf cards

    // Parity: with bandCompact threaded, A7 is a no-op (no chords) and the
    // CLUSTER gap survives seedCompact.
    const refined = refineStrataCoordinates(a0, model, primes, {
      bandCompact: true,
    });
    expect(gapOf(refined)).toBe(36);
    expect(fingerprint(refined)).toBe(fingerprint(a0));

    // Contrast arm (the half-fix the design guards against): withOUT the
    // option threaded, banded constraints re-inflate the gap to LANE.
    const unthreaded = refineStrataCoordinates(a0, model, primes);
    expect(gapOf(unthreaded)).toBe(96);
  });

  it("uses geometric overlap at blocksConstrain: X-disjoint row-share survives A7", () => {
    // Two accounts under one provider, X-disjoint columns ⇒ A0 (bandCompact)
    // row-shares them at the provider level.
    const clusters = [
      frameCluster(
        "c1",
        placement("aws", "111", "r1", "vpc-1", "s1"),
        "aws.c1",
        200,
        100,
      ),
      frameCluster(
        "c2",
        placement("aws", "222", "r1", "vpc-2", "s2"),
        "aws.c2",
        200,
        100,
      ),
    ];
    const model = buildStrataModel(prep(clusters), OPTS);
    const primes = primeEdges([]);
    const a0 = placeStrataHulls(model, primes, rankStub({ c1: 0, c2: 1 }), BC);
    const a111 = keyOf("aws", "111");
    const a222 = keyOf("aws", "222");
    expect(a0.boxedHulls.get(a111)!.box.y).toBe(a0.boxedHulls.get(a222)!.box.y);

    // With bandCompact threaded, the X-disjoint pair does not constrain ⇒
    // the shared row survives (identity — no chords to act on).
    const refined = refineStrataCoordinates(a0, model, primes, {
      bandCompact: true,
    });
    expect(refined.boxedHulls.get(a111)!.box.y).toBe(
      refined.boxedHulls.get(a222)!.box.y,
    );
    expect(fingerprint(refined)).toBe(fingerprint(a0));

    // Contrast arm: unthreaded, banded blocksConstrain treats EVERY pair as
    // overlapping ⇒ seedCompact stacks the shared row back into bands.
    const unthreaded = refineStrataCoordinates(a0, model, primes);
    expect(unthreaded.boxedHulls.get(a222)!.box.y).toBeGreaterThan(
      unthreaded.boxedHulls.get(a111)!.box.y,
    );
  });

  it("flag-off parity: opts absent ≡ { bandCompact: false } (constraintPolicy === policy)", () => {
    const { model, primes, a0 } = fixtureB();
    const noOpts = refineStrataCoordinates(a0, model, primes);
    const explicitFalse = refineStrataCoordinates(a0, model, primes, {
      bandCompact: false,
    });
    expect(fingerprint(explicitFalse)).toBe(fingerprint(noOpts));
  });
});

// ── W10 Stage 2: engine meta echo (Requested / AppliedHullCount / ReclaimedPx) ─

describe("strataBandCompact — engine meta echo rules (W10 Stage 2)", () => {
  const preset = "staging-localstack";

  it(
    "flag OFF: meta is byte-identical to flag-absent and carries NO strataBandCompact* keys",
    async () => {
      const { nodes, plan } = loadNodes(preset);
      const absent = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
      });
      const off = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
        strataBandCompact: false,
      });
      expect(off.meta).toEqual(absent.meta);
      expect(
        Object.keys(absent.meta).filter((k) =>
          k.startsWith("strataBandCompact"),
        ),
      ).toEqual([]);
      expect(
        Object.keys(off.meta).filter((k) => k.startsWith("strataBandCompact")),
      ).toEqual([]);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "flag ON (with rankSeparate + A7): Requested echo, pre-A7 AppliedHullCount snapshot, ReclaimedPx only-when-positive",
    async () => {
      const { nodes, plan } = loadNodes(preset);
      const on = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
        strataRankSeparate: true,
        strataCoordinateRefine: true,
        strataBandCompact: true,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();
      expect(on.meta.strataBandCompactRequested).toBe(true);
      // The snapshot is taken from the A0 result BEFORE A7 rebuilds the
      // placement object — with coordinateRefine ON this only survives if the
      // engine snapshots correctly.
      const count = on.meta.strataBandCompactAppliedHullCount;
      expect(typeof count).toBe("number");
      expect(count as number).toBeGreaterThan(0);
      // ε only-when-nonzero precedent: present ⇒ strictly positive. Under
      // rankSeparate the W10 Stage-1 evidence says the row-share reclaims
      // real height on this preset.
      expect(on.meta.strataBandCompactReclaimedPx).toBeDefined();
      expect(on.meta.strataBandCompactReclaimedPx as number).toBeGreaterThan(0);
      // R2 evidence still all-zero on the final geometry.
      expect(on.meta.strataStructural).toEqual({
        nonAncestorOverlaps: 0,
        titleCollisions: 0,
        contiguityViolations: 0,
      });
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );
});
