/**
 * M6 `strataBoxEndpoints` — round-trip + collector-parity gates on a REAL
 * strata scene (preset staging-extended-localstack-v2, compact:false — the
 * owner's config; scaffold idiom from terraformStrataRepairFlatten.probe.test.ts).
 *
 *  - ROUND-TRIP: with the flag on, every clip-stamped declared edge SURVIVES
 *    the production conversion kernel's repair pass — `flattenedBy.clip === 0`
 *    and `keptBy.clip ===` the styler's own `boxEndpointsStamped` count — for
 *    BOTH edge styles: "curve" (dense bezier polylines) and the default
 *    "straight" (3-collinear-point chords, the minimum that carries repair's
 *    `points.length > 2` routed marker).
 *  - PARITY: the skeleton-side frame collector
 *    (`collectStrataPrimaryClusterRectsByAddress`) and repair's element-side
 *    collector (`collectTerraformClusterFrameRectsByAddress`) produce
 *    IDENTICAL address→rect maps over the same scene — the lockstep contract
 *    both modules' cross-referencing comments pin. Any predicate/geometry
 *    drift between the two flattens every clip-stamped edge, so this parity
 *    IS the mechanism the round-trip gates rest on.
 */
import { describe, expect, it } from "vitest";

import graphlibDot from "@dagrejs/graphlib-dot";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { preparePipelineLayout } from "./terraformPipelineLayoutShared";
import { convertPipelineSkeletonToElements } from "./terraformPipelineLayoutFinalize";
import { buildStrataModel } from "./terraformPipelineStrataModel";
import { repairStrataCycles } from "./terraformPipelineStrataCycleRepair";
import { rankStrataClusters } from "./terraformPipelineStrataRank";
import { placeStrataHulls } from "./terraformPipelineStrataPlacement";
import { refineStrataCoordinates } from "./terraformPipelineStrataCoordRefine";
import {
  assembleStrataSceneSkeleton,
  collectStrataPrimaryClusterRectsByAddress,
} from "./terraformPipelineStrataSceneBuild";
import { clusterFrameLocalRect } from "./terraformPipelineV2Pack";
import {
  collectTerraformClusterFrameRectsByAddress,
  createTerraformEdgeRepairStats,
} from "./terraformVisibility";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
} from "./terraformPlanParsing";

import type { StrataEdgeStyle } from "./terraformPipelineStrataEdgeStyle";
import type { PipelineLayoutPrep } from "./terraformPipelineLayoutShared";
import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";
import type { TerraformPlanNodesMap } from "./terraformPlanParsing";
import type {
  StrataEngineOptions,
  StrataModel,
  StrataPlacementResult,
} from "./terraformPipelineStrataTypes";

const PRESET = "staging-extended-localstack-v2";
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8;

// ── preset → nodes/plan (same recipe as the repair-flatten probe) ─────────────

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

/** Vanilla `buildTerraformStrataExcalidrawScene` phase sequence up to the A7
 * refine (owner's config, every non-default toggle off) — the repair-flatten
 * probe's scaffold, built ONCE and shared across the tests below. */
type Scaffold = {
  nodes: TerraformPlanNodesMap;
  prep: PipelineLayoutPrep;
  model: StrataModel;
  placement: StrataPlacementResult;
};

const cachedScaffolds = new Map<boolean, Scaffold>();

