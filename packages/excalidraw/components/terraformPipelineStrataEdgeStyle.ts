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
 * The bezier control points travel TOWARD the target along the chord sign (like
 * the step branch's `dir`), NOT React Flow's fixed Right-port push — a Δx<0 or
 * Δy<0 edge no longer loops its control arm out through the source card. Forward
 * edges keep the classic 0.5·distance offset (byte-identical), and are additionally
 * x-monotone-clamped (Fritsch–Carlson analog: control coords stay in [x0,x3], so
 * x'(t)≥0 — no against-flow excursion, and two forward curves cross like straight
 * chords). Genuine back-edges (target strictly left of source) are NOT clamped —
 * a monotone chord through the spanned ranks would slice every intervening card;
 * they route as the ORBIT class in `applyStrataEdgeStyle` (arc over/under the
 * occupied Y band with vertical entry/exit — the dot/ELK reverse-then-route
 * idiom), guard-gated per edge against foreign-card pierce (revert to chord on
 * failure). The orbit needs obstacle geometry, so it runs only when real
 * `placement` leaf boxes are supplied.
 *
 * SAME-Y FORWARD EDGES SAMPLE STRAIGHT — BY DESIGN. When source and target share
 * a Y (Δy≈0, the common LR same-rank-row case), the x-monotone-clamped forward
 * bezier's control points are collinear with its endpoints, so the curve samples
 * to a visually straight segment. It is styled (stamped `terraformRoutedPolyline`,
 * survives repair) but renders straight — this is React Flow parity (`getBezierPath`
 * degenerates identically on a flat chord), NOT a missed/flattened curve. Do not
 * "fix" it by bowing same-Y edges: an off-axis control arm would reintroduce the
 * against-flow excursion the monotone clamp exists to prevent.
 *
 * COMPOSES UNDER THE ROUTERS. Runs AFTER edgeRouting + borderRoute in the
 * scene-build seam and SKIPS any arrow already stamped `terraformRoutedPolyline`
 * (first-stamper-wins): routed edges keep their obstacle-aware detour; only the
 * chords the routers left straight get styled. So `style="straight"` (default)
 * never runs — byte-identical off — and a routed scene keeps its routing.
 *
 * ENDPOINTS = REPAIR'S CHORD ANCHORS. When the caller supplies the keyed body
 * rects (the same `terraformVisibilityRole:"resource"` cards
 * `repairTerraformEdgeBindings` re-keys), each styled polyline's start/end are
 * derived from `computeTerraformChordAnchors(bodyRectA, bodyRectB)` — the EXACT
 * centre-clipped anchors repair re-derives at element time. Repair therefore
 * finds the polyline endpoints already sitting on its recomputed anchors, so its
 * validate-before-trust gate (`ROUTED_ANCHOR_TOLERANCE`) passes by construction
 * and never flattens the styled curve. (Historically the endpoints were the
 * skeleton chord's, which sit on the leaf FRAME border — > 48px outside the
 * inset card body for tall composite cards — so repair flattened 97/145 curves.)
 * Only interior path shape plus these body-clipped endpoints change; el.x/el.y
 * stay put and the polyline is stored el-relative, exactly like the routers.
 * When a keyed rect is missing (the edges repair itself leaves unchanged), the
 * pass falls back to the skeleton chord endpoints.
 *
 * RENDER FIDELITY (E1.1). Curve-styled (non-orbit) records get `roundness:
 * null` in the Phase-3 write-back — NOT the `{type:2}` inherited from
 * skeleton creation. TFD arrows default to `roundness:{type:2}` (see
 * terraformElkLayout.ts), and RoughJS's `shape.ts` reaches for
 * `generator.curve()` whenever roundness is set — which re-splines the
 * `STRATA_EDGE_STYLE_CURVE_SAMPLES`-point polyline through ALL of its points,
 * bowing the rendered stroke OUTSIDE the computed path (including into
 * adjacent cards). The Stage-C passes above (own-card re-entry clamp, lens
 * removal) validate and guard-gate the COMPUTED polyline, so the render must
 * match it exactly: `roundness:null` makes RoughJS draw straight segments
 * between the sampled points instead, and the raised sample count keeps that
 * literal polyline visually smooth. The orbit class is exempt — it shares
 * `smoothStepPolyline`'s coarse rectilinear shape (a handful of points with
 * genuine right-angle corners, see `orbitPolyline`), so like `step` it keeps
 * `{type:2}` to round those corners; only the true bezier sample is dense
 * enough to fall prey to the re-splining bow.
 *
 * Determinism (C4′): no RNG, no clock; pure function of endpoints + style.
 * Clearance is read inside the function, never as a module-level const derived
 * from a layout import (SDEC-34 NaN hazard).
 */
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";
import { segmentIntersectsStrataBoxInterior } from "./terraformPipelineStrataPackedScoring";
import { computeTerraformChordAnchors } from "./terraformEdgeAnchors";

