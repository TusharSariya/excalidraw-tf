/**
 * A5 pierce / contiguity structural metrics (rcll-v2 spec v2.0 §6-A5, WP-3d /
 * M1b W3). Measurement-only over ONE final Excalidraw element array (no diff).
 *
 * REPORT-ONLY during M1 (gating begins at M2 per C11) — this module never
 * gates; it only counts.
 *
 * pierce: for each E′ edge chord (the rendered TFD arrow polyline, already
 *   center-clipped as drawn), for each hull frame rect f that is NOT an
 *   ancestor of the edge's source or target, count once per (edge, f) when the
 *   chord's INTERIOR intersects f's INTERIOR. Normative boundary semantics
 *   (v2.0 §6-A5), all satisfied by the "clip then test the clipped midpoint for
 *   strict interiority" rule below:
 *     1. touching an edge/corner without interior entry does NOT count;
 *     2. collinear overlap along a border does NOT count;
 *     3. an endpoint ON f's border with the chord entering the interior DOES.
 *
 * contiguity: per hull h and column c, the units of h that fall in column c
 *   must be contiguous in that column's final Y order; each break (a non-h
 *   cluster wedged between two h clusters in the same column) is one violation.
 *   Hulls range over every distinct topology-path prefix present among the
 *   clusters (so provider/account/region/… contiguity is each checked). Column
 *   identity = bbox left edge (el.x) — the same convention the slice metrics
 *   use.
 *
 * Scene readers mirror terraformPipelineSliceMetrics.ts's private
 * roleOf/pathOf/addressOf/resolveClusterPath (duplicated, not imported, to stay
 * additive-only — same precedent that file documents).
 */
import type { ExcalidrawElement } from "@excalidraw/element/types";

import { compareStrataContentKeys } from "./terraformPipelineStrataTypes";

import type { Rect } from "./terraformPipelineTopologyGeometry";

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

const topologyKeyOf = (el: Frame): string | null => {
  const k = el.customData?.terraformTopologyKey;
  return typeof k === "string" ? k : typeof el.id === "string" ? el.id : null;
};

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

const centerY = (r: Rect): number => r.y + r.height / 2;

/** `pre` is a prefix of `full` (equal length allowed). */
function isPrefix(pre: readonly string[], full: readonly string[]): boolean {
  if (pre.length > full.length) {
    return false;
  }
  for (let i = 0; i < pre.length; i++) {
    if (pre[i] !== full[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Does the open segment p0→p1 intersect rect's OPEN interior?
 *
 * Liang–Barsky clip to the CLOSED rect, then test the clipped segment's
 * midpoint for STRICT interiority. This yields exactly the three normative
 * boundary semantics: a point-touch clips to zero length (midpoint on the
 * boundary ⇒ false); a border-collinear overlap clips to positive length but
 * its midpoint sits on the border (⇒ false); an endpoint on the border with the
 * chord entering has a midpoint strictly inside (⇒ true).
 */
export function segmentIntersectsRectInterior(
  p0: readonly [number, number],
  p1: readonly [number, number],
  rect: Rect,
): boolean {
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }
  const x0 = rect.x;
  const x1 = rect.x + rect.width;
  const y0 = rect.y;
  const y1 = rect.y + rect.height;
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];

  const p = [-dx, dx, -dy, dy];
  const q = [p0[0] - x0, x1 - p0[0], p0[1] - y0, y1 - p0[1]];

  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i]! < 0) {
        // Parallel to this edge and outside it — no overlap at all.
        return false;
      }
      continue;
    }
    const r = q[i]! / p[i]!;
    if (p[i]! < 0) {
      if (r > t1) {
        return false;
      }
      if (r > t0) {
        t0 = r;
      }
    } else {
      if (r < t0) {
        return false;
      }
      if (r < t1) {
        t1 = r;
      }
    }
  }
  if (t1 < t0) {
    return false;
  }
  const tm = (t0 + t1) / 2;
  const mx = p0[0] + tm * dx;
  const my = p0[1] + tm * dy;
  return mx > x0 && mx < x1 && my > y0 && my < y1;
}

/** Absolute polyline points of an arrow (el.x/el.y + relative points). */
function arrowPoints(el: ExcalidrawElement): Array<[number, number]> {
  const pts = (el as { points?: ReadonlyArray<readonly [number, number]> })
    .points;
  if (!Array.isArray(pts) || pts.length < 2) {
    return [];
  }
  return pts.map(([px, py]) => [el.x + px, el.y + py] as [number, number]);
}

export type PierceEdgeEntry = {
  source: string;
  target: string;
  /** Number of non-ancestor hull frames whose interior this chord pierces. */
  pierces: number;
  /** Path keys (join by " ") of the pierced hull frames, code-unit sorted. */
  piercedHulls: string[];
};

export type ContiguityViolation = {
  hullPath: string;
  columnX: number;
  /** Maximal runs of this hull's clusters in the column (violations = runs−1). */
  runs: number;
};

export type PierceMetrics = {
  pierce: {
    total: number;
    /** edges with a resolvable geometry & both endpoints as clusters. */
    edgeCount: number;
    /** arrows dropped (missing endpoint cluster or <2 points). */
    unresolvedEdgeCount: number;
    perEdge: PierceEdgeEntry[];
  };
  contiguity: {
    totalViolations: number;
    violations: ContiguityViolation[];
  };
};

