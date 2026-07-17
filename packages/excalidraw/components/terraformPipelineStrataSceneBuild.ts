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
 * The build is a pure function of its inputs (no wall-clock reads / randomness
 * of its own, C3′ — statically asserted by the finalize test suite); two runs
 * over the same placement produce byte-identical geometry, and the A6 finalize
 * below makes ids/seeds/nonces byte-identical too.
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
import {
  routeStrataSkeletonEdges,
  type StrataEdgeRoutingMeta,
} from "./terraformPipelineStrataEdgeRouting";
import {
  routeStrataBorderExits,
  type StrataBorderRouteMeta,
} from "./terraformPipelineStrataBorderRoute";
import { finalizeStrataScene } from "./terraformPipelineStrataFinalize";
import { STRATA_ROOT_ID } from "./terraformPipelineStrataModel";
import { STRATA_HULL_POLICY } from "./terraformPipelineStrataTypes";
import {
  topologyFrameSkeletonId,
  topologyPathForCluster,
  type TopologyFrameRole,
} from "./terraformPipelineTopologyFrames";
import { clusterFrameLocalRect } from "./terraformPipelineV2Pack";

import type { TerraformDependencyLayoutBox } from "./terraformElkLayout";
import type { DeBandLevel } from "./terraformPipelineLayoutProfiles";
import type {
  PipelineCluster,
  PipelineLayoutPrep,
  PipelinePlacement,
} from "./terraformPipelineLayoutShared";
import type { StrataAncillaryBand } from "./terraformPipelineStrataAncillary";
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
  /**
   * Generation G for the A6 finalize (OD-7) — threaded from
   * `TerraformStrataSceneOptions.strataGeneration`. Defaults to 1 (the app-side
   * per-scene regeneration counter is the S7/M3 follow-up; the finalize and
   * tombstone machinery are fully G-parameterized regardless).
   */
  generation?: number;
  /**
   * Package C spike (W9): when true, TFD arrows whose straight chord
   * penetrates a foreign box are re-emitted as detour polylines
   * (terraformPipelineStrataEdgeRouting.ts). Default off — absent, the
   * routing module never runs and the skeleton is byte-identical to today.
   */
  edgeRouting?: boolean;
  /**
   * P3-pierce border-exit routing (terraformPipelineStrataBorderRoute.ts): when
   * true, a TFD arrow that leaves its own ancestor container as a long interior
   * diagonal is re-emitted with a clean single-side exit waypoint. Orthogonal
   * to `edgeRouting` (own-ancestor exits vs foreign-box detours — disjoint edge
   * sets). Default off — absent, the module never runs (byte-identical).
   */
  borderRoute?: boolean;
  /**
   * OD-15 de-band level (default `"none"`). MUST be the same level the model
   * tree was built with: this input drives the `terraformTopologyPath` stamped
   * on every leaf cluster frame, and T9 slice classification reconstructs the
   * hull tree read-only FROM that stamp (v3.1 §2.6). A stamp that disagrees with
   * the tree mis-slices A/B silently — the layout looks right and every metric
   * downstream is garbage. Pinned by a test asserting the two agree.
   */
  deBandLevel?: DeBandLevel;
  /**
   * Ancillary ("All resources") bands, keyed by host hull id
   * (terraformPipelineStrataAncillary.ts). A SIDE MAP: bands are not in the model
   * and never enter `StrataBoxedHull.placed`, so `StrataUnit` stays a closed
   * 2-kind union. Each band carries a REAL, already-absolute skeleton — this
   * build only appends it and parents its frame under the host hull. Present only
   * when non-empty (flag-OFF byte-identity).
   */
  ancillaryBands?: ReadonlyMap<string, StrataAncillaryBand>;
};

/** Hull-frame display label (mirrors terraformPipelineTopologyFrames.ts's
 * private `frameNameForLevel`, D6′ copy). Exported so the ancillary band
 * builder labels its nested scope groups with the SAME phrasing real hull
 * frames use (plan §3n) instead of inventing a second label vocabulary. */
