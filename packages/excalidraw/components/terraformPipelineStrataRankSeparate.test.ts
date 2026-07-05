/**
 * Strata OD-14 — sibling-separation ranking (the height lever) tests.
 *
 * Covers the algorithm-core port (`computeStrataSeparatedFloor`) and its
 * consumption in the rank stage + engine dispatch:
 *   (a) FLAG-OFF byte-identity — the separated-floor branch is skipped, so both
 *       the rank result and the placement geometry are byte-identical to
 *       baseline strata (synthetic placement + real-preset scene geometry).
 *   (b) FLAG-ON changes the floor and REDUCES canvas Y extent — a two-subnetZone
 *       fixture where a one-way sibling dependency, once separated into disjoint
 *       column ranges, lets the packed skyline place the siblings side-by-side.
 *   (c) NS mutual-exclusion — both flags ⇒ rankSeparate WINS, NS dropped, the
 *       `rank-floor-conflict-rankseparate-wins-network-simplex` signal surfaces
 *       in scene meta (mirror of terraformPipelineToggleGuards).
 *   (d) run-twice determinism.
 *   + unit tests for the no-pairs short-circuit and the co-axial-cycle collapse.
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataRankSeparate.test.ts
 */
import graphlibDot from "@dagrejs/graphlib-dot";
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { clusterFrameLocalRect } from "./terraformPipelineV2Pack";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { buildStrataModel } from "./terraformPipelineStrataModel";
import { rankStrataClusters } from "./terraformPipelineStrataRank";
import { computeStrataSeparatedFloor } from "./terraformPipelineStrataRankSeparate";
import { placeStrataHulls } from "./terraformPipelineStrataPlacement";
import { buildTerraformStrataExcalidrawScene } from "./terraformPipelineStrata";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
} from "./terraformPlanParsing";

import type {
  CollapsedPipelineEdge,
  PipelineCluster,
  PipelineLayoutPrep,
  PipelinePlacement,
} from "./terraformPipelineLayoutShared";
import type {
  StrataEngineOptions,
  StrataModel,
  StrataPrimeEdge,
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

// ── synthetic model helpers (mirror terraformPipelineStrataPlacement.test.ts) ──

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

/** Rank a model (floor + optional refinements) using the real frame widths. */
function rankOf(
  model: StrataModel,
  pairs: [string, string][],
  opts: { networkSimplexRank?: boolean; rankSeparate?: boolean } = {},
) {
  return rankStrataClusters([...model.clusters.keys()], primeRepair(pairs), {
    networkSimplexRank: opts.networkSimplexRank ?? false,
    rankSeparate: opts.rankSeparate,
    hullRoot: opts.rankSeparate ? model.hullRoot : undefined,
    unitWidthOf: (id) => {
      const c = model.clusters.get(id);
      return c ? clusterFrameLocalRect(c).width : 0;
    },
  });
}

function primeRepair(pairs: [string, string][]) {
  return { feedbackKeys: new Set<string>(), edgesPrime: primeEdges(pairs) };
}

const effEdgesOf = (
  pairs: [string, string][],
): { source: string; target: string }[] =>
  pairs.map(([source, target]) => ({ source, target }));

/** Absolute canvas Y extent (max bottom − min top) over live elements. */
function canvasYExtent(elements: readonly ExcalidrawElement[]): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const el of elements) {
    if (el.isDeleted) {
      continue;
    }
    min = Math.min(min, el.y);
    max = Math.max(max, el.y + el.height);
  }
  return max - min;
}

const sortedEntries = (m: ReadonlyMap<string, number>): [string, number][] =>
  [...m.entries()].sort((a, b) => (a[0] === b[0] ? 0 : a[0] < b[0] ? -1 : 1));

