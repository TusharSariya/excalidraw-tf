/**
 * T9 metric-family extension — slice-A/B split + new metrics (rcll-v2 spec
 * v3.1 §2 / v3.0 §2, WP-2d).
 *
 * A pure, scene-side (final-Excalidraw-elements-only) diagnostic that
 * classifies every TFD dataflow arrow into slice A (packed-LCA — same
 * region/vpc/subnet neighbourhood) or slice B (banded-LCA, i.e. the edge's
 * least-common-ancestor hull is root/provider/account — the "cross-band"
 * seam), then reports per-slice readability metrics plus three report-only
 * companions (bands-skipped, stacked band height, rank-span-normalized
 * deviation, area utilization).
 *
 * Consumed additively by `diagnosePipelineScene` (terraformPipelineCollisionDiagnostics.ts)
 * under the `slices` field — this module owns no rendering/layout behavior,
 * only measurement.
 *
 * Hull-tree reconstruction is done ENTIRELY from customData already stamped
 * onto frames by `pipelineFrameCustomData` (terraformPipelineLayoutShared.ts:233-259):
 *   - topology frames (`terraformTopologyRole` ∈ provider/account/region/vpc/subnetZone)
 *     ALWAYS carry their own `terraformTopologyPath`.
 *   - primary-cluster frames (`terraformTopologyRole === "primaryCluster"`) do
 *     NOT reliably carry their own path — coverage depends on the builder
 *     (verified empirically, 2026-07, WP-2d): the classic/fallback builder
 *     (`buildFallbackCluster`) and FULL-mode compound scenes stamp a full
 *     `terraformTopologyPath` directly, but COMPACT-mode compound scenes omit
 *     it entirely, carrying ONLY `terraformCompoundParentKey` (a reference to
 *     the immediate parent hull frame's own key/id). `resolveClusterPath`
 *     below resolves a cluster's effective ancestor path via a 3-tier
 *     fallback (own path → compound-parent-key lookup → geometric
 *     containment) so slice classification is correct under every builder —
 *     this is what lets bands-skipped recover a dissolved band's identity
 *     even when no container frame exists for it (rcll deBand arms).
 *
 * The role→policy map is NOT re-declared here — it is imported from
 * `terraformPipelineStrataTypes.ts` (`STRATA_HULL_POLICY`), the single source
 * of truth per v3.1 §2.6.
 */
import type { ExcalidrawElement } from "@excalidraw/element/types";

// M5-style DRY: the same median used by the model-level acceptance gate and by
// terraformPipelineCollisionDiagnostics.ts's hubCenteringRate.
import { median } from "./terraformPipelineCoordinateAssignment";
import { PIPELINE_COLUMN_GAP } from "./terraformPipelineLayoutShared";
import {
  STRATA_HULL_POLICY,
  type StrataHullRole,
} from "./terraformPipelineStrataTypes";

import type { Rect } from "./terraformPipelineTopologyGeometry";

// Mirrors terraformPipelineCollisionDiagnostics.ts's NEAR_STRAIGHT_MAX_PX
// (24px). Not imported — that constant is module-private there; keep the two
// in lockstep if the threshold ever changes (both are cited from the same RCLL
// readability spec section).
const NEAR_STRAIGHT_MAX_PX = 24;

export type SliceLabel = "A" | "B";

export type SliceExtentStats = {
  /** Edge count this slice's stats are computed over (0 ⇒ vacuous 0s below). */
  n: number;
  p50: number;
  p90: number;
  mean: number;
  fractionNearStraight: number;
  nearStraightCount: number;
};

export type BandsSkippedSummary = {
  n: number;
  mean: number;
  /** Per-edge bands-skipped values, in edge-iteration order (deterministic). */
  distribution: number[];
};

export type StackedBandHeightEntry = {
  hullPath: readonly string[];
  role: StrataHullRole;
  childCount: number;
  totalHeightPx: number;
};

export type StackedBandHeightSummary = {
  perHull: StackedBandHeightEntry[];
  totalPx: number;
};

