/* eslint-disable max-lines */
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import {
  buildTerraformResourceCardCustomData,
  shortTerraformResourceLabel,
  type TerraformDependencyLayoutBox,
} from "./terraformElkLayout";
import {
  isPrimaryVisibleResourceType,
  spreadClusterFrameColors,
} from "./terraformPrimaryVisibility";
import {
  getTerraformCardResourceType,
  getTerraformResourceShortDisplayName,
} from "./terraformResourceCardLabel";
import {
  DECLARED_DATAFLOW_ORDERED_KEY,
  type DeclaredDataFlowEdge,
} from "./terraformDeclaredDataFlow";
import { buildArnIndexForTopology } from "./terraformTopologyIamLinks";
import { filterPlanByProviderFamily } from "./terraformProviderClassification";
import { getTerraformImportPrepCache } from "./terraformImportPrepCache";
import {
  buildEnrichedTopologyPlacements,
  topologyAddressPlacementMap,
  type EnrichedTopologyPlacements,
  type TopologyAddressPlacement,
} from "./terraformTopologyPlacementBuild";
import {
  buildCompactPipelinePrimaryCluster,
  buildTopologyPrimaryClusterSkeletonForPipeline,
  type PipelinePrimaryClusterBuildResult,
} from "./terraformTopologyLayout";
import { resolveAlbCompanionParentLbAddressFromPlan } from "./terraformTopologyAlbLinks";
import { buildAllSatellitePrimaryMappings } from "./terraformTopologySatelliteRegistry";
import {
  isTerraformImportProfilerEnabled,
  terraformImportProfilerMeasure,
} from "./terraformImportProfiler";

import { withTerraformPlanNodeKeyIndex } from "./terraformPlanParsing";

import type {
  TerraformPlanGraphNode,
  TerraformPlanNodesMap,
} from "./terraformPlanParsing";

export type PipelinePlacement = TopologyAddressPlacement;

export type PipelineCluster = {
  id: string;
  primaryAddress: string;
  firstSequence: number;
  depth: number;
  placement: PipelinePlacement;
  build: PipelinePrimaryClusterBuildResult;
  ancillaryScopeRole?: AncillaryStrip["scopeRole"];
};

export type CollapsedPipelineEdge = {
  source: string;
  target: string;
  sequence: number;
  original: DeclaredDataFlowEdge;
};

export type PipelineLayoutPrep = {
  clusters: PipelineCluster[];
  collapsedEdges: CollapsedPipelineEdge[];
  maxDepth: number;
  columnX: number[];
  depthResult: { depths: Map<string, number>; hasCycle: boolean };
  /**
   * Whether the network-simplex ranker (`networkSimplexRank`) actually rewrote the
   * depth floor. False when the toggle is off, the candidate failed verify-or-abort
   * (`nsSkipReason: "infeasible-fallback"`), or the DAG was cyclic
   * (`nsSkipReason: "cyclic-skip"`) — in every non-applied case the longest-path
   * floor is kept and `nsSkipReason` records why (surfaced in scene meta).
   */
  networkSimplexApplied: boolean;
  nsSkipReason?: "infeasible-fallback" | "cyclic-skip";
  /** satellite address -> owning primary address (all plan primaries). */
  satelliteOwners: ReadonlyMap<string, string>;
  /** Every plan address -> topology placement (unknown-* fallbacks included). */
  placementByAddress: ReadonlyMap<string, PipelinePlacement>;
};

export type AncillaryCard = {
  address: string;
  /** True placement incl. subnet info (kept on the card for expand-on-click). */
  placement: PipelinePlacement;
  build: PipelinePrimaryClusterBuildResult;
};

/**
 * One "Unconnected" strip of non-TFD resources, hosted at the bottom of its
 * deepest trustworthy topology hull.
 */
export type AncillaryStrip = {
  scopeRole: "provider" | "account" | "region" | "vpc";
  scopeKey: string;
  /** Scope-level placement — subnet info dropped so no subnetZone frame forms. */
  placement: PipelinePlacement;
  stripFrameId: string;
  cards: AncillaryCard[];
};

export const PIPELINE_MARGIN = 50;
export const PIPELINE_FRAME_PAD = 28;
export const PIPELINE_COLUMN_GAP = 150;
export const PIPELINE_CLUSTER_GAP_Y = 36;
export const PIPELINE_LANE_GAP_Y = 96;
const FALLBACK_W = 220;
const FALLBACK_H = 96;

type ResourceChange = {
  address?: string;
  type?: string;
};

function getPrimaryResource(
  node: TerraformPlanGraphNode | undefined,
): Record<string, unknown> | undefined {
  const first = Object.values(node?.resources || {})[0];
  return first && typeof first === "object"
    ? (first as Record<string, unknown>)
    : undefined;
}

export function resourceTypeFor(
  nodes: TerraformPlanNodesMap,
  address: string,
): string {
  const node = nodes[address] as TerraformPlanGraphNode | undefined;
  return getTerraformCardResourceType(address, getPrimaryResource(node));
}

function providerFamilyForType(type: string): string {
  const i = type.indexOf("_");
  return i > 0 ? type.slice(0, i) : "terraform";
}

function planChanges(plan: unknown): ResourceChange[] {
  const changes = (plan as { resource_changes?: unknown[] })?.resource_changes;
  return Array.isArray(changes) ? (changes as ResourceChange[]) : [];
}

function buildSatelliteOwnerMap(
  nodes: TerraformPlanNodesMap,
  plan: unknown,
): Map<string, string> {
  const arnIndex = buildArnIndexForTopology(nodes);
  const primaryAddresses = Object.keys(nodes)
    .filter((key) => !key.startsWith("__"))
    .filter((addr) =>
      isPrimaryVisibleResourceType(resourceTypeFor(nodes, addr)),
    )
    .sort();
  const out = buildAllSatellitePrimaryMappings(
    nodes,
    arnIndex,
    primaryAddresses,
    plan,
  );

  const changes = planChanges(plan);
  for (const rc of changes) {
    if (!rc.address) {
      continue;
    }
    const parent = resolveAlbCompanionParentLbAddressFromPlan(
      rc as any,
      changes as any,
    );
    if (parent) {
      out.set(rc.address, parent);
    }
  }
  return out;
}

function collapseEndpoint(
  nodes: TerraformPlanNodesMap,
  satelliteOwners: ReadonlyMap<string, string>,
  address: string,
): string {
  const owner = satelliteOwners.get(address);
  if (owner && nodes[owner]) {
    return owner;
  }
  const type = resourceTypeFor(nodes, address);
  if (isPrimaryVisibleResourceType(type)) {
    return address;
  }
  return address;
}