import type { EdgeAnchorRect } from "./terraformEdgeAnchors";

import type {
  StrataBox,
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
/** Cubic-bezier sample count → SAMPLES+1 polyline points (25 points). Render
 * fidelity (E1.1): the polyline IS the rendered path (roundness forced off on
 * curve-styled records, see Phase 3 in `applyStrataEdgeStyle`), so this must
 * be dense enough that the literal straight-segment polyline reads as smooth. */
export const STRATA_EDGE_STYLE_CURVE_SAMPLES = 24;

export type StrataEdgeStyleMeta = {
  style: Exclude<StrataEdgeStyle, "straight">;
  /** TFD arrows reshaped to the styled polyline. */
  styled: number;
  /** Eligible arrows left untouched (already routed / degenerate / < 2 pts). */
  skipped: number;
  /** Total polyline points across all styled arrows (router cost budget). */
  pointsTotal: number;
  /** Back-edges (target left of source) routed as an orbit arc (subset of
   * `styled`). Only counted when real placement geometry is supplied. */
  orbited: number;
  /** Back-edges whose orbit pierced MORE foreign cards than the chord, so the
   * chord was kept (guard revert). */
  orbitReverted: number;
  /** W3-2: curve edges whose own-card re-entry the control-arm clamp cleared
   * (guard-accepted). NO-OP on clean edges and on placement-artifact re-entries. */
  reentryClamped: number;
  /** W3-4: lens (empty-bigon) swaps applied — each removes exactly 2 crossings. */
  lensSwaps: number;
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
 * `getBezierPath` shape), sampled to a `samples`+1 point polyline (Excalidraw
 * arrows are polylines).
 *
 * DIRECTION-AWARE control offsets: the control arms push TOWARD the target along
 * the chord sign (`dir`), not React Flow's hardcoded Right/Bottom-port push. The
 * magnitude is the classic forward offset 0.5·|distance| (`curvature` retained
 * for signature compatibility / `calculateControlOffset` parity but no longer
 * used to loop backward arms out). For a FORWARD major axis the interior control
 * coords are additionally clamped into the endpoint interval [start,end] so the
 * curve is monotone in the flow direction (x'(t)≥0 for horizontal-major,
 * y'(t)≥0 for vertical-major) — this both kills the "+16.8px into the source
 * card" excursion the old Right-port offset produced on Δ<0 edges and makes two
 * forward curves cross like straight function graphs (≤1 crossing per pair).
 * A backward major axis (target on the wrong side) is left monotone-but-straight
 * here; `applyStrataEdgeStyle` upgrades those to the orbit class.
 */
/**
 * The two axis-aligned cubic control points for the styled bezier of a chord
 * (extracted from `bezierPolyline` so the W3-2 own-card re-entry clamp can
 * shorten one control arm and re-sample the SAME curve family). `axis` names the
 * major axis; `forward` is true when the chord advances along +axis (the
 * monotone-clamped, byte-identical case).
 */
export function bezierControlPoints(
  start: Pt,
  end: Pt,
): { c1: Pt; c2: Pt; axis: "h" | "v"; forward: boolean } {
  const [sx, sy] = start;
  const [ex, ey] = end;
  const dx = ex - sx;
  const dy = ey - sy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    // Horizontal-major: control arms travel toward the target (chord sign).
    const dir = dx >= 0 ? 1 : -1;
    const mag = 0.5 * Math.abs(dx);
    let c1x = sx + dir * mag;
    let c2x = ex - dir * mag;
    const forward = ex >= sx;
    if (forward) {
      // Forward: clamp interior control x into [sx,ex] ⇒ x'(t)≥0 (monotone).
      c1x = Math.max(sx, Math.min(c1x, ex));
      c2x = Math.max(c1x, Math.min(c2x, ex));
    }
    return { c1: [c1x, sy], c2: [c2x, ey], axis: "h", forward };
  }
  // Vertical-major: control arms travel toward the target (chord sign).
  const dir = dy >= 0 ? 1 : -1;
  const mag = 0.5 * Math.abs(dy);
  let c1y = sy + dir * mag;
  let c2y = ey - dir * mag;
  const forward = ey >= sy;
  if (forward) {
    // Forward (top→bottom): clamp interior control y into [sy,ey] ⇒ monotone.
    c1y = Math.max(sy, Math.min(c1y, ey));
    c2y = Math.max(c1y, Math.min(c2y, ey));
  }
  return { c1: [sx, c1y], c2: [ex, c2y], axis: "v", forward };
}

/** Sample a cubic bezier P0,c1,c2,P3 to a `samples`+1 point polyline. */
function sampleCubic(
  start: Pt,
  c1: Pt,
  c2: Pt,
  end: Pt,
  samples: number,
): Pt[] {
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
      a * start[0] + b * c1[0] + c * c2[0] + d * end[0],
      a * start[1] + b * c1[1] + c * c2[1] + d * end[1],
    ]);
  }
  return out;
}

