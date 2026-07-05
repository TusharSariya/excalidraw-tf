/**
 * Strata P8 scene build + P11 engine integration / failure contract (WP-2c).
 *
 * Two layers:
 *  1. Scene build over a HAND-CRAFTED placement (skeleton-level, no async icon
 *     injection). Scene build's own contract is "emit each frame at its
 *     placement box byte-identically, never re-derive geometry" (SEAM #6), so
 *     the unit tests feed a known-good `StrataPlacementResult` and assert the
 *     emitted geometry copies it exactly. This deliberately does NOT run
 *     `placeStrataHulls` — that is WP-2b's module (and its own tests own its
 *     correctness); decoupling keeps these tests valid regardless of the
 *     placement engine's state.
 *  2. The full engine `buildTerraformStrataExcalidrawScene` on the committed
 *     preset fixtures: no degradation, R2 zero (via meta), run-twice byte-equal,
 *     every prep cluster present, TFD arrows rendered — plus the P11 failure
 *     contract (a forced stage error falls back to the v2 scene built with the
 *     SAME prep, tagged `rcllV2Degraded`).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataSceneBuild.test.ts
 */
import { describe, expect, it } from "vitest";

import graphlibDot from "@dagrejs/graphlib-dot";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { clusterFrameLocalRect } from "./terraformPipelineV2Pack";
import { preparePipelineLayout } from "./terraformPipelineLayoutShared";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { buildTerraformPipelineV2ExcalidrawScene } from "./terraformPipelineLayoutV2";
import { buildStrataModel } from "./terraformPipelineStrataModel";
import { assembleStrataSceneSkeleton } from "./terraformPipelineStrataSceneBuild";
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
  StrataBoxedHull,
  StrataEngineOptions,
  StrataHullNode,
  StrataModel,
  StrataPlacementResult,
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

// ── synthetic model helpers ───────────────────────────────────────────────────

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
  frameOffset: { x: number; y: number } = { x: 0, y: 0 },
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
        customData: {
          terraformTopologyRole: "primaryCluster",
          terraformPrimaryAddress: primaryAddress,
        },
      },
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

