/* eslint-disable max-lines -- Aggregator diagnostics leaf: the wave-3 additive
 * badPatterns block (report 3 §0-§6: samePairMultiCross / parallelCross /
 * backwardTurn / endpointOcclusion + offenders) lands here per spec because the
 * `badPatterns` field is part of PipelineSceneDiagnostics and reuses this file's
 * segmentsCross / arrowGeometry / frameByAddress kernels. Matches the
 * eslint-disable precedent of the sibling large leaves (terraformPipelineLayoutShared.ts,
 * terraformPipelineStrataAncillary.ts). */
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
// Wave-3 badPatterns (M4 own-card re-entry): reuse the pierce leaf's normative
// interior-intersection kernel rather than re-implementing it. Sibling leaf, no
// layout-module dependency (per the file's L163-165 constraint).
import { segmentIntersectsRectInterior } from "./terraformPipelineStrataPierceMetrics";

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
  /** Wave-3 owner-theory validation metrics (samePairMultiCross, parallelCross
   * + bundleGridCross, backwardTurn, endpointOcclusion) + edgeLengthPxTotal.
   * Additive; computed from the SAME polyline geometry as `dataflow.crossings`
   * without altering it (report 3 §0-§6). */
  badPatterns: BadPatternsSummary;
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

/** Near-flat segment thresholds (edge-angle metric, probe P2). A LONG segment
 * (> `NEAR_FLAT_MIN_LEN_PX`) counts as "near-flat" when its acute angle to the
 * horizontal falls in the half-open band `(NEAR_FLAT_MIN_DEG, NEAR_FLAT_MAX_DEG]`
 * — the owner's "extreme angle" complaint operationalized as a long,
 * almost-but-not-quite-horizontal diagonal.
 *
 * The `NEAR_FLAT_MIN_DEG` (1°) floor is a FAIRNESS fix for orthogonal routing
 * (step / channel arms): an exact-horizontal segment (≤ 1°) is a DELIBERATE run,
 * not a near-flat readability defect, so it is excluded from the numerator and
 * tallied separately as `horizontalSegments`. Before the floor, the channel arm
 * read nearFlatShare ≈ 0.62 purely from its intentional horizontals — a
 * meaningless number. */
export const NEAR_FLAT_MAX_DEG = 15;
export const NEAR_FLAT_MIN_DEG = 1;
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
  /** Fraction of LONG segments (> NEAR_FLAT_MIN_LEN_PX) that are near-flat —
   * acute angle to horizontal in `(NEAR_FLAT_MIN_DEG, NEAR_FLAT_MAX_DEG]`, i.e.
   * true near-flat diagonals, EXCLUDING deliberate horizontals (≤ 1°). 0 when no
   * long segments. */
  nearFlatShare: number;
  /** Long, near-flat DIAGONAL segments — angle in (1°, 15°] (numerator of
   * nearFlatShare). Excludes exact horizontals. */
  nearFlatSegments: number;
  /** Long, deliberately-horizontal segments — angle ≤ NEAR_FLAT_MIN_DEG (1°).
   * Reported separately so orthogonal (step/channel) routing is not penalized
   * for its intentional horizontal runs. */
  horizontalSegments: number;
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

/**
 * Edge geometry WITH identity (report 3 §0-A). Extends the anonymous
 * ArrowGeometry with the arrow's element id + terraform source/target addresses
 * + world-coordinate polyline points, so the badPatterns metrics can attribute
 * offenders. `segments`/`verticalExtent` are byte-identical to `arrowGeometry`.
 */
export type EdgeGeom = {
  id: string;
  source: string;
  target: string;
  segments: Seg[];
  points: Array<[number, number]>;
  verticalExtent: number;
};

/**
 * One deduped crossing between two edges (report 3 §0-B). `x`/`y` = intersection
 * point (world coords); `degAcute` = acute crossing angle; `dirADeg`/`dirBDeg` =
 * each segment's direction folded into [0,180); `segA`/`segB` = the crossing
 * segment indices on edge A / edge B.
 */
export type CrossingEvent = {
  x: number;
  y: number;
  degAcute: number;
  dirADeg: number;
  dirBDeg: number;
  segA: number;
  segB: number;
};

/** Wave-3 owner-theory validation metrics (report 3 §5). Every rate pairs with
 * its count (0-when-vacuous, DEC-6). */
export type BadPatternsSummary = {
  /** M1 — edge pairs that cross ≥2 times (removable, zero information). */
  samePairMultiCross: {
    pairs: number;
    excess: number;
    maxPerPair: number;
    totalCrossEvents: number;
  };
  /** M2 — (2a) near-parallel small-angle bundle crossings (PENALTY);
   * (2b) organized bundle-grid crossings (DESCRIPTIVE ONLY — never gated, a rise
   * with fewer scattered crossings may be an improvement). */
  parallelCross: {
    events: number;
    share: number;
    gridEvents: number;
    gridShare: number;
    totalEvents: number;
  };
  /** M3 — signed-run against-flow excursions beyond one stub (H_BACKTRACK). */
  backwardTurn: {
    edges: number;
    countTotal: number;
    backtrackPxTotal: number;
    backtrackPxMax: number;
    edgeCount: number;
  };
  /** M4 — (4a) own-card re-entry beyond the stub; (4b) crossings within
   * R_ANCHOR of an attachment point, split own/foreign. */
  endpointOcclusion: {
    ownCardReentryCount: number;
    ownCardReentryEdges: number;
    endpointCrossOwn: number;
    endpointCrossForeign: number;
    anchorCount: number;
    endpointsResolved: number;
    endpointsUnresolved: number;
  };
  /** Literature adjustment #2 (F3 guard axis): Σ polyline arc length over edges. */
  edgeLengthPxTotal: number;
};