type ClusterInfo = { address: string; path: string[]; rect: Rect };

export function computePierceMetrics(
  elements: readonly ExcalidrawElement[],
): PierceMetrics {
  const frames = elements.filter(
    (el): el is Frame => el.type === "frame" && !el.isDeleted,
  );

  const topoByTopologyKey = new Map<string, { path: string[]; rect: Rect }>();
  const topoList: Array<{ path: string[]; rect: Rect }> = [];
  const hullFrames: Array<{ path: string[]; rect: Rect }> = [];
  for (const f of frames) {
    if (!TOPOLOGY_ROLES.has(roleOf(f))) {
      continue;
    }
    const path = pathOf(f);
    const rect = rectOf(f);
    const tKey = topologyKeyOf(f);
    if (tKey) {
      topoByTopologyKey.set(tKey, { path, rect });
    }
    topoList.push({ path, rect });
    hullFrames.push({ path, rect });
  }

  const resolvePath = (f: Frame): string[] => {
    const own = pathOf(f);
    if (own.length > 0) {
      return own;
    }
    const parentKey = compoundParentKeyOf(f);
    if (parentKey) {
      const parent = topoByTopologyKey.get(parentKey);
      if (parent) {
        return [...parent.path];
      }
    }
    const rect = rectOf(f);
    let best: string[] = [];
    for (const t of topoList) {
      if (t.path.length > best.length && rectContains(t.rect, rect)) {
        best = t.path;
      }
    }
    return [...best];
  };

  const clusterByAddress = new Map<string, ClusterInfo>();
  const clusters: ClusterInfo[] = [];
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
      path: resolvePath(f),
      rect: rectOf(f),
    };
    clusters.push(info);
    clusterByAddress.set(address, info);
  }

  // ── pierce ──────────────────────────────────────────────────────────────
  const perEdge: PierceEdgeEntry[] = [];
  let total = 0;
  let edgeCount = 0;
  let unresolvedEdgeCount = 0;
  for (const el of elements) {
    if (el.type !== "arrow") {
      continue;
    }
    const r = relOf(el);
    if (
      r == null ||
      typeof r.source !== "string" ||
      typeof r.target !== "string" ||
      r.aggregated === true
    ) {
      continue;
    }
    const src = clusterByAddress.get(r.source);
    const tgt = clusterByAddress.get(r.target);
    const pts = arrowPoints(el);
    if (!src || !tgt || pts.length < 2) {
      unresolvedEdgeCount += 1;
      continue;
    }
    edgeCount += 1;
    const piercedHulls: string[] = [];
    for (const f of hullFrames) {
      // Skip hulls that are ancestors of either endpoint.
      if (isPrefix(f.path, src.path) || isPrefix(f.path, tgt.path)) {
        continue;
      }
      let hit = false;
      for (let s = 0; s + 1 < pts.length && !hit; s++) {
        if (segmentIntersectsRectInterior(pts[s]!, pts[s + 1]!, f.rect)) {
          hit = true;
        }
      }
      if (hit) {
        piercedHulls.push(f.path.join(" "));
      }
    }
    piercedHulls.sort(compareStrataContentKeys);
    total += piercedHulls.length;
    perEdge.push({
      source: r.source,
      target: r.target,
      pierces: piercedHulls.length,
      piercedHulls,
    });
  }

  // ── contiguity ────────────────────────────────────────────────────────────
  // Distinct non-empty hull-path prefixes across all clusters.
  const hullPathKeys = new Map<string, string[]>();
  for (const c of clusters) {
    for (let len = 1; len <= c.path.length; len++) {
      const p = c.path.slice(0, len);
      hullPathKeys.set(p.join(" "), p);
    }
  }

  // Columns by left edge.
  const byColumn = new Map<number, ClusterInfo[]>();
  for (const c of clusters) {
    const arr = byColumn.get(c.rect.x);
    if (arr) {
      arr.push(c);
    } else {
      byColumn.set(c.rect.x, [c]);
    }
  }

  const violations: ContiguityViolation[] = [];
  let totalViolations = 0;
  const sortedColumnXs = [...byColumn.keys()].sort((a, b) => a - b);
  const sortedHullPaths = [...hullPathKeys.entries()].sort((a, b) =>
    compareStrataContentKeys(a[0], b[0]),
  );
  for (const colX of sortedColumnXs) {
    // Equal-center clusters break the tie on their content key (C4′ total
    // order — codex-review WP-3f fix-4b) instead of falling through to input
    // stability.
    const inColumn = [...byColumn.get(colX)!].sort((a, b) => {
      const dy = centerY(a.rect) - centerY(b.rect);
      return dy !== 0 ? dy : compareStrataContentKeys(a.address, b.address);
    });
    for (const [hullKey, hullPath] of sortedHullPaths) {
      let runs = 0;
      let inRun = false;
      let members = 0;
      for (const c of inColumn) {
        const isMember = isPrefix(hullPath, c.path);
        if (isMember) {
          members += 1;
          if (!inRun) {
            runs += 1;
            inRun = true;
          }
        } else {
          inRun = false;
        }
      }
      if (members >= 2 && runs > 1) {
        violations.push({ hullPath: hullKey, columnX: colX, runs });
        totalViolations += runs - 1;
      }
    }
  }

  return {
    pierce: { total, edgeCount, unresolvedEdgeCount, perEdge },
    contiguity: { totalViolations, violations },
  };
}
