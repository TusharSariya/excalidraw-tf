/**
 * Aesthetic-edges LOOP 0 — a reusable EDGE-QUALITY SCOREBOARD over one final
 * Excalidraw scene (`computeStrataEdgeScoreboard`). Measurement-only, pure, no
 * diff, no mutation. It gates every later aesthetic-edges experiment: an
 * experiment is a win only if it moves these numbers the right way without
 * regressing the others.
 *
 * EDGE SET — the declared-dataflow TFD arrows: `type:"arrow"` elements whose
 *   `customData.terraformEdgeLayer === "declaredDataFlow"` (via
 *   {@link getTerraformEdgeLayer}). DELIBERATE DEVIATION from the literal
 *   "non-deleted arrows" spec: in the shipped strata engine the ENTIRE
 *   declaredDataFlow layer is soft-HIDDEN by default (the layer pin defaults
 *   off), so every such arrow carries `isDeleted:true` — a non-deleted filter
 *   measures ZERO. The repaired/styled final geometry survives on the hidden
 *   element, so the scoreboard measures ALL declared arrows regardless of
 *   `isDeleted`, exactly as `computePierceMetrics` / `computeStrataPathMetrics`
 *   already do (both iterate arrows without an `isDeleted` gate). The probe that
 *   captures the baseline logs a deleted/non-deleted census alongside.
 *
 * CARD RECTS — non-deleted `type:"rectangle"` elements with
 *   `customData.terraformVisibilityRole === "resource"`, skipping AWS icon
 *   glyphs (`terraformAwsIconGlyph === true`). Keyed by
 *   {@link getTerraformVisibilityKey} — the SAME key an edge's
 *   `customData.relationship.{source,target}` addresses resolve to — so an
 *   edge's OWN endpoint cards can be excluded from the foreign-card metrics.
 *   Mirrors `collectTerraformResourceRects` (terraformVisibility.ts) but keeps
 *   EVERY satellite appearance of a key (not last-wins) so a foreign card in a
 *   second parent cluster still counts as an obstacle.
 *
 * CONTAINER (HULL) FRAMES — non-deleted `type:"frame"` elements whose
 *   `customData.terraformTopologyRole` is one of provider / account / region /
 *   vpc / subnetZone. This is the canonical hull-frame set that
 *   `computePierceMetrics` and `diagnosePipelineScene` already use. (The scene
 *   build stamps `customData.terraformTopologyPath` on these hull frames — but
 *   ALSO on every primaryCluster / leaf-cluster frame, so `terraformTopologyPath`
 *   alone over-selects; the topology-role gate is the load-bearing marker.)
 *
 * All numbers. Absolute coordinates throughout: arrow `points` are element-
 * relative, so each point is offset by the arrow's `x`/`y` before any geometry.
 * The interior-intersection primitive is reused from the pierce module
 * ({@link segmentIntersectsRectInterior}) rather than re-derived.
 */
import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  getTerraformEdgeLayer,
  getTerraformVisibilityKey,
} from "./terraformVisibility";
import { segmentIntersectsRectInterior } from "./terraformPipelineStrataPierceMetrics";

type Rect = { x: number; y: number; width: number; height: number };
type Pt = readonly [number, number];

/** Hull-frame roles — the exact set `computePierceMetrics` /
 * `diagnosePipelineScene` treat as container hulls. */