type EdgeRef = { id: string; source: string; target: string };

/** Per-metric top-10 offenders (report 3 §6) — element ids + terraform
 * addresses + integer world coords for screenshot/refinement/share-URL repro. */
export type BadPatternOffenders = {
  samePairMultiCross: Array<{
    edgeA: EdgeRef;
    edgeB: EdgeRef;
    crossCount: number;
    points: Array<[number, number]>;
    minDeg: number;
  }>;
  parallelCross: Array<{
    id: string;
    source: string;
    target: string;
    parallelEvents: number;
    gridEvents: number;
    samplePoints: Array<[number, number]>;
    partnerEdgeIds: string[];
  }>;
  backwardTurn: Array<{
    id: string;
    source: string;
    target: string;
    backwardTurns: number;
    backtrackPx: number;
    worstRun: { fromX: number; toX: number; y: number } | null;
    semanticViolation: boolean;
  }>;
  endpointOcclusion: Array<{
    id: string;
    source: string;
    target: string;
    reentry: "src" | "tgt" | "both" | null;
    reentryRect: {
      frameId: string;
      x: number;
      y: number;
      w: number;
      h: number;
    } | null;
    anchorCrossOwn: number;
    anchorCrossForeign: number;
    anchorPoints: Array<[number, number]>;
  }>;
};

// Metric tolerances, derived from the layout spacing in
// terraformPipelineLayoutShared.ts (kept local so this diagnostics leaf does
// not depend on the heavy layout module). If that spacing changes, update here.
//   FANOUT_COLUMN_TOLERANCE_PX = PIPELINE_COLUMN_GAP (150) / 2
//   CENTERING_EPSILON_PX       = PIPELINE_CLUSTER_GAP_Y (36)
const FANOUT_COLUMN_TOLERANCE_PX = 75;
const CENTERING_EPSILON_PX = 36;
const NEAR_STRAIGHT_MAX_PX = 24;

// ── Wave-3 badPatterns constants (report 3 §5). All re-declared locally with
// their donor named, matching the FANOUT_COLUMN_TOLERANCE_PX precedent above —
// this diagnostics leaf must not import the heavy layout / edge-style / channel
// modules. If a donor constant changes, update the value here.

/** Two crossing events closer than one routing track read as ONE crossing.
 * Donor: STRATA_CHANNEL_TRACK_GAP_PX (terraformPipelineStrataChannelRoute.ts).
 * > the 1px endpoint-share tolerance and < the 20px stub, so genuinely separate
 * crossings (≥ one track apart) survive dedup. */
export const CROSS_DEDUP_PX = 12;
/** Acute crossing angle below which a crossing is "near-parallel" (the worst
 * tail of sharp crossings — sits between NEAR_FLAT_MAX_DEG=15 and
 * SHARP_CROSSING_MAX_DEG=30). Huang 2008 (already cited above). */
export const PARALLEL_CROSS_MAX_DEG = 20;
/** Direction-alignment band for two edges to count as a near-parallel bundle.
 * Donor: NEAR_FLAT_MAX_DEG (this file) — the existing near-parallel band. */
export const PARALLEL_ALIGN_MAX_DEG = 15;
/** Spatial-neighbor radius / grid cell for the parallelCross bundle test.
 * Donor: FANOUT_COLUMN_TOLERANCE_PX = PIPELINE_COLUMN_GAP/2 — "same visual
 * column" locality. */
export const D_NEIGH_PX = 75;
/** A signed x-run below this magnitude is stub/jitter, not a genuine backward
 * excursion. Donor: STRATA_EDGE_STYLE_STUB_PX = STRATA_CHANNEL_STUB_PX = 20 —
 * one perpendicular escape/entry stub. */
export const H_BACKTRACK_PX = 20;
/** Arc-length skipped from each endpoint before own-card re-entry is tested
 * (clears the exit/entry stub). Donor: STRATA_EDGE_STYLE_STUB_PX = 20. */
export const STUB_SKIP_PX = 20;
/** A crossing within this radius of an edge's attachment point reads as "at the
 * card". Donor: PIPELINE_FRAME_PAD (terraformPipelineLayoutShared.ts, =28);
 * also ≈ NEAR_STRAIGHT_MAX_PX=24, same perceptual scale. */