function getScaffold(compact = false): Scaffold {
  const cached = cachedScaffolds.get(compact);
  if (cached) {
    return cached;
  }
  const { nodes, plan } = loadNodes(PRESET);
  const prep = preparePipelineLayout(nodes, plan, compact);
  const engineOptions: StrataEngineOptions = {
    compact,
    includeAncillary: false,
    networkSimplexRank: false,
    rankSeparate: false,
    sweeps: 4,
    coordinateRefine: true,
  };
  const model = buildStrataModel(prep, engineOptions);
  const repair = repairStrataCycles(model.edges, model.addressOf);
  const rank = rankStrataClusters([...model.clusters.keys()], repair, {
    networkSimplexRank: false,
    rankSeparate: false,
    jointNsProbe: false,
    hullRoot: model.hullRoot,
    unitWidthOf: (id: string) => {
      const cluster = model.clusters.get(id);
      return cluster ? clusterFrameLocalRect(cluster).width : 0;
    },
  } as unknown as Parameters<typeof rankStrataClusters>[2]);
  let placement = placeStrataHulls(
    model,
    repair.edgesPrime,
    rank,
    engineOptions,
  );
  placement = refineStrataCoordinates(placement, model, repair.edgesPrime, {
    cascade: false,
  });
  const scaffold: Scaffold = { nodes, prep, model, placement };
  cachedScaffolds.set(compact, scaffold);
  return scaffold;
}

/** Assemble (box endpoints ON) + run the PRODUCTION conversion kernel (which
 * repairs internally, accumulating into `stats`). */
async function roundTrip(style: StrataEdgeStyle): Promise<{
  stamped: number;
  stats: ReturnType<typeof createTerraformEdgeRepairStats>;
  elements: ExcalidrawElement[];
}> {
  const { nodes, prep, model, placement } = getScaffold();
  const assembled = assembleStrataSceneSkeleton({
    prep,
    model,
    placement,
    nodes,
    ...(style !== "straight" ? { edgeStyle: style } : {}),
    boxEndpoints: true,
  });
  const stamped = assembled.edgeStyle?.boxEndpointsStamped ?? 0;
  const stats = createTerraformEdgeRepairStats();
  const elements = await convertPipelineSkeletonToElements(
    assembled.skeleton,
    stats,
  );
  return { stamped, stats, elements };
}

describe("strataBoxEndpoints — real-scene round-trip through repair", () => {
  it(
    "curve: repair KEEPS every clip-stamped edge (flattenedBy.clip === 0, keptBy.clip === stamped)",
    async () => {
      const { stamped, stats } = await roundTrip("curve");
      // eslint-disable-next-line no-console
      console.log(
        `boxEndpoints curve round-trip: stamped=${stamped} keptBy=${JSON.stringify(
          stats.keptBy,
        )} flattenedBy=${JSON.stringify(stats.flattenedBy)} unresolved=${
          stats.routedUnresolved
        }`,
      );
      expect(stamped).toBeGreaterThan(0);
      expect(stats.flattenedBy.clip ?? 0).toBe(0);
      expect(stats.keptBy.clip ?? 0).toBe(stamped);
    },
    TIMEOUT,
  );

  it(
    "straight: the 3-collinear-point chords survive too (points.length>2 gate) and stay 3 points",
    async () => {
      const { stamped, stats, elements } = await roundTrip("straight");
      // eslint-disable-next-line no-console
      console.log(
        `boxEndpoints straight round-trip: stamped=${stamped} keptBy=${JSON.stringify(
          stats.keptBy,
        )} flattenedBy=${JSON.stringify(stats.flattenedBy)} unresolved=${
          stats.routedUnresolved
        }`,
      );
      expect(stamped).toBeGreaterThan(0);
      expect(stats.flattenedBy.clip ?? 0).toBe(0);
      expect(stats.keptBy.clip ?? 0).toBe(stamped);
      // Element-side: every surviving clip arrow carries exactly the 3
      // collinear points the styler emitted (repair preserved the geometry).
      const clipArrows = elements.filter(
        (el) =>
          el.type === "arrow" &&
          (el.customData as Record<string, unknown> | undefined)
            ?.terraformRoutedBy === "clip",
      );
      expect(clipArrows.length).toBe(stamped);
      for (const el of clipArrows) {
        expect(
          (el as unknown as { points: readonly unknown[] }).points.length,
        ).toBe(3);
      }
    },
    TIMEOUT,
  );
});

