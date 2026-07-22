/**
 * Strata edge-STYLE pass (probe P2): endpoint-local render styles for TFD
 * arrows, transplanted from React Flow's `getSmoothStepPath` / `getBezierPath`
 * math (MIT). A pure post-geometry rewrite — the sibling of
 * terraformPipelineStrataEdgeRouting.ts / terraformPipelineStrataBorderRoute.ts,
 * but with ZERO obstacle knowledge: it only reshapes each straight chord's path
 * (perpendicular escape stubs + a single Z-bend, or an axis-aligned cubic
 * bezier), leaving crossings/pierce topology essentially unchanged. Directly
 * attacks the owner's "calm React Flow look" priority.
 *
 * ORIENTATION-AWARE. Strata is LR, but a backward or predominantly-vertical
 * edge would look wrong forced horizontal, so each edge picks its major axis
 * from |Δx| vs |Δy|: horizontal-major departs L/R, vertical-major departs T/B.
 *
 * COMPOSES UNDER THE ROUTERS. Runs AFTER edgeRouting + borderRoute in the
 * scene-build seam and SKIPS any arrow already stamped `terraformRoutedPolyline`
 * (first-stamper-wins): routed edges keep their obstacle-aware detour; only the
 * chords the routers left straight get styled. So `style="straight"` (default)
 * never runs — byte-identical off — and a routed scene keeps its routing.
 *
 * ENDPOINTS NEVER MOVE. Only interior path shape changes; el.x/el.y and the
 * final absolute point are preserved, so bindings survive the repair pass (the
 * `terraformRoutedPolyline` stamp keeps `repairTerraformEdgeBindings` from
 * flattening the polyline back to a chord).
 *
 * Determinism (C4′): no RNG, no clock; pure function of endpoints + style.
 * Clearance is read inside the function, never as a module-level const derived
 * from a layout import (SDEC-34 NaN hazard).
 */
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";

import type {
  StrataModel,
  StrataPlacementResult,
} from "./terraformPipelineStrataTypes";

export type StrataEdgeStyle = "straight" | "step" | "curve";

/** Perpendicular escape-stub length (px), clamped to the hull padding so the
 * stub never protrudes past a container's inner margin. React Flow's default. */
export const STRATA_EDGE_STYLE_STUB_PX = 20;
/** Smoothstep corner radius (px) — small; applied via Excalidraw roundness. */
export const STRATA_EDGE_STYLE_BORDER_RADIUS = 5;
/** React Flow bezier default curvature. */
export const STRATA_EDGE_STYLE_CURVATURE = 0.25;
/** Cubic-bezier sample count → SAMPLES+1 polyline points (14 points). */
export const STRATA_EDGE_STYLE_CURVE_SAMPLES = 13;

export type StrataEdgeStyleMeta = {
  style: Exclude<StrataEdgeStyle, "straight">;
  /** TFD arrows reshaped to the styled polyline. */
  styled: number;
  /** Eligible arrows left untouched (already routed / degenerate / < 2 pts). */
  skipped: number;
  /** Total polyline points across all styled arrows (router cost budget). */
  pointsTotal: number;
};

type Pt = readonly [number, number];

type ArrowSkeleton = ExcalidrawElementSkeleton & {
  type: "arrow";
  points?: ReadonlyArray<readonly [number, number]>;
  customData?: Record<string, unknown>;
};

const relationshipOf = (
  el: ArrowSkeleton,
): { source: string; target: string } | null => {
  const cd = el.customData;
  if (cd?.terraformEdgeLayer !== "declaredDataFlow") {
    return null;
  }
  const rel = cd?.relationship as Record<string, unknown> | undefined;
  if (
    !rel ||
    typeof rel.source !== "string" ||
    typeof rel.target !== "string" ||
    rel.aggregated === true
  ) {
    return null;
  }
  return { source: rel.source, target: rel.target };
};

/**
 * React Flow `calculateControlOffset` (getBezierPath.ts). Forward-facing
 * control points push half the axis distance; backward-facing ones (source and
 * target on the wrong side of each other) push `curvature·25·√|distance|` so
 * the curve loops out cleanly instead of collapsing.
 */
export function calculateControlOffset(
  distance: number,
  curvature: number,
): number {
  if (distance >= 0) {
    return 0.5 * distance;
  }
  return curvature * 25 * Math.sqrt(-distance);
}

/** Remove consecutive duplicate and collinear points so a styled polyline
 * carries only its genuine bends (keeps the bend metric honest and the point
 * count minimal). Endpoints are always kept. */
function simplifyPolyline(pts: Pt[]): Pt[] {
  const EPS = 1e-6;
  const dedup: Pt[] = [];
  for (const p of pts) {
    const last = dedup[dedup.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > EPS || Math.abs(last[1] - p[1]) > EPS) {
      dedup.push(p);
    }
  }
  if (dedup.length <= 2) {
    return dedup;
  }
  const out: Pt[] = [dedup[0]!];
  for (let i = 1; i + 1 < dedup.length; i++) {
    const a = out[out.length - 1]!;
    const b = dedup[i]!;
    const c = dedup[i + 1]!;
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > EPS) {
      out.push(b);
    }
  }
  out.push(dedup[dedup.length - 1]!);
  return out;
}

/**
 * Smoothstep polyline: perpendicular escape stubs + a single Z-bend at
 * stepPosition 0.5 (React Flow `getSmoothStepPath`, orthogonal reduction).
 * Corner rounding is delegated to Excalidraw roundness (type 2) by the caller;
 * the returned points are the sharp orthogonal skeleton.
 */