export function buildPlacementMap(
  nodes: TerraformPlanNodesMap,
  plan: unknown,
  enrichedOverride?: EnrichedTopologyPlacements,
  precomputedSatelliteAddresses?: ReadonlySet<string>,
): Map<string, PipelinePlacement> {
  const awsPlan = filterPlanByProviderFamily(plan as any, "aws");
  const cache = getTerraformImportPrepCache();
  let enriched = enrichedOverride ?? cache?.enrichedPlacements;
  if (!enriched) {
    enriched = buildEnrichedTopologyPlacements(awsPlan, nodes, {
      precomputedSatelliteAddresses,
    });
    if (cache) {
      cache.enrichedPlacements = enriched;
    }
  }
  const out = topologyAddressPlacementMap(enriched, awsPlan);

  for (const address of Object.keys(nodes)) {
    if (address.startsWith("__") || out.has(address)) {
      continue;
    }
    const type = resourceTypeFor(nodes, address);
    out.set(address, {
      providerFamily: providerFamilyForType(type),
      accountId: "unknown-account",
      region: "unknown-region",
      vpcId: null,
    });
  }
  return out;
}

export function pipelineFrameCustomData(
  role: string,
  p: PipelinePlacement,
  key: string,
  extras?: Record<string, unknown>,
) {
  return {
    terraform: true,
    terraformSemanticOverview: true,
    terraformPipelineView: true,
    terraformTopologyRole: role,
    terraformTopologyKey: key,
    terraformTopologyPath:
      role === "provider"
        ? [p.providerFamily]
        : role === "account"
        ? [p.providerFamily, p.accountId]
        : role === "region"
        ? [p.providerFamily, p.accountId, p.region]
        : role === "vpc"
        ? [p.providerFamily, p.accountId, p.region, p.vpcId]
        : [
            p.providerFamily,
            p.accountId,
            p.region,
            p.vpcId,
            p.subnetSignature,
          ].filter(Boolean),
    ...(p.subnetIds ? { terraformSubnetIds: p.subnetIds } : {}),
    ...(extras ?? {}),
  };
}

export function buildFallbackCluster(
  address: string,
  nodes: TerraformPlanNodesMap,
  plan: unknown,
  placement: PipelinePlacement,
): PipelinePrimaryClusterBuildResult {
  const frameId = `tf-pipeline:cluster:${encodeURIComponent(address)}`;
  const node = nodes[address] as TerraformPlanGraphNode | undefined;
  const resource = getPrimaryResource(node);
  const fallbackResourceType = resourceTypeFor(nodes, address);
  const fallbackSubtitle =
    getTerraformResourceShortDisplayName(fallbackResourceType);
  const skeleton: ExcalidrawElementSkeleton[] = [
    {
      type: "rectangle",
      id: address,
      x: 10,
      y: 10,
      width: FALLBACK_W,
      height: FALLBACK_H,
      strokeWidth: 1.5,
      strokeColor: "#64748b",
      backgroundColor: "#f8fafc",
      roundness: { type: 3, value: 8 },
      label: {
        text: `${shortTerraformResourceLabel(address)}\n${fallbackSubtitle}`,
        fontSize: 12,
        strokeColor: "#0f172a",
      },
      customData: {
        terraform: true,
        terraformSemanticOverview: true,
        terraformVisibilityRole: "resource",
        terraformVisibilityKey: address,
        terraformNodeKind: "resource",
        terraformInitiallyVisible: true,
        terraformSatelliteTier: 0,
        terraformExplodeParentKeys: [],
        terraformExplodeParent: null,
        terraformExpandAllView: false,
        ...buildTerraformResourceCardCustomData(address, resource, node, plan),
      },
    },
    {
      type: "frame",
      id: frameId,
      name: shortTerraformResourceLabel(address).slice(0, 48),
      x: 0,
      y: 0,
      width: FALLBACK_W + 20,
      height: FALLBACK_H + 20,
      ...spreadClusterFrameColors(fallbackResourceType),
      children: [address],
      customData: pipelineFrameCustomData(
        "primaryCluster",
        placement,
        frameId,
        {
          terraformPrimaryAddress: address,
        },
      ),
    },
  ];
  return {
    skeleton,
    width: FALLBACK_W + 20,
    height: FALLBACK_H + 20,
    clusterFrameId: frameId,
  };
}

/**
 * Longest-path layering on a DAG, shared by every column/depth consumer (RCLL
 * §7.2a, RFC docs/pipeline-rcll-layout-design.md). Kahn's algorithm assigns each
 * node the length of the longest path reaching it (`col(v) = max over preds p of
 * col(p)+1`, sources at 0); the result is order-independent, so it is
 * deterministic regardless of edge/node ordering. `rankOf` only breaks ties in
 * the processing queue (cosmetic — does not change the returned columns), kept so
 * callers reproduce a stable, byte-identical traversal.
 *
 * On a cycle the nodes on/behind it never settle (their indegree never reaches
 * 0); they are returned in `unresolved` with `hasCycle = true`, and each caller
 * applies its OWN fallback (e.g. `computeDepths` clamps them to `firstSequence`;
 * the RCLL layering stacks a cyclic container's children sequentially). The
 * helper itself stays minimal — longest-path + cycle detection, no policy.
 *
 *   nodeKeys ─┐
 *   edges  ───┼─► Kahn longest-path ─► column (settled nodes)
 *   rankOf ───┘                     └─► unresolved (cyclic) + hasCycle
 */
export function longestPath(
  nodeKeys: readonly string[],
  edges: readonly { from: string; to: string }[],
  rankOf: (key: string) => number,
): {
  column: Map<string, number>;
  hasCycle: boolean;
  unresolved: ReadonlySet<string>;
} {
  const indegree = new Map<string, number>(nodeKeys.map((k) => [k, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.from);
    if (list) {
      list.push(edge.to);
    } else {
      outgoing.set(edge.from, [edge.to]);
    }
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    if (!indegree.has(edge.from)) {
      indegree.set(edge.from, 0);
    }
  }
  const cmp = (a: string, b: string): number =>
    rankOf(a) - rankOf(b) || a.localeCompare(b);
  const ready = nodeKeys.filter((k) => (indegree.get(k) ?? 0) === 0).sort(cmp);
  const column = new Map<string, number>(nodeKeys.map((k) => [k, 0]));
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.shift()!;
    visited += 1;
    for (const to of outgoing.get(id) ?? []) {
      column.set(to, Math.max(column.get(to) ?? 0, (column.get(id) ?? 0) + 1));
      const nextIn = (indegree.get(to) ?? 0) - 1;
      indegree.set(to, nextIn);
      if (nextIn === 0) {
        ready.push(to);
        ready.sort(cmp);
      }
    }
  }
  const unresolved = new Set<string>();
  for (const k of nodeKeys) {
    if ((indegree.get(k) ?? 0) > 0) {
      unresolved.add(k);
    }
  }
  return { column, hasCycle: visited < nodeKeys.length, unresolved };
}

/**
 * Strongly-connected components of a directed graph (Tarjan, iterative).
 * Returns `nodeKey → representative key` (the lexicographically-smallest member
 * of its SCC), so the result is deterministic regardless of edge/node order. An
 * acyclic node is its own singleton SCC. Used to condense a cyclic container's
 * hull graph `D_H` into a DAG (layering + placement) AND to detect genuine
 * cluster-level cycles in `D` (the iron-rule gate excuses only those).
 */