export type RankBucketStats = {
  n: number;
  p50: number;
  p90: number;
  mean: number;
};

export type NormalizedDeviationSummary = {
  /** |Δx_endpoints| === 0 — denominator floors to PIPELINE_COLUMN_GAP. */
  sameRank: RankBucketStats;
  crossRank: RankBucketStats;
};

export type AreaUtilizationSummary = {
  leafAreaPx2: number;
  contentBBoxAreaPx2: number;
  /** leafAreaPx2 / contentBBoxAreaPx2, asserted ∈ [0,1] by tests. 0 when the
   * content bbox is degenerate (no topology/cluster frames). */
  utilization: number;
  leafElementCount: number;
};

export type PipelineSliceMetrics = {
  populations: {
    nA: number;
    nB: number;
    /** TFD arrows whose source/target address did not resolve to a primary
     * cluster frame (or lacked ≥2 rendered points) — excluded from every
     * metric below, counted here for honesty (not silently dropped). */
    unresolvedEdgeCount: number;
  };
  /** True iff slice B has zero edges — bandsSkipped is then null (vacuous). */
  sliceBEmpty: boolean;
  extent: { A: SliceExtentStats; B: SliceExtentStats };
  bandsSkipped: BandsSkippedSummary | null;
  stackedBandHeight: StackedBandHeightSummary;
  normalizedDeviation: NormalizedDeviationSummary;
  areaUtilization: AreaUtilizationSummary;
};

// ── scene element helpers (mirror terraformPipelineCollisionDiagnostics.ts's
// private roleOf/pathOf/relOf conventions; duplicated rather than imported so
// this file stays additive-only w.r.t. that module — see WP-2d file-ownership
// note) ──────────────────────────────────────────────────────────────────────

type Frame = ExcalidrawElement & { customData?: Record<string, unknown> };