const TOPOLOGY_ROLES: ReadonlySet<string> = new Set([
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

/** A container-frame border crossing carries the face it landed on. */
type Face = "top" | "bottom" | "left" | "right";

export type StrataEdgeScoreboard = {
  /** # declared-dataflow arrows in the edge set. */
  edgeCount: number;
  /** # edge-set arrows that are stamped routed polylines
   * (`customData.terraformRoutedPolyline === true` AND `points.length > 2`). */
  routedCount: number;
  /** Σ over NET-FORWARD edges (lastAbs.x − firstAbs.x > 1) of the total
   * leftward horizontal travel — Σ max(0, −Δx) across consecutive absolute
   * points. A forward edge that never backtracks contributes 0; wiggle against
   * the LR flow accumulates here. */
  backwardXPx: number;
  /** # net-forward edges that contain ANY segment with Δx < −0.5 (a genuine
   * backward excursion, not float jitter). */
  backwardEdgeCount: number;
  /** min over all (edge, FOREIGN card) pairs of the min distance from any of the
   * edge's polyline segments to the card rect (0 when a segment intersects /
   * enters the card). "Foreign" = a card whose visibility key is NOT the edge's
   * relationship source or target. Larger is better (more breathing room). 0
   * when the edge set or foreign-card set is empty. */
  minCardClearancePx: number;
  /** # (edge, FOREIGN card) pairs where at least one segment STRICTLY enters the
   * card's interior ({@link segmentIntersectsRectInterior}). An edge that runs
   * through the middle of an unrelated resource card. Lower is better. */
  cardOverlapCount: number;
  /** # container-frame border crossings that land on the TOP or BOTTOM face
   * (against LR flow — an edge should enter/leave a hull left↔right). Subset of
   * {@link hullBoundaryCrossings}. Lower is better. */
  wrongFaceCrossings: number;
  /** total container-frame border crossings across all four faces (each
   * enter/exit is one crossing; deduped within 0.5px per edge+frame). */
  hullBoundaryCrossings: number;
  /** p95 (linear-interpolated) over ROUTED edges of polylineLength / chordLength
   * (chord = first→last absolute point; guarded when chord < 1px). 1.0 = a
   * straight run; higher = a longer detour relative to the direct chord. 0 when
   * there are no routed edges. */
  detourRatioP95: number;
};

// ── customData readers ─────────────────────────────────────────────────────────
const customDataOf = (el: ExcalidrawElement): Record<string, unknown> =>
  (el.customData ?? {}) as Record<string, unknown>;

const relationshipOf = (
  el: ExcalidrawElement,
): { source: string; target: string } | null => {
  const rel = customDataOf(el).relationship as
    | { source?: unknown; target?: unknown; aggregated?: unknown }
    | undefined;
  if (
    rel &&
    typeof rel.source === "string" &&
    typeof rel.target === "string" &&
    rel.aggregated !== true
  ) {
    return { source: rel.source, target: rel.target };
  }
  return null;
};

const roleOf = (el: ExcalidrawElement): string => {
  const r = customDataOf(el).terraformTopologyRole;
  return typeof r === "string" ? r : "";
};

/** Absolute polyline points of an arrow (element-relative points + x/y). */
const absPoints = (el: ExcalidrawElement): Pt[] => {
  const pts = (el as { points?: ReadonlyArray<readonly [number, number]> })
    .points;
  if (!Array.isArray(pts)) {
    return [];
  }
  return pts.map(([px, py]) => [el.x + px, el.y + py] as const);
};

const rectOf = (el: ExcalidrawElement): Rect => ({
  x: el.x,
  y: el.y,
  width: el.width,
  height: el.height,
});

// ── geometry primitives ─────────────────────────────────────────────────────────
const pointInRectClosed = (p: Pt, r: Rect): boolean =>
  p[0] >= r.x && p[0] <= r.x + r.width && p[1] >= r.y && p[1] <= r.y + r.height;

/** Euclidean distance from point p to the closed segment a→b. */
const pointToSegmentDist = (p: Pt, a: Pt, b: Pt): number => {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) {
    return Math.hypot(p[0] - a[0], p[1] - a[1]);
  }
  let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a[0] + t * abx;
  const cy = a[1] + t * aby;
  return Math.hypot(p[0] - cx, p[1] - cy);
};

/**
 * Proper intersection POINT of segments p0→p1 and q0→q1, or null when they do
 * not cross within both segments (parallel / collinear → null). Endpoints that
 * lie on the other segment count (closed).
 */
const segmentIntersectionPoint = (
  p0: Pt,
  p1: Pt,
  q0: Pt,
  q1: Pt,
): Pt | null => {
  const rX = p1[0] - p0[0];
  const rY = p1[1] - p0[1];
  const sX = q1[0] - q0[0];
  const sY = q1[1] - q0[1];
  const denom = rX * sY - rY * sX;
  if (denom === 0) {
    return null; // parallel or collinear — not a clean crossing
  }
  const qpX = q0[0] - p0[0];
  const qpY = q0[1] - p0[1];
  const t = (qpX * sY - qpY * sX) / denom;
  const u = (qpX * rY - qpY * rX) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) {
    return null;
  }
  return [p0[0] + t * rX, p0[1] + t * rY] as const;
};