/**
 * TWO subnetZones (subA, subB) under ONE packed vpc, a one-way leaf edge
 * a1→b1. Base floor: a1,a2 @ col 0; b1 @ col 1, b2 @ col 0 — so subA spans {0}
 * and subB spans {0,1} ⇒ their x-extents OVERLAP ⇒ the packed vpc skyline
 * stacks them (tall). Separation pushes ALL of subB after ALL of subA (b2:0→1)
 * ⇒ disjoint column ranges ⇒ side-by-side ⇒ shorter vpc.
 */
function twoSubnetFixture(): {
  model: StrataModel;
  pairs: [string, string][];
} {
  const subA = placement("aws", "1", "us-east-1", "vpc-1", "subA");
  const subB = placement("aws", "1", "us-east-1", "vpc-1", "subB");
  const clusters = [
    frameCluster("a1", subA, "aws.a1", 200, 120),
    frameCluster("a2", subA, "aws.a2", 200, 120),
    frameCluster("b1", subB, "aws.b1", 200, 120),
    frameCluster("b2", subB, "aws.b2", 200, 120),
  ];
  const pairs: [string, string][] = [["a1", "b1"]];
  const model = buildStrataModel(
    prep(
      clusters,
      pairs.map(([s, t]) => edge(s, t)),
    ),
    OPTS,
  );
  return { model, pairs };
}

// ── (unit) computeStrataSeparatedFloor ────────────────────────────────────────

describe("computeStrataSeparatedFloor", () => {
  it("no one-way sibling pair ⇒ no-op short-circuit returns the base floor verbatim", () => {
    // Independent siblings (no edge between subA and subB): no separation.
    const { model } = twoSubnetFixture();
    const base = rankOf(model, []).rank; // floor with no edges
    const sep = computeStrataSeparatedFloor(
      model.hullRoot,
      base,
      effEdgesOf([]),
    );
    expect(sep.pairCount).toBe(0);
    expect(sep.applied).toBe(false);
    expect(sep.fallbackReason).toBe("no-pairs");
    expect(sep.floor).toBe(base); // same reference — byte-identical
  });

  it("one-way sibling dependency ⇒ separates the dependent hull into disjoint columns", () => {
    const { model, pairs } = twoSubnetFixture();
    const base = rankOf(model, pairs).rank;
    // base: a1,a2,b2 @ 0; b1 @ 1 (subA {0} overlaps subB {0,1}).
    expect(base.get("b2")).toBe(0);

    const sep = computeStrataSeparatedFloor(
      model.hullRoot,
      base,
      effEdgesOf(pairs),
    );
    expect(sep.pairCount).toBeGreaterThanOrEqual(1);
    expect(sep.applied).toBe(true);
    expect(sep.fallbackReason).toBe("none");
    expect(sep.changedRankCount).toBeGreaterThanOrEqual(1);
    // ALL of subB now ranks after ALL of subA ⇒ disjoint ⇒ b2 pushed 0→1.
    expect(sep.floor.get("a1")).toBe(0);
    expect(sep.floor.get("a2")).toBe(0);
    expect(sep.floor.get("b1")).toBe(1);
    expect(sep.floor.get("b2")).toBe(1);
  });

  it("mutual sibling cycle stays co-axial (collapses to one SCC ⇒ no separation)", () => {
    const { model } = twoSubnetFixture();
    const pairs: [string, string][] = [
      ["a1", "b1"],
      ["b2", "a2"], // reverse direction ⇒ subA ⇄ subB mutual at the vpc level
    ];
    const base = rankOf(model, pairs).rank;
    const sep = computeStrataSeparatedFloor(
      model.hullRoot,
      base,
      effEdgesOf(pairs),
    );
    // The two subnetZones form ONE quotient ⇒ no sibling separation edge fires.
    expect(sep.pairCount).toBe(0);
    expect(sep.applied).toBe(false);
    expect(sep.fallbackReason).toBe("no-pairs");
  });

  it("is deterministic (run-twice byte-identical floor)", () => {
    const { model, pairs } = twoSubnetFixture();
    const base = rankOf(model, pairs).rank;
    const a = computeStrataSeparatedFloor(
      model.hullRoot,
      base,
      effEdgesOf(pairs),
    );
    const b = computeStrataSeparatedFloor(
      model.hullRoot,
      base,
      effEdgesOf(pairs),
    );
    expect(sortedEntries(a.floor)).toEqual(sortedEntries(b.floor));
    expect(a.pairCount).toBe(b.pairCount);
    expect(a.changedRankCount).toBe(b.changedRankCount);
  });
});