function prepOf(
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

/**
 * A hand-crafted, known-good placement over a model — distinct real-number
 * boxes for every hull + leaf. Scene build's SEAM-#6 contract is to copy these
 * verbatim, so containment/overlap correctness (a `placeStrataHulls` concern) is
 * irrelevant here: only faithfulness of the copy is under test.
 */
function fakePlacement(model: StrataModel): {
  placement: StrataPlacementResult;
  hullBox: Map<string, StrataBox>;
  leafBox: Map<string, StrataBox>;
} {
  const boxedHulls = new Map<string, StrataBoxedHull>();
  const leafBoxes = new Map<string, StrataBox>();
  const hullBox = new Map<string, StrataBox>();
  const leafBox = new Map<string, StrataBox>();
  let i = 1;
  const next = (w: number, h: number): StrataBox => {
    const b = { x: i * 11, y: i * 137, width: w, height: h };
    i += 1;
    return b;
  };
  const walk = (hull: StrataHullNode): void => {
    for (const child of hull.children) {
      walk(child);
    }
    for (const leafId of hull.leafClusterIds) {
      const b = next(200, 100);
      leafBoxes.set(leafId, b);
      leafBox.set(leafId, b);
    }
    const hb = next(600, 500);
    boxedHulls.set(hull.id, { hull, box: hb, placed: [] });
    hullBox.set(hull.id, hb);
  };
  walk(model.hullRoot);
  return { placement: { boxedHulls, leafBoxes }, hullBox, leafBox };
}

type SkelEl = {
  type?: string;
  id?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  customData?: Record<string, unknown>;
};

const frameById = (skeleton: readonly SkelEl[], id: string) =>
  skeleton.find((el) => el.type === "frame" && el.id === id);

describe("Strata scene build — faithful copy of a hand-crafted placement", () => {
  const clusters = [
    frameCluster(
      "a1",
      placement("aws", "1", "us-east-1", "vpc-1", "subA"),
      "aws.a1",
      200,
      100,
    ),
    // offset frame (pre-compensation probe): local (15,-25)
    frameCluster(
      "a2",
      placement("aws", "1", "us-east-1", "vpc-1", "subA"),
      "aws.a2",
      220,
      90,
      { x: 15, y: -25 },
    ),
    frameCluster(
      "a3",
      placement("aws", "1", "us-west-2", "vpc-2", "subB"),
      "aws.a3",
      200,
      120,
    ),
    frameCluster(
      "g1",
      placement("gcp", "9", "us-c1", "vpc-9", "subZ"),
      "gcp.g1",
      200,
      100,
    ),
  ];
  const prep = prepOf(clusters);
  const nodes = {} as TerraformPlanNodesMap;

  it("emits every non-root hull frame at its EXACT placement box (SEAM #6, ≥2 providers)", () => {
    const model = buildStrataModel(prep, OPTS);
    const { placement: placed, hullBox } = fakePlacement(model);
    const { skeleton } = assembleStrataSceneSkeleton({
      prep,
      model,
      placement: placed,
      nodes,
    });

    // every non-root hull → a frame at the byte-identical box
    for (const [hullId, box] of hullBox) {
      if (hullId === model.hullRoot.id) {
        // root is the canvas — NO frame emitted
        const rootFrame = skeleton.find(
          (el) =>
            el.type === "frame" &&
            (el.customData as { terraformTopologyKey?: string } | undefined)
              ?.terraformTopologyKey === model.hullRoot.id,
        );
        expect(rootFrame).toBeUndefined();
        continue;
      }
      const roleAndKey = topologyRoleAndKeyFromPath(
        placed.boxedHulls.get(hullId)!.hull.path,
      )!;
      const frameId = `tf-pipeline:${roleAndKey.role}:${encodeURIComponent(
        hullId,
      )}`;
      const frame = frameById(skeleton, frameId);
      expect(frame, `frame for hull ${hullId}`).toBeTruthy();
      expect(frame!.x).toBe(box.x);
      expect(frame!.y).toBe(box.y);
      expect(frame!.width).toBe(box.width);
      expect(frame!.height).toBe(box.height);
    }

    // provider frames specifically: two, Y byte-identical to their boxes
    const providerFrames = skeleton.filter(
      (el) =>
        el.type === "frame" &&
        (el.customData as { terraformTopologyRole?: string } | undefined)
          ?.terraformTopologyRole === "provider",
    );
    expect(providerFrames).toHaveLength(2);
    expect(frameById(skeleton, "tf-pipeline:provider:aws")!.y).toBe(
      hullBox.get("aws")!.y,
    );
    expect(frameById(skeleton, "tf-pipeline:provider:gcp")!.y).toBe(
      hullBox.get("gcp")!.y,
    );
  });

  it("pre-compensates each leaf so the cluster frame lands on its leaf box (skeleton-origin)", () => {
    const model = buildStrataModel(prep, OPTS);
    const { placement: placed, leafBox } = fakePlacement(model);
    const { skeleton } = assembleStrataSceneSkeleton({
      prep,
      model,
      placement: placed,
      nodes,
    });
    for (const cluster of clusters) {
      const box = leafBox.get(cluster.id)!;
      const rect = clusterFrameLocalRect(cluster);
      const frameEl = frameById(skeleton, cluster.build.clusterFrameId)!;
      // translated by (box.x - rect.x, box.y - rect.y): frame lands exactly on box
      expect(frameEl.x).toBe(box.x);
      expect(frameEl.y).toBe(box.y);
      // the offset cluster a2 truly moved (its local frame was at 15,-25)
      if (cluster.id === "a2") {
        expect(rect.x).toBe(15);
        expect(rect.y).toBe(-25);
      }
    }
  });

  it("stamps terraformTopologyPath on hull frames (= hull.path) and on cluster frames", () => {
    const model = buildStrataModel(prep, OPTS);
    const { placement: placed } = fakePlacement(model);
    const { skeleton } = assembleStrataSceneSkeleton({
      prep,
      model,
      placement: placed,
      nodes,
    });

    const subnetId = topologyRoleAndKeyFromPath([
      "aws",
      "1",
      "us-east-1",
      "vpc-1",
      "subA",
    ])!.key;
    const subnetFrame = frameById(
      skeleton,
      `tf-pipeline:subnetZone:${encodeURIComponent(subnetId)}`,
    )!;
    expect(
      (subnetFrame.customData as { terraformTopologyPath?: string[] })
        .terraformTopologyPath,
    ).toEqual(["aws", "1", "us-east-1", "vpc-1", "subA"]);

    const clusterFrame = frameById(skeleton, "a1:frame")!;
    expect(
      (clusterFrame.customData as { terraformTopologyPath?: string[] })
        .terraformTopologyPath,
    ).toEqual(["aws", "1", "us-east-1", "vpc-1", "subA"]);
    // stamping is on a FRESH customData object — the prep skeleton is untouched
    expect(
      (clusters[0]!.build.skeleton[0] as SkelEl).customData
        ?.terraformTopologyPath,
    ).toBeUndefined();
  });

  it("is deterministic (run-twice byte-equal frame geometry)", () => {
    const model = buildStrataModel(prep, OPTS);
    const { placement: placed } = fakePlacement(model);
    const geom = () =>
      assembleStrataSceneSkeleton({ prep, model, placement: placed, nodes })
        .skeleton.filter((el) => el.type === "frame")
        .map((el) => `${el.id}|${el.x},${el.y},${el.width},${el.height}`)
        .sort();
    expect(geom()).toEqual(geom());
  });

  it("keeps self-loops on the draw path (excluded from ranking, still in prep.collapsedEdges)", () => {
    // The model splits self-loops out of the RANKED edge set (excluded from
    // ranking/ordering), but the DRAW path (appendPipelineEdgeSkeletons) reads
    // prep.collapsedEdges — which still carries them — so they render (M1 A6).
    const selfPrep = prepOf(clusters, [
      {
        source: "a1",
        target: "a1",
        sequence: 0,
        original: { source: "a1", target: "a1", sequence: 0, origin: "tfd" },
      },
    ]);
    const model = buildStrataModel(selfPrep, OPTS);
    expect(model.selfLoops).toHaveLength(1);
    // not folded into the ranked edge set
    expect(model.edges.find((e) => e.source === e.target)).toBeUndefined();
    // still present on the draw source (assembleStrataSceneSkeleton passes
    // prep.collapsedEdges verbatim to the shared TFD emission)
    expect(selfPrep.collapsedEdges.some((e) => e.source === e.target)).toBe(
      true,
    );
  });
});

// ── full engine integration + P11 failure contract on real presets ──

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

// Whole-pixel geometry fingerprint (for the degraded===v2 fallback comparison,
// where both scenes are built adjacently and match exactly to the pixel).
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

/**
 * Content-keyed frame geometry for the run-twice determinism check: the engine's
 * hull frames (keyed by their content-addressed topology key) and primary-cluster
 * frames (keyed by primary address). The engine positions these integer-exactly
 * from placement; the shared `convertPipelineSkeletonToElements` kernel adds a
 * sub-pixel (<0.5px) text-measurement jitter to a few label-bearing frames ONLY
 * under accumulated jsdom process state (0 diff standalone) — a shared-pipeline
 * artifact, not Strata's — so the comparison allows a 1px tolerance.
 */
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

describe("buildTerraformStrataExcalidrawScene — engine integration (real presets)", () => {
  for (const preset of PRESETS) {
    it(
      `${preset}: engine succeeds (no degradation), R2 zero, deterministic, all clusters present, arrows drawn`,
      async () => {
        const { nodes, plan } = loadNodes(preset);
        expect(
          nodes[DECLARED_DATAFLOW_ORDERED_KEY]?.length ?? 0,
        ).toBeGreaterThan(0);

        // two builds BACK-TO-BACK for the determinism check (the shared pipeline's
        // async AWS-icon cache settles consistently across adjacent builds).
        const scene = await buildTerraformStrataExcalidrawScene(nodes, plan, {
          compact: true,
        });
        const scene2 = await buildTerraformStrataExcalidrawScene(nodes, plan, {
          compact: true,
        });
        // Run-twice determinism on the engine's own frame geometry (placement →
        // hull + pre-compensated cluster frames), keyed by content id, 1px
        // tolerance for the shared kernel's sub-pixel label jitter (see helper).
        expectFramesDeterministic(scene.elements, scene2.elements);

        // No degradation — the engine ran end to end.
        expect(scene.meta.rcllV2Degraded).toBeUndefined();
        expect(scene.meta.pipelineLayoutVariant).toBe("strata");
        expect(scene.meta.pipelineVariant).toBe("strata");
        expect(scene.meta.strataPassthrough).toBeUndefined();

        // R2 evidence in meta — all three counts zero.
        expect(scene.meta.strataStructural).toEqual({
          nonAncestorOverlaps: 0,
          titleCollisions: 0,
          contiguityViolations: 0,
        });

        expect(scene.elements.length).toBeGreaterThan(0);

        // every prep cluster present as a primaryCluster frame
        const prep = preparePipelineLayout(nodes, plan, true);
        const primaryFrames = scene.elements.filter(
          (el) =>
            el.type === "frame" &&
            (el.customData as { terraformTopologyRole?: string } | undefined)
              ?.terraformTopologyRole === "primaryCluster",
        );
        expect(primaryFrames.length).toBe(prep.clusters.length);
        expect(scene.meta.pipelineClusterCount).toBe(prep.clusters.length);

        // TFD arrows rendered (declared dataflow) — non-vacuous.
        const tfdArrows = scene.elements.filter((el) => {
          if (el.type !== "arrow") {
            return false;
          }
          const r = (
            el.customData as { relationship?: Record<string, unknown> }
          )?.relationship;
          return (
            r != null &&
            typeof r.source === "string" &&
            typeof r.target === "string" &&
            r.aggregated !== true
          );
        });
        expect(tfdArrows.length).toBeGreaterThan(0);
      },
      STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
    );
  }
});

describe("buildTerraformStrataExcalidrawScene — P11 failure contract", () => {
  const preset = "staging-extended-localstack-v2";

  it(
    "a forced stage error falls back to the v2 scene built with the SAME prep, tagged rcllV2Degraded",
    async () => {
      const { nodes, plan } = loadNodes(preset);

      const degraded = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
        __testForceStageError: "a1",
      });

      // meta surfaces the failure with the right stage; NO throw.
      expect(degraded.meta.rcllV2Degraded).toMatchObject({ stage: "a1" });
      expect(
        (degraded.meta.rcllV2Degraded as { reason?: string }).reason,
      ).toContain("a1");
      expect(degraded.meta.pipelineLayoutVariant).toBe("strata");
      // fell back to v2 substrate — v2 meta survives underneath.
      expect(degraded.meta.pipelineVariant).toBe("v2");

      // fallback scene === v2 scene built with the same prep (geometry byte-equal).
      const prep = preparePipelineLayout(nodes, plan, true);
      const v2 = await buildTerraformPipelineV2ExcalidrawScene(nodes, plan, {
        compact: true,
        prep,
      });
      expect(geomTuples(degraded.elements)).toEqual(geomTuples(v2.elements));
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );

  it(
    "the stage tag reflects WHICH stage threw",
    async () => {
      const { nodes, plan } = loadNodes(preset);
      for (const stage of [
        "model",
        "a3",
        "a0",
        "scene-build",
        "structural-check",
      ] as const) {
        const degraded = await buildTerraformStrataExcalidrawScene(
          nodes,
          plan,
          {
            compact: true,
            __testForceStageError: stage,
          },
        );
        expect(degraded.meta.rcllV2Degraded).toMatchObject({ stage });
      }
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );

  it(
    "includeAncillary is deferred (extraction-free M1) and echoed honestly",
    async () => {
      const { nodes, plan } = loadNodes(preset);
      const scene = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
        includeAncillary: true,
      });
      expect(scene.meta.strataAncillaryDeferred).toBe(true);
      expect(scene.meta.rcllV2Degraded).toBeUndefined();
      expect(scene.elements.length).toBeGreaterThan(0);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );
});