export const R_ANCHOR_PX = 28;

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

  // dataflow metrics — polyline-aware (RFC DEC-6). `geoms` now carries edge
  // identity (EdgeGeom) so the additive badPatterns block can attribute
  // offenders; `segments`/`verticalExtent` are byte-identical to the previous
  // anonymous ArrowGeometry (same `arrowGeometry` output, same <2-point filter,
  // same tfdArrows order), so crossings/crossingAngles are unchanged.
  const geoms = tfdArrows
    .map(edgeGeomOf)
    .filter((g): g is EdgeGeom => g != null);
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
    badPatterns: computeBadPatterns(geoms, frameByAddress).summary,
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
  let horizontalSegments = 0;
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
        const deg = segAngleToHorizontalDeg(seg);
        if (deg <= NEAR_FLAT_MIN_DEG) {
          // Deliberate horizontal (≤ 1°) — counted separately, never near-flat.
          horizontalSegments += 1;
        } else if (deg <= NEAR_FLAT_MAX_DEG) {
          // True near-flat diagonal in (1°, 15°].
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
    bendCountMeanPerEdge:
      edgeCount > 0 ? round2(bendCountTotal / edgeCount) : 0,
    edgeCount,
    nearFlatShare:
      longSegments > 0 ? round2(nearFlatSegments / longSegments) : 0,
    nearFlatSegments,
    horizontalSegments,
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

// ────────────────────────────────────────────────────────────────────────────
// Wave-3 badPatterns (report 3 §0-§6). Additive; the crossings/crossingAngles
// computation above is untouched. All geometry is world-coordinate polylines.
// ────────────────────────────────────────────────────────────────────────────

/** Wrap `arrowGeometry` with edge identity + world-coordinate points (§0-A).
 * Returns null under exactly the same condition as the old `geoms` filter
 * (arrow with <2 points), preserving byte-identity of the crossing set. */
function edgeGeomOf(el: ExcalidrawElement): EdgeGeom | null {
  const g = arrowGeometry(el);
  if (!g) {
    return null;
  }
  const pts = (el as { points?: ReadonlyArray<readonly [number, number]> })
    .points!;
  const points = pts.map(
    ([px, py]) => [el.x + px, el.y + py] as [number, number],
  );
  const r = relOf(el);
  return {
    id: el.id,
    source: r && typeof r.source === "string" ? r.source : "",
    target: r && typeof r.target === "string" ? r.target : "",
    segments: g.segments,
    points,
    verticalExtent: g.verticalExtent,
  };
}

/** Direction of a segment vector folded into [0,180) degrees (undirected). */
function foldDirDeg(dx: number, dy: number): number {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return ((deg % 180) + 180) % 180;
}

/** Minimal folded difference between two [0,180) directions, into [0,90]. */
function foldedAngleDiff(d1: number, d2: number): number {
  let d = Math.abs(d1 - d2) % 180;
  if (d > 90) {
    d = 180 - d;
  }
  return d;
}

/**
 * Deduped crossing events between two edges' polylines (§0-B). For each segment
 * pair passing the EXISTING `segmentsCross` kernel (not forked), compute the
 * intersection point; skip |D| < 1e-9 (near-collinear pairs orient's 1e-6
 * tolerance can admit). Sampled curves graze tangentially and emit several
 * intersections one sample apart that read as ONE crossing: sort by (segA,
 * t-along-A) and merge events within CROSS_DEDUP_PX of the running cluster's
 * last point; each cluster emits one event (min degAcute, first member's point).
 */
export function crossingEventsOf(a: EdgeGeom, b: EdgeGeom): CrossingEvent[] {
  const raw: Array<CrossingEvent & { tA: number }> = [];
  for (let i = 0; i < a.segments.length; i++) {
    const sa = a.segments[i]!;
    const rx = sa.x2 - sa.x1;
    const ry = sa.y2 - sa.y1;
    for (let j = 0; j < b.segments.length; j++) {
      const sb = b.segments[j]!;
      if (!segmentsCross(sa, sb)) {
        continue;
      }
      const ux = sb.x2 - sb.x1;
      const uy = sb.y2 - sb.y1;
      const D = rx * uy - ry * ux;
      if (Math.abs(D) < 1e-9) {
        continue;
      }
      const t = ((sb.x1 - sa.x1) * uy - (sb.y1 - sa.y1) * ux) / D;
      raw.push({
        x: sa.x1 + t * rx,
        y: sa.y1 + t * ry,
        degAcute: segmentAngleDeg(sa, sb),
        dirADeg: foldDirDeg(rx, ry),
        dirBDeg: foldDirDeg(ux, uy),
        segA: i,
        segB: j,
        tA: t,
      });
    }
  }
  if (raw.length <= 1) {
    return raw.map(({ tA: _tA, ...e }) => e);
  }
  raw.sort((p, q) => p.segA - q.segA || p.tA - q.tA);
  const emit = (
    cluster: Array<CrossingEvent & { tA: number }>,
  ): CrossingEvent => {
    let minDeg = cluster[0]!.degAcute;
    for (const e of cluster) {
      minDeg = Math.min(minDeg, e.degAcute);
    }
    const f = cluster[0]!;
    return {
      x: f.x,
      y: f.y,
      degAcute: minDeg,
      dirADeg: f.dirADeg,
      dirBDeg: f.dirBDeg,
      segA: f.segA,
      segB: f.segB,
    };
  };
  const out: CrossingEvent[] = [];
  let cluster: Array<CrossingEvent & { tA: number }> = [raw[0]!];
  let lastX = raw[0]!.x;
  let lastY = raw[0]!.y;
  for (let k = 1; k < raw.length; k++) {
    const e = raw[k]!;
    if (Math.hypot(e.x - lastX, e.y - lastY) <= CROSS_DEDUP_PX) {
      cluster.push(e);
      lastX = e.x;
      lastY = e.y;
    } else {
      out.push(emit(cluster));
      cluster = [e];
      lastX = e.x;
      lastY = e.y;
    }
  }
  out.push(emit(cluster));
  return out;
}

type ScenedEvent = CrossingEvent & {
  pairIdx: number;
  edgeA: string;
  edgeB: string;
};

type SignedRun = { dx: number; startIdx: number; endIdx: number };

const runSign = (v: number): number => (v > 1e-6 ? 1 : v < -1e-6 ? -1 : 0);

/** Merge consecutive same-sign (or neutral) runs, preserving span indices. */
function mergeAdjacentRuns(runs: SignedRun[]): SignedRun[] {
  if (runs.length === 0) {
    return runs;
  }
  const out: SignedRun[] = [{ ...runs[0]! }];
  for (let k = 1; k < runs.length; k++) {
    const last = out[out.length - 1]!;
    const cur = runs[k]!;
    const sl = runSign(last.dx);
    const sc = runSign(cur.dx);
    if (sl === sc || sl === 0 || sc === 0) {
      last.dx += cur.dx;
      last.endIdx = cur.endIdx;
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * Signed-run compression for backwardTurn (§3): build maximal signed x-runs,
 * then fold the smallest run ≤ H_BACKTRACK into its surroundings and re-merge,
 * repeating until every surviving run exceeds one stub. Smallest-first folding
 * matches "fold jitter into surrounding context" (a small neutral/backward blip
 * between two forward runs is absorbed, merging them).
 */
function compressBackwardRuns(points: Array<[number, number]>): SignedRun[] {
  let runs: SignedRun[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const dx = points[i + 1]![0] - points[i]![0];
    if (runs.length === 0) {
      runs.push({ dx, startIdx: i, endIdx: i + 1 });
      continue;
    }
    const last = runs[runs.length - 1]!;
    const sl = runSign(last.dx);
    const sc = runSign(dx);
    if (sc === 0 || sl === 0 || sc === sl) {
      last.dx += dx;
      last.endIdx = i + 1;
    } else {
      runs.push({ dx, startIdx: i, endIdx: i + 1 });
    }
  }
  runs = mergeAdjacentRuns(runs);
  // Fold smallest ≤H run, re-merge, until stable.
  for (;;) {
    let idx = -1;
    let best = Infinity;
    for (let k = 0; k < runs.length; k++) {
      const mag = Math.abs(runs[k]!.dx);
      if (mag <= H_BACKTRACK_PX && mag < best) {
        best = mag;
        idx = k;
      }
    }
    if (idx < 0) {
      break;
    }
    runs.splice(idx, 1);
    if (runs.length === 0) {
      break;
    }
    runs = mergeAdjacentRuns(runs);
  }
  return runs;
}

/** Strict (OPEN) interior membership, matching `segmentIntersectsRectInterior`'s
 * midpoint rule: a point ON the border is NOT inside. */
const pointStrictlyInsideRect = (
  p: readonly [number, number],
  rect: Rect,
): boolean =>
  rect.width > 0 &&
  rect.height > 0 &&
  p[0] > rect.x &&
  p[0] < rect.x + rect.width &&
  p[1] > rect.y &&
  p[1] < rect.y + rect.height;

/**
 * Own-card re-entry test (§4a): does the polyline RE-ENTER `rect`'s interior
 * *after it has first left it*? Call with reversed points to test the target
 * end.
 *
 * EXIT-FIRST SEMANTICS (measurement-artifact fix). The naïve "skip a fixed
 * `skipPx` of arc, then flag any interior presence" rule mis-counts every
 * legitimate egress run: a body-anchored endpoint (route/border/style-pass
 * edges since the curve-fix track) sits well OVER `skipPx` INSIDE its composite
 * frame, so the single run from the body out through the frame border is still
 * inside the rect past `skipPx` and reads as a re-entry it is not. A re-entry is
 * only real once the polyline has EXITED the rect and come back. So:
 *   1. Walk from the endpoint until the path first leaves the interior; skip
 *      that whole egress run (its arc length, but never less than `skipPx` — the
 *      stub lower bound still clears a border-hugging start).
 *   2. Test only the remainder for interior intersection.
 *   3. Degenerate always-inside edge (never exits): fall back to the `skipPx`
 *      lower-bound skip so a chord that never leaves its own card is still
 *      flagged.
 * Splits the segment straddling the effective skip point, then tests each
 * remaining (sub)segment via the pierce leaf's `segmentIntersectsRectInterior`.
 */
function polylineReentersRect(
  points: ReadonlyArray<readonly [number, number]>,
  rect: Rect,
  skipPx: number,
): boolean {
  if (points.length < 2) {
    return false;
  }
  // Arc length to the first exit from the interior. If the endpoint already
  // sits on/outside the border (a non-body anchor), the egress is 0 and the
  // effective skip collapses to the `skipPx` lower bound — i.e. the original
  // fixed-stub behavior, unchanged. If the endpoint is inside (body anchor),
  // skip out to the first vertex that leaves the interior.
  let exitAcc: number | null = pointStrictlyInsideRect(points[0]!, rect)
    ? null
    : 0;
  if (exitAcc === null) {
    let walk = 0;
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      walk += Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!pointStrictlyInsideRect(b, rect)) {
        exitAcc = walk;
        break;
      }
    }
  }
  // exitAcc === null here ⇒ the polyline never left the interior (degenerate
  // always-inside). Use the stub lower bound so the remainder test still flags
  // it; otherwise skip the whole egress run (>= the stub lower bound).
  const effectiveSkip =
    exitAcc === null ? skipPx : Math.max(skipPx, exitAcc);

  let acc = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + L <= effectiveSkip) {
      acc += L;
      continue;
    }
    let start: readonly [number, number] = a;
    if (acc < effectiveSkip && L > 0) {
      const tt = (effectiveSkip - acc) / L;
      start = [a[0] + tt * (b[0] - a[0]), a[1] + tt * (b[1] - a[1])];
    }
    if (segmentIntersectsRectInterior(start, b, rect)) {
      return true;
    }
    acc += L;
  }
  return false;
}

