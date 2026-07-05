/**
 * Strata engine — P8 scene build (docs/strata-view-implementation-flow.md P8;
 * spec rcll-v2-spec-v2 §6-A6 draw + v3.1 §5).
 *
 * Converts the engine's finished geometry — `(prep, model, placement)` — into
 * Excalidraw elements, WITHOUT ever calling `applyCompoundHierarchicalLayout`
 * (SEAM #6): Strata's own A0 placement is final, so the provider re-stack that
 * builder performs would destroy A0's Y geometry. Every frame here is emitted
 * DIRECTLY at its `placement.boxedHulls` box (not re-derived from child bounds),
 * so the emitted scene's frame geometry is byte-identical to the placement.
 *
 * Pattern reference: `buildSceneFromBoxedTree` in terraformPipelineLayoutRcll.ts
 * (leaf pre-compensation) + the shared kernel `convertPipelineSkeletonToElements`
 * in terraformPipelineLayoutFinalize.ts.
 *
 * The build is a pure function of its inputs (no Date.now / Math.random of its
 * own — element ids/seeds are regenerated deterministically by the shared
 * kernel); two runs over the same placement produce byte-identical geometry.
 *
 * NOTE on edge direction (C10′): TFD arrows are drawn from `prep.collapsedEdges`
 * in their TRUE declared direction (source→target as declared). A3's `edgesPrime`
 * reversal is a RANK/ORDER concept only and is deliberately NOT consumed at draw
 * time — back-edge styling of A3-reversed arcs is an M1b/A6 concern. Self-loops
 * (source === target) survive in `prep.collapsedEdges` and therefore still render.
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataSceneBuild.test.ts
 */
import { invariant } from "@excalidraw/common";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { assignCompoundEdgeFrameParents } from "./terraformPipelineLayoutCompoundHierarchy";
import { appendCompoundTopologyFrameEdgeSkeletons } from "./terraformPipelineLayoutCompoundSiblingEdges";
import {
  appendPipelineEdgeSkeletons,
  convertPipelineSkeletonToElements,
} from "./terraformPipelineLayoutFinalize";
import {
  pipelineFrameCustomData,
  translateSkeleton,
} from "./terraformPipelineLayoutShared";
import { spreadContextFrameColors } from "./terraformPrimaryVisibility";
import { STRATA_ROOT_ID } from "./terraformPipelineStrataModel";
import {
  topologyFrameSkeletonId,
  topologyPathForCluster,
  type TopologyFrameRole,
} from "./terraformPipelineTopologyFrames";
import { clusterFrameLocalRect } from "./terraformPipelineV2Pack";

import type { TerraformDependencyLayoutBox } from "./terraformElkLayout";
import type {
  PipelineCluster,
  PipelineLayoutPrep,
  PipelinePlacement,
} from "./terraformPipelineLayoutShared";
import type {
  StrataHullNode,
  StrataModel,
  StrataPlacementResult,
} from "./terraformPipelineStrataTypes";
import type { TerraformPlanNodesMap } from "./terraformPlanParsing";

export type StrataSceneBuildInput = {
  prep: PipelineLayoutPrep;
  model: StrataModel;
  placement: StrataPlacementResult;
  nodes: TerraformPlanNodesMap;
};

/** Hull-frame display label (mirrors terraformPipelineTopologyFrames.ts's
 * private `frameNameForLevel`, D6′ copy). */
function strataHullLabel(
  role: TopologyFrameRole,
  p: PipelinePlacement,
): string {
  switch (role) {
    case "provider":
      return p.providerFamily;
    case "account":
      return `Account ${p.accountId}`;
    case "region":
      return `Region ${p.region}`;
    case "vpc":
      return `VPC ${p.vpcId}`;
    case "subnetZone":
      return p.subnetTier ? `${p.subnetTier} subnet zone` : "subnet zone";
    default:
      return role;
  }
}

/** Deterministic representative leaf for a hull (its content-least leaf), used
 * only for the frame's colour + label + placement-derived customData. */
function firstLeafOf(
  hull: StrataHullNode,
  model: StrataModel,
): PipelineCluster | undefined {
  for (const leafId of hull.leafClusterIds) {
    const c = model.clusters.get(leafId);
    if (c) {
      return c;
    }
  }
  for (const child of hull.children) {
    const c = firstLeafOf(child, model);
    if (c) {
      return c;
    }
  }
  return undefined;
}

/**
 * Assemble the Strata scene skeleton + the id→box map the shared edge/frame
 * emission reads. Split out from {@link buildStrataScene} so tests can assert
 * on pure geometry without the async icon-injection / z-stack passes.
 */