export function bezierPolyline(
  start: Pt,
  end: Pt,
  _curvature: number = STRATA_EDGE_STYLE_CURVATURE,
  samples: number = STRATA_EDGE_STYLE_CURVE_SAMPLES,
): Pt[] {
  const { c1, c2 } = bezierControlPoints(start, end);
  return sampleCubic(start, c1, c2, end, samples);
}

/** Number of `foreign` boxes whose interior the polyline pierces. */
function piercedCardCount(poly: readonly Pt[], foreign: readonly StrataBox[]): number {
  let n = 0;
  for (const b of foreign) {
    let hit = false;
    for (let s = 0; s + 1 < poly.length && !hit; s++) {
      if (
        segmentIntersectsStrataBoxInterior(
          poly[s]![0],
          poly[s]![1],
          poly[s + 1]![0],
          poly[s + 1]![1],
          b.x,
          b.y,
          b.x + b.width,
          b.y + b.height,
        )
      ) {
        hit = true;
      }
    }
    if (hit) {
      n += 1;
    }
  }
  return n;
}

/**
 * Orbit polyline for a genuine back-edge: vertical exit from `start` to an
 * `orbitY` OUTSIDE the occupied band, one horizontal run across the spanned X
 * at `orbitY`, then vertical entry into `end`. The dot/ELK "reverse-then-route"
 * idiom rendered directly on fixed endpoints.
 */
function orbitPolyline(start: Pt, end: Pt, orbitY: number): Pt[] {
  return simplifyPolyline([
    start,
    [start[0], orbitY],
    [end[0], orbitY],
    end,
  ]);
}

// ────────────────────────────────────────────────────────────────────────────
// Wave-3 STAGE C refinement passes (spec SECTION 3). All operate on the sampled
// curve polylines AFTER styling, are a per-edge NO-OP on clean edges, preserve
// endpoints, and are individually guard-gated (never-worse on scene crossings +
// foreign-card pierce, plus the stage-specific gate). Constants re-declared here
// with their donor named, matching the file's SDEC-34 self-containment rule.
// ────────────────────────────────────────────────────────────────────────────

/** Own-card re-entry arc-length skip = the perpendicular exit stub (donor:
 * STRATA_EDGE_STYLE_STUB_PX). A segment inside the source/target rect within one
 * stub of the anchor is the legitimate exit; beyond it is a re-entry. */
const STAGE_C_STUB_SKIP_PX = STRATA_EDGE_STYLE_STUB_PX;
/** Lens-removal fixpoint cap (spec W3-4 "small cap"). */
const STAGE_C_LENS_MAX_PASSES = 3;

/** Does `poly` pierce `box`'s interior beyond `skipPx` arc length from its
 * start? Arc-length walk splitting the segment straddling the skip point, then
 * the strata interior test (donor: terraformPipelineStrataPierceMetrics normative
 * semantics, via the packed-scoring interior kernel). Mirror of the diagnostics
 * leaf's `polylineReentersRect`; call with reversed points for the target end. */
function polyReentersBox(
  poly: readonly Pt[],
  box: StrataBox,
  skipPx: number,
): boolean {
  const x0 = box.x;
  const y0 = box.y;
  const x1 = box.x + box.width;
  const y1 = box.y + box.height;
  let acc = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[i + 1]!;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + L <= skipPx) {
      acc += L;
      continue;
    }
    let start: Pt = a;
    if (acc < skipPx && L > 0) {
      const tt = (skipPx - acc) / L;
      start = [a[0] + tt * (b[0] - a[0]), a[1] + tt * (b[1] - a[1])];
    }
    if (segmentIntersectsStrataBoxInterior(start[0], start[1], b[0], b[1], x0, y0, x1, y1)) {
      return true;
    }
    acc += L;
  }
  return false;
}