export function strataHullLabel(
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
  /** Present only when `edgeRouting` was requested (flag-OFF byte-identity). */
  edgeRouting?: StrataEdgeRoutingMeta;
  /** Present only when `borderRoute` was requested (flag-OFF byte-identity). */
  borderRoute?: StrataBorderRouteMeta;
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
    const path = topologyPathForCluster(cluster, input.deBandLevel ?? "none");
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
      // Ancillary band hosted by THIS hull, if any. The band's frame joins
      // `childIds` so drag-grouping/nesting fall out the way the compound path
      // produces them (RISK: `childIds` is otherwise only child hull frames +
      // direct-leaf cluster frames — a band frame here is unverified
      // interactively; the fallback is to omit it, at which point bands still
      // render but do not drag-group).
      const band = input.ancillaryBands?.get(hull.id);
      if (band) {
        childIds.push(band.frameId);
      }

      // Resolved-policy stamp (spec v3.1 §53 `terraformHullPolicy`): the
      // slice-metrics diagnostics run on built scene elements and have no
      // `hull.policy` to read, so they otherwise reconstruct policy from the
      // static role→policy map — stale once a non-default band-depth cut moves
      // the banded/packed boundary. Stamp the resolved policy CONDITIONALLY —
      // only when this hull's policy diverges from `STRATA_HULL_POLICY[role]`
      // (i.e. the cut actually moved it). At the default "account" cut every
      // hull matches the map, so the key is never added and frame customData is
      // byte-identical to today.
      const policyStamp =
        hull.policy !== STRATA_HULL_POLICY[hull.role]
          ? { terraformHullPolicy: hull.policy }
          : {};

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
              ...policyStamp,
            })
          : {
              terraform: true,
              terraformSemanticOverview: true,
              terraformPipelineView: true,
              terraformTopologyRole: role,
              terraformTopologyKey: frameId,
              terraformTopologyPath: [...hull.path],
              ...policyStamp,
            },
      } as unknown as ExcalidrawElementSkeleton);
      layoutBoxes.set(frameId, {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      });
    }
    // ── ancillary band (opt-in): append the band's REAL, already-absolute
    // skeleton. Emitted outside the non-root guard because the synthetic root
    // can host a band too (a root-hosted band is top-level, exactly like a root
    // leaf). No re-derivation and no re-translation — the band's geometry IS the
    // injector's, so the two can never disagree. ──
    const hostedBand = input.ancillaryBands?.get(hull.id);
    if (hostedBand) {
      skeleton.push(...hostedBand.skeleton);
      layoutBoxes.set(hostedBand.frameId, {
        x: hostedBand.box.x,
        y: hostedBand.box.y,
        width: hostedBand.box.width,
        height: hostedBand.box.height,
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

  // ── Package C spike (W9, flag-gated): detour TFD arrows whose straight
  // chord penetrates a foreign box. Runs on the just-emitted TFD arrows only
  // (the aggregated frame connectors below are relationship.aggregated and
  // would be skipped anyway); endpoints/bindings/customData are untouched, so
  // frame-parenting below is unaffected. Absent the flag this pass never runs.
  const edgeRouting = input.edgeRouting
    ? routeStrataSkeletonEdges(skeleton, input.model, input.placement)
    : undefined;

  // ── P3-pierce border-exit routing (flag-gated). Runs AFTER edgeRouting and
  // is kept DISJOINT from it: border-route SKIPS any arrow already stamped
  // `terraformRoutedPolyline` by edgeRouting (it would otherwise re-derive
  // [start,W,end] from the endpoints, discarding edgeRouting's foreign-detour
  // waypoints). So each edge is owned by whichever pass fired first — no
  // clobber, no re-pierce. Absent the flag this never runs. ──
  const borderRoute = input.borderRoute
    ? routeStrataBorderExits(skeleton, input.model, input.placement)
    : undefined;

  // ── aggregated hull-to-hull connectors + edge frame-parenting (geometry-
  // preserving; neither moves a frame — SEAM #6 safe). ──
  const frameEdgeCount = appendCompoundTopologyFrameEdgeSkeletons(
    prep.collapsedEdges,
    prep.clusters,
    skeleton,
    layoutBoxes,
  );
  assignCompoundEdgeFrameParents(skeleton, prep.clusters);

  return {
    skeleton,
    layoutBoxes,
    frameEdgeCount,
    ...(edgeRouting ? { edgeRouting } : {}),
    ...(borderRoute ? { borderRoute } : {}),
  };
}

/**
 * P8 entry: `(prep, model, placement)` → Excalidraw elements. Deterministic;
 * see the file header for the SEAM #6 / edge-direction / self-loop contracts.
 *
 * A6 (WP-3c): the shared-kernel output is finalized through
 * `finalizeStrataScene` — content-stable ids/groupIds, FNV-1a seeds,
 * generation versions/nonces, all id references rewritten. The finalize is a
 * pure post-processing pass and NEVER touches geometry, so the skeleton
 * contracts above (and the committed Q2 strata baselines' geometry) are
 * unaffected. D2′: this is the ONLY call site — no other engine's scenes pass
 * through the finalize.
 */
export async function buildStrataScene(input: StrataSceneBuildInput): Promise<{
  elements: ExcalidrawElement[];
  frameEdgeCount: number;
  /** Present only when `edgeRouting` was requested (flag-OFF byte-identity). */
  edgeRouting?: StrataEdgeRoutingMeta;
  /** Present only when `borderRoute` was requested (flag-OFF byte-identity). */
  borderRoute?: StrataBorderRouteMeta;
}> {
  const { skeleton, frameEdgeCount, edgeRouting, borderRoute } =
    assembleStrataSceneSkeleton(input);
  const converted = await convertPipelineSkeletonToElements(skeleton);
  const elements = finalizeStrataScene(converted, {
    generation: input.generation ?? 1,
  });
  return {
    elements,
    frameEdgeCount,
    ...(edgeRouting ? { edgeRouting } : {}),
    ...(borderRoute ? { borderRoute } : {}),
  };
}
