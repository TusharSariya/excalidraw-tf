/**
 * Final-scene collision / hierarchy diagnostics for the pipeline view.
 *
 * Defines, on the converted Excalidraw elements, what "no overlaps or broken
 * hierarchies" means for the semantic-placement work
 * (docs/pipeline-semantic-placement-audit.md). Used as the acceptance gate by
 * tests and by the audit metrics instrument.
 *
 * Collision categories (first-applicable order) per
 * REGION_SUBNET_VERTICAL_BANDS_PLAN.md §"Collision Diagnostic Specification":
 *   region-region | same-vpc-subnet-subnet | frame-title-primary-cluster |
 *   non-ancestor-topology-frame
 * Ancestor containment (a frame inside its own ancestor) is valid and excluded.
 */
import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  frameTitleRect,
  rectsOverlap,
  topologyFrameCollisionHull,
  yIntervalsOverlap,
  type Rect,
} from "./terraformPipelineTopologyGeometry";
// M5: the centering median is shared with the model-level acceptance gate so the
// rendered `hubCenteringRate` and the deterministic model gate never drift.
import { median } from "./terraformPipelineCoordinateAssignment";
// T9 (WP-2d, v3.1 §2): slice-A/B split + companion metrics, additive-only —
// see terraformPipelineSliceMetrics.ts for the full contract.
import {
  computeSliceMetrics,
  type PipelineSliceMetrics,
} from "./terraformPipelineSliceMetrics";

export type CollisionCategory =
  | "region-region"
  | "same-vpc-subnet-subnet"
  | "frame-title-primary-cluster"
  | "non-ancestor-topology-frame";

export type FinalSceneCollision = {
  category: CollisionCategory;
  a: { id: string; role: string; key: string | null };
  b: { id: string; role: string; key: string | null };
};

export type SemanticEdgeViolation = { source: string; target: string };

export type PipelineSceneDiagnostics = {
  collisionCount: number;
  collisions: FinalSceneCollision[];
  collisionsByCategory: Record<CollisionCategory, number>;
  bandInterleave: {
    regionYIntervalSharedPairs: number;
    accountYIntervalSharedPairs: number;
  };
  semanticEdgeViolations: SemanticEdgeViolation[];
  dataflow: {
    tfdArrowCount: number;
    crossings: number;
    medianVerticalDeviationPx: number;
    meanVerticalDeviationPx: number;
    fractionNearStraight: number;
    // RCLL readability metrics (REQ-11 / §17). Rates are fractions in [0,1];
    // each pairs with a count so a vacuous 0/0 reads as 0 with count 0, not a
    // misleading 1.0 (RFC DEC-6 gate; see *_PX tolerances below).
    fanoutColumnRate: number;
    fanoutSetCount: number;
    hubCenteringRate: number;
    hubCount: number;
    aspect: number;
  };
  /** T9 (WP-2d): slice-A/B split + companion metrics. Additive — see
   * terraformPipelineSliceMetrics.ts. */
  slices: PipelineSliceMetrics;
  /** v3.2 gate-family minimal slice (round-8 follow-up): crossing-angle
   * summary over the SAME crossing pairs `dataflow.crossings` counts. Additive. */
  crossingAngles: CrossingAngleSummary;
  /** Probe P2 edge-angle metrics (bends, near-flat share, endpoint angular
   * resolution), polyline-aware. Additive. */
  edgeAngles: EdgeAngleSummary;
};

/**
 * Sharp-crossing threshold (degrees). Crossings with an acute angle below this
 * read materially worse: Huang 2008's eye-tracking study (arXiv:0810.4431)
 * found small crossing angles trigger extra eye movements and delay path
 * search, and the RAC/large-angle literature's conventional "large angle"
 * boundary is ~30° (e.g. LNCS 6502 §"large angle crossings"). v3.2 gate: the
 * candidate's sharpShare must not exceed baseline + 0.02.
 */
export const SHARP_CROSSING_MAX_DEG = 30;