export function assembleStrataSceneSkeleton(input: StrataSceneBuildInput): {
  skeleton: ExcalidrawElementSkeleton[];
  layoutBoxes: Map<string, TerraformDependencyLayoutBox>;
  frameEdgeCount: number;
} {
  const { prep, model, placement, nodes } = input;
  const skeleton: ExcalidrawElementSkeleton[] = [];
  const layoutBoxes = new Map<string, TerraformDependencyLayoutBox>();

  // ── leaf clusters: translate each built skeleton so the cluster's TRUE frame
  // local rect lands EXACTLY on its placed leaf box (skeleton-origin
  // pre-compensation — full-mode frames sit at a nonzero local offset). ──
  for (const cluster of prep.clusters) {
    const box = placement.leafBoxes.get(cluster.id);
    invariant(
      box !== undefined,
      `Strata scene build: leaf cluster "${cluster.id}" has no placed box`,
    );
    const rect = clusterFrameLocalRect(cluster);
    const dx = box.x - rect.x;
    const dy = box.y - rect.y;
    const path = topologyPathForCluster(cluster);
    const translated = translateSkeleton(cluster.build.skeleton, dx, dy).map(
      (el) =>
        el.id === cluster.build.clusterFrameId
          ? {
              ...el,
              // Fresh customData object — translateSkeleton is a shallow clone,
              // so the prep skeleton's customData is still shared; mutating it
              // in place would corrupt the prep the fallback path reuses.
              customData: {
                ...((el as { customData?: Record<string, unknown> })
                  .customData ?? {}),
                // Tier-1 ancestor signal for T9 slice classification
                // (resolveClusterPath). FULL-mode compound scenes stamp this
                // directly; COMPACT-mode ones carry only a parent key — Strata
                // stamps the full path so classification is correct under both.
                terraformTopologyPath: [...path],
              },
            }
          : el,
    );
    skeleton.push(...translated);
    const boxEntry: TerraformDependencyLayoutBox = {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    };
    layoutBoxes.set(cluster.id, boxEntry);
    layoutBoxes.set(cluster.build.clusterFrameId, boxEntry);
  }

  // ── hull frames: one frame per non-root hull, at its EXACT placement box
  // (never boundsOf-re-derived). The synthetic root is the canvas — no frame. ──
  const emitHullFrame = (hull: StrataHullNode): void => {
    if (hull.id !== STRATA_ROOT_ID) {
      const boxed = placement.boxedHulls.get(hull.id);
      invariant(
        boxed !== undefined,
        `Strata scene build: hull "${hull.id}" has no placed box`,
      );
      const role = hull.role as TopologyFrameRole;
      const rep = firstLeafOf(hull, model);
      const p = rep?.placement;
      const frameId = topologyFrameSkeletonId(role, hull.id);

      // children = immediate child hull frames + direct-leaf cluster frames
      // (band rows), so drag-grouping + nesting fall out exactly as the
      // compound path produces them.
      const childIds: string[] = [];
      for (const child of hull.children) {
        childIds.push(
          topologyFrameSkeletonId(child.role as TopologyFrameRole, child.id),
        );
      }
      for (const leafId of hull.leafClusterIds) {
        const c = model.clusters.get(leafId);
        if (c) {
          childIds.push(c.build.clusterFrameId);
        }
      }

      const box = boxed.box;
      skeleton.push({
        type: "frame",
        id: frameId,
        name: p ? strataHullLabel(role, p) : role,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        children: childIds,
        ...(p
          ? spreadContextFrameColors(role, {
              subnetTier: role === "subnetZone" ? p.subnetTier : undefined,
            })
          : {}),
        customData: p
          ? pipelineFrameCustomData(role, p, frameId, {
              // Stamp the topology path from the HULL itself (v3.1 §5 / T9): the
              // diagnostics classify slices by reading topology paths off frames.
              terraformTopologyPath: [...hull.path],
              terraformSubnetSignature: p.subnetSignature,
              terraformSubnetTier: p.subnetTier,
            })
          : {
              terraform: true,
              terraformSemanticOverview: true,
              terraformPipelineView: true,
              terraformTopologyRole: role,
              terraformTopologyKey: frameId,
              terraformTopologyPath: [...hull.path],
            },
      } as unknown as ExcalidrawElementSkeleton);
      layoutBoxes.set(frameId, {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      });
    }
    for (const child of hull.children) {
      emitHullFrame(child);
    }
  };
  emitHullFrame(model.hullRoot);

  // ── TFD arrows: true declared direction, from prep.collapsedEdges (self-loops
  // included). Same shared emission the v2/rcll builders use. ──
  appendPipelineEdgeSkeletons(
    nodes,
    prep.collapsedEdges,
    skeleton,
    layoutBoxes,
  );

  // ── aggregated hull-to-hull connectors + edge frame-parenting (geometry-
  // preserving; neither moves a frame — SEAM #6 safe). ──
  const frameEdgeCount = appendCompoundTopologyFrameEdgeSkeletons(
    prep.collapsedEdges,
    prep.clusters,
    skeleton,
    layoutBoxes,
  );
  assignCompoundEdgeFrameParents(skeleton, prep.clusters);

  return { skeleton, layoutBoxes, frameEdgeCount };
}

/**
 * P8 entry: `(prep, model, placement)` → Excalidraw elements. Deterministic;
 * see the file header for the SEAM #6 / edge-direction / self-loop contracts.
 */
export async function buildStrataScene(input: StrataSceneBuildInput): Promise<{
  elements: ExcalidrawElement[];
  frameEdgeCount: number;
}> {
  const { skeleton, frameEdgeCount } = assembleStrataSceneSkeleton(input);
  const elements = await convertPipelineSkeletonToElements(skeleton);
  return { elements, frameEdgeCount };
}