export function stronglyConnectedComponents(
  nodeKeys: readonly string[],
  edges: readonly { from: string; to: string }[],
): Map<string, string> {
  const adj = new Map<string, string[]>();
  for (const k of nodeKeys) {
    adj.set(k, []);
  }
  for (const e of edges) {
    adj.get(e.from)?.push(e.to);
  }
  for (const list of adj.values()) {
    list.sort(); // deterministic neighbor order
  }

  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const rep = new Map<string, string>();

  for (const start of nodeKeys) {
    if (idx.has(start)) {
      continue;
    }
    const work: { node: string; i: number }[] = [{ node: start, i: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const v = frame.node;
      if (frame.i === 0) {
        idx.set(v, index);
        low.set(v, index);
        index += 1;
        stack.push(v);
        onStack.add(v);
      }
      const neighbors = adj.get(v) ?? [];
      if (frame.i < neighbors.length) {
        const w = neighbors[frame.i]!;
        frame.i += 1;
        if (!idx.has(w)) {
          work.push({ node: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, idx.get(w)!));
        }
      } else {
        if (low.get(v) === idx.get(v)) {
          const members: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            members.push(w);
          } while (w !== v);
          const r = members.reduce((a, b) => (a.localeCompare(b) <= 0 ? a : b));
          for (const m of members) {
            rep.set(m, r);
          }
        }
        work.pop();
        const parent = work[work.length - 1];
        if (parent) {
          low.set(parent.node, Math.min(low.get(parent.node)!, low.get(v)!));
        }
      }
    }
  }
  return rep;
}

export function computeDepths(
  clusterEdges: Array<{ source: string; target: string; sequence: number }>,
  clusterIds: readonly string[],
): { depths: Map<string, number>; hasCycle: boolean } {
  // Tiebreak rank: min TFD sequence touching a cluster (0 if it touches none).
  const firstSeq = new Map<string, number>();
  for (const edge of clusterEdges) {
    firstSeq.set(
      edge.source,
      Math.min(firstSeq.get(edge.source) ?? edge.sequence, edge.sequence),
    );
    firstSeq.set(
      edge.target,
      Math.min(firstSeq.get(edge.target) ?? edge.sequence, edge.sequence),
    );
  }
  const { column, hasCycle, unresolved } = longestPath(
    clusterIds,
    clusterEdges.map((e) => ({ from: e.source, to: e.target })),
    (id) => firstSeq.get(id) ?? 0,
  );
  // Cyclic clusters never settled a longest-path floor; clamp each to its
  // firstSequence (the prior behaviour — keeps the depth bounded + deterministic).
  for (const id of unresolved) {
    column.set(id, firstSeq.get(id) ?? 0);
  }
  return { depths: column, hasCycle };
}

/**
 * Experimental width-budgeted column assignment (Phase A).
 *
 * The pipeline's natural longest-path layering is ASAP — every cluster sits as
 * far LEFT as its TFD predecessors allow, which crowds early columns and crams
 * receivers next to their producers. Phase A instead pushes each cluster as far
 * RIGHT as it can go without crossing a successor (ALAP within its slack window),
 * so a chain spreads across columns and each cluster sits adjacent to the
 * consumers it feeds — the "push nodes deeper than they strictly need to be"
 * intuition that reads wider / flatter and keeps the left-to-right flow honest.
 *
 * `dL(v) = maxDepth − (longest path in edges from v to any sink)` is the latest
 * column `v` can occupy while every edge still satisfies `depth(src) < depth(tgt)`
 * — so the result is order-safe by construction. Deterministic: pure function of
 * the longest-path depths. Critical-path clusters (zero slack) do not move, so
 * `maxDepth` is preserved.
 */
export function computeWidthBudgetedDepths(
  collapsedEdges: readonly { source: string; target: string }[],
  clusters: readonly PipelineCluster[],
  longestPathDepths: ReadonlyMap<string, number>,
): Map<string, number> {
  const ids = clusters.map((c) => c.id);
  const d0 = new Map(ids.map((id) => [id, longestPathDepths.get(id) ?? 0]));
  if (ids.length === 0) {
    return d0;
  }
  const maxDepth = Math.max(0, ...d0.values());

  const succs = new Map<string, string[]>();
  for (const e of collapsedEdges) {
    succs.set(e.source, [...(succs.get(e.source) ?? []), e.target]);
  }

  // Longest path (in edges) from each node to a sink. Process in descending d0
  // order so every successor is resolved before the node itself (d0 is a valid
  // topological layering: d0(src) < d0(tgt)).
  const toSink = new Map<string, number>(ids.map((id) => [id, 0]));
  const byDepthDesc = [...ids].sort(
    (a, b) => d0.get(b)! - d0.get(a)! || a.localeCompare(b),
  );
  for (const id of byDepthDesc) {
    let best = 0;
    for (const s of succs.get(id) ?? []) {
      best = Math.max(best, 1 + (toSink.get(s) ?? 0));
    }
    toSink.set(id, best);
  }

  // Center each cluster within its order-safe slack window [d0, dL]. This
  // spreads chains rightward (wider/flatter than pure ASAP) without collapsing
  // them onto their successors the way pure ALAP does — which keeps edges short
  // and avoids the crossing blow-up ALAP causes. Zero-slack (critical-path)
  // clusters stay put, preserving maxDepth.
  const depths = new Map<string, number>();
  for (const id of ids) {
    const lo = d0.get(id)!;
    const hi = maxDepth - (toSink.get(id) ?? 0);
    depths.set(id, Math.round((lo + hi) / 2));
  }
  return depths;
}

/**
 * Verify-or-abort guard for swapping the cluster depth floor. A candidate depth
 * assignment is applied only if it keeps EVERY collapsed edge forward
 * (`depth(src) < depth(tgt)`) — the order-safety invariant the whole RCLL
 * layering relies on. Shared by the experimental ALAP arm and the X-axis
 * network-simplex ranker so the swap + dual-write logic lives in one place.
 *
 * On a valid candidate it DUAL-WRITES both downstream consumers and returns the
 * new depth result; on an infeasible candidate it returns `null` and the caller
 * keeps the longest-path floor. The two writes are distinct and both
 * load-bearing — writing only one ships green and changes nothing:
 *   1. `cluster.depth` (mutated in place) → `computeGlobalColumnX` column-width
 *      pixel geometry.
 *   2. the returned `{ depths }` → `effectiveDepthResult` → `buildRcllModel`
 *      `lattice.floor` (the RCLL `denseRank` column axis, primary layering input).
 */
