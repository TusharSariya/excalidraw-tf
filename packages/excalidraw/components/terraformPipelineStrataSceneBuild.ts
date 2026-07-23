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
  routeStrataChannelEdges,
  type StrataChannelRouteMeta,
} from "./terraformPipelineStrataChannelRoute";
import {
  routeStrataEdgeClip,
  type StrataEdgeClipMeta,
} from "./terraformPipelineStrataEdgeClip";
import {
  routeStrataSkeletonEdges,
  type StrataEdgeRoutingMeta,
} from "./terraformPipelineStrataEdgeRouting";
import {
  routeStrataBorderExits,
  type StrataBorderRouteMeta,
} from "./terraformPipelineStrataBorderRoute";
import {
  applyStrataEdgeStyle,
  type StrataEdgeStyle,
  type StrataEdgeStyleAnchors,
  type StrataEdgeStyleMeta,
} from "./terraformPipelineStrataEdgeStyle";
import {
  smoothStrataRoutedEdges,
  type StrataEdgeSmoothMeta,
} from "./terraformPipelineStrataEdgeSmooth";
import {
  collectTerraformResourceRectsByKey,
  collectTerraformStructuralDependencyPairKeysFromItems,
  createTerraformEdgeRepairStats,
} from "./terraformVisibility";
import type { TerraformEdgeRepairStats } from "./terraformVisibility";
import type { EdgeAnchorRect } from "./terraformEdgeAnchors";
import { finalizeStrataScene } from "./terraformPipelineStrataFinalize";
import {
  isTerraformImportProfilerEnabled,
  terraformImportProfilerRecord,
} from "./terraformImportProfiler";
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
   * Loop-2 E2.1+E2.2 container-boundary CLIP pass
   * (terraformPipelineStrataEdgeClip.ts): when true, each eligible net-forward
   * cross-cluster TFD arrow is rewritten to a Graphviz-lhead/ltail-style clip
   * polyline whose endpoints sit ON the source/target leaf-cluster frame
   * borders (egress R face, ingress L face), with perpendicular hull
   * port-crossing waypoints in between. Runs FIRST among ALL edge passes and
   * owns the eligible edges (stamps `terraformRoutedPolyline` +
   * `terraformRoutedBy:"clip"` + `terraformClipAnchor`, so channelRoute /
   * routers / edgeStyle below skip them). Net-backward and same-column edges
   * are left unstamped for the style-pass orbit / E2.4 lanes. Default off —
   * absent, the module never runs (byte-identical).
   */
  edgeClip?: boolean;
  /**
   * Probe P1 inter-rank channel routing (terraformPipelineStrataChannelRoute.ts):
   * when true, each inter-rank TFD arrow is rewritten to an orthogonal
   * exit-stub → per-channel vertical run at an assigned track X → entry-stub
   * polyline. Runs FIRST among the ROUTER passes (after the clip pass above
   * when both are on) and owns the polyline topology (stamps
   * `terraformRoutedPolyline`, so the routers/edgeStyle below skip its
   * edges). Default off — absent, the module never runs (byte-identical).
   */
  channelRoute?: boolean;
  /**
   * P3-pierce border-exit routing (terraformPipelineStrataBorderRoute.ts): when
   * true, a TFD arrow that leaves its own ancestor container as a long interior
   * diagonal is re-emitted with a clean single-side exit waypoint. Orthogonal
   * to `edgeRouting` (own-ancestor exits vs foreign-box detours — disjoint edge
   * sets). Default off — absent, the module never runs (byte-identical).
   */
  borderRoute?: boolean;
  /**
   * Probe P2 edge render style (`"straight"` default | `"step"` | `"curve"`):
   * reshape un-routed TFD arrow chords with React-Flow smoothstep / bezier
   * geometry (terraformPipelineStrataEdgeStyle.ts). Runs AFTER edgeRouting +
   * borderRoute and SKIPS arrows they already stamped. Absent / `"straight"`
   * the module never runs (byte-identical).
   */
  edgeStyle?: StrataEdgeStyle;
  /**
   * Loop-3 E3.1 GLEE smoothing pass (terraformPipelineStrataEdgeSmooth.ts):
   * when true, every stamped routed polyline (all four router provenances +
   * clip; `"style"` records are already smooth and skipped) gets a final
   * refine-straighten-smooth treatment — inflection shortcut, collinear
   * dedupe, chamfer corner rounding with a 12px inflated-card clearance test —
   * and `roundness:null` so the rendered path is EXACTLY the computed
   * polyline. Runs AFTER all the stampers, BEFORE convert/repair. Endpoints,
   * provenance and clip anchors are never touched. Default off — absent, the
   * module never runs (byte-identical).
   */
  edgeSmooth?: boolean;
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
 * Build the keyed-anchor inputs `applyStrataEdgeStyle` consumes so a styled
 * polyline's endpoints coincide with the anchors `repairTerraformEdgeBindings`
 * re-derives at element time (see terraformEdgeAnchors.ts). Both are collected
 * from the skeleton BEFORE the frame connectors are appended:
 *  - `bodyRectByKey`: the resource CARD body rects, keyed EXACTLY as
 *    `collectTerraformResourceRects` keys the converted elements (same
 *    last-wins). Icon injection only restacks the card's groupIds and repair
 *    reads x/y/width/height, so the skeleton rect geometry equals the converted
 *    body rect repair validates against.
 *  - `structuralPairKeys`: the 18px structural-dependency offset set (empty in
 *    strata scenes today — only `topologyFrameFlow`/`declaredDataFlow` edges
 *    exist — but collected for parity so the offset can never drift from repair).
 */