/**
 * Perceptual sharp-crossing threshold (degrees). The Huang/Eades/Hong
 * eye-tracking literature places the readability knee at ~70°: below it,
 * path-tracing accuracy and speed degrade sharply; above it the cost is
 * near-flat. Reported ALONGSIDE `SHARP_CROSSING_MAX_DEG` (30°) — the 30°
 * "large-angle" boundary is unchanged; this adds the 70° perceptual number.
 */
export const SHARP_CROSSING_MAX_DEG_70 = 70;

/** Near-flat segment thresholds (edge-angle metric, probe P2). A segment counts
 * as "near-flat" when its acute angle to the horizontal is below
 * `NEAR_FLAT_MAX_DEG` AND it is longer than `NEAR_FLAT_MIN_LEN_PX` — the owner's
 * "extreme angle" complaint operationalized (a long, almost-horizontal run). */
export const NEAR_FLAT_MAX_DEG = 15;
export const NEAR_FLAT_MIN_LEN_PX = 40;

/** A polyline vertex is a "bend" when the turn between its incoming and outgoing
 * segment directions exceeds this (degrees). A straight 2-point arrow has 0
 * bends; a clean orthogonal Z has 2; gentle bezier samples fall below it. */
export const BEND_MIN_DEG = 10;

export type CrossingAngleSummary = {
  /** Crossing arrow PAIRS (same pair-once semantics as `dataflow.crossings`). */
  nCross: number;
  /** Fraction of crossing pairs with θ < SHARP_CROSSING_MAX_DEG (0 when
   * nCross is 0 — vacuous, read with nCross). */
  sharpShare: number;
  /** Fraction of crossing pairs with θ < SHARP_CROSSING_MAX_DEG_70 (70°, the
   * perceptual knee). Reported alongside `sharpShare`, never replacing it
   * (0 when nCross is 0 — vacuous, read with nCross). */
  sharpShare70: number;
  /** Nearest-rank p10 of θ across crossing pairs, degrees (0 when nCross 0). */
  p10Deg: number;
  /** Minimum θ across crossing pairs, degrees (0 when nCross 0). */
  minDeg: number;
};

/**
 * Polyline-aware edge-angle summary (probe P2). All four families are computed
 * from the SAME segment geometry as `dataflow.crossings`; each scalar pairs
 * with the count it is a fraction/aggregate of, so a vacuous 0/0 reads as 0
 * with its count 0 (never a misleading 1.0), matching the RFC DEC-6 gate.
 */
export type EdgeAngleSummary = {
  /** Σ bends over all TFD arrows (interior vertices whose turn > BEND_MIN_DEG). */
  bendCountTotal: number;
  /** Max bend count on any single arrow. */
  bendCountMax: number;
  /** Mean bends per arrow (bendCountTotal / edgeCount; 0 when no edges). */
  bendCountMeanPerEdge: number;
  /** Arrows considered (polyline-derivable TFD arrows). */
  edgeCount: number;
  /** Fraction of LONG segments (> NEAR_FLAT_MIN_LEN_PX) that are near-flat
   * (acute angle to horizontal < NEAR_FLAT_MAX_DEG). 0 when no long segments. */
  nearFlatShare: number;
  /** Long, near-flat segments (numerator of nearFlatShare). */
  nearFlatSegments: number;
  /** Segments longer than NEAR_FLAT_MIN_LEN_PX (denominator of nearFlatShare). */
  longSegments: number;
  /** Scene-level MIN over card sides of the per-side minimum angular gap
   * between incident edge departures, degrees. 0 when no side has ≥2
   * departures (read with `endpointSidesConsidered`). */
  endpointAngularResolutionMinDeg: number;
  /** Scene-level MEAN over card sides of that per-side minimum gap, degrees. */
  endpointAngularResolutionMeanDeg: number;
  /** Card sides with ≥2 incident departures (the population both scalars
   * summarize; 0 ⇒ both are vacuous 0). */
  endpointSidesConsidered: number;
};

// Metric tolerances, derived from the layout spacing in
// terraformPipelineLayoutShared.ts (kept local so this diagnostics leaf does
// not depend on the heavy layout module). If that spacing changes, update here.
//   FANOUT_COLUMN_TOLERANCE_PX = PIPELINE_COLUMN_GAP (150) / 2
//   CENTERING_EPSILON_PX       = PIPELINE_CLUSTER_GAP_Y (36)
const FANOUT_COLUMN_TOLERANCE_PX = 75;
const CENTERING_EPSILON_PX = 36;
const NEAR_STRAIGHT_MAX_PX = 24;