export function applyDepthFloorIfValid(
  clusters: readonly PipelineCluster[],
  candidate: ReadonlyMap<string, number>,
  collapsedEdges: readonly { source: string; target: string }[],
): { depths: Map<string, number>; hasCycle: false } | null {
  const valid = collapsedEdges.every(
    (edge) =>
      (candidate.get(edge.source) ?? 0) < (candidate.get(edge.target) ?? 0),
  );
  if (!valid) {
    return null;
  }
  for (const cluster of clusters) {
    cluster.depth = candidate.get(cluster.id) ?? cluster.depth; // DUAL-WRITE #1
  }
  return { depths: new Map(candidate), hasCycle: false }; // DUAL-WRITE #2
}

type NsEdge = { u: string; v: string; w: number };

/**
 * X-axis network-simplex ranker — minimum-weighted-span layering of the acyclic
 * collapsed cluster DAG (Gansner, Koutsofios, North & Vo, TSE93 "dot": feasible
 * tight tree → cut values → entering/leaving pivots to the EXACT optimum →
 * balance), the proven CONFIRMED-GO edge-length lever (probe: width −8.4%, total
 * span 262→190 on staging-extended-localstack-v2). Signature mirrors
 * `computeWidthBudgetedDepths`. Minimizes Σ w(e)·(rank(v)−rank(u)) subject to
 * rank(v) ≥ rank(u)+1, where the per-pair weight `w` is the parallel-edge count.
 *
 * Pure + fully deterministic — every tie-break (entering edge, leaving edge,
 * balance target) resolves by sorted `(u,v)` / id order; no `Math.random`/`Date`.
 * Leaving-edge selection uses Bland's rule (first negative-cut tree edge in fixed
 * order), which both pins determinism AND prevents pivot cycling. EXACT to the
 * optimum — never a capped/partial result: a heuristic stalls at a plausible-but-
 * wrong smaller win (a balance heuristic stalled −10.3%, a sign-bug −7.3%, both
 * still "every edge forward"), so only the true simplex is trustworthy. If the
 * safety pivot ceiling is ever hit that is a BUG (not a slow case) → return the
 * input unchanged so the caller keeps the longest-path floor.
 *
 * The caller applies the result through `applyDepthFloorIfValid` (verify-or-abort),
 * so an out-of-order return is caught and the longest-path floor kept, never
 * shipped. Solves each weakly-connected component independently (a disconnected
 * DAG is min-span per component); nodes touched by no edge keep their longest-path
 * rank.
 */