export function smoothStepPolyline(
  start: Pt,
  end: Pt,
  stubPx: number = Math.min(STRATA_EDGE_STYLE_STUB_PX, PIPELINE_FRAME_PAD),
): Pt[] {
  const [sx, sy] = start;
  const [ex, ey] = end;
  const dx = ex - sx;
  const dy = ey - sy;
  let raw: Pt[];
  if (Math.abs(dx) >= Math.abs(dy)) {
    const dir = dx >= 0 ? 1 : -1;
    const sStub: Pt = [sx + dir * stubPx, sy];
    const tStub: Pt = [ex - dir * stubPx, ey];
    const cx = (sStub[0] + tStub[0]) / 2;
    raw = [start, sStub, [cx, sy], [cx, ey], tStub, end];
  } else {
    const dir = dy >= 0 ? 1 : -1;
    const sStub: Pt = [sx, sy + dir * stubPx];
    const tStub: Pt = [ex, ey - dir * stubPx];
    const cy = (sStub[1] + tStub[1]) / 2;
    raw = [start, sStub, [sx, cy], [ex, cy], tStub, end];
  }
  return simplifyPolyline(raw);
}

/**
 * Cubic-bezier polyline with axis-aligned control points (React Flow
 * `getBezierPath`), sampled to a `samples`+1 point polyline (Excalidraw arrows
 * are polylines). Horizontal-major edges use Right/Left ports; vertical-major
 * use Bottom/Top.
 */
export function bezierPolyline(
  start: Pt,
  end: Pt,
  curvature: number = STRATA_EDGE_STYLE_CURVATURE,
  samples: number = STRATA_EDGE_STYLE_CURVE_SAMPLES,
): Pt[] {
  const [sx, sy] = start;
  const [ex, ey] = end;
  const dx = ex - sx;
  const dy = ey - sy;
  let c1: Pt;
  let c2: Pt;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const off = calculateControlOffset(dx, curvature);
    c1 = [sx + off, sy];
    c2 = [ex - off, ey];
  } else {
    const off = calculateControlOffset(dy, curvature);
    c1 = [sx, sy + off];
    c2 = [ex, ey - off];
  }
  const out: Pt[] = [];
  const n = Math.max(2, samples);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const mt = 1 - t;
    const a = mt * mt * mt;
    const b = 3 * mt * mt * t;
    const c = 3 * mt * t * t;
    const d = t * t * t;
    out.push([
      a * sx + b * c1[0] + c * c2[0] + d * ex,
      a * sy + b * c1[1] + c * c2[1] + d * ey,
    ]);
  }
  return out;
}

/**
 * Scene-level pass: reshape, IN PLACE in the skeleton array, every un-routed
 * TFD arrow to the requested render style. Endpoints are preserved; only
 * interior path shape changes. Arrows already stamped `terraformRoutedPolyline`
 * (by edgeRouting / borderRoute) are skipped. `model`/`placement` are accepted
 * for signature parity with the sibling routers (endpoint-local styling needs
 * no obstacle data) and to leave room for future hull-padding-aware clamping.
 */
export function applyStrataEdgeStyle(
  skeleton: ExcalidrawElementSkeleton[],
  _model: StrataModel,
  _placement: StrataPlacementResult,
  style: Exclude<StrataEdgeStyle, "straight">,
): StrataEdgeStyleMeta {
  const meta: StrataEdgeStyleMeta = {
    style,
    styled: 0,
    skipped: 0,
    pointsTotal: 0,
  };
  const stub = Math.min(STRATA_EDGE_STYLE_STUB_PX, PIPELINE_FRAME_PAD);

  for (let i = 0; i < skeleton.length; i++) {
    const el = skeleton[i] as ArrowSkeleton;
    if (el.type !== "arrow") {
      continue;
    }
    if (!relationshipOf(el)) {
      continue;
    }
    // First-stamper-wins: a routed arrow keeps its obstacle-aware geometry.
    if (el.customData?.terraformRoutedPolyline === true) {
      meta.skipped += 1;
      continue;
    }
    const pts = el.points;
    if (!Array.isArray(pts) || pts.length < 2) {
      meta.skipped += 1;
      continue;
    }
    const sx = el.x;
    const sy = el.y;
    const lastPt = pts[pts.length - 1]!;
    const start: Pt = [sx, sy];
    const end: Pt = [sx + lastPt[0], sy + lastPt[1]];
    if (start[0] === end[0] && start[1] === end[1]) {
      meta.skipped += 1; // self-loop / zero-length — nothing to style
      continue;
    }

    const poly =
      style === "step"
        ? smoothStepPolyline(start, end, stub)
        : bezierPolyline(start, end);

    if (poly.length < 2) {
      meta.skipped += 1;
      continue;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of poly) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    skeleton[i] = {
      ...el,
      points: poly.map(([px, py]) => pointFrom<LocalPoint>(px - sx, py - sy)),
      width: maxX - minX,
      height: maxY - minY,
      // Step: round the orthogonal corners in the renderer (React Flow
      // smoothstep look) while the polyline stays clean 2-bend geometry for the
      // bend metric. Curve is already smooth — leave its roundness untouched.
      ...(style === "step" ? { roundness: { type: 2 } } : {}),
      customData: {
        ...(el.customData ?? {}),
        terraformRoutedPolyline: true,
      },
    } as ExcalidrawElementSkeleton;
    meta.styled += 1;
    meta.pointsTotal += poly.length;
  }

  return meta;
}