/**
 * W3-2 own-card re-entry clamp. A forward monotone bezier can still graze its
 * OWN source/target card past the exit stub (control arm long enough that the
 * curve bulges back across the rect it just left). Shorten the offending control
 * arm — move the control point toward its endpoint (scale s∈[0,1], s=1 original,
 * s→0 straight chord) — binary-searching the largest s that clears the rect, then
 * re-sample. Returns the clamped polyline, or null when the edge is clean OR the
 * re-entry is irreducible by arm-shortening (the straight chord itself re-enters,
 * i.e. the anchor sits >1 stub inside its own card — a placement artifact this
 * pass leaves untouched rather than distorting the curve to chase).
 *
 * Only meaningful for FORWARD bezier edges (the monotone-clamped family); step /
 * orbit / back-edge polylines are handled by their own construction.
 */
export function clampOwnCardReentry(
  start: Pt,
  end: Pt,
  srcBox: StrataBox | null,
  tgtBox: StrataBox | null,
  samples: number = STRATA_EDGE_STYLE_CURVE_SAMPLES,
  iters: number = 5,
): Pt[] | null {
  const base = bezierControlPoints(start, end);
  let { c1, c2 } = base;
  let changed = false;

  // Shorten one control arm (toward its endpoint) until `poly` clears `box`,
  // testing the arc beyond one stub from `fromStart` end. Returns the new
  // control point, or null if even the straight chord (s=0) still re-enters.
  const clampArm = (
    anchor: Pt,
    control: Pt,
    box: StrataBox,
    fromStart: boolean,
  ): Pt | null => {
    const reenters = (ctrlA: Pt, ctrlB: Pt): boolean => {
      const poly = sampleCubic(start, ctrlA, ctrlB, end, samples);
      const walk = fromStart ? poly : [...poly].reverse();
      return polyReentersBox(walk, box, STAGE_C_STUB_SKIP_PX);
    };
    const armAt = (s: number): Pt => [
      anchor[0] + s * (control[0] - anchor[0]),
      anchor[1] + s * (control[1] - anchor[1]),
    ];
    // s=1 is the incumbent; if it doesn't re-enter, nothing to do.
    if (!reenters(fromStart ? control : c1, fromStart ? c2 : control)) {
      // caller-side no-op signalled by returning the incumbent unchanged
      return null;
    }
    // s=0 straight chord still re-enters ⇒ placement artifact, irreducible.
    const straight = armAt(0);
    if (
      fromStart ? reenters(straight, c2) : reenters(c1, straight)
    ) {
      return null;
    }
    let lo = 0; // known-clear
    let hi = 1; // known-reenter
    for (let k = 0; k < iters; k++) {
      const mid = (lo + hi) / 2;
      const cand = armAt(mid);
      const bad = fromStart ? reenters(cand, c2) : reenters(c1, cand);
      if (bad) {
        hi = mid;
      } else {
        lo = mid;
      }
    }
    return armAt(lo);
  };

  if (srcBox) {
    const nc1 = clampArm(start, c1, srcBox, true);
    if (nc1) {
      c1 = nc1;
      changed = true;
    }
  }
  if (tgtBox) {
    const nc2 = clampArm(end, c2, tgtBox, false);
    if (nc2) {
      c2 = nc2;
      changed = true;
    }
  }
  if (!changed) {
    return null;
  }
  return sampleCubic(start, c1, c2, end, samples);
}

/** Proper crossing of two segments (interior-interior; shared endpoints and
 * collinear touches excluded), used only by the Stage-C scene guards — a local
 * self-check, deliberately NOT the diagnostics kernel (no cross-leaf import). */
function segsProperlyCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const EPS = 1e-9;
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return (
    ((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) &&
    ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))
  );
}

/** Number of segment pairs where polyline `p` properly crosses polyline `q`. */
function polyCrossCount(p: readonly Pt[], q: readonly Pt[]): number {
  let n = 0;
  for (let i = 0; i + 1 < p.length; i++) {
    for (let j = 0; j + 1 < q.length; j++) {
      if (segsProperlyCross(p[i]!, p[i + 1]!, q[j]!, q[j + 1]!)) {
        n += 1;
      }
    }
  }
  return n;
}

type CrossXY = { segP: number; tP: number; segQ: number; pt: Pt };

/** All proper crossings between polylines p and q, with the intersection point
 * and each polyline's (segment index, parameter t along P). */
function polyCrossings(p: readonly Pt[], q: readonly Pt[]): CrossXY[] {
  const out: CrossXY[] = [];
  for (let i = 0; i + 1 < p.length; i++) {
    const a = p[i]!;
    const b = p[i + 1]!;
    const rx = b[0] - a[0];
    const ry = b[1] - a[1];
    for (let j = 0; j + 1 < q.length; j++) {
      const c = q[j]!;
      const dd = q[j + 1]!;
      if (!segsProperlyCross(a, b, c, dd)) {
        continue;
      }
      const ux = dd[0] - c[0];
      const uy = dd[1] - c[1];
      const D = rx * uy - ry * ux;
      if (Math.abs(D) < 1e-9) {
        continue;
      }
      const t = ((c[0] - a[0]) * uy - (c[1] - a[1]) * ux) / D;
      out.push({ segP: i, tP: t, segQ: j, pt: [a[0] + t * rx, a[1] + t * ry] });
    }
  }
  return out;
}