export function computeNetworkSimplexDepths(
  collapsedEdges: readonly { source: string; target: string }[],
  clusterIds: readonly string[],
  longestPathDepths: ReadonlyMap<string, number>,
): Map<string, number> {
  const ids = [...clusterIds];
  const identity = (): Map<string, number> =>
    new Map(ids.map((id) => [id, longestPathDepths.get(id) ?? 0]));
  if (ids.length === 0) {
    return new Map();
  }

  // Merge parallel edges (same u→v) into one weighted edge; drop self-loops. The
  // objective Σ w·span is unchanged, and parallel edges can't both be tree edges
  // (they'd form a 2-cycle). The sorted order feeds every tie-break below.
  const SEP = " ";
  const weightByPair = new Map<string, number>();
  for (const e of collapsedEdges) {
    if (e.source === e.target) {
      continue;
    }
    const k = e.source + SEP + e.target;
    weightByPair.set(k, (weightByPair.get(k) ?? 0) + 1);
  }
  const edges: NsEdge[] = [...weightByPair.entries()]
    .map(([k, w]): NsEdge => {
      const sep = k.indexOf(SEP);
      return { u: k.slice(0, sep), v: k.slice(sep + 1), w };
    })
    .sort((a, b) => a.u.localeCompare(b.u) || a.v.localeCompare(b.v));
  if (edges.length === 0) {
    return identity();
  }

  // Ranks start at the feasible longest-path floor (slack ≥ 0 everywhere) and are
  // mutated in place per component below.
  const rank = new Map<string, number>(
    ids.map((id) => [id, longestPathDepths.get(id) ?? 0]),
  );

  // Weakly-connected components (union-find over the merged edges).
  const parent = new Map<string, string>(ids.map((id) => [id, id]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) {
      r = parent.get(r)!;
    }
    while (parent.get(x) !== r) {
      const next = parent.get(x)!;
      parent.set(x, r);
      x = next;
    }
    return r;
  };
  for (const e of edges) {
    const ru = find(e.u);
    const rv = find(e.v);
    if (ru !== rv) {
      parent.set(ru, rv);
    }
  }
  const componentEdges = new Map<string, NsEdge[]>();
  for (const e of edges) {
    const r = find(e.u);
    const list = componentEdges.get(r);
    if (list) {
      list.push(e);
    } else {
      componentEdges.set(r, [e]);
    }
  }

  // Solve one weakly-connected component IN PLACE (writes `rank` for its nodes).
  // Returns false if the component could not be spanned (degenerate) so the caller
  // can abort to the longest-path floor wholesale rather than ship a partial mix.
  const solveComponent = (
    compEdges: NsEdge[],
    compNodes: string[],
  ): boolean => {
    if (compEdges.length === 0) {
      return true;
    }
    const slack = (e: NsEdge): number =>
      (rank.get(e.v) ?? 0) - (rank.get(e.u) ?? 0) - 1;
    const treeEdges = new Set<number>();

    // tight_tree: greedily grow the maximal node set connected to compNodes[0]
    // through slack-0 edges; records the tree edges used.
    const growTightTree = (): Set<string> => {
      treeEdges.clear();
      const nodes = new Set<string>([compNodes[0]!]);
      let grew = true;
      while (grew) {
        grew = false;
        for (let i = 0; i < compEdges.length; i++) {
          const e = compEdges[i]!;
          if (nodes.has(e.u) !== nodes.has(e.v) && slack(e) === 0) {
            nodes.add(e.u);
            nodes.add(e.v);
            treeEdges.add(i);
            grew = true;
          }
        }
      }
      return nodes;
    };

    // feasible_tree: pull the min-slack joining edge tight until the tree spans the
    // component. Each pass adds ≥1 node, so it terminates in ≤|compNodes| passes.
    for (let guard = 0; guard <= compNodes.length; guard++) {
      const nodes = growTightTree();
      if (nodes.size >= compNodes.length) {
        break;
      }
      let bestIdx = -1;
      let bestSlack = Infinity;
      for (let i = 0; i < compEdges.length; i++) {
        const e = compEdges[i]!;
        if (nodes.has(e.u) === nodes.has(e.v)) {
          continue;
        }
        const s = slack(e);
        if (s < bestSlack) {
          bestSlack = s;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) {
        return false; // unreachable for a connected component, but be safe
      }
      const e = compEdges[bestIdx]!;
      const delta = nodes.has(e.v) ? -bestSlack : bestSlack;
      for (const n of nodes) {
        rank.set(n, (rank.get(n) ?? 0) + delta);
      }
    }
    if (treeEdges.size !== compNodes.length - 1) {
      return false;
    }

    // Undirected adjacency for the CURRENT tree (rebuilt after every exchange).
    const buildTreeAdj = (): Map<string, { idx: number; to: string }[]> => {
      const adj = new Map<string, { idx: number; to: string }[]>();
      for (const n of compNodes) {
        adj.set(n, []);
      }
      for (const i of treeEdges) {
        const e = compEdges[i]!;
        adj.get(e.u)!.push({ idx: i, to: e.v });
        adj.get(e.v)!.push({ idx: i, to: e.u });
      }
      return adj;
    };

    // Component of `start` once tree edge `exclude` is removed (the tail side).
    const tailComponent = (
      adj: Map<string, { idx: number; to: string }[]>,
      start: string,
      exclude: number,
    ): Set<string> => {
      const comp = new Set<string>([start]);
      const stack = [start];
      while (stack.length > 0) {
        const n = stack.pop()!;
        for (const { idx, to } of adj.get(n) ?? []) {
          if (idx === exclude || comp.has(to)) {
            continue;
          }
          comp.add(to);
          stack.push(to);
        }
      }
      return comp;
    };

    // Cut value of a tree edge: (Σ w of edges crossing tail→head) − (head→tail).
    const cutValue = (tailComp: Set<string>): number => {
      let value = 0;
      for (const f of compEdges) {
        const tailIn = tailComp.has(f.u);
        const headIn = tailComp.has(f.v);
        if (tailIn && !headIn) {
          value += f.w;
        } else if (!tailIn && headIn) {
          value -= f.w;
        }
      }
      return value;
    };

    // Re-derive ranks so every tree edge is tight (rank(v) = rank(u)+1). Fully
    // determined by the tree (up to a global shift); a valid network-simplex tree
    // stays feasible, and the verify-or-abort caller is the final safety net.
    const retightenRanks = (): void => {
      const adj = buildTreeAdj();
      const seen = new Set<string>([compNodes[0]!]);
      const stack = [compNodes[0]!];
      rank.set(compNodes[0]!, 0);
      while (stack.length > 0) {
        const n = stack.pop()!;
        for (const { idx, to } of adj.get(n) ?? []) {
          if (seen.has(to)) {
            continue;
          }
          const e = compEdges[idx]!;
          rank.set(
            to,
            e.u === n && e.v === to
              ? (rank.get(n) ?? 0) + 1
              : (rank.get(n) ?? 0) - 1,
          );
          seen.add(to);
          stack.push(to);
        }
      }
    };

    const maxPivots = 4 * compNodes.length + 16;
    for (let pivots = 0; ; pivots++) {
      if (pivots > maxPivots) {
        return false; // safety ceiling = BUG → caller keeps longest-path
      }
      const adj = buildTreeAdj();
      // leave_edge: first tree edge (sorted order) with a negative cut value
      // (Bland's rule — fixed order is anti-cycling AND deterministic).
      let leaveIdx = -1;
      let leaveTailComp: Set<string> | null = null;
      for (let i = 0; i < compEdges.length; i++) {
        if (!treeEdges.has(i)) {
          continue;
        }
        const tailComp = tailComponent(adj, compEdges[i]!.u, i);
        if (cutValue(tailComp) < 0) {
          leaveIdx = i;
          leaveTailComp = tailComp;
          break;
        }
      }
      if (leaveIdx < 0) {
        break; // no negative cut value ⇒ optimal
      }
      // enter_edge: a non-tree edge crossing the cut in the OPPOSITE direction
      // (tail in head-side, head in tail-side) with minimum slack; ties → first.
      const tailComp = leaveTailComp!;
      let enterIdx = -1;
      let enterSlack = Infinity;
      for (let i = 0; i < compEdges.length; i++) {
        if (treeEdges.has(i)) {
          continue;
        }
        const f = compEdges[i]!;
        if (!tailComp.has(f.u) && tailComp.has(f.v)) {
          const s = slack(f);
          if (s < enterSlack) {
            enterSlack = s;
            enterIdx = i;
          }
        }
      }
      if (enterIdx < 0) {
        break; // no improving entering edge (should not happen with cutval<0)
      }
      treeEdges.delete(leaveIdx);
      treeEdges.add(enterIdx);
      retightenRanks();
    }
    return true;
  };

  for (const [root, compEdges] of componentEdges) {
    const compNodes = ids.filter((id) => find(id) === root);
    if (!solveComponent(compEdges, compNodes)) {
      return identity();
    }
  }

  // balance: a node whose total in-weight equals its out-weight can slide anywhere
  // in its feasible window [maxInRank+1, minOutRank−1] without changing Σ w·span.
  // Move each such node to the LEAST-populated rank in that window (ties → lowest
  // rank), evening out column occupancy (the width win). Deterministic: nodes
  // processed in sorted id order; population recomputed each step.
  const inW = new Map<string, number>(ids.map((id) => [id, 0]));
  const outW = new Map<string, number>(ids.map((id) => [id, 0]));
  const inNbrs = new Map<string, string[]>(ids.map((id) => [id, []]));
  const outNbrs = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    outW.set(e.u, (outW.get(e.u) ?? 0) + e.w);
    inW.set(e.v, (inW.get(e.v) ?? 0) + e.w);
    outNbrs.get(e.u)!.push(e.v);
    inNbrs.get(e.v)!.push(e.u);
  }
  for (const id of [...ids].sort((a, b) => a.localeCompare(b))) {
    const w = inW.get(id) ?? 0;
    if (w === 0 || w !== (outW.get(id) ?? 0)) {
      continue;
    }
    let low = -Infinity;
    for (const u of inNbrs.get(id) ?? []) {
      low = Math.max(low, (rank.get(u) ?? 0) + 1);
    }
    let high = Infinity;
    for (const v of outNbrs.get(id) ?? []) {
      high = Math.min(high, (rank.get(v) ?? 0) - 1);
    }
    if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) {
      continue;
    }
    const pop = new Map<number, number>();
    for (const other of ids) {
      if (other === id) {
        continue;
      }
      const r = rank.get(other) ?? 0;
      pop.set(r, (pop.get(r) ?? 0) + 1);
    }
    let bestRank = rank.get(id) ?? low;
    let bestPop = Infinity;
    for (let r = low; r <= high; r++) {
      const p = pop.get(r) ?? 0;
      if (p < bestPop) {
        bestPop = p;
        bestRank = r;
      }
    }
    rank.set(id, bestRank);
  }

  // Normalize each weakly-connected component so its minimum rank is 0 (sources at
  // column 0, matching the longest-path convention the rest of the layout assumes).
  const compMin = new Map<string, number>();
  for (const id of ids) {
    const r = find(id);
    compMin.set(r, Math.min(compMin.get(r) ?? Infinity, rank.get(id) ?? 0));
  }
  return new Map(
    ids.map((id) => {
      const base = compMin.get(find(id)) ?? 0;
      return [id, (rank.get(id) ?? 0) - (Number.isFinite(base) ? base : 0)];
    }),
  );
}