const TOPOLOGY_ROLES: ReadonlySet<string> = new Set([
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

const roleOf = (el: Frame): string =>
  typeof el.customData?.terraformTopologyRole === "string"
    ? (el.customData.terraformTopologyRole as string)
    : "";

const pathOf = (el: Frame): string[] => {
  const p = el.customData?.terraformTopologyPath;
  return Array.isArray(p)
    ? (p.filter((s) => typeof s === "string") as string[])
    : [];
};

const addressOf = (el: Frame): string | null => {
  const a = el.customData?.terraformPrimaryAddress;
  return typeof a === "string" ? a : null;
};

/** A topology frame's own key (== its element id, per pipelineFrameCustomData's
 * `key` argument) — what a primary-cluster frame's `terraformCompoundParentKey`
 * points at under the compound builder. */
const topologyKeyOf = (el: Frame): string | null => {
  const k = el.customData?.terraformTopologyKey;
  return typeof k === "string" ? k : typeof el.id === "string" ? el.id : null;
};

/** Set by the compound co-layout builder (terraformCompoundHierarchy) on every
 * primary-cluster frame — the immediate parent hull's own key/id. Empirically
 * (2026-07, WP-2d verification probe) this is the ONLY reliable ancestry
 * signal in COMPACT-mode compound scenes: primary-cluster frames there carry
 * no `terraformTopologyPath` of their own (unlike the classic/fallback
 * builder's `buildFallbackCluster`, and unlike FULL-mode compound scenes,
 * which redundantly stamp both). */
const compoundParentKeyOf = (el: Frame): string | null => {
  const k = el.customData?.terraformCompoundParentKey;
  return typeof k === "string" ? k : null;
};

const rectOf = (el: ExcalidrawElement): Rect => ({
  x: el.x,
  y: el.y,
  width: el.width,
  height: el.height,
});

/** Strict rect containment (outer fully encloses inner). */
function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

const relOf = (el: ExcalidrawElement) => {
  const r = (el.customData as { relationship?: unknown } | undefined)
    ?.relationship;
  return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
};

/**
 * Population per v3.1 §2 item 1: engine-emitted non-aggregated declared-
 * dataflow (TFD) arrows regardless of isDeleted. MUST stay identical to
 * diagnosePipelineScene's tfdArrows filter — update both if this ever
 * changes.
 */
function tfdArrowsOf(
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] {
  return elements.filter((el) => {
    if (el.type !== "arrow") {
      return false;
    }
    const r = relOf(el);
    return (
      r != null &&
      typeof r.source === "string" &&
      typeof r.target === "string" &&
      r.aggregated !== true
    );
  });
}

/** Vertical extent (max_y−min_y over the rendered polyline — same convention
 * as terraformPipelineCollisionDiagnostics.ts's arrowGeometry) + the endpoint
 * Δx (|x_last − x_first|) used by the rank-span-normalized deviation metric. */
type EdgeGeom = { verticalExtent: number; dx: number };

function edgeGeometry(el: ExcalidrawElement): EdgeGeom | null {
  const pts = (el as { points?: ReadonlyArray<readonly [number, number]> })
    .points;
  if (!Array.isArray(pts) || pts.length < 2) {
    return null;
  }
  let minY = el.y + pts[0]![1];
  let maxY = minY;
  for (let i = 1; i < pts.length; i++) {
    const y = el.y + pts[i]![1];
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const x1 = el.x + pts[0]![0];
  const x2 = el.x + pts[pts.length - 1]![0];
  return { verticalExtent: maxY - minY, dx: Math.abs(x2 - x1) };
}

/** Longest common path prefix (LCA over topology paths, v3.1 §2 item 2). */
function longestCommonPrefix(
  a: readonly string[],
  b: readonly string[],
): string[] {
  const out: string[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      break;
    }
    out.push(a[i]!);
  }
  return out;
}

/** path length 0→root, 1→provider, 2→account, 3→region, 4→vpc, ≥5→subnetZone
 * — mirrors terraformPipelineTopologyFrames.ts's topologyRoleAndKeyFromPath
 * bucketing, extended with root at length 0. */
function roleForPathLength(len: number): StrataHullRole {
  if (len <= 0) {
    return "root";
  }
  if (len === 1) {
    return "provider";
  }
  if (len === 2) {
    return "account";
  }
  if (len === 3) {
    return "region";
  }
  if (len === 4) {
    return "vpc";
  }
  return "subnetZone";
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Nearest-rank percentile, consistent with the existing file family's median
 * convention (`sorted[Math.floor(sorted.length/2)]` for p50 === fraction 0.5). */
function percentileAt(sortedAsc: readonly number[], fraction: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.floor(sortedAsc.length * fraction),
  );
  return sortedAsc[idx]!;
}

type ClusterInfo = { address: string; path: readonly string[]; rect: Rect };

/**
 * The ordered set of a banded hull's immediate children (band rows), per the
 * band-row invariant (terraformPipelineStrataTypes.ts's StrataHullNode doc):
 * every child of a banded hull is either a deeper hull (grouped by the next
 * path segment) or a bare leaf cluster anchored directly at the hull (its own
 * singleton band). Y-order: an existing topology frame's rect.y wins;
 * otherwise (dissolved band — rcll deBand arms) falls back to the median
 * center-Y of the band's member clusters (v3.1 §2 item 4).
 */
type BandChild = {
  key: string;
  y: number;
  heightPx: number;
  memberAddresses: string[];
};

function bandChildKeyFor(
  cluster: ClusterInfo,
  hullPath: readonly string[],
): string {
  return cluster.path.length === hullPath.length
    ? `leaf:${cluster.address}`
    : `hull:${cluster.path.slice(0, hullPath.length + 1).join("\0")}`;
}

function bandsOfHull(
  hullPath: readonly string[],
  clusters: readonly ClusterInfo[],
  topoFramesByPathKey: ReadonlyMap<
    string,
    { role: StrataHullRole; rect: Rect }
  >,
): BandChild[] {
  const groups = new Map<string, ClusterInfo[]>();
  for (const c of clusters) {
    if (c.path.length < hullPath.length) {
      continue;
    }
    let isDescendant = true;
    for (let i = 0; i < hullPath.length; i++) {
      if (c.path[i] !== hullPath[i]) {
        isDescendant = false;
        break;
      }
    }
    if (!isDescendant) {
      continue;
    }
    const key = bandChildKeyFor(c, hullPath);
    const arr = groups.get(key);
    if (arr) {
      arr.push(c);
    } else {
      groups.set(key, [c]);
    }
  }

  const out: BandChild[] = [];
  for (const [key, members] of groups) {
    if (key.startsWith("leaf:")) {
      const m = members[0]!;
      out.push({
        key,
        y: m.rect.y + m.rect.height / 2,
        heightPx: m.rect.height,
        memberAddresses: [m.address],
      });
      continue;
    }
    const childPathKey = key.slice("hull:".length);
    const frame = topoFramesByPathKey.get(childPathKey);
    if (frame) {
      out.push({
        key,
        y: frame.rect.y + frame.rect.height / 2,
        heightPx: frame.rect.height,
        memberAddresses: members.map((m) => m.address),
      });
      continue;
    }
    // Dissolved band: no container frame at this path (e.g. rcll de-band) —
    // recover Y-order from the member elements' own geometry.
    const ys = members.map((m) => m.rect.y + m.rect.height / 2);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const m of members) {
      minY = Math.min(minY, m.rect.y);
      maxY = Math.max(maxY, m.rect.y + m.rect.height);
    }
    out.push({
      key,
      y: median(ys),
      heightPx: maxY - minY,
      memberAddresses: members.map((m) => m.address),
    });
  }
  // Stable sort by Y (ties preserve Map-insertion / element-array order —
  // deterministic given deterministic input, CON-8 style).
  out.sort((a, b) => a.y - b.y);
  return out;
}

export function computeSliceMetrics(
  elements: readonly ExcalidrawElement[],
): PipelineSliceMetrics {
  const frames = elements.filter(
    (el): el is Frame => el.type === "frame" && !el.isDeleted,
  );

  const topoFramesByPathKey = new Map<
    string,
    { role: StrataHullRole; rect: Rect }
  >();
  const topoFrameByTopologyKey = new Map<
    string,
    { path: readonly string[]; rect: Rect }
  >();
  const topoFramesList: Array<{ path: readonly string[]; rect: Rect }> = [];
  const contentEls: Frame[] = [];
  for (const f of frames) {
    const role = roleOf(f);
    if (TOPOLOGY_ROLES.has(role)) {
      const path = pathOf(f);
      const rect = rectOf(f);
      topoFramesByPathKey.set(path.join("\0"), {
        role: role as StrataHullRole,
        rect,
      });
      const tKey = topologyKeyOf(f);
      if (tKey) {
        topoFrameByTopologyKey.set(tKey, { path, rect });
      }
      topoFramesList.push({ path, rect });
      contentEls.push(f);
    } else if (role === "primaryCluster") {
      contentEls.push(f);
    }
  }

  /**
   * A primary-cluster frame's effective ancestor path, 3-tier fallback:
   *  1. its own `terraformTopologyPath` (buildFallbackCluster / FULL-mode
   *     compound scenes stamp this directly).
   *  2. `terraformCompoundParentKey` → the parent hull's own path (the ONLY
   *     signal present in COMPACT-mode compound scenes — see
   *     compoundParentKeyOf's doc comment).
   *  3. geometric containment: the deepest topology frame whose rect fully
   *     contains this cluster's rect (final safety net for any other
   *     builder/format; matches the spec's literal "deepest frame containing
   *     its endpoint element").
   */
  const resolveClusterPath = (f: Frame): string[] => {
    const own = pathOf(f);
    if (own.length > 0) {
      return own;
    }
    const parentKey = compoundParentKeyOf(f);
    if (parentKey) {
      const parent = topoFrameByTopologyKey.get(parentKey);
      if (parent) {
        return [...parent.path];
      }
    }
    const rect = rectOf(f);
    let best: readonly string[] = [];
    for (const t of topoFramesList) {
      if (t.path.length > best.length && rectContains(t.rect, rect)) {
        best = t.path;
      }
    }
    return [...best];
  };

  const clusters: ClusterInfo[] = [];
  const clusterByAddress = new Map<string, ClusterInfo>();
  for (const f of frames) {
    if (roleOf(f) !== "primaryCluster") {
      continue;
    }
    const address = addressOf(f);
    if (!address) {
      continue;
    }
    const info: ClusterInfo = {
      address,
      path: resolveClusterPath(f),
      rect: rectOf(f),
    };
    clusters.push(info);
    clusterByAddress.set(address, info);
  }

  type EdgeClass = {
    slice: SliceLabel;
    lcaPath: string[];
    src: ClusterInfo;
    tgt: ClusterInfo;
    geom: EdgeGeom;
  };

  const edgeClasses: EdgeClass[] = [];
  let unresolvedEdgeCount = 0;
  for (const arrow of tfdArrowsOf(elements)) {
    const r = relOf(arrow)!;
    const src = clusterByAddress.get(r.source as string);
    const tgt = clusterByAddress.get(r.target as string);
    const geom = edgeGeometry(arrow);
    if (!src || !tgt || !geom) {
      unresolvedEdgeCount += 1;
      continue;
    }
    const lcaPath = longestCommonPrefix(src.path, tgt.path);
    const policy = STRATA_HULL_POLICY[roleForPathLength(lcaPath.length)];
    const slice: SliceLabel =
      policy === "banded" || lcaPath.length === 0 ? "B" : "A";
    edgeClasses.push({ slice, lcaPath, src, tgt, geom });
  }

  const sliceAEdges = edgeClasses.filter((e) => e.slice === "A");
  const sliceBEdges = edgeClasses.filter((e) => e.slice === "B");
  const sliceBEmpty = sliceBEdges.length === 0;

  // ── per-slice extent + near-straight ────────────────────────────────────
  const extentStatsFor = (edges: readonly EdgeClass[]): SliceExtentStats => {
    const extents = edges
      .map((e) => e.geom.verticalExtent)
      .sort((a, b) => a - b);
    const n = extents.length;
    const mean = n ? extents.reduce((a, b) => a + b, 0) / n : 0;
    const nearStraightCount = extents.filter(
      (d) => d <= NEAR_STRAIGHT_MAX_PX,
    ).length;
    return {
      n,
      p50: round2(percentileAt(extents, 0.5)),
      p90: round2(percentileAt(extents, 0.9)),
      mean: round2(mean),
      fractionNearStraight: n ? round2(nearStraightCount / n) : 0,
      nearStraightCount,
    };
  };

  // ── bands-skipped (slice B only) ────────────────────────────────────────
  const distribution: number[] = [];
  for (const e of sliceBEdges) {
    const bands = bandsOfHull(e.lcaPath, clusters, topoFramesByPathKey);
    const srcKey = bandChildKeyFor(e.src, e.lcaPath);
    const tgtKey = bandChildKeyFor(e.tgt, e.lcaPath);
    const idxSrc = bands.findIndex((b) => b.key === srcKey);
    const idxTgt = bands.findIndex((b) => b.key === tgtKey);
    if (idxSrc < 0 || idxTgt < 0 || idxSrc === idxTgt) {
      // Degenerate: self-loop, or both endpoints project to the same band
      // (should not occur for a correctly-computed LCA on distinct clusters —
      // pinned convention: report 0, not a negative/undefined value).
      distribution.push(0);
      continue;
    }
    distribution.push(Math.abs(idxSrc - idxTgt) - 1);
  }
  const bandsSkipped: BandsSkippedSummary | null = sliceBEmpty
    ? null
    : {
        n: distribution.length,
        mean: round2(
          distribution.reduce((a, b) => a + b, 0) / distribution.length,
        ),
        distribution,
      };

  // ── stacked band height: every banded hull (root/provider/account) present
  // in the scene, keyed by distinct topology-path prefixes among clusters ──
  const bandedHullPathKeys = new Map<string, readonly string[]>();
  if (clusters.length > 0) {
    bandedHullPathKeys.set("", []);
  }
  for (const c of clusters) {
    if (c.path.length >= 1) {
      const p = c.path.slice(0, 1);
      bandedHullPathKeys.set(p.join("\0"), p);
    }
    if (c.path.length >= 2) {
      const p = c.path.slice(0, 2);
      bandedHullPathKeys.set(p.join("\0"), p);
    }
  }
  const perHull: StackedBandHeightEntry[] = [];
  let totalPx = 0;
  for (const hullPath of bandedHullPathKeys.values()) {
    const bands = bandsOfHull(hullPath, clusters, topoFramesByPathKey);
    if (bands.length === 0) {
      continue;
    }
    const heightSum = bands.reduce((a, b) => a + b.heightPx, 0);
    perHull.push({
      hullPath,
      role: roleForPathLength(hullPath.length),
      childCount: bands.length,
      totalHeightPx: round2(heightSum),
    });
    totalPx += heightSum;
  }
  perHull.sort((a, b) => {
    if (a.hullPath.length !== b.hullPath.length) {
      return a.hullPath.length - b.hullPath.length;
    }
    // Code-unit compare, NEVER bare localeCompare (C4′ hygiene: this feeds
    // frozen baseline tables that must be byte-stable across machines/locales).
    const ka = a.hullPath.join("\0");
    const kb = b.hullPath.join("\0");
    return ka === kb ? 0 : ka < kb ? -1 : 1;
  });

  // ── rank-span-normalized deviation (A+B, report-only) ───────────────────
  const sameRankVals: number[] = [];
  const crossRankVals: number[] = [];
  for (const e of edgeClasses) {
    const denom = Math.max(PIPELINE_COLUMN_GAP, e.geom.dx);
    const val = denom > 0 ? e.geom.verticalExtent / denom : 0;
    if (e.geom.dx === 0) {
      sameRankVals.push(val);
    } else {
      crossRankVals.push(val);
    }
  }
  const bucketStats = (vals: readonly number[]): RankBucketStats => {
    const sorted = [...vals].sort((a, b) => a - b);
    const n = sorted.length;
    return {
      n,
      p50: round2(percentileAt(sorted, 0.5)),
      p90: round2(percentileAt(sorted, 0.9)),
      mean: n ? round2(sorted.reduce((a, b) => a + b, 0) / n) : 0,
    };
  };

  // ── area utilization (report-only) ──────────────────────────────────────
  const isLeafResource = (el: ExcalidrawElement): boolean => {
    if (el.type === "frame" || el.isDeleted) {
      return false;
    }
    const cd = (el as Frame).customData;
    return (
      cd?.terraformNodeKind === "resource" ||
      cd?.terraformVisibilityRole === "resource"
    );
  };
  let leafAreaPx2 = 0;
  let leafElementCount = 0;
  for (const el of elements) {
    if (!isLeafResource(el)) {
      continue;
    }
    leafAreaPx2 += el.width * el.height;
    leafElementCount += 1;
  }
  let contentBBoxAreaPx2 = 0;
  if (contentEls.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of contentEls) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    }
    contentBBoxAreaPx2 = Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
  }
  const utilization =
    contentBBoxAreaPx2 > 0 ? leafAreaPx2 / contentBBoxAreaPx2 : 0;

  return {
    populations: {
      nA: sliceAEdges.length,
      nB: sliceBEdges.length,
      unresolvedEdgeCount,
    },
    sliceBEmpty,
    extent: {
      A: extentStatsFor(sliceAEdges),
      B: extentStatsFor(sliceBEdges),
    },
    bandsSkipped,
    stackedBandHeight: { perHull, totalPx: round2(totalPx) },
    normalizedDeviation: {
      sameRank: bucketStats(sameRankVals),
      crossRank: bucketStats(crossRankVals),
    },
    areaUtilization: {
      leafAreaPx2: round2(leafAreaPx2),
      contentBBoxAreaPx2: round2(contentBBoxAreaPx2),
      utilization: round2(utilization),
      leafElementCount,
    },
  };
}