/**
 * W3-4 same-pair lens (empty-bigon) removal. For a pair of polylines with ≥2
 * proper crossings, find two crossings CONSECUTIVE along BOTH curves (an empty
 * bigon — Reidemeister-II) and swap the sub-arcs between them: the two curves
 * occupy the same union of points afterward, so no third edge gains a crossing,
 * and exactly the 2 bigon crossings vanish. Endpoints are preserved. Returns the
 * two rebuilt polylines, or null when no bigon exists.
 */
export function removeOneLens(
  pPts: readonly Pt[],
  qPts: readonly Pt[],
): { p: Pt[]; q: Pt[] } | null {
  const crossings = polyCrossings(pPts, qPts);
  if (crossings.length < 2) {
    return null;
  }
  // Order along P (segP, tP). Adjacent-along-P candidates are consecutive here.
  const alongP = [...crossings].sort(
    (a, b) => a.segP - b.segP || a.tP - b.tP,
  );
  // Rank of each crossing along Q (segQ, then point order along that segment).
  const alongQ = [...crossings].sort(
    (a, b) =>
      a.segQ - b.segQ ||
      (a.pt[0] - qPts[a.segQ]![0]) ** 2 +
        (a.pt[1] - qPts[a.segQ]![1]) ** 2 -
        ((b.pt[0] - qPts[b.segQ]![0]) ** 2 +
          (b.pt[1] - qPts[b.segQ]![1]) ** 2),
  );
  const qRank = new Map<CrossXY, number>();
  alongQ.forEach((c, i) => qRank.set(c, i));

  for (let k = 0; k + 1 < alongP.length; k++) {
    const p1 = alongP[k]!;
    const p2 = alongP[k + 1]!;
    // Consecutive along P by construction; require consecutive along Q too.
    if (Math.abs(qRank.get(p1)! - qRank.get(p2)!) !== 1) {
      continue;
    }
    // Interior vertices of P strictly between the two crossings (segP..).
    const pInterior = pPts.slice(p1.segP + 1, p2.segP + 1);
    // Interior vertices of Q between the two crossings, oriented p1 → p2.
    const qFirst = qRank.get(p1)! < qRank.get(p2)! ? p1 : p2;
    const qSecond = qFirst === p1 ? p2 : p1;
    const qInterior = qPts.slice(qFirst.segQ + 1, qSecond.segQ + 1);
    // arc along Q oriented from p1 to p2:
    let arcQ: Pt[];
    if (qFirst === p1) {
      arcQ = [p1.pt, ...qInterior, p2.pt];
    } else {
      arcQ = [p1.pt, ...[...qInterior].reverse(), p2.pt];
    }
    const arcP: Pt[] = [p1.pt, ...pInterior, p2.pt];
    // Rebuild: P takes Q's arc between p1,p2; Q takes P's arc.
    const newP = [
      ...pPts.slice(0, p1.segP + 1),
      ...arcQ,
      ...pPts.slice(p2.segP + 1),
    ];
    // For Q, splice between the earlier and later crossing ALONG Q.
    const loQ = qFirst.segQ;
    const hiQ = qSecond.segQ;
    const arcPForQ =
      qFirst === p1 ? arcP : [...arcP].reverse();
    const newQ = [
      ...qPts.slice(0, loQ + 1),
      ...arcPForQ,
      ...qPts.slice(hiQ + 1),
    ];
    return { p: simplifyPolyline(newP), q: simplifyPolyline(newQ) };
  }
  return null;
}

/**
 * Optional keyed-anchor inputs so the styled polyline's endpoints coincide with
 * the anchors `repairTerraformEdgeBindings` re-derives (see the file header's
 * "ENDPOINTS = REPAIR'S CHORD ANCHORS"). Built at skeleton time by
 * `assembleStrataSceneSkeleton`:
 *  - `bodyRectByKey`  — resource `terraformVisibilityKey` → CARD body rect, keyed
 *    exactly as `collectTerraformResourceRects` keys the converted elements.
 *  - `structuralPairKeys` — sorted `source|||target` pairs that also carry a
 *    structural dependency line (drives repair's 18px offset).
 * Absent (or a per-edge key miss) ⇒ the pass falls back to the skeleton chord
 * endpoints for that edge, exactly the edges repair leaves unchanged.
 */