export function laneKey(p: PipelinePlacement): string {
  return [
    p.providerFamily,
    p.accountId,
    p.region,
    p.vpcId ?? "",
    p.subnetSignature ?? "",
  ].join("\0");
}

export function providerScopeKey(p: PipelinePlacement): string {
  return p.providerFamily;
}

export function accountScopeKey(p: PipelinePlacement): string {
  return [p.providerFamily, p.accountId].join("\0");
}

export function regionScopeKey(p: PipelinePlacement): string {
  return [p.providerFamily, p.accountId, p.region].join("\0");
}

export function vpcScopeKey(p: PipelinePlacement): string | null {
  return p.vpcId
    ? [p.providerFamily, p.accountId, p.region, p.vpcId].join("\0")
    : null;
}

export function translateSkeleton(
  skeleton: ExcalidrawElementSkeleton[],
  dx: number,
  dy: number,
): ExcalidrawElementSkeleton[] {
  return skeleton.map((el) => ({
    ...el,
    x: (typeof el.x === "number" ? el.x : 0) + dx,
    y: (typeof el.y === "number" ? el.y : 0) + dy,
  }));
}

export function boundsOf(
  ids: readonly string[],
  boxes: ReadonlyMap<string, TerraformDependencyLayoutBox>,
) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const b = boxes.get(id);
    if (!b) {
      continue;
    }
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  if (!Number.isFinite(minX)) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Cumulative left-edge X offsets for a row of columns: column `i` starts at
 * `startX + Σ_{j<i} (widths[j] + gap)`. The arithmetic kernel shared by the
 * global TFD grid (`computeGlobalColumnX`, columns = cluster depths) and the
 * per-container RCLL placement (M3a, columns = `localColumn` over child boxes) —
 * the two differ only in how `widths` is derived, not in the offset math.
 * Empty `widths` ⇒ `[]`; a single column ⇒ `[startX]`.
 */
export function columnOffsetsFromWidths(
  widths: readonly number[],
  startX: number,
  gap: number = PIPELINE_COLUMN_GAP,
): number[] {
  const offsets: number[] = [];
  let x = startX;
  for (let i = 0; i < widths.length; i++) {
    offsets[i] = x;
    x += widths[i]! + gap;
  }
  return offsets;
}

export function computeGlobalColumnX(
  clusters: readonly PipelineCluster[],
  maxDepth: number,
  columnGap: number = PIPELINE_COLUMN_GAP,
): number[] {
  const columnWidths = Array.from({ length: maxDepth + 1 }, (_, depth) =>
    Math.max(
      260,
      ...clusters.filter((c) => c.depth === depth).map((c) => c.build.width),
    ),
  );
  return columnOffsetsFromWidths(
    columnWidths,
    PIPELINE_MARGIN + PIPELINE_FRAME_PAD * 5,
    columnGap,
  );
}

export function layoutLaneClusters(
  laneClusters: readonly PipelineCluster[],
  columnX: readonly number[],
  maxDepth: number,
  originY: number,
): {
  skeleton: ExcalidrawElementSkeleton[];
  layoutBoxes: Map<string, TerraformDependencyLayoutBox>;
  laneBottomY: number;
} {
  const colY = new Map<number, number>();
  for (let d = 0; d <= maxDepth; d++) {
    colY.set(d, originY);
  }
  const skeleton: ExcalidrawElementSkeleton[] = [];
  const layoutBoxes = new Map<string, TerraformDependencyLayoutBox>();
  const ordered = [...laneClusters].sort(
    (a, b) =>
      a.depth - b.depth ||
      a.firstSequence - b.firstSequence ||
      a.id.localeCompare(b.id),
  );
  for (const cluster of ordered) {
    const cx = columnX[cluster.depth]!;
    const cy = colY.get(cluster.depth)!;
    const translated = translateSkeleton(cluster.build.skeleton, cx, cy);
    skeleton.push(...translated);
    const frame = translated.find(
      (el) => el.id === cluster.build.clusterFrameId,
    );
    const frameBox = {
      x: typeof frame?.x === "number" ? frame.x : cx,
      y: typeof frame?.y === "number" ? frame.y : cy,
      width:
        typeof frame?.width === "number" ? frame.width : cluster.build.width,
      height:
        typeof frame?.height === "number" ? frame.height : cluster.build.height,
    };
    layoutBoxes.set(cluster.build.clusterFrameId, { ...frameBox });
    layoutBoxes.set(cluster.id, { ...frameBox });
    colY.set(
      cluster.depth,
      frameBox.y + frameBox.height + PIPELINE_CLUSTER_GAP_Y,
    );
  }
  const laneBottomY =
    Math.max(...Array.from(colY.values()), originY + 1) +
    PIPELINE_LANE_GAP_Y +
    PIPELINE_FRAME_PAD * 4;
  return { skeleton, layoutBoxes, laneBottomY };
}

export const ANCILLARY_STRIP_STROKE = "#94a3b8";
/** Default wrap for strips whose scope has no TFD lanes (~4 compact cards). */
export const ANCILLARY_DEFAULT_WRAP_WIDTH =
  4 * 276 + 3 * PIPELINE_CLUSTER_GAP_Y + 2 * PIPELINE_FRAME_PAD;

export function ancillaryStripFrameId(scopeKey: string): string {
  return `tf-pipeline:ancillaryStrip:${encodeURIComponent(scopeKey)}`;
}

function ancillaryStripRows(
  strip: AncillaryStrip,
  wrapWidth: number,
): {
  effectiveWrap: number;
  positions: { card: AncillaryCard; x: number; y: number }[];
  width: number;
  height: number;
} {
  const pad = PIPELINE_FRAME_PAD;
  const gap = PIPELINE_CLUSTER_GAP_Y;
  const maxCardWidth = Math.max(0, ...strip.cards.map((c) => c.build.width));
  const effectiveWrap = Math.max(wrapWidth, maxCardWidth + 2 * pad);
  const positions: { card: AncillaryCard; x: number; y: number }[] = [];
  let x = pad;
  let y = pad;
  let rowHeight = 0;
  let usedWidth = 0;
  for (const card of strip.cards) {
    if (x > pad && x + card.build.width > effectiveWrap - pad) {
      x = pad;
      y += rowHeight + gap;
      rowHeight = 0;
    }
    positions.push({ card, x, y });
    usedWidth = Math.max(usedWidth, x + card.build.width);
    rowHeight = Math.max(rowHeight, card.build.height);
    x += card.build.width + gap;
  }
  return {
    effectiveWrap,
    positions,
    width: Math.min(effectiveWrap, usedWidth + pad),
    height: y + rowHeight + pad,
  };
}

/**
 * Wrapping flow grid of ancillary cluster cards inside a muted "Unconnected"
 * frame, built at origin. Rows wrap at the host scope's content width so the
 * strip grows the hull downward, not sideways (a single card wider than the
 * scope is the only case that can widen it).
 */