// ── (a) FLAG-OFF byte-identity (synthetic rank + placement) ────────────────────

describe("rankStrataClusters — OD-14 flag-OFF byte-identity", () => {
  it("rankSeparate:false ⇒ rank + placement byte-identical to baseline (no option)", () => {
    const { model, pairs } = twoSubnetFixture();
    const baseline = rankOf(model, pairs); // no rankSeparate key at all
    const off = rankStrataClusters(
      [...model.clusters.keys()],
      primeRepair(pairs),
      {
        networkSimplexRank: false,
        rankSeparate: false,
        hullRoot: model.hullRoot,
        unitWidthOf: (id) => {
          const c = model.clusters.get(id);
          return c ? clusterFrameLocalRect(c).width : 0;
        },
      },
    );

    // No OD-14 observability leaks onto the OFF result.
    expect(off.rankSeparateApplied).toBeUndefined();
    expect(off.rankSeparateFallback).toBeUndefined();
    expect(sortedEntries(off.rank)).toEqual(sortedEntries(baseline.rank));
    expect(off.columnX).toEqual(baseline.columnX);

    // Placement geometry byte-identical.
    const pB = placeStrataHulls(model, primeEdges(pairs), baseline, OPTS);
    const pOff = placeStrataHulls(model, primeEdges(pairs), off, OPTS);
    const leafJson = (r: typeof pB) =>
      JSON.stringify([...r.leafBoxes.entries()].sort());
    expect(leafJson(pOff)).toEqual(leafJson(pB));
  });
});

// ── (b) FLAG-ON changes the floor + REDUCES canvas Y extent ───────────────────

describe("rankStrataClusters + placeStrataHulls — OD-14 flag-ON height lever", () => {
  it("separated floor packs the sibling subnetZones side-by-side ⇒ shorter vpc", () => {
    const { model, pairs } = twoSubnetFixture();
    const off = rankOf(model, pairs);
    const on = rankOf(model, pairs, { rankSeparate: true });

    // The floor changed (b2 pushed 0→1) and OD-14 observability is populated.
    expect(on.rankSeparateApplied).toBe(true);
    expect(on.rankSeparatePairCount).toBeGreaterThanOrEqual(1);
    expect(on.rankSeparateChangedRankCount).toBeGreaterThanOrEqual(1);
    expect(on.rank.get("b2")).toBe(1);
    expect(off.rank.get("b2")).toBe(0);

    const pOff = placeStrataHulls(model, primeEdges(pairs), off, OPTS);
    const pOn = placeStrataHulls(model, primeEdges(pairs), on, OPTS);

    const rootOff = pOff.boxedHulls.get(model.hullRoot.id)!.box.height;
    const rootOn = pOn.boxedHulls.get(model.hullRoot.id)!.box.height;
    // eslint-disable-next-line no-console -- measured delta is the deliverable
    console.log(
      `[OD-14 synthetic] root Y extent OFF=${rootOff} ON=${rootOn} Δ=${
        rootOn - rootOff
      } (${(((rootOn - rootOff) / rootOff) * 100).toFixed(1)}%)`,
    );
    expect(rootOn).toBeLessThan(rootOff);
  });

  it("is deterministic (run-twice byte-identical placement)", () => {
    const { model, pairs } = twoSubnetFixture();
    const on1 = rankOf(model, pairs, { rankSeparate: true });
    const on2 = rankOf(model, pairs, { rankSeparate: true });
    const p1 = placeStrataHulls(model, primeEdges(pairs), on1, OPTS);
    const p2 = placeStrataHulls(model, primeEdges(pairs), on2, OPTS);
    expect(JSON.stringify([...p1.leafBoxes.entries()].sort())).toEqual(
      JSON.stringify([...p2.leafBoxes.entries()].sort()),
    );
  });
});