function buildStrataEdgeStyleAnchors(
  skeleton: readonly ExcalidrawElementSkeleton[],
): StrataEdgeStyleAnchors {
  const rectByKey = collectTerraformResourceRectsByKey(skeleton);
  const bodyRectByKey = new Map<string, EdgeAnchorRect>();
  for (const [key, rect] of rectByKey) {
    const r = rect as unknown as EdgeAnchorRect;
    bodyRectByKey.set(key, {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
    });
  }
  return {
    bodyRectByKey,
    structuralPairKeys:
      collectTerraformStructuralDependencyPairKeysFromItems(skeleton),
  };
}

/** The topology hull roles whose frames the E3.1 smoothing pass treats as
 * LR-discipline walls (mirrors the scoreboard's `TOPOLOGY_ROLES` — leaf
 * cluster frames are deliberately NOT walls; clip endpoints sit ON them). */
const SMOOTH_HULL_ROLES: ReadonlySet<string> = new Set([
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

/** Collect the emitted hull frame rects for the smoothing pass's
 * top/bottom-border guard — read from the SKELETON so the guard sees exactly
 * the frames the wrong-face metric measures against. */
function collectStrataHullFrameRects(
  skeleton: readonly ExcalidrawElementSkeleton[],
): EdgeAnchorRect[] {
  const rects: EdgeAnchorRect[] = [];
  for (const el of skeleton) {
    if ((el as { type?: string }).type !== "frame") {
      continue;
    }
    const cd = (el as { customData?: Record<string, unknown> }).customData;
    const role = cd?.terraformTopologyRole;
    if (typeof role !== "string" || !SMOOTH_HULL_ROLES.has(role)) {
      continue;
    }
    const r = el as unknown as EdgeAnchorRect;
    rects.push({ x: r.x, y: r.y, width: r.width, height: r.height });
  }
  return rects;
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
  /** Present only when `edgeClip` was requested (flag-OFF byte-identity). */
  edgeClip?: StrataEdgeClipMeta;
  /** Present only when `channelRoute` was requested (flag-OFF byte-identity). */
  channelRoute?: StrataChannelRouteMeta;
  /** Present only when `edgeRouting` was requested (flag-OFF byte-identity). */
  edgeRouting?: StrataEdgeRoutingMeta;
  /** Present only when `borderRoute` was requested (flag-OFF byte-identity). */
  borderRoute?: StrataBorderRouteMeta;
  /** Present only when a non-"straight" `edgeStyle` was requested. */
  edgeStyle?: StrataEdgeStyleMeta;
  /** Present only when `edgeSmooth` was requested (flag-OFF byte-identity). */
  edgeSmooth?: StrataEdgeSmoothMeta;
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

  // ── Shared body-rect anchor authority. The CARD body rects (+ the structural-
  // dependency pair keys) `repairTerraformEdgeBindings` re-derives at element
  // time (terraformEdgeAnchors.ts). Collected ONCE here — BEFORE the edge passes —
  // so ALL FOUR consumers (channel router, around-boxes router, border router,
  // edge-style pass) re-origin their polyline endpoints onto the SAME anchors
  // repair validates against: composite cards put the leaf FRAME border >48px
  // from the inset body rect, so frame-clipped endpoints get flattened back to
  // chords. A pure read of the card rectangles — the edge passes rewrite only
  // arrow points/x/y/customData, never card skeletons, so hoisting ahead of them
  // is read-only-safe. Computed only when a consumer needs it, so the default-off
  // scene skips the collection and stays byte-identical. ──
  const needsEdgeAnchors =
    input.channelRoute === true ||
    input.edgeRouting === true ||
    input.borderRoute === true ||
    // E3.1 smoothing consumes the same CARD body rects as its obstacle class
    // (triangle-clearance tests), even when only the clip pass stamped edges.
    input.edgeSmooth === true ||
    (input.edgeStyle !== undefined && input.edgeStyle !== "straight");
  const edgeStyleAnchors = needsEdgeAnchors
    ? buildStrataEdgeStyleAnchors(skeleton)
    : undefined;

  // ── Loop-2 E2.1+E2.2 container-boundary CLIP pass (flag-gated; E2.3 gutter
  // nudging + E2.4 over-the-top lanes). Runs FIRST among ALL the edge passes —
  // when ON it owns every eligible cross-cluster declared edge (endpoints
  // clipped ON the leaf-cluster frame borders, LR port discipline, hull port
  // chains; cross-band X-overlap and net-backward edges ride E2.4 lanes above/
  // below the transited bands) and stamps `terraformRoutedPolyline` +
  // `terraformRoutedBy:"clip"` + `terraformClipAnchor`, so the
  // channel/route/border/style passes below (all first-stamper-wins) skip its
  // edges; same-column edges (and backward edges no lane fits) are left
  // unstamped for them. It does NOT consume `edgeStyleAnchors` — its
  // endpoints are frame-border ports, not card-body anchors; repair validates
  // them through the typed "clip" gate instead (terraformVisibility.ts).
  // Absent the flag this never runs (byte-identical). ──
  const edgeClip = input.edgeClip
    ? routeStrataEdgeClip(skeleton, input.model, input.placement)
    : undefined;

  // ── Probe P1 channel routing (flag-gated). Runs FIRST among the router passes
  // and owns the polyline topology: each inter-rank TFD arrow becomes an
  // orthogonal exit-stub → per-channel vertical run → entry-stub polyline. It
  // stamps `terraformRoutedPolyline`, so edgeRouting/borderRoute/edgeStyle below
  // (all first-stamper-wins) SKIP the edges it routed — no double-routing. When
  // a non-"straight" edgeStyle is requested, its channel polylines are emitted
  // with roundness so the renderer softens their corners (minimal integration).
  // Its polyline endpoints are re-origined onto `edgeStyleAnchors` (the SAME body
  // rects repair validates) so the stamped channel polylines survive repair.
  // Absent the flag this never runs (byte-identical). ──
  const channelRoute = input.channelRoute
    ? routeStrataChannelEdges(
        skeleton,
        input.model,
        input.placement,
        input.edgeStyle !== undefined && input.edgeStyle !== "straight",
        edgeStyleAnchors,
      )
    : undefined;

  // ── Package C spike (W9, flag-gated): detour TFD arrows whose straight
  // chord penetrates a foreign box. Runs on the just-emitted TFD arrows only
  // (the aggregated frame connectors below are relationship.aggregated and
  // would be skipped anyway); interior waypoints/customData change and its
  // polyline endpoints are re-origined onto `edgeStyleAnchors` (E1.5 — the SAME
  // body rects repair validates, so the stamped detours survive repair instead
  // of flattening on the frame-vs-body gap). Bindings and card skeletons are
  // untouched, so frame-parenting below is unaffected. Absent the flag this pass
  // never runs.
  const edgeRouting = input.edgeRouting
    ? routeStrataSkeletonEdges(
        skeleton,
        input.model,
        input.placement,
        edgeStyleAnchors,
      )
    : undefined;

  // ── P3-pierce border-exit routing (flag-gated). Runs AFTER edgeRouting and
  // is kept DISJOINT from it: border-route SKIPS any arrow already stamped
  // `terraformRoutedPolyline` by edgeRouting (it would otherwise re-derive
  // [start,W,end] from the endpoints, discarding edgeRouting's foreign-detour
  // waypoints). So each edge is owned by whichever pass fired first — no
  // clobber, no re-pierce. Its exit/entry waypoints and endpoints are re-origined
  // onto `edgeStyleAnchors` (E1.5), the SAME body rects repair validates. Absent
  // the flag this never runs. ──
  const borderRoute = input.borderRoute
    ? routeStrataBorderExits(
        skeleton,
        input.model,
        input.placement,
        edgeStyleAnchors,
      )
    : undefined;

  // ── Probe P2 edge STYLE (flag-gated). Runs LAST of the edge passes and
  // SKIPS any arrow the two routers above already stamped, so routing wins and
  // only un-routed chords get restyled. Absent / "straight" this never runs
  // (byte-identical). The styled polyline's endpoints are clipped against the
  // keyed CARD body rects — the SAME rects `repairTerraformEdgeBindings`
  // validates against — so repair keeps the stamp instead of flattening the
  // curve. Both the rect map (keyed exactly as `collectTerraformResourceRects`)
  // and the structural-dependency pair keys (repair's 18px offset) are collected
  // from the skeleton HERE, before the frame connectors below are appended. ──
  const edgeStyle =
    input.edgeStyle && input.edgeStyle !== "straight"
      ? applyStrataEdgeStyle(
          skeleton,
          input.model,
          input.placement,
          input.edgeStyle,
          // Same shared anchor authority the channel router above consumed —
          // hoisted so both passes clip endpoints to the identical body rects.
          edgeStyleAnchors,
        )
      : undefined;

  // ── Loop-3 E3.1 GLEE smoothing pass (flag-gated). Runs AFTER all five
  // stampers above, BEFORE convert/repair: every stamped routed polyline
  // (channel/route/border/clip provenance) gets the inflection shortcut +
  // collinear dedupe + chamfer corner rounding, and `roundness:null` so the
  // rendered stroke IS the computed path (E1.1 rationale — the routed records
  // otherwise keep `{type:2}` and RoughJS re-splines them into wiggles/arcs).
  // "style" records are skipped (already exact-path). Endpoints, provenance
  // and clip anchors are NEVER touched, so both repair gates (typed clip face
  // ±2px; card-anchored 48px) validate the smoothed polylines unchanged.
  // Consumes the CARD body rects from `edgeStyleAnchors` (hull interiors
  // deliberately untested — cheap obstacle class) plus the emitted HULL frame
  // rects for the LR-discipline guard: a smoothing diagonal must never cross a
  // hull's top/bottom border (it would re-introduce the wrong-face crossings
  // the clip discipline eliminated). Absent the flag this never runs
  // (byte-identical). ──
  const edgeSmooth =
    input.edgeSmooth && edgeStyleAnchors
      ? smoothStrataRoutedEdges(
          skeleton,
          [...edgeStyleAnchors.bodyRectByKey.values()],
          collectStrataHullFrameRects(skeleton),
        )
      : undefined;

  // ── aggregated hull-to-hull connectors + edge frame-parenting (geometry-
  // preserving; neither moves a frame — SEAM #6 safe). ──
  // NOTE: these aggregated `topologyFrameFlow` hull connectors are intentionally
  // NOT edge-styled. They are appended AFTER the style pass above, and the style
  // pass is layer/aggregated-filtered (it only touches per-resource TFD chords),
  // so it would skip them anyway. Their curvature is whatever hardcoded roundness
  // this appender emits — the curve-fix track leaves that untouched. Wave-4 owns
  // the decision on whether hull connectors should participate in edge styling.
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
    ...(edgeClip ? { edgeClip } : {}),
    ...(channelRoute ? { channelRoute } : {}),
    ...(edgeRouting ? { edgeRouting } : {}),
    ...(borderRoute ? { borderRoute } : {}),
    ...(edgeStyle ? { edgeStyle } : {}),
    ...(edgeSmooth ? { edgeSmooth } : {}),
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
  /** Present only when `edgeClip` was requested (flag-OFF byte-identity). */
  edgeClip?: StrataEdgeClipMeta;
  /** Present only when `channelRoute` was requested (flag-OFF byte-identity). */
  channelRoute?: StrataChannelRouteMeta;
  /** Present only when `edgeRouting` was requested (flag-OFF byte-identity). */
  edgeRouting?: StrataEdgeRoutingMeta;
  /** Present only when `borderRoute` was requested (flag-OFF byte-identity). */
  borderRoute?: StrataBorderRouteMeta;
  /** Present only when a non-"straight" `edgeStyle` was requested. */
  edgeStyle?: StrataEdgeStyleMeta;
  /** Present only when `edgeSmooth` was requested (flag-OFF byte-identity). */
  edgeSmooth?: StrataEdgeSmoothMeta;
  /** M3 telemetry: repair's keep/flatten/strip census over the stamped routed
   * polylines this scene fed it. Always present (repair always runs); zeroed on
   * a default/"straight" scene that stamped nothing. */
  repair: TerraformEdgeRepairStats;
}> {
  // Closure-free stage timing (see terraformPipelineStrata.ts): zero overhead
  // when the profiler is disabled, and the async span is timed around its await
  // WITHOUT touching the shared sync stack.
  const profileOn = isTerraformImportProfilerEnabled();
  const spanNow = (): number => (profileOn ? performance.now() : 0);
  const spanRecord = (name: string, since: number): void => {
    if (profileOn) {
      terraformImportProfilerRecord(name, performance.now() - since);
    }
  };

  const tSkeleton = spanNow();
  const {
    skeleton,
    frameEdgeCount,
    edgeClip,
    channelRoute,
    edgeRouting,
    borderRoute,
    edgeStyle,
    edgeSmooth,
  } = assembleStrataSceneSkeleton(input);
  spanRecord("strata.sceneBuild.skeleton", tSkeleton);
  const tConvert = spanNow();
  // M3 telemetry: the shared kernel's `repairTerraformEdgeBindings` accumulates
  // its keep/flatten/strip verdict here, so the scene can report how many styled
  // routed polylines actually survived repair (vs the styling COUNT the M2 bug
  // exposed a gap against). Zeroed on a default/"straight" scene (nothing stamped).
  const repair = createTerraformEdgeRepairStats();
  const converted = await convertPipelineSkeletonToElements(skeleton, repair);
  spanRecord("strata.sceneBuild.convert", tConvert);
  const tFinalize = spanNow();
  const elements = finalizeStrataScene(converted, {
    generation: input.generation ?? 1,
  });
  spanRecord("strata.finalize", tFinalize);
  return {
    elements,
    frameEdgeCount,
    repair,
    ...(edgeClip ? { edgeClip } : {}),
    ...(channelRoute ? { channelRoute } : {}),
    ...(edgeRouting ? { edgeRouting } : {}),
    ...(borderRoute ? { borderRoute } : {}),
    ...(edgeStyle ? { edgeStyle } : {}),
    ...(edgeSmooth ? { edgeSmooth } : {}),
  };
}