const TOPOLOGY_ROLES = new Set([
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

type Frame = ExcalidrawElement & {
  customData?: Record<string, unknown>;
};

const rectOf = (el: ExcalidrawElement): Rect => ({
  x: el.x,
  y: el.y,
  width: el.width,
  height: el.height,
});

const roleOf = (el: Frame): string =>
  typeof el.customData?.terraformTopologyRole === "string"
    ? (el.customData.terraformTopologyRole as string)
    : "";

const keyOf = (el: Frame): string | null =>
  typeof el.customData?.terraformTopologyKey === "string"
    ? (el.customData.terraformTopologyKey as string)
    : null;

const pathOf = (el: Frame): string[] => {
  const p = el.customData?.terraformTopologyPath;
  return Array.isArray(p)
    ? (p.filter((s) => typeof s === "string") as string[])
    : [];
};

const isPrefix = (a: string[], b: string[]): boolean =>
  a.length <= b.length && a.every((s, i) => s === b[i]);

const relOf = (el: ExcalidrawElement) => {
  const r = (el.customData as { relationship?: unknown } | undefined)
    ?.relationship;
  return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
};

/**
 * A 2D line segment. Exported so the M6c crossing-min scorer
 * (`terraformPipelineRcllCrossingMin.ts`) can count crossings on box-derived
 * segments through the SAME kernel the rendered diagnostic uses (DRY — RFC DEC-6).
 */
export type Seg = { x1: number; y1: number; x2: number; y2: number };

// Polyline-aware arrow geometry (RFC DEC-6). The previous counter collapsed
// every arrow to a single first→last chord, which mis-counts crossings and
// vertical travel once arrows have bends (e.g. M9 orthogonal routing). We now
// keep all consecutive segments (for crossings) and the polyline's vertical
// extent max_y−min_y (for the ΔY / near-straight metrics). A 2-point straight
// arrow yields exactly one segment whose extent == |Δy|, so today's geometry is
// unchanged — verified by the two-point-regression fixture.
type ArrowGeometry = { segments: Seg[]; verticalExtent: number };

function arrowGeometry(el: ExcalidrawElement): ArrowGeometry | null {
  const pts = (el as { points?: ReadonlyArray<readonly [number, number]> })
    .points;
  if (!Array.isArray(pts) || pts.length < 2) {
    return null;
  }
  const segments: Seg[] = [];
  let minY = el.y + pts[0]![1];
  let maxY = minY;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    segments.push({
      x1: el.x + a[0],
      y1: el.y + a[1],
      x2: el.x + b[0],
      y2: el.y + b[1],
    });
    const ay = el.y + a[1];
    const by = el.y + b[1];
    minY = Math.min(minY, ay, by);
    maxY = Math.max(maxY, ay, by);
  }
  return { segments, verticalExtent: maxY - minY };
}

/** Acute angle between two segments' direction vectors, degrees ∈ [0, 90]. */
function segmentAngleDeg(a: Seg, b: Seg): number {
  const ux = a.x2 - a.x1;
  const uy = a.y2 - a.y1;
  const vx = b.x2 - b.x1;
  const vy = b.y2 - b.y1;
  const nu = Math.hypot(ux, uy);
  const nv = Math.hypot(vx, vy);
  if (nu === 0 || nv === 0) {
    return 90; // degenerate zero-length segment — never the sharp minimum
  }
  const cos = Math.min(1, Math.abs(ux * vx + uy * vy) / (nu * nv));
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Euclidean length of a segment. */
function segLen(s: Seg): number {
  return Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
}

/** Acute angle of a segment to the horizontal axis, degrees ∈ [0, 90]. A
 * horizontal segment is 0°, a vertical one 90°. */
function segAngleToHorizontalDeg(s: Seg): number {
  const dx = Math.abs(s.x2 - s.x1);
  const dy = Math.abs(s.y2 - s.y1);
  if (dx === 0 && dy === 0) {
    return 0;
  }
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/** Turn (deviation from collinear) between two consecutive DIRECTION vectors,
 * degrees ∈ [0, 180]. Collinear-same-direction = 0; right-angle = 90; reversal
 * = 180. Unlike `segmentAngleDeg` this is NOT folded to the acute range — a
 * bend must be distinguishable from a straight continuation. */
function turnAngleDeg(a: Seg, b: Seg): number {
  const ux = a.x2 - a.x1;
  const uy = a.y2 - a.y1;
  const vx = b.x2 - b.x1;
  const vy = b.y2 - b.y1;
  const nu = Math.hypot(ux, uy);
  const nv = Math.hypot(vx, vy);
  if (nu === 0 || nv === 0) {
    return 0; // degenerate zero-length segment — not a bend
  }
  const cos = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (nu * nv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Minimum acute crossing angle between two arrows' polylines, or null when no
 * segment pair properly crosses (v3.2 crossing-angle capture). Uses the SAME
 * `segmentsCross` kernel as the crossing count, so a pair contributes an angle
 * iff it contributes to `dataflow.crossings`; when several segment pairs of
 * the two polylines cross, the pair's angle is the WORST (minimum θ).
 */
function minCrossingAngleDeg(
  a: ArrowGeometry,
  b: ArrowGeometry,
): number | null {
  let min: number | null = null;
  for (const sa of a.segments) {
    for (const sb of b.segments) {
      if (segmentsCross(sa, sb)) {
        const deg = segmentAngleDeg(sa, sb);
        if (min === null || deg < min) {
          min = deg;
        }
      }
    }
  }
  return min;
}

type CardSide = "L" | "R" | "T" | "B";

/** The side of a rectangle a point is on/nearest, by larger normalized offset
 * from centre. Ties (a corner) prefer the horizontal axis, matching the LR
 * reading direction. Degenerate zero-size frames return "R". */
function sideOfPoint(
  px: number,
  py: number,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
): CardSide {
  if (fw <= 0 || fh <= 0) {
    return "R";
  }
  const nx = (px - (fx + fw / 2)) / (fw / 2);
  const ny = (py - (fy + fh / 2)) / (fh / 2);
  if (Math.abs(nx) >= Math.abs(ny)) {
    return nx >= 0 ? "R" : "L";
  }
  return ny >= 0 ? "B" : "T";
}

/** Outward-normal direction of a side, degrees (screen coords, y down). */
function sideNormalDeg(side: CardSide): number {
  switch (side) {
    case "R":
      return 0;
    case "L":
      return 180;
    case "T":
      return -90;
    case "B":
      return 90;
  }
}

/** Normalize an angle to (-180, 180], degrees. */
function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d <= -180) {
    d += 360;
  } else if (d > 180) {
    d -= 360;
  }
  return d;
}

function orient(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): number {
  const v = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  return v > 1e-6 ? 1 : v < -1e-6 ? -1 : 0;
}

/**
 * Proper-crossing test for two segments. Endpoint-sharing (within 1px) is treated
 * as NON-crossing — two edges that meet at a shared node do not "cross" in the
 * layered sense. Exported as the shared rendered-crossing kernel (RFC DEC-6) used
 * by both this diagnostic and the M6c box-coordinate scorer.
 */
export function segmentsCross(a: Seg, b: Seg): boolean {
  const share =
    (Math.abs(a.x1 - b.x1) < 1 && Math.abs(a.y1 - b.y1) < 1) ||
    (Math.abs(a.x1 - b.x2) < 1 && Math.abs(a.y1 - b.y2) < 1) ||
    (Math.abs(a.x2 - b.x1) < 1 && Math.abs(a.y2 - b.y1) < 1) ||
    (Math.abs(a.x2 - b.x2) < 1 && Math.abs(a.y2 - b.y2) < 1);
  if (share) {
    return false;
  }
  const o1 = orient(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const o2 = orient(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const o3 = orient(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const o4 = orient(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return o1 !== o2 && o3 !== o4;
}

/**
 * Classify a colliding topology-frame pair into the first applicable category.
 * Returns null when the pair does not collide or is a valid ancestor pair.
 */
function classifyFramePair(a: Frame, b: Frame): CollisionCategory | null {
  const roleA = roleOf(a);
  const roleB = roleOf(b);
  const hullA = topologyFrameCollisionHull(rectOf(a));
  const hullB = topologyFrameCollisionHull(rectOf(b));
  const hullsOverlap = rectsOverlap(hullA, hullB);

  if (roleA === "region" && roleB === "region" && hullsOverlap) {
    return "region-region";
  }
  if (roleA === "subnetZone" && roleB === "subnetZone" && hullsOverlap) {
    const pa = pathOf(a);
    const pb = pathOf(b);
    // same VPC parent = first 4 path segments equal (provider/account/region/vpc)
    if (
      pa.length >= 4 &&
      pb.length >= 4 &&
      pa.slice(0, 4).join("\0") === pb.slice(0, 4).join("\0")
    ) {
      return "same-vpc-subnet-subnet";
    }
  }
  if (!hullsOverlap) {
    return null;
  }
  const pa = pathOf(a);
  const pb = pathOf(b);
  if (isPrefix(pa, pb) || isPrefix(pb, pa)) {
    return null; // valid ancestor containment
  }
  return "non-ancestor-topology-frame";
}

export function diagnosePipelineScene(
  elements: readonly ExcalidrawElement[],
): PipelineSceneDiagnostics {
  const frames = elements.filter(
    (el): el is Frame =>
      el.type === "frame" &&
      !el.isDeleted &&
      TOPOLOGY_ROLES.has(roleOf(el as Frame)),
  );
  const primaryClusters = elements.filter(
    (el) =>
      el.type === "frame" &&
      !el.isDeleted &&
      (el.customData as { terraformTopologyRole?: string } | undefined)
        ?.terraformTopologyRole === "primaryCluster",
  );

  const collisions: FinalSceneCollision[] = [];
  const collisionsByCategory: Record<CollisionCategory, number> = {
    "region-region": 0,
    "same-vpc-subnet-subnet": 0,
    "frame-title-primary-cluster": 0,
    "non-ancestor-topology-frame": 0,
  };
  const record = (cat: CollisionCategory, a: Frame, b: Frame) => {
    collisions.push({
      category: cat,
      a: { id: a.id, role: roleOf(a), key: keyOf(a) },
      b: { id: b.id, role: roleOf(b), key: keyOf(b) },
    });
    collisionsByCategory[cat] += 1;
  };

  // frame-title vs primary cluster (count even when the cluster is a descendant —
  // title space is not valid content space).
  for (const f of frames) {
    const title = frameTitleRect(rectOf(f));
    for (const pc of primaryClusters) {
      if (rectsOverlap(title, rectOf(pc))) {
        record("frame-title-primary-cluster", f, pc as Frame);
      }
    }
  }

  // topology-frame pairs (region-region / same-vpc-subnet / non-ancestor)
  for (let i = 0; i < frames.length; i++) {
    for (let j = i + 1; j < frames.length; j++) {
      const cat = classifyFramePair(frames[i]!, frames[j]!);
      if (cat) {
        record(cat, frames[i]!, frames[j]!);
      }
    }
  }

  // Y-band interleave (forced-band purity): same-role frames whose vertical
  // intervals overlap regardless of X.
  const byRole = (role: string) => frames.filter((f) => roleOf(f) === role);
  const yShared = (els: Frame[]) => {
    let n = 0;
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        if (yIntervalsOverlap(rectOf(els[i]!), rectOf(els[j]!))) {
          n += 1;
        }
      }
    }
    return n;
  };

  // semantic edge violations: declared edge whose target column is left of source.
  const frameByAddress = new Map<string, Frame>();
  for (const pc of primaryClusters) {
    const addr = (pc.customData as { terraformPrimaryAddress?: string })
      ?.terraformPrimaryAddress;
    if (typeof addr === "string") {
      frameByAddress.set(addr, pc as Frame);
    }
  }
  const centerX = (f: Frame) => f.x + f.width / 2;
  const centerY = (f: Frame) => f.y + f.height / 2;
  const semanticEdgeViolations: SemanticEdgeViolation[] = [];

  const allArrows = elements.filter((el) => el.type === "arrow");
  const tfdArrows = allArrows.filter((el) => {
    const r = relOf(el);
    return (
      r != null &&
      typeof r.source === "string" &&
      typeof r.target === "string" &&
      r.aggregated !== true
    );
  });
  for (const arrow of tfdArrows) {
    const r = relOf(arrow)!;
    const src = frameByAddress.get(r.source as string);
    const tgt = frameByAddress.get(r.target as string);
    if (src && tgt && centerX(tgt) < centerX(src) - 1) {
      semanticEdgeViolations.push({
        source: r.source as string,
        target: r.target as string,
      });
    }
  }

  // dataflow metrics — polyline-aware (RFC DEC-6).
  const geoms = tfdArrows
    .map(arrowGeometry)
    .filter((g): g is ArrowGeometry => g != null);
  // Crossings: count each arrow PAIR at most once, even if multiple of their
  // segments intersect ("edges that cross", not segment intersections). For
  // 2-point arrows this reduces to the previous chord-vs-chord count. The same
  // pass captures each crossing pair's worst acute angle (v3.2).
  let crossings = 0;
  const crossingAngleDegs: number[] = [];
  for (let i = 0; i < geoms.length; i++) {
    for (let j = i + 1; j < geoms.length; j++) {
      const deg = minCrossingAngleDeg(geoms[i]!, geoms[j]!);
      if (deg !== null) {
        crossings += 1;
        crossingAngleDegs.push(deg);
      }
    }
  }
  // Vertical deviation / near-straight use the polyline's vertical extent
  // (max_y−min_y), so an orthogonal jog reads as deviating even when its
  // endpoints share a Y. Equals |Δy| for a straight arrow.
  const dys = geoms.map((g) => g.verticalExtent).sort((a, b) => a - b);
  const medianDeltaY = dys.length ? dys[Math.floor(dys.length / 2)]! : 0;
  const meanDeltaY = dys.length
    ? dys.reduce((a, b) => a + b, 0) / dys.length
    : 0;
  const nearStraight = dys.filter((d) => d <= NEAR_STRAIGHT_MAX_PX).length;

  // Fan-out / convergence readability (REQ-3/T4, REQ-6/T5). Reconstruct sets
  // from the TFD arrow relationships and resolve endpoints to primary-cluster
  // frames by terraformPrimaryAddress (same map as the semantic-edge gate).
  // Coverage depends on the builder: under the compound fallback this resolves
  // in Compact (every cluster card carries terraformPrimaryAddress) but is
  // empty in Full, where the inlined-satellite cluster frames carry no such
  // address — so Full reads 0 with fanoutSetCount/hubCount 0 (the companion
  // counts make that "measured nothing" explicit rather than a false 1.0).
  // RCLL geometry (M2+) tags frames consistently, closing the Full gap.
  const targetsBySource = new Map<string, Set<string>>();
  const sourcesByTarget = new Map<string, Set<string>>();
  const addTo = (map: Map<string, Set<string>>, key: string, value: string) => {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(value);
  };
  for (const arrow of tfdArrows) {
    const r = relOf(arrow)!;
    const source = r.source as string;
    const target = r.target as string;
    if (source === target) {
      continue;
    }
    addTo(targetsBySource, source, target);
    addTo(sourcesByTarget, target, source);
  }

  // fanoutColumnRate: of fan-out sets with ≥2 resolvable targets, the fraction
  // whose targets share a column (centerX spread ≤ tolerance).
  let fanoutSetCount = 0;
  let fanoutColumnAligned = 0;
  // hubCenteringRate: of nodes that fan out OR converge (≥2 resolvable
  // neighbours) and resolve to a frame, the fraction centered within ε on the
  // median of those neighbours (both directions, RFC §13 gate).
  let hubCount = 0;
  let hubCentered = 0;
  const evaluate = (
    nodeAddr: string,
    neighbours: Set<string>,
    countColumn: boolean,
  ) => {
    const neighbourFrames = [...neighbours]
      .map((addr) => frameByAddress.get(addr))
      .filter((f): f is Frame => f != null);
    if (neighbourFrames.length < 2) {
      return;
    }
    if (countColumn) {
      fanoutSetCount += 1;
      const xs = neighbourFrames.map(centerX);
      if (Math.max(...xs) - Math.min(...xs) <= FANOUT_COLUMN_TOLERANCE_PX) {
        fanoutColumnAligned += 1;
      }
    }
    const node = frameByAddress.get(nodeAddr);
    if (node) {
      hubCount += 1;
      if (
        Math.abs(centerY(node) - median(neighbourFrames.map(centerY))) <=
        CENTERING_EPSILON_PX
      ) {
        hubCentered += 1;
      }
    }
  };
  for (const [source, targets] of targetsBySource) {
    evaluate(source, targets, true);
  }
  for (const [target, sources] of sourcesByTarget) {
    evaluate(target, sources, false);
  }

  // aspect = content bounding box W:H over topology frames + clusters.
  const aspectEls = [...frames, ...primaryClusters];
  let aspect = 0;
  if (aspectEls.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const el of aspectEls) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      maxX = Math.max(maxX, el.x + el.width);
      maxY = Math.max(maxY, el.y + el.height);
    }
    const height = maxY - minY;
    aspect = height > 0 ? (maxX - minX) / height : 0;
  }

  const rate = (numerator: number, denominator: number) =>
    denominator > 0 ? Math.round((numerator / denominator) * 100) / 100 : 0;

  return {
    collisionCount: collisions.length,
    collisions,
    collisionsByCategory,
    bandInterleave: {
      regionYIntervalSharedPairs: yShared(byRole("region")),
      accountYIntervalSharedPairs: yShared(byRole("account")),
    },
    semanticEdgeViolations,
    dataflow: {
      tfdArrowCount: geoms.length,
      crossings,
      medianVerticalDeviationPx: Math.round(medianDeltaY * 100) / 100,
      meanVerticalDeviationPx: Math.round(meanDeltaY * 100) / 100,
      fractionNearStraight: rate(nearStraight, geoms.length),
      fanoutColumnRate: rate(fanoutColumnAligned, fanoutSetCount),
      fanoutSetCount,
      hubCenteringRate: rate(hubCentered, hubCount),
      hubCount,
      aspect: Math.round(aspect * 100) / 100,
    },
    slices: computeSliceMetrics(elements),
    crossingAngles: crossingAngleSummaryOf(crossingAngleDegs),
    edgeAngles: edgeAngleSummaryOf(geoms, tfdArrows, frameByAddress),
  };
}

/** Summarize crossing-pair angles (degrees) into the v3.2 scene scalars.
 * Nearest-rank p10 uses the file family's `sorted[floor(n·f)]` convention. */
export function crossingAngleSummaryOf(
  degs: readonly number[],
): CrossingAngleSummary {
  const n = degs.length;
  if (n === 0) {
    return { nCross: 0, sharpShare: 0, sharpShare70: 0, p10Deg: 0, minDeg: 0 };
  }
  const sorted = [...degs].sort((a, b) => a - b);
  const sharp = sorted.filter((d) => d < SHARP_CROSSING_MAX_DEG).length;
  const sharp70 = sorted.filter((d) => d < SHARP_CROSSING_MAX_DEG_70).length;
  const p10 = sorted[Math.min(n - 1, Math.floor(n * 0.1))]!;
  const round2 = (v: number) => Math.round(v * 100) / 100;
  return {
    nCross: n,
    sharpShare: round2(sharp / n),
    sharpShare70: round2(sharp70 / n),
    p10Deg: round2(p10),
    minDeg: round2(sorted[0]!),
  };
}

/**
 * Probe P2 edge-angle summary over TFD arrows. `geoms` supplies the
 * polyline segments (bends + near-flat); `tfdArrows` + `frameByAddress` supply
 * the endpoint→card resolution for angular resolution. Pure — no element
 * mutation, all values derived from geometry already in hand.
 */
export function edgeAngleSummaryOf(
  geoms: readonly { segments: Seg[] }[],
  tfdArrows: readonly ExcalidrawElement[],
  frameByAddress: ReadonlyMap<string, ExcalidrawElement>,
): EdgeAngleSummary {
  const round2 = (v: number) => Math.round(v * 100) / 100;

  // Bends + near-flat: polyline-aware over the same segments as crossings.
  let bendCountTotal = 0;
  let bendCountMax = 0;
  let nearFlatSegments = 0;
  let longSegments = 0;
  for (const g of geoms) {
    let bends = 0;
    for (let s = 0; s + 1 < g.segments.length; s++) {
      if (turnAngleDeg(g.segments[s]!, g.segments[s + 1]!) > BEND_MIN_DEG) {
        bends += 1;
      }
    }
    bendCountTotal += bends;
    bendCountMax = Math.max(bendCountMax, bends);
    for (const seg of g.segments) {
      if (segLen(seg) > NEAR_FLAT_MIN_LEN_PX) {
        longSegments += 1;
        if (segAngleToHorizontalDeg(seg) < NEAR_FLAT_MAX_DEG) {
          nearFlatSegments += 1;
        }
      }
    }
  }
  const edgeCount = geoms.length;

  // Endpoint angular resolution: group each incident edge's departure by
  // (card, side); departures are stored relative to the side's outward normal
  // so a "left" side's ±180° departures do not wrap when sorted.
  const sideDepartures = new Map<string, number[]>();
  const addDeparture = (
    frame: ExcalidrawElement,
    endpointX: number,
    endpointY: number,
    dirX: number,
    dirY: number,
  ) => {
    if (dirX === 0 && dirY === 0) {
      return;
    }
    const side = sideOfPoint(
      endpointX,
      endpointY,
      frame.x,
      frame.y,
      frame.width,
      frame.height,
    );
    const angle = (Math.atan2(dirY, dirX) * 180) / Math.PI;
    const rel = normalizeDeg(angle - sideNormalDeg(side));
    const key = `${frame.id}:${side}`;
    let list = sideDepartures.get(key);
    if (!list) {
      list = [];
      sideDepartures.set(key, list);
    }
    list.push(rel);
  };
  for (const arrow of tfdArrows) {
    const pts = (arrow as { points?: ReadonlyArray<readonly [number, number]> })
      .points;
    if (!Array.isArray(pts) || pts.length < 2) {
      continue;
    }
    const r = relOf(arrow);
    if (!r || typeof r.source !== "string" || typeof r.target !== "string") {
      continue;
    }
    const n = pts.length;
    const p0x = arrow.x + pts[0]![0];
    const p0y = arrow.y + pts[0]![1];
    const p1x = arrow.x + pts[1]![0];
    const p1y = arrow.y + pts[1]![1];
    const lastx = arrow.x + pts[n - 1]![0];
    const lasty = arrow.y + pts[n - 1]![1];
    const prevx = arrow.x + pts[n - 2]![0];
    const prevy = arrow.y + pts[n - 2]![1];
    const srcFrame = frameByAddress.get(r.source as string);
    if (srcFrame) {
      addDeparture(srcFrame, p0x, p0y, p1x - p0x, p1y - p0y);
    }
    const tgtFrame = frameByAddress.get(r.target as string);
    if (tgtFrame) {
      addDeparture(tgtFrame, lastx, lasty, prevx - lastx, prevy - lasty);
    }
  }
  const perSideMin: number[] = [];
  for (const list of sideDepartures.values()) {
    if (list.length < 2) {
      continue;
    }
    const sorted = [...list].sort((a, b) => a - b);
    let minGap = Infinity;
    for (let i = 0; i + 1 < sorted.length; i++) {
      minGap = Math.min(minGap, sorted[i + 1]! - sorted[i]!);
    }
    perSideMin.push(minGap);
  }
  const sidesConsidered = perSideMin.length;

  return {
    bendCountTotal,
    bendCountMax,
    bendCountMeanPerEdge: edgeCount > 0 ? round2(bendCountTotal / edgeCount) : 0,
    edgeCount,
    nearFlatShare: longSegments > 0 ? round2(nearFlatSegments / longSegments) : 0,
    nearFlatSegments,
    longSegments,
    endpointAngularResolutionMinDeg: sidesConsidered
      ? round2(Math.min(...perSideMin))
      : 0,
    endpointAngularResolutionMeanDeg: sidesConsidered
      ? round2(perSideMin.reduce((a, b) => a + b, 0) / sidesConsidered)
      : 0,
    endpointSidesConsidered: sidesConsidered,
  };
}