export function layoutAncillaryStrip(
  strip: AncillaryStrip,
  wrapWidth: number,
): {
  skeleton: ExcalidrawElementSkeleton[];
  width: number;
  height: number;
  boxes: Map<string, TerraformDependencyLayoutBox>;
} {
  const rows = ancillaryStripRows(strip, wrapWidth);
  const skeleton: ExcalidrawElementSkeleton[] = [];
  const boxes = new Map<string, TerraformDependencyLayoutBox>();
  for (const { card, x, y } of rows.positions) {
    skeleton.push(...translateSkeleton(card.build.skeleton, x, y));
    boxes.set(card.build.clusterFrameId, {
      x,
      y,
      width: card.build.width,
      height: card.build.height,
    });
  }
  skeleton.push({
    type: "frame",
    id: strip.stripFrameId,
    name: "Unconnected",
    x: 0,
    y: 0,
    width: rows.width,
    height: rows.height,
    strokeColor: ANCILLARY_STRIP_STROKE,
    backgroundColor: "transparent",
    children: strip.cards.map((c) => c.build.clusterFrameId),
    customData: pipelineFrameCustomData(
      "ancillaryStrip",
      strip.placement,
      strip.stripFrameId,
      { terraformPipelineAncillary: true },
    ),
  });
  boxes.set(strip.stripFrameId, {
    x: 0,
    y: 0,
    width: rows.width,
    height: rows.height,
  });
  return { skeleton, width: rows.width, height: rows.height, boxes };
}

/** Height/width-only mirror of `layoutAncillaryStrip` for packed measuring. */
export function measureAncillaryStrip(
  strip: AncillaryStrip,
  wrapWidth: number,
): { width: number; height: number } {
  const rows = ancillaryStripRows(strip, wrapWidth);
  return { width: rows.width, height: rows.height };
}

/**
 * Wrap a placed strip as a pseudo-cluster so `emitTopologyContextFrames`
 * hulls the strip frame into its vpc/region frame like any cluster frame.
 */
export function ancillaryStripAsPseudoCluster(
  strip: AncillaryStrip,
  placedBox: TerraformDependencyLayoutBox,
): PipelineCluster {
  const id = `__ancillary__:${strip.scopeKey}`;
  return {
    id,
    primaryAddress: id,
    firstSequence: Number.MAX_SAFE_INTEGER,
    depth: 0,
    placement: strip.placement,
    ancillaryScopeRole: strip.scopeRole,
    build: {
      skeleton: [],
      width: placedBox.width,
      height: placedBox.height,
      clusterFrameId: strip.stripFrameId,
    },
  };
}

export type PlaceClustersOptions = {
  /** Opt-in nesting-aware semantic placement (forced bands + straightening). */
  semanticPlacement?: boolean;
  /** Experimental view: width-budgeted columns (Phase A) + barycenter order (Phase B). */
  experimentalLayout?: boolean;
};