/** Do segments a→b and c→d intersect at all (closed)? */
const segmentsIntersect = (a: Pt, b: Pt, c: Pt, d: Pt): boolean =>
  segmentIntersectionPoint(a, b, c, d) !== null;

/** The four border segments of a rect, each tagged with its face. */
const rectBorders = (r: Rect): Array<{ a: Pt; b: Pt; face: Face }> => {
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.width;
  const y1 = r.y + r.height;
  return [
    { a: [x0, y0], b: [x1, y0], face: "top" },
    { a: [x0, y1], b: [x1, y1], face: "bottom" },
    { a: [x0, y0], b: [x0, y1], face: "left" },
    { a: [x1, y0], b: [x1, y1], face: "right" },
  ];
};

/**
 * Minimum distance from segment p0→p1 to the (closed) axis-aligned rect. 0 when
 * either endpoint is inside the rect OR the segment crosses a border; otherwise
 * the min distance from the segment to the four border edges.
 */
const segmentToRectDist = (p0: Pt, p1: Pt, r: Rect): number => {
  if (pointInRectClosed(p0, r) || pointInRectClosed(p1, r)) {
    return 0;
  }
  let best = Infinity;
  for (const { a, b } of rectBorders(r)) {
    if (segmentsIntersect(p0, p1, a, b)) {
      return 0;
    }
    // segment-to-segment min distance (non-crossing) = min of the four
    // endpoint-to-opposite-segment distances.
    const d = Math.min(
      pointToSegmentDist(p0, a, b),
      pointToSegmentDist(p1, a, b),
      pointToSegmentDist(a, p0, p1),
      pointToSegmentDist(b, p0, p1),
    );
    if (d < best) {
      best = d;
    }
  }
  return best;
};

/** p95 (linear-interpolated) of an already-sorted-ascending array; 0 if empty. */
const percentile95 = (sortedAsc: number[]): number => {
  const n = sortedAsc.length;
  if (n === 0) {
    return 0;
  }
  if (n === 1) {
    return sortedAsc[0]!;
  }
  const rank = 0.95 * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) {
    return sortedAsc[lo]!;
  }
  return sortedAsc[lo]! + (rank - lo) * (sortedAsc[hi]! - sortedAsc[lo]!);
};

/**
 * Container-frame crossings for one edge polyline against one hull rect: the
 * deduped crossing points (within 0.5px per edge+frame) and how many landed on
 * a top/bottom face. A crossing near a corner may touch two borders; those
 * merge into one deduped crossing, and it counts as wrong-face when ANY of its
 * merged faces is top or bottom.
 */
const frameCrossings = (
  points: Pt[],
  rect: Rect,
): { total: number; wrongFace: number } => {
  const borders = rectBorders(rect);
  const hits: Array<{ p: Pt; faces: Set<Face> }> = [];
  for (let s = 0; s + 1 < points.length; s++) {
    const p0 = points[s]!;
    const p1 = points[s + 1]!;
    for (const { a, b, face } of borders) {
      const ip = segmentIntersectionPoint(p0, p1, a, b);
      if (!ip) {
        continue;
      }
      const existing = hits.find(
        (h) =>
          Math.abs(h.p[0] - ip[0]) <= 0.5 && Math.abs(h.p[1] - ip[1]) <= 0.5,
      );
      if (existing) {
        existing.faces.add(face);
      } else {
        hits.push({ p: ip, faces: new Set<Face>([face]) });
      }
    }
  }
  let wrongFace = 0;
  for (const h of hits) {
    if (h.faces.has("top") || h.faces.has("bottom")) {
      wrongFace += 1;
    }
  }
  return { total: hits.length, wrongFace };
};