describe("strataBoxEndpoints — skeleton/element frame-collector parity", () => {
  // Shared parity contract for both modes:
  //  (a) every skeleton-side (= styler-resolvable) entry is IDENTICAL at
  //      element time — the lockstep contract the clip gate rests on;
  //  (b) the element side's EXTRA addresses are exactly the conversion
  //      falsy-zero-trap frames: their SKELETON rect sat at x=0 or y=0, so
  //      `convertToExcalidrawElements` re-derives that axis from children
  //      (transform.ts `frame?.x || minX` — the re-derived value may or may
  //      not coincide with the skeleton value, so it is UNPREDICTABLE at
  //      skeleton time) and the skeleton-side collector rightly refuses to
  //      resolve them (the styler stamps side:"card" for those ends instead);
  //  (c) with the flag on, repair still KEEPS every clip stamp — the trap
  //      frames' edges ride the card fallback instead of failing the rigid
  //      face gate against a possibly-moved frame.
  const runParity = async (compact: boolean) => {
    const { nodes, prep, model, placement } = getScaffold(compact);
    const assembled = assembleStrataSceneSkeleton({
      prep,
      model,
      placement,
      nodes,
      boxEndpoints: true,
    });
    const stamped = assembled.edgeStyle?.boxEndpointsStamped ?? 0;
    expect(stamped).toBeGreaterThan(0);

    const skeletonSide = collectStrataPrimaryClusterRectsByAddress(
      assembled.skeleton,
    );
    expect(skeletonSide.size).toBeGreaterThan(0);

    const stats = createTerraformEdgeRepairStats();
    const elements = await convertPipelineSkeletonToElements(
      assembled.skeleton,
      stats,
    );
    const elementSide = collectTerraformClusterFrameRectsByAddress(elements);

    // (a) exact per-entry parity on every resolvable frame.
    for (const [addr, rect] of skeletonSide) {
      expect(elementSide.get(addr)).toEqual(rect);
    }

    // (b) extras are exactly the falsy-zero-trap frames.
    const skeletonFrameOriginByAddress = new Map<
      string,
      { x: number; y: number }
    >();
    for (const el of assembled.skeleton) {
      const item = el as {
        type?: string;
        x?: number;
        y?: number;
        customData?: Record<string, unknown> | null;
      };
      if (item.type !== "frame") {
        continue;
      }
      const cd = item.customData ?? {};
      if (
        cd.terraformTopologyRole === "primaryCluster" &&
        typeof cd.terraformPrimaryAddress === "string"
      ) {
        skeletonFrameOriginByAddress.set(cd.terraformPrimaryAddress, {
          x: item.x ?? 0,
          y: item.y ?? 0,
        });
      }
    }
    const extras = [...elementSide.keys()].filter(
      (addr) => !skeletonSide.has(addr),
    );
    // eslint-disable-next-line no-console
    console.log(
      `compact:${compact} parity: skeletonSide=${
        skeletonSide.size
      } elementSide=${elementSide.size} falsy-trap extras=${
        extras.length
      } stamped=${stamped} keptBy=${JSON.stringify(
        stats.keptBy,
      )} flattenedBy=${JSON.stringify(stats.flattenedBy)}`,
    );
    expect(skeletonSide.size + extras.length).toBe(elementSide.size);
    for (const addr of extras) {
      const skel = skeletonFrameOriginByAddress.get(addr);
      expect(skel).toBeDefined();
      expect(skel!.x === 0 || skel!.y === 0).toBe(true);
    }

    // (c) round-trip: no clip stamp flattened, all kept.
    expect(stats.flattenedBy.clip ?? 0).toBe(0);
    expect(stats.keptBy.clip ?? 0).toBe(stamped);
  };

  it(
    "compact:false — resolvable frames identical; extras are exactly the falsy-zero-trap frames; all clip stamps kept",
    () => runParity(false),
    TIMEOUT,
  );

  it(
    "compact:true — resolvable frames identical; extras are exactly the falsy-zero-trap frames; all clip stamps kept",
    () => runParity(true),
    TIMEOUT,
  );
});