export function placeClustersClassicGrid(
  prep: PipelineLayoutPrep,
  ancillaryStrips?: readonly AncillaryStrip[],
  _options?: PlaceClustersOptions,
): {
  skeleton: ExcalidrawElementSkeleton[];
  layoutBoxes: Map<string, TerraformDependencyLayoutBox>;
  laneEntries: [string, PipelineCluster[]][];
  ancillaryClusters: PipelineCluster[];
} {
  const lanes = new Map<string, PipelineCluster[]>();
  for (const cluster of prep.clusters) {
    const key = laneKey(cluster.placement);
    lanes.set(key, [...(lanes.get(key) ?? []), cluster]);
  }
  const laneEntries = [...lanes.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const skeleton: ExcalidrawElementSkeleton[] = [];
  const layoutBoxes = new Map<string, TerraformDependencyLayoutBox>();
  const ancillaryClusters: PipelineCluster[] = [];

  const pendingStrips = new Map(
    (ancillaryStrips ?? []).map((strip) => [strip.scopeKey, strip]),
  );
  const scopeSpans = new Map<string, { minX: number; maxX: number }>();

  let laneY = PIPELINE_MARGIN + PIPELINE_FRAME_PAD * 5;

  // Strips are emitted at scope boundaries of the untouched lane order, so a
  // strip lands as the bottom band of its vpc/region hull and the no-strip
  // output stays byte-identical.
  const placeStrip = (scopeKey: string | null): void => {
    if (scopeKey == null) {
      return;
    }
    const strip = pendingStrips.get(scopeKey);
    if (!strip) {
      return;
    }
    pendingStrips.delete(scopeKey);
    const span = scopeSpans.get(scopeKey);
    const stripX = span ? span.minX : PIPELINE_MARGIN + PIPELINE_FRAME_PAD * 5;
    const wrapWidth = span
      ? span.maxX - span.minX
      : ANCILLARY_DEFAULT_WRAP_WIDTH;
    const laid = layoutAncillaryStrip(strip, wrapWidth);
    skeleton.push(...translateSkeleton(laid.skeleton, stripX, laneY));
    for (const [id, box] of laid.boxes) {
      layoutBoxes.set(id, { ...box, x: box.x + stripX, y: box.y + laneY });
    }
    ancillaryClusters.push(
      ancillaryStripAsPseudoCluster(
        strip,
        layoutBoxes.get(strip.stripFrameId)!,
      ),
    );
    laneY += laid.height + PIPELINE_LANE_GAP_Y + PIPELINE_FRAME_PAD * 4;
  };

  let currentVpcKey: string | null = null;
  let currentRegionKey: string | null = null;
  for (const [, laneClusters] of laneEntries) {
    const placement = laneClusters[0]!.placement;
    const vpcKey = vpcScopeKey(placement);
    const regionKey = regionScopeKey(placement);
    if (currentVpcKey !== vpcKey) {
      placeStrip(currentVpcKey);
    }
    if (currentRegionKey !== regionKey) {
      placeStrip(currentRegionKey);
    }
    currentVpcKey = vpcKey;
    currentRegionKey = regionKey;

    const laneLayout = layoutLaneClusters(
      laneClusters,
      prep.columnX,
      prep.maxDepth,
      laneY,
    );
    skeleton.push(...laneLayout.skeleton);
    for (const [id, box] of laneLayout.layoutBoxes) {
      layoutBoxes.set(id, box);
    }
    if (pendingStrips.size > 0) {
      for (const scopeKey of vpcKey ? [vpcKey, regionKey] : [regionKey]) {
        let span = scopeSpans.get(scopeKey);
        if (!span) {
          span = { minX: Infinity, maxX: -Infinity };
          scopeSpans.set(scopeKey, span);
        }
        for (const box of laneLayout.layoutBoxes.values()) {
          span.minX = Math.min(span.minX, box.x);
          span.maxX = Math.max(span.maxX, box.x + box.width);
        }
      }
    }
    laneY = laneLayout.laneBottomY;
  }
  placeStrip(currentVpcKey);
  placeStrip(currentRegionKey);
  for (const scopeKey of [...pendingStrips.keys()].sort((a, b) =>
    a.localeCompare(b),
  )) {
    placeStrip(scopeKey);
  }

  return { skeleton, layoutBoxes, laneEntries, ancillaryClusters };
}

export type PreparePipelineLayoutOptions = {
  /** Experimental Phase A: width-budgeted column assignment in place of longest-path. */
  experimentalLayout?: boolean;
  /**
   * X-axis network-simplex ranker (`pipelineColumnPacking:"shorten"`). Replaces the
   * longest-path depth floor with the Gansner TSE93 minimum-weighted-span ranking,
   * gated by verify-or-abort. Mutually exclusive with `experimentalLayout` (both
   * rewrite the depth floor; NS takes precedence).
   */
  networkSimplexRank?: boolean;
};

export function preparePipelineLayout(
  nodes: TerraformPlanNodesMap,
  plan: unknown,
  compact: boolean,
  options?: PreparePipelineLayoutOptions,
): PipelineLayoutPrep {
  const declared = nodes[DECLARED_DATAFLOW_ORDERED_KEY];
  if (!Array.isArray(declared) || declared.length === 0) {
    throw new Error(
      "Pipeline view requires at least one resolved .tfd dataflow edge.",
    );
  }

  const { satelliteOwners, placementByAddress } = withTerraformPlanNodeKeyIndex(
    nodes,
    () => {
      const owners = terraformImportProfilerMeasure(
        "pipeline.prep.satelliteBundles",
        () => buildSatelliteOwnerMap(nodes, plan),
      );
      return {
        satelliteOwners: owners,
        placementByAddress: terraformImportProfilerMeasure(
          "pipeline.prep.resourceRects",
          () =>
            buildPlacementMap(nodes, plan, undefined, new Set(owners.keys())),
        ),
      };
    },
  );
  const firstSequence = new Map<string, number>();
  const collapsedEdges: CollapsedPipelineEdge[] = [];
  for (const edge of [...declared].sort((a, b) => a.sequence - b.sequence)) {
    const source = collapseEndpoint(nodes, satelliteOwners, edge.source);
    const target = collapseEndpoint(nodes, satelliteOwners, edge.target);
    firstSequence.set(
      source,
      Math.min(firstSequence.get(source) ?? edge.sequence, edge.sequence),
    );
    firstSequence.set(
      target,
      Math.min(firstSequence.get(target) ?? edge.sequence, edge.sequence),
    );
    if (source !== target) {
      collapsedEdges.push({
        source,
        target,
        sequence: edge.sequence,
        original: edge,
      });
    }
  }

  const clusterIds = [...firstSequence.keys()].sort(
    (a, b) =>
      (firstSequence.get(a) ?? 0) - (firstSequence.get(b) ?? 0) ||
      a.localeCompare(b),
  );
  const depthResult = computeDepths(collapsedEdges, clusterIds);

  let clusterBuilderCalls = 0;
  const clusters: PipelineCluster[] = terraformImportProfilerMeasure(
    "pipeline.prep.materialize",
    () =>
      clusterIds.map((address) => {
        const placement = placementByAddress.get(address) ?? {
          providerFamily: providerFamilyForType(
            resourceTypeFor(nodes, address),
          ),
          accountId: "unknown-account",
          region: "unknown-region",
          vpcId: null,
        };
        const clusterPlacement = {
          accountId: placement.accountId,
          region: placement.region,
          vpcId: placement.vpcId,
          subnetTier: placement.subnetTier,
          subnetSignature: placement.subnetSignature,
        };
        clusterBuilderCalls += 1;
        let build = compact
          ? buildCompactPipelinePrimaryCluster(
              address,
              nodes,
              plan,
              clusterPlacement,
            )
          : buildTopologyPrimaryClusterSkeletonForPipeline(
              address,
              nodes,
              plan,
              clusterPlacement,
            );
        if (
          build.skeleton.length === 0 ||
          build.width <= 0 ||
          build.height <= 0
        ) {
          clusterBuilderCalls += 1;
          build = buildFallbackCluster(address, nodes, plan, placement);
        }
        return {
          id: address,
          primaryAddress: address,
          firstSequence: firstSequence.get(address) ?? 0,
          depth: depthResult.depths.get(address) ?? 0,
          placement,
          build,
        };
      }),
  );

  // Depth-floor swap slot. Two mutually-exclusive arms rewrite the longest-path
  // floor in place (each through the shared `applyDepthFloorIfValid` verify-or-abort
  // guard, which dual-writes `cluster.depth` + the returned depths and falls back to
  // longest-path on an infeasible candidate). NS takes precedence over the
  // experimental ALAP arm — the slot collision is defined, not undefined.
  //
  //   - networkSimplexRank ("shorten"): minimum-weighted-span ranking (shortens
  //     cross-column edges; the proven width win). Non-application is observable via
  //     `networkSimplexApplied` + `nsSkipReason`.
  //   - experimentalLayout (Phase A): width-budgeted ALAP columns so tall TFD
  //     columns spill deeper and the scene reads wider/flatter.
  let effectiveDepthResult: { depths: Map<string, number>; hasCycle: boolean } =
    depthResult;
  let networkSimplexApplied = false;
  let nsSkipReason: "infeasible-fallback" | "cyclic-skip" | undefined;
  if (options?.networkSimplexRank && !depthResult.hasCycle) {
    const swapped = applyDepthFloorIfValid(
      clusters,
      computeNetworkSimplexDepths(
        collapsedEdges,
        clusterIds,
        depthResult.depths,
      ),
      collapsedEdges,
    );
    if (swapped) {
      effectiveDepthResult = swapped;
      networkSimplexApplied = true;
    } else {
      nsSkipReason = "infeasible-fallback";
    }
  } else if (options?.networkSimplexRank) {
    // The collapsed cluster DAG has a cycle; network simplex is undefined on it, so
    // we keep the longest-path floor (cyclic clusters clamped to firstSequence).
    nsSkipReason = "cyclic-skip";
  } else if (options?.experimentalLayout && !depthResult.hasCycle) {
    const swapped = applyDepthFloorIfValid(
      clusters,
      computeWidthBudgetedDepths(collapsedEdges, clusters, depthResult.depths),
      collapsedEdges,
    );
    if (swapped) {
      effectiveDepthResult = swapped;
    }
  }

  const maxDepth = Math.max(0, ...clusters.map((c) => c.depth));
  const columnX = computeGlobalColumnX(clusters, maxDepth);

  if (isTerraformImportProfilerEnabled()) {
    // eslint-disable-next-line no-console -- intentional gated profiling output
    console.log("[terraform:rcll-instr] preparePipelineLayout", {
      clusterCount: clusters.length,
      satelliteCardCount: satelliteOwners.size,
      clusterBuilderCalls,
    });
  }

  return {
    clusters,
    collapsedEdges,
    maxDepth,
    columnX,
    depthResult: effectiveDepthResult,
    networkSimplexApplied,
    ...(nsSkipReason ? { nsSkipReason } : {}),
    satelliteOwners,
    placementByAddress,
  };
}