// ── main ─────────────────────────────────────────────────────────────────────
export function computeStrataEdgeScoreboard(
  elements: readonly ExcalidrawElement[],
): StrataEdgeScoreboard {
  // Edge set: declaredDataFlow arrows with ≥2 absolute points. `isDeleted` is
  // NOT filtered — the shipped scene soft-hides the whole declared layer, and
  // the final repaired geometry lives on the hidden element (see file header).
  const edges: Array<{
    el: ExcalidrawElement;
    pts: Pt[];
    ownKeys: Set<string>;
  }> = [];
  for (const el of elements) {
    if (
      el.type !== "arrow" ||
      getTerraformEdgeLayer(el) !== "declaredDataFlow"
    ) {
      continue;
    }
    const pts = absPoints(el);
    if (pts.length < 2) {
      continue;
    }
    const rel = relationshipOf(el);
    const ownKeys = new Set<string>();
    if (rel) {
      ownKeys.add(rel.source);
      ownKeys.add(rel.target);
    }
    edges.push({ el, pts, ownKeys });
  }

  // Card rects (all satellite appearances kept, tagged with key).
  const cards: Array<{ key: string; rect: Rect }> = [];
  for (const el of elements) {
    if (el.isDeleted || el.type !== "rectangle") {
      continue;
    }
    const cd = customDataOf(el);
    if (cd.terraformAwsIconGlyph === true) {
      continue;
    }
    if (cd.terraformVisibilityRole !== "resource") {
      continue;
    }
    const key = getTerraformVisibilityKey(el);
    if (key) {
      cards.push({ key, rect: rectOf(el) });
    }
  }

  // Container (hull) frames.
  const hullFrames: Rect[] = [];
  for (const el of elements) {
    if (el.type !== "frame" || el.isDeleted) {
      continue;
    }
    if (TOPOLOGY_ROLES.has(roleOf(el))) {
      hullFrames.push(rectOf(el));
    }
  }

  let routedCount = 0;
  let backwardXPx = 0;
  let backwardEdgeCount = 0;
  let minCardClearancePx = Infinity;
  let cardOverlapCount = 0;
  let wrongFaceCrossings = 0;
  let hullBoundaryCrossings = 0;
  const detourRatios: number[] = [];

  for (const { el, pts, ownKeys } of edges) {
    const cd = customDataOf(el);
    const routed = cd.terraformRoutedPolyline === true && pts.length > 2;
    if (routed) {
      routedCount += 1;
    }

    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    const netForward = last[0] - first[0] > 1;

    // backward-X travel (net-forward edges only).
    if (netForward) {
      let hasBackSegment = false;
      for (let i = 0; i + 1 < pts.length; i++) {
        const dx = pts[i + 1]![0] - pts[i]![0];
        if (dx < 0) {
          backwardXPx += -dx;
        }
        if (dx < -0.5) {
          hasBackSegment = true;
        }
      }
      if (hasBackSegment) {
        backwardEdgeCount += 1;
      }
    }

    // foreign-card clearance + overlap.
    for (const { key, rect } of cards) {
      if (ownKeys.has(key)) {
        continue; // own source/target card — not a foreign obstacle
      }
      let entersInterior = false;
      for (let s = 0; s + 1 < pts.length; s++) {
        const d = segmentToRectDist(pts[s]!, pts[s + 1]!, rect);
        if (d < minCardClearancePx) {
          minCardClearancePx = d;
        }
        if (segmentIntersectsRectInterior(pts[s]!, pts[s + 1]!, rect)) {
          entersInterior = true;
        }
      }
      if (entersInterior) {
        cardOverlapCount += 1;
      }
    }

    // container-frame face crossings.
    for (const frame of hullFrames) {
      const { total, wrongFace } = frameCrossings(pts, frame);
      hullBoundaryCrossings += total;
      wrongFaceCrossings += wrongFace;
    }

    // detour ratio (routed edges only).
    if (routed) {
      const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
      if (chord >= 1) {
        let polyLen = 0;
        for (let i = 0; i + 1 < pts.length; i++) {
          polyLen += Math.hypot(
            pts[i + 1]![0] - pts[i]![0],
            pts[i + 1]![1] - pts[i]![1],
          );
        }
        detourRatios.push(polyLen / chord);
      }
    }
  }

  detourRatios.sort((a, b) => a - b);

  return {
    edgeCount: edges.length,
    routedCount,
    backwardXPx: Math.round(backwardXPx * 100) / 100,
    backwardEdgeCount,
    minCardClearancePx: Number.isFinite(minCardClearancePx)
      ? Math.round(minCardClearancePx * 100) / 100
      : 0,
    cardOverlapCount,
    wrongFaceCrossings,
    hullBoundaryCrossings,
    detourRatioP95: Math.round(percentile95(detourRatios) * 1000) / 1000,
  };
}