// ── (c) NS mutual-exclusion — rankSeparate WINS (rank-stage backstop) ──────────

describe("rankStrataClusters — OD-14 mutual exclusion with network-simplex", () => {
  it("both flags on ⇒ rankSeparate wins, NS never applied (backstop mirror of toggleGuards)", () => {
    const { model, pairs } = twoSubnetFixture();
    const both = rankStrataClusters(
      [...model.clusters.keys()],
      primeRepair(pairs),
      {
        networkSimplexRank: true,
        rankSeparate: true,
        hullRoot: model.hullRoot,
        unitWidthOf: (id) => {
          const c = model.clusters.get(id);
          return c ? clusterFrameLocalRect(c).width : 0;
        },
      },
    );
    expect(both.rankSeparateApplied).toBe(true);
    expect(both.networkSimplexApplied).toBe(false);
    expect(both.nsSkipReason).toBeUndefined();
  });
});

// ── real-preset integration: byte-identity, mutual-exclusion signal, height ────

const PRESET_1 = "staging-extended-localstack-v2"; // P1

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

const geomTuples = (elements: readonly ExcalidrawElement[]): string[] =>
  elements
    .filter((el) => !el.isDeleted)
    .map(
      (el) =>
        `${el.type}|${Math.round(el.x)},${Math.round(el.y)},${Math.round(
          el.width,
        )},${Math.round(el.height)}`,
    )
    .sort();

describe("buildTerraformStrataExcalidrawScene — OD-14 on real P1", () => {
  it(
    "flag-OFF (explicit false) is geometry byte-identical to default strata",
    async () => {
      const { nodes, plan } = loadNodes(PRESET_1);
      const base = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
      });
      const off = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
        strataRankSeparate: false,
      });
      expect(base.meta.rcllV2Degraded).toBeUndefined();
      expect(geomTuples(off.elements)).toEqual(geomTuples(base.elements));
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "both flags ⇒ mutual-exclusion signal surfaces in meta; NS echoed as dropped",
    async () => {
      const { nodes, plan } = loadNodes(PRESET_1);
      const scene = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
        strataRankSeparate: true,
        strataNetworkSimplexRank: true,
      });
      expect(scene.meta.rcllV2Degraded).toBeUndefined();
      expect(scene.meta.strataRankSeparate).toBe(true);
      expect(scene.meta.strataNetworkSimplexRank).toBe(false); // dropped (honest)
      expect(scene.meta.strataToggleSuppressions).toContain(
        "rank-floor-conflict-rankseparate-wins-network-simplex",
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "flag-ON runs end-to-end (no degradation); reports the canvas Y-extent delta",
    async () => {
      const { nodes, plan } = loadNodes(PRESET_1);
      const off = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
      });
      const on = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
        strataRankSeparate: true,
      });
      expect(on.meta.rcllV2Degraded).toBeUndefined();

      const yOff = canvasYExtent(off.elements);
      const yOn = canvasYExtent(on.elements);
      // eslint-disable-next-line no-console -- measured delta is the deliverable
      console.log(
        `[OD-14 P1 compact] canvas Y extent OFF=${Math.round(
          yOff,
        )} ON=${Math.round(yOn)} Δ=${Math.round(yOn - yOff)} (${(
          ((yOn - yOff) / yOff) *
          100
        ).toFixed(1)}%) | rankSeparateApplied=${String(
          on.meta.strataRankSeparateApplied,
        )} pairCount=${String(
          on.meta.strataRankSeparatePairCount,
        )} changed=${String(on.meta.strataRankSeparateChangedRankCount)}`,
      );
      // Report-only on the real preset (structure-dependent); the synthetic
      // fixture owns the hard "reduces" assertion. Assert only that the flag is
      // wired through end-to-end.
      expect(on.meta.strataRankSeparateApplied).toBeDefined();
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );
});