/**
 * Compute the Wave-3 badPatterns summary + top-10 offenders in one pass over the
 * identity-carrying edge geometry. `frameByAddress` resolves terraform addresses
 * to primary-cluster frames (same map + Full-empty coverage caveat as
 * `edgeAngles`; unresolvable endpoints count in `endpointsUnresolved`).
 */
export function computeBadPatterns(
  edgeGeoms: readonly EdgeGeom[],
  frameByAddress: ReadonlyMap<string, ExcalidrawElement>,
): { summary: BadPatternsSummary; offenders: BadPatternOffenders } {
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const refOf = (g: EdgeGeom): EdgeRef => ({
    id: g.id,
    source: g.source,
    target: g.target,
  });

  // ── Materialize crossing events once (§0-B).
  const pairRecords: Array<{
    a: EdgeGeom;
    b: EdgeGeom;
    events: CrossingEvent[];
  }> = [];
  const allEvents: ScenedEvent[] = [];
  for (let i = 0; i < edgeGeoms.length; i++) {
    for (let j = i + 1; j < edgeGeoms.length; j++) {
      const events = crossingEventsOf(edgeGeoms[i]!, edgeGeoms[j]!);
      if (events.length === 0) {
        continue;
      }
      const pairIdx = pairRecords.length;
      pairRecords.push({ a: edgeGeoms[i]!, b: edgeGeoms[j]!, events });
      for (const e of events) {
        allEvents.push({
          ...e,
          pairIdx,
          edgeA: edgeGeoms[i]!.id,
          edgeB: edgeGeoms[j]!.id,
        });
      }
    }
  }
  const totalEvents = allEvents.length;

  // ── M1 samePairMultiCross (§1).
  let m1Pairs = 0;
  let m1Excess = 0;
  let m1Max = 0;
  for (const pr of pairRecords) {
    const c = pr.events.length;
    if (c >= 2) {
      m1Pairs += 1;
    }
    m1Excess += Math.max(0, c - 1);
    m1Max = Math.max(m1Max, c);
  }

  // ── Spatial grid over events for M2 / M4b (cell = D_NEIGH_PX / R_ANCHOR_PX).
  const buildGrid = (cell: number, xs: number[], ys: number[]) => {
    const grid = new Map<string, number[]>();
    for (let idx = 0; idx < xs.length; idx++) {
      const key = `${Math.floor(xs[idx]! / cell)},${Math.floor(
        ys[idx]! / cell,
      )}`;
      let arr = grid.get(key);
      if (!arr) {
        arr = [];
        grid.set(key, arr);
      }
      arr.push(idx);
    }
    return grid;
  };
  const eventXs = allEvents.map((e) => e.x);
  const eventYs = allEvents.map((e) => e.y);
  const eventGrid = buildGrid(D_NEIGH_PX, eventXs, eventYs);
  const eventNeighbors = (idx: number): number[] => {
    const e = allEvents[idx]!;
    const cx = Math.floor(e.x / D_NEIGH_PX);
    const cy = Math.floor(e.y / D_NEIGH_PX);
    const res: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = eventGrid.get(`${cx + dx},${cy + dy}`);
        if (!arr) {
          continue;
        }
        for (const j of arr) {
          if (j === idx) {
            continue;
          }
          const f = allEvents[j]!;
          if (Math.hypot(f.x - e.x, f.y - e.y) <= D_NEIGH_PX) {
            res.push(j);
          }
        }
      }
    }
    return res;
  };
  const inPair = (edge: string, e: ScenedEvent) =>
    edge === e.edgeA || edge === e.edgeB;

  // ── M2 parallelCross (2a) + bundleGridCross (2b) (§2).
  let parallelEvents = 0;
  let gridEvents = 0;
  type ParAgg = {
    parallel: number;
    grid: number;
    samples: Array<[number, number]>;
    partners: Set<string>;
  };
  const parAgg = new Map<string, ParAgg>();
  const parOf = (id: string): ParAgg => {
    let a = parAgg.get(id);
    if (!a) {
      a = { parallel: 0, grid: 0, samples: [], partners: new Set() };
      parAgg.set(id, a);
    }
    return a;
  };
  for (let idx = 0; idx < allEvents.length; idx++) {
    const e = allEvents[idx]!;
    const neighbors = eventNeighbors(idx);
    // (2a)
    if (e.degAcute < PARALLEL_CROSS_MAX_DEG) {
      let qualified = false;
      const partners: string[] = [];
      for (const j of neighbors) {
        const f = allEvents[j]!;
        const thirdEdge = !inPair(f.edgeA, e) || !inPair(f.edgeB, e);
        if (!thirdEdge) {
          continue;
        }
        const minPair = Math.min(
          foldedAngleDiff(e.dirADeg, f.dirADeg),
          foldedAngleDiff(e.dirADeg, f.dirBDeg),
          foldedAngleDiff(e.dirBDeg, f.dirADeg),
          foldedAngleDiff(e.dirBDeg, f.dirBDeg),
        );
        if (minPair <= PARALLEL_ALIGN_MAX_DEG) {
          qualified = true;
          if (!inPair(f.edgeA, e)) {
            partners.push(f.edgeA);
          }
          if (!inPair(f.edgeB, e)) {
            partners.push(f.edgeB);
          }
        }
      }
      if (qualified) {
        parallelEvents += 1;
        for (const id of [e.edgeA, e.edgeB]) {
          const agg = parOf(id);
          agg.parallel += 1;
          if (agg.samples.length < 3) {
            agg.samples.push([Math.round(e.x), Math.round(e.y)]);
          }
          for (const p of partners) {
            agg.partners.add(p);
          }
        }
      }
    }
    // (2b) — ≥2 neighbors sharing exactly one edge with e, non-shared partners
    // near-parallel. Captures bundle-vs-bundle grids at any crossing angle.
    let gridCount = 0;
    for (const j of neighbors) {
      const f = allEvents[j]!;
      const aShared = inPair(f.edgeA, e);
      const bShared = inPair(f.edgeB, e);
      if (aShared === bShared) {
        continue; // shares 0 or 2 edges — not a one-edge bundle neighbor
      }
      const shared = aShared ? f.edgeA : f.edgeB;
      const ePartnerDir = shared === e.edgeA ? e.dirBDeg : e.dirADeg;
      const fPartnerDir = shared === f.edgeA ? f.dirBDeg : f.dirADeg;
      if (foldedAngleDiff(ePartnerDir, fPartnerDir) <= PARALLEL_ALIGN_MAX_DEG) {
        gridCount += 1;
      }
    }
    if (gridCount >= 2) {
      gridEvents += 1;
      parOf(e.edgeA).grid += 1;
      parOf(e.edgeB).grid += 1;
    }
  }

  // ── M3 backwardTurn (§3).
  let btEdges = 0;
  let btCountTotal = 0;
  let btPxTotal = 0;
  let btPxMax = 0;
  const btOffenders: BadPatternOffenders["backwardTurn"] = [];
  for (const g of edgeGeoms) {
    const runs = compressBackwardRuns(g.points);
    let backwardTurns = 0;
    let backtrackPx = 0;
    let worst: SignedRun | null = null;
    for (const r of runs) {
      if (r.dx < 0) {
        backwardTurns += 1;
        backtrackPx += Math.abs(r.dx);
        if (worst === null || Math.abs(r.dx) > Math.abs(worst.dx)) {
          worst = r;
        }
      }
    }
    if (backwardTurns > 0) {
      btEdges += 1;
      btCountTotal += backwardTurns;
      btPxTotal += backtrackPx;
      btPxMax = Math.max(btPxMax, backtrackPx);
      const srcF = frameByAddress.get(g.source);
      const tgtF = frameByAddress.get(g.target);
      const semanticViolation =
        srcF != null &&
        tgtF != null &&
        tgtF.x + tgtF.width / 2 < srcF.x + srcF.width / 2 - 1;
      btOffenders.push({
        id: g.id,
        source: g.source,
        target: g.target,
        backwardTurns,
        backtrackPx: round2(backtrackPx),
        worstRun: worst
          ? {
              fromX: Math.round(g.points[worst.startIdx]![0]),
              toX: Math.round(g.points[worst.endIdx]![0]),
              y: Math.round(g.points[worst.startIdx]![1]),
            }
          : null,
        semanticViolation,
      });
    }
  }

  // ── M4 endpointOcclusion (§4).
  // (4a) own-card re-entry.
  let ownCardReentryCount = 0;
  let ownCardReentryEdges = 0;
  let endpointsResolved = 0;
  let endpointsUnresolved = 0;
  const occ = new Map<
    string,
    {
      reentry: "src" | "tgt" | "both" | null;
      reentryRect: {
        frameId: string;
        x: number;
        y: number;
        w: number;
        h: number;
      } | null;
      own: number;
      foreign: number;
      anchorPoints: Array<[number, number]>;
    }
  >();
  const occOf = (g: EdgeGeom) => {
    let o = occ.get(g.id);
    if (!o) {
      o = {
        reentry: null,
        reentryRect: null,
        own: 0,
        foreign: 0,
        anchorPoints: [
          [Math.round(g.points[0]![0]), Math.round(g.points[0]![1])],
          [
            Math.round(g.points[g.points.length - 1]![0]),
            Math.round(g.points[g.points.length - 1]![1]),
          ],
        ],
      };
      occ.set(g.id, o);
    }
    return o;
  };
  for (const g of edgeGeoms) {
    const o = occOf(g);
    let edgeReentry = 0;
    const srcF = frameByAddress.get(g.source);
    if (srcF) {
      endpointsResolved += 1;
      if (polylineReentersRect(g.points, rectOf(srcF), STUB_SKIP_PX)) {
        edgeReentry += 1;
        o.reentry = "src";
        o.reentryRect = {
          frameId: srcF.id,
          x: Math.round(srcF.x),
          y: Math.round(srcF.y),
          w: Math.round(srcF.width),
          h: Math.round(srcF.height),
        };
      }
    } else {
      endpointsUnresolved += 1;
    }
    const tgtF = frameByAddress.get(g.target);
    if (tgtF) {
      endpointsResolved += 1;
      const reversed = [...g.points].reverse();
      if (polylineReentersRect(reversed, rectOf(tgtF), STUB_SKIP_PX)) {
        edgeReentry += 1;
        o.reentry = o.reentry === "src" ? "both" : "tgt";
        if (!o.reentryRect) {
          o.reentryRect = {
            frameId: tgtF.id,
            x: Math.round(tgtF.x),
            y: Math.round(tgtF.y),
            w: Math.round(tgtF.width),
            h: Math.round(tgtF.height),
          };
        }
      }
    } else {
      endpointsUnresolved += 1;
    }
    ownCardReentryCount += edgeReentry;
    if (edgeReentry > 0) {
      ownCardReentryEdges += 1;
    }
  }

  // (4b) anchor-region crossings. Anchors = first+last point of every edge.
  const anchorXs: number[] = [];
  const anchorYs: number[] = [];
  const anchorEdge: string[] = [];
  for (const g of edgeGeoms) {
    anchorXs.push(g.points[0]![0], g.points[g.points.length - 1]![0]);
    anchorYs.push(g.points[0]![1], g.points[g.points.length - 1]![1]);
    anchorEdge.push(g.id, g.id);
  }
  const anchorGrid = buildGrid(R_ANCHOR_PX, anchorXs, anchorYs);
  const anchorsNear = (x: number, y: number): number[] => {
    const cx = Math.floor(x / R_ANCHOR_PX);
    const cy = Math.floor(y / R_ANCHOR_PX);
    const res: number[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const arr = anchorGrid.get(`${cx + dx},${cy + dy}`);
        if (!arr) {
          continue;
        }
        for (const ai of arr) {
          if (Math.hypot(anchorXs[ai]! - x, anchorYs[ai]! - y) <= R_ANCHOR_PX) {
            res.push(ai);
          }
        }
      }
    }
    return res;
  };
  let endpointCrossOwn = 0;
  let endpointCrossForeign = 0;
  for (const e of allEvents) {
    const near = anchorsNear(e.x, e.y);
    let own = false;
    let foreign = false;
    const bumpedOwn = new Set<string>();
    const bumpedForeign = new Set<string>();
    for (const ai of near) {
      const owner = anchorEdge[ai]!;
      if (owner === e.edgeA || owner === e.edgeB) {
        own = true;
        if (!bumpedOwn.has(owner)) {
          bumpedOwn.add(owner);
          const g = edgeGeoms.find((x) => x.id === owner);
          if (g) {
            occOf(g).own += 1;
          }
        }
      } else {
        foreign = true;
        if (!bumpedForeign.has(owner)) {
          bumpedForeign.add(owner);
          const g = edgeGeoms.find((x) => x.id === owner);
          if (g) {
            occOf(g).foreign += 1;
          }
        }
      }
    }
    if (own) {
      endpointCrossOwn += 1;
    }
    if (foreign) {
      endpointCrossForeign += 1;
    }
  }

  // ── edgeLengthPxTotal (F3 guard axis).
  let edgeLengthPxTotal = 0;
  for (const g of edgeGeoms) {
    for (const s of g.segments) {
      edgeLengthPxTotal += segLen(s);
    }
  }

  const summary: BadPatternsSummary = {
    samePairMultiCross: {
      pairs: m1Pairs,
      excess: m1Excess,
      maxPerPair: m1Max,
      totalCrossEvents: totalEvents,
    },
    parallelCross: {
      events: parallelEvents,
      share: totalEvents > 0 ? round2(parallelEvents / totalEvents) : 0,
      gridEvents,
      gridShare: totalEvents > 0 ? round2(gridEvents / totalEvents) : 0,
      totalEvents,
    },
    backwardTurn: {
      edges: btEdges,
      countTotal: btCountTotal,
      backtrackPxTotal: round2(btPxTotal),
      backtrackPxMax: round2(btPxMax),
      edgeCount: edgeGeoms.length,
    },
    endpointOcclusion: {
      ownCardReentryCount,
      ownCardReentryEdges,
      endpointCrossOwn,
      endpointCrossForeign,
      anchorCount: anchorEdge.length,
      endpointsResolved,
      endpointsUnresolved,
    },
    edgeLengthPxTotal: round2(edgeLengthPxTotal),
  };

  // ── Offenders (§6). Top-10 per metric.
  const samePairOffenders: BadPatternOffenders["samePairMultiCross"] =
    pairRecords
      .map((pr) => {
        let minDeg = pr.events[0]!.degAcute;
        for (const e of pr.events) {
          minDeg = Math.min(minDeg, e.degAcute);
        }
        return {
          edgeA: refOf(pr.a),
          edgeB: refOf(pr.b),
          crossCount: pr.events.length,
          points: pr.events.map(
            (e) => [Math.round(e.x), Math.round(e.y)] as [number, number],
          ),
          minDeg: round2(minDeg),
        };
      })
      .sort((a, b) => b.crossCount - a.crossCount || a.minDeg - b.minDeg)
      .slice(0, 10);

  const parallelOffenders: BadPatternOffenders["parallelCross"] = [
    ...parAgg.entries(),
  ]
    .map(([id, agg]) => {
      const g = edgeGeoms.find((x) => x.id === id)!;
      return {
        id,
        source: g.source,
        target: g.target,
        parallelEvents: agg.parallel,
        gridEvents: agg.grid,
        samplePoints: agg.samples.slice(0, 3),
        partnerEdgeIds: [...agg.partners].slice(0, 5),
      };
    })
    .filter((r) => r.parallelEvents > 0 || r.gridEvents > 0)
    .sort(
      (a, b) =>
        b.parallelEvents - a.parallelEvents || b.gridEvents - a.gridEvents,
    )
    .slice(0, 10);

  const backwardOffenders = [...btOffenders]
    .sort((a, b) => b.backtrackPx - a.backtrackPx)
    .slice(0, 10);

  const endpointOffenders: BadPatternOffenders["endpointOcclusion"] = [
    ...occ.entries(),
  ]
    .map(([id, o]) => {
      const g = edgeGeoms.find((x) => x.id === id)!;
      return {
        id,
        source: g.source,
        target: g.target,
        reentry: o.reentry,
        reentryRect: o.reentryRect,
        anchorCrossOwn: o.own,
        anchorCrossForeign: o.foreign,
        anchorPoints: o.anchorPoints,
      };
    })
    .filter(
      (r) =>
        r.reentry !== null || r.anchorCrossOwn > 0 || r.anchorCrossForeign > 0,
    )
    .sort((a, b) => {
      const ra = a.reentry === "both" ? 2 : a.reentry ? 1 : 0;
      const rb = b.reentry === "both" ? 2 : b.reentry ? 1 : 0;
      return rb - ra || b.anchorCrossOwn - a.anchorCrossOwn;
    })
    .slice(0, 10);

  return {
    summary,
    offenders: {
      samePairMultiCross: samePairOffenders,
      parallelCross: parallelOffenders,
      backwardTurn: backwardOffenders,
      endpointOcclusion: endpointOffenders,
    },
  };
}