export type StrataEdgeStyleAnchors = {
  bodyRectByKey: ReadonlyMap<string, EdgeAnchorRect>;
  structuralPairKeys: ReadonlySet<string>;
};

/**
 * Scene-level pass: reshape, IN PLACE in the skeleton array, every un-routed
 * TFD arrow to the requested render style. Only interior path shape (plus the
 * body-clipped endpoints when `anchors` is supplied) changes. Arrows already
 * stamped `terraformRoutedPolyline` (by channel / edgeRouting / borderRoute) are
 * skipped, and every arrow this pass stamps additionally records
 * `terraformRoutedBy:"style"` provenance.
 *
 * When `anchors` is supplied and BOTH of an edge's endpoint keys resolve to a
 * body rect, the styled polyline's start/end are the shared
 * `computeTerraformChordAnchors` anchors — identical to what repair re-derives,
 * so repair's validate-before-trust gate passes and never flattens the curve.
 * Missing anchors ⇒ fall back to the skeleton chord endpoints.
 *
 * `curve` style additionally routes genuine BACK-EDGES (target strictly left of
 * source) as an orbit arc over/under the occupied Y band (W3-1 orbit class),
 * guard-gated against foreign-card pierce (revert to chord on failure). That
 * needs obstacle geometry, so it activates only when `placement` supplies leaf
 * boxes; with a null/empty placement the pass degrades to the pure endpoint-
 * local styling (back-edges fall through to the monotone bezier).
 */
export function applyStrataEdgeStyle(
  skeleton: ExcalidrawElementSkeleton[],
  _model: StrataModel,
  placement: StrataPlacementResult,
  style: Exclude<StrataEdgeStyle, "straight">,
  anchors?: StrataEdgeStyleAnchors,
): StrataEdgeStyleMeta {
  const meta: StrataEdgeStyleMeta = {
    style,
    styled: 0,
    skipped: 0,
    pointsTotal: 0,
    orbited: 0,
    orbitReverted: 0,
    reentryClamped: 0,
    lensSwaps: 0,
  };
  const stub = Math.min(STRATA_EDGE_STYLE_STUB_PX, PIPELINE_FRAME_PAD);
  // Card catalogue for the orbit pierce guard (curve style only). Null-safe:
  // a null/degenerate placement disables orbiting entirely.
  const leafBoxes =
    placement && placement.leafBoxes instanceof Map
      ? placement.leafBoxes
      : null;

  // ── PHASE 1: build the styled polyline for every eligible arrow, deferring the
  // skeleton write-back so the cross-edge Stage-C passes (W3-2/W3-4) can operate
  // over the whole styled set. Byte-identical geometry to the pre-Stage-C loop.
  type Rec = {
    i: number;
    el: ArrowSkeleton;
    start: Pt;
    end: Pt;
    poly: Pt[];
    orbit: boolean;
    /** curve bezier (non-orbit) — eligible for W3-2 clamp / W3-4 lens removal. */
    bezier: boolean;
    srcBox: StrataBox | null;
    tgtBox: StrataBox | null;
  };
  const records: Rec[] = [];

  for (let i = 0; i < skeleton.length; i++) {
    const el = skeleton[i] as ArrowSkeleton;
    if (el.type !== "arrow") {
      continue;
    }
    const rel = relationshipOf(el);
    if (!rel) {
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
    // Default endpoints = the skeleton chord (clipped against the leaf FRAME).
    let start: Pt = [sx, sy];
    let end: Pt = [sx + lastPt[0], sy + lastPt[1]];
    // Prefer repair's chord anchors when both endpoint keys resolve to a body
    // rect: the styled polyline then ends exactly where repair re-derives, so
    // repair's validate-before-trust gate keeps the stamp (never flattens). A
    // key miss falls back to the skeleton chord — the same edges repair leaves
    // unchanged (terraformVisibility.ts: `!rectA || !rectB` early return).
    if (anchors) {
      const rectA = anchors.bodyRectByKey.get(rel.source);
      const rectB = anchors.bodyRectByKey.get(rel.target);
      if (rectA && rectB) {
        const pairKey = [rel.source, rel.target].sort().join("|||");
        const chord = computeTerraformChordAnchors(rectA, rectB, {
          structuralPair: anchors.structuralPairKeys.has(pairKey),
        });
        start = [chord.startPoint.x, chord.startPoint.y];
        end = [chord.endPoint.x, chord.endPoint.y];
      }
    }
    if (start[0] === end[0] && start[1] === end[1]) {
      meta.skipped += 1; // self-loop / zero-length — nothing to style
      continue;
    }

    // Genuine back-edge (target strictly left of source): a monotone chord/curve
    // would slice every intervening rank card, so route it as a guard-gated
    // orbit arc OUTSIDE the occupied Y band. Needs obstacle geometry — skipped
    // when placement is null/empty (back-edge then falls through to the bezier).
    let orbitPoly: Pt[] | null = null;
    if (leafBoxes && end[0] < start[0]) {
      const foreign: StrataBox[] = [];
      for (const [id, b] of leafBoxes) {
        if (id === rel.source || id === rel.target) {
          continue;
        }
        foreign.push(b);
      }
      const loX = Math.min(start[0], end[0]);
      const hiX = Math.max(start[0], end[0]);
      let bandTop = Infinity;
      let bandBottom = -Infinity;
      for (const b of foreign) {
        // Band = Y-extent of cards overlapping the spanned X corridor.
        if (b.x + b.width > loX && b.x < hiX) {
          bandTop = Math.min(bandTop, b.y);
          bandBottom = Math.max(bandBottom, b.y + b.height);
        }
      }
      if (Number.isFinite(bandTop)) {
        const chordPierce = piercedCardCount([start, end], foreign);
        const topOrbit = orbitPolyline(start, end, bandTop - stub);
        const bottomOrbit = orbitPolyline(start, end, bandBottom + stub);
        // Prefer the arc with the fewer foreign-card pierces (tie → over-the-top,
        // the conventional feedback-arc idiom).
        const topPierce = piercedCardCount(topOrbit, foreign);
        const bottomPierce = piercedCardCount(bottomOrbit, foreign);
        const best =
          topPierce <= bottomPierce
            ? { poly: topOrbit, pierce: topPierce }
            : { poly: bottomOrbit, pierce: bottomPierce };
        if (best.pierce <= chordPierce) {
          orbitPoly = best.poly;
          meta.orbited += 1;
        } else {
          // Never-worse guard failed: keep the straight chord (unstyled).
          meta.orbitReverted += 1;
          meta.skipped += 1;
          continue;
        }
      }
    }

    const poly =
      orbitPoly ??
      (style === "step"
        ? smoothStepPolyline(start, end, stub)
        : bezierPolyline(start, end));

    if (poly.length < 2) {
      meta.skipped += 1;
      continue;
    }
    records.push({
      i,
      el,
      start,
      end,
      poly,
      orbit: orbitPoly != null,
      bezier: style === "curve" && orbitPoly == null,
      srcBox: leafBoxes?.get(rel.source) ?? null,
      tgtBox: leafBoxes?.get(rel.target) ?? null,
    });
  }

  // ── PHASE 2: Stage-C refinement (curve style only). Each pass is a per-edge
  // no-op on clean edges and never-worse-gated on scene crossings + foreign
  // pierce. Foreign-card set for the pierce guard = all leaf boxes minus the
  // edge's own source/target.
  if (style === "curve" && leafBoxes) {
    const foreignBoxesFor = (r: Rec): StrataBox[] => {
      const out: StrataBox[] = [];
      for (const [id, b] of leafBoxes) {
        if (b === r.srcBox || b === r.tgtBox || id === "") {
          continue;
        }
        out.push(b);
      }
      return out;
    };
    // Scene crossings of a candidate polyline for `self` against all OTHER
    // records' current polylines.
    const crossingsAgainstOthers = (selfIdx: number, poly: readonly Pt[]) => {
      let n = 0;
      for (let k = 0; k < records.length; k++) {
        if (k === selfIdx) {
          continue;
        }
        n += polyCrossCount(poly, records[k]!.poly);
      }
      return n;
    };

    // W3-2 own-card re-entry clamp (forward bezier edges only).
    for (let idx = 0; idx < records.length; idx++) {
      const r = records[idx]!;
      if (!r.bezier) {
        continue;
      }
      const clamped = clampOwnCardReentry(
        r.start,
        r.end,
        r.srcBox,
        r.tgtBox,
      );
      if (!clamped) {
        continue; // clean, or placement-artifact re-entry (irreducible)
      }
      const foreign = foreignBoxesFor(r);
      const beforeCross = crossingsAgainstOthers(idx, r.poly);
      const afterCross = crossingsAgainstOthers(idx, clamped);
      const beforePierce = piercedCardCount(r.poly, foreign);
      const afterPierce = piercedCardCount(clamped, foreign);
      if (afterCross <= beforeCross && afterPierce <= beforePierce) {
        r.poly = clamped;
        meta.reentryClamped += 1;
      }
    }

    // W3-4 same-pair lens removal — iterate to fixpoint (cap). Each accepted
    // swap removes exactly 2 crossings and touches only its two edges' interiors.
    for (let pass = 0; pass < STAGE_C_LENS_MAX_PASSES; pass++) {
      let applied = 0;
      for (let a = 0; a < records.length; a++) {
        for (let b = a + 1; b < records.length; b++) {
          const ra = records[a]!;
          const rb = records[b]!;
          const swapped = removeOneLens(ra.poly, rb.poly);
          if (!swapped) {
            continue;
          }
          // Guard: strict total-crossings decrease for this pair against the
          // WHOLE scene + no new foreign pierce on either edge.
          const beforeA = crossingsAgainstOthers(a, ra.poly);
          const beforeB = crossingsAgainstOthers(b, rb.poly);
          const between = polyCrossCount(ra.poly, rb.poly);
          // beforeA/beforeB double-count the a-b crossing; subtract once.
          const before = beforeA + beforeB - between;
          const afterBetween = polyCrossCount(swapped.p, swapped.q);
          // Temporarily measure the swapped pair against others.
          const savedA = ra.poly;
          const savedB = rb.poly;
          ra.poly = swapped.p;
          rb.poly = swapped.q;
          const afterA = crossingsAgainstOthers(a, swapped.p);
          const afterB = crossingsAgainstOthers(b, swapped.q);
          const after = afterA + afterB - afterBetween;
          const foreignA = foreignBoxesFor(ra);
          const foreignB = foreignBoxesFor(rb);
          const pierceOk =
            piercedCardCount(swapped.p, foreignA) <=
              piercedCardCount(savedA, foreignA) &&
            piercedCardCount(swapped.q, foreignB) <=
              piercedCardCount(savedB, foreignB);
          if (after < before && pierceOk) {
            meta.lensSwaps += 1;
            applied += 1;
          } else {
            ra.poly = savedA; // revert
            rb.poly = savedB;
          }
        }
      }
      if (applied === 0) {
        break;
      }
    }
  }

  // ── PHASE 3: write the (possibly refined) polylines back into the skeleton.
  for (const r of records) {
    const poly = r.poly;
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
    // Origin the element at the polyline's FIRST point so points[0] === [0,0]
    // and el.x/el.y === the absolute first point. `convertToExcalidrawElements`
    // re-normalizes linear elements to points[0]=[0,0] anchored at el.x/el.y, so
    // an element whose first point drifted from el.x/el.y (the anchor-clipped
    // case) would otherwise be re-anchored back to the OLD frame-clipped origin,
    // discarding the fix. When endpoints are unchanged (no anchors / fallback)
    // poly[0] === the original [el.x, el.y], so el.x/el.y and points are
    // byte-identical to the pre-Stage-C write-back.
    const originX = poly[0]![0];
    const originY = poly[0]![1];
    // Defense-in-depth: drop any clip-pass markers before re-stamping (the
    // first-stamper skip means a clip edge never reaches here, but a stale
    // `terraformClipAnchor`/`terraformClipLane` is inert to the repair gate yet
    // serializes as garbage / inflates the lane census — strip so a "style"
    // stamp is self-consistent).
    const {
      terraformClipAnchor: _staleClipAnchor,
      terraformClipLane: _staleClipLane,
      ...prevCustomData
    } = r.el.customData ?? {};
    skeleton[r.i] = {
      ...r.el,
      x: originX,
      y: originY,
      points: poly.map(([px, py]) =>
        pointFrom<LocalPoint>(px - originX, py - originY),
      ),
      width: maxX - minX,
      height: maxY - minY,
      // Step (and the orbit class, which shares step's coarse rectilinear
      // shape — see `orbitPolyline`: start/[startX,orbitY]/[endX,orbitY]/end,
      // 2 right-angle corners) round their orthogonal corners in the renderer
      // (React Flow smoothstep look) while the polyline stays clean 2-bend
      // geometry for the bend metric.
      //
      // Render fidelity (E1.1): a true (non-orbit) curve record's polyline IS
      // the finely-sampled shape (`STRATA_EDGE_STYLE_CURVE_SAMPLES` points) —
      // it must render as the LITERAL path Stage C computed and validated
      // (crossings/pierce guards). Leaving roundness inherited from skeleton
      // creation (`{type:2}`) makes RoughJS's `generator.curve()` re-spline
      // through all those points instead of drawing straight segments between
      // them, bowing outside the computed polyline into adjacent cards. So
      // curve (non-orbit) records force roundness OFF (`null`) here; the
      // dense sampling then reads as smooth on its own.
      ...(style === "step" || r.orbit
        ? { roundness: { type: 2 } }
        : { roundness: null }),
      customData: {
        ...prevCustomData,
        terraformRoutedPolyline: true,
        terraformRoutedBy: "style",
      },
    } as ExcalidrawElementSkeleton;
    meta.styled += 1;
    meta.pointsTotal += poly.length;
  }

  return meta;
}