/** Build the identity-carrying edge geometry + address→frame map for a scene
 * (the inputs `computeBadPatterns` needs), matching `diagnosePipelineScene`'s
 * own construction. */
export function buildBadPatternInputs(elements: readonly ExcalidrawElement[]): {
  edgeGeoms: EdgeGeom[];
  frameByAddress: Map<string, ExcalidrawElement>;
} {
  const tfdArrows = elements.filter((el) => {
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
  const edgeGeoms = tfdArrows
    .map(edgeGeomOf)
    .filter((g): g is EdgeGeom => g != null);
  const frameByAddress = new Map<string, ExcalidrawElement>();
  for (const el of elements) {
    if (
      el.type === "frame" &&
      !el.isDeleted &&
      (el.customData as { terraformTopologyRole?: string } | undefined)
        ?.terraformTopologyRole === "primaryCluster"
    ) {
      const addr = (el.customData as { terraformPrimaryAddress?: string })
        ?.terraformPrimaryAddress;
      if (typeof addr === "string") {
        frameByAddress.set(addr, el);
      }
    }
  }
  return { edgeGeoms, frameByAddress };
}

/** Per-metric top-10 badPattern offenders for a scene (§6) — the probe prints
 * these; a fresh pass over the scene reusing the same kernels. */
export function diagnoseBadPatternOffenders(
  elements: readonly ExcalidrawElement[],
): BadPatternOffenders {
  const { edgeGeoms, frameByAddress } = buildBadPatternInputs(elements);
  return computeBadPatterns(edgeGeoms, frameByAddress).offenders;
}
