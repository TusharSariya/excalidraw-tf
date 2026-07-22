/**
 * Probe P2 `strataEdgeStyle` module unit tests (React-Flow math transplant +
 * the in-place skeleton pass). FAILS on pre-change code: the module did not
 * exist.
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import {
  applyStrataEdgeStyle,
  bezierPolyline,
  calculateControlOffset,
  smoothStepPolyline,
} from "./terraformPipelineStrataEdgeStyle";
import { segmentIntersectsStrataBoxInterior } from "./terraformPipelineStrataPackedScoring";
import type { StrataBox } from "./terraformPipelineStrataTypes";
import type {
  StrataModel,
  StrataPlacementResult,
} from "./terraformPipelineStrataTypes";

const model = null as unknown as StrataModel;
const placement = null as unknown as StrataPlacementResult;

const tfdArrow = (
  x: number,
  y: number,
  end: readonly [number, number],
  extra: Record<string, unknown> = {},
): ExcalidrawElementSkeleton =>
  ({
    type: "arrow",
    x,
    y,
    width: Math.abs(end[0]),
    height: Math.abs(end[1]),
    points: [
      [0, 0],
      [end[0], end[1]],
    ],
    customData: {
      terraformEdgeLayer: "declaredDataFlow",
      relationship: { source: "A", target: "B" },
      ...extra,
    },
  }) as unknown as ExcalidrawElementSkeleton;

describe("calculateControlOffset (React Flow getBezierPath)", () => {
  it("pushes half the distance forward", () => {
    expect(calculateControlOffset(100, 0.25)).toBe(50);
  });
  it("pushes curvature·25·√|distance| backward", () => {
    // distance -100 → 0.25 * 25 * 10 = 62.5
    expect(calculateControlOffset(-100, 0.25)).toBe(62.5);
  });
});

describe("smoothStepPolyline", () => {
  it("preserves endpoints and yields an orthogonal Z (2 interior corners)", () => {
    const poly = smoothStepPolyline([0, 0], [100, 40], 20);
    expect(poly[0]).toEqual([0, 0]);
    expect(poly[poly.length - 1]).toEqual([100, 40]);
    // Horizontal-major: vertical middle segment at centerX = 50.
    // Simplified path: [0,0] -> [50,0] -> [50,40] -> [100,40].
    expect(poly).toEqual([
      [0, 0],
      [50, 0],
      [50, 40],
      [100, 40],
    ]);
  });

  it("collapses to a straight line when start and end share Y", () => {
    const poly = smoothStepPolyline([0, 0], [100, 0], 20);
    expect(poly).toEqual([
      [0, 0],
      [100, 0],
    ]);
  });
});

describe("bezierPolyline", () => {
  it("preserves endpoints and samples to 14 points", () => {
    const poly = bezierPolyline([0, 0], [100, 40], 0.25, 13);
    expect(poly.length).toBe(14);
    expect(poly[0]).toEqual([0, 0]);
    expect(poly[13]![0]).toBeCloseTo(100, 6);
    expect(poly[13]![1]).toBeCloseTo(40, 6);
  });

  it("its midpoint lies on the chord midpoint for a symmetric forward edge", () => {
    // Horizontal-major, control points at x=50 on each endpoint's Y → the t=0.5
    // sample sits at x=50, y=20 (mean of the two endpoint Ys).
    const poly = bezierPolyline([0, 0], [100, 40], 0.25, 2);
    expect(poly[1]![0]).toBeCloseTo(50, 6);
    expect(poly[1]![1]).toBeCloseTo(20, 6);
  });

  // DEFECT 1 (Fable attacker): the old control-offset hardcoded React Flow's
  // Right/Bottom-port push (`calculateControlOffset` on the SIGNED chord), so a
  // Δx<0 or Δy<0 chord looped its control arm the wrong way — bulging back INTO
  // the source card and overshooting THROUGH the target. Direction-aware offsets
  // + the forward-edge monotone clamp make every curve monotone in its major
  // axis. FAILS pre-fix (old code excursions ≈+16.8px / dips ≈+14.5px).
  it("keeps a leftward (Δx<0) horizontal edge x-monotone — no excursion into source or past target", () => {
    const poly = bezierPolyline([0, 0], [-500, 0]);
    const xs = poly.map((p) => p[0]);
    // No sample bulges to the right of the source anchor (x=0).
    expect(Math.max(...xs)).toBeLessThanOrEqual(1e-6);
    // No sample overshoots past the target anchor (x=-500).
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-500 - 1e-6);
  });

  it("keeps an upward (Δy<0) vertical edge y-monotone — no dip below the source", () => {
    const poly = bezierPolyline([0, 0], [0, -300]);
    const ys = poly.map((p) => p[1]);
    expect(Math.max(...ys)).toBeLessThanOrEqual(1e-6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-300 - 1e-6);
  });
});

describe("applyStrataEdgeStyle", () => {
  it("reshapes an un-routed TFD chord and stamps the routed-polyline marker", () => {
    const skeleton = [tfdArrow(0, 0, [100, 40])];
    const meta = applyStrataEdgeStyle(skeleton, model, placement, "step");
    expect(meta.styled).toBe(1);
    expect(meta.skipped).toBe(0);
    const el = skeleton[0] as ExcalidrawElementSkeleton & {
      points: number[][];
      customData: Record<string, unknown>;
    };
    expect(el.customData.terraformRoutedPolyline).toBe(true);
    expect(el.points.length).toBeGreaterThan(2);
    // Endpoints preserved (points are el-relative; last point = end - start).
    expect(el.points[0]).toEqual([0, 0]);
    expect(el.points[el.points.length - 1]).toEqual([100, 40]);
  });

  it("skips arrows already stamped by an earlier routing pass (first-stamper-wins)", () => {
    const skeleton = [
      tfdArrow(0, 0, [100, 40], { terraformRoutedPolyline: true }),
    ];
    const before = JSON.stringify(skeleton[0]);
    const meta = applyStrataEdgeStyle(skeleton, model, placement, "curve");
    expect(meta.styled).toBe(0);
    expect(meta.skipped).toBe(1);
    expect(JSON.stringify(skeleton[0])).toBe(before);
  });

  // DEFECT 1 orbit class (W3-1): a genuine back-edge (target strictly left of
  // source) whose monotone chord would slice an intermediate card is rerouted
  // as a guard-gated orbit arc OUTSIDE the occupied band. Needs real placement
  // geometry. FAILS pre-fix (no orbit; back-edge bezier pierces the mid card).
  it("routes a back-edge as an orbit that clears an intermediate card the chord would slice", () => {
    const mid: StrataBox = { x: 240, y: 90, width: 80, height: 40 };
    const leafBoxes = new Map<string, StrataBox>([
      ["A", { x: 0, y: 80, width: 80, height: 40 }],
      ["B", { x: 500, y: 80, width: 80, height: 40 }],
      ["M", mid],
    ]);
    const placementReal = {
      leafBoxes,
    } as unknown as StrataPlacementResult;
    // Back-edge B(right) → A(left); its straight chord at y=100 crosses M.
    const skeleton = [
      tfdArrow(500, 100, [-500, 0], {
        relationship: { source: "B", target: "A" },
      }),
    ];
    const meta = applyStrataEdgeStyle(skeleton, model, placementReal, "curve");
    expect(meta.orbited).toBe(1);
    expect(meta.styled).toBe(1);
    expect(meta.orbitReverted).toBe(0);
    const el = skeleton[0] as unknown as {
      x: number;
      y: number;
      points: Array<[number, number]>;
    };
    const abs = el.points.map(
      ([px, py]) => [el.x + px, el.y + py] as [number, number],
    );
    // Endpoints preserved.
    expect(abs[0]).toEqual([500, 100]);
    expect(abs[abs.length - 1]).toEqual([0, 100]);
    // No segment of the emitted orbit pierces the intermediate card interior.
    let slices = false;
    for (let i = 0; i + 1 < abs.length; i++) {
      if (
        segmentIntersectsStrataBoxInterior(
          abs[i]![0],
          abs[i]![1],
          abs[i + 1]![0],
          abs[i + 1]![1],
          mid.x,
          mid.y,
          mid.x + mid.width,
          mid.y + mid.height,
        )
      ) {
        slices = true;
      }
    }
    expect(slices).toBe(false);
  });

  it("ignores non-TFD arrows (no relationship)", () => {
    const plain = {
      type: "arrow",
      x: 0,
      y: 0,
      points: [
        [0, 0],
        [100, 0],
      ],
      customData: {},
    } as unknown as ExcalidrawElementSkeleton;
    const skeleton = [plain];
    const before = JSON.stringify(skeleton[0]);
    const meta = applyStrataEdgeStyle(skeleton, model, placement, "step");
    expect(meta.styled).toBe(0);
    expect(JSON.stringify(skeleton[0])).toBe(before);
  });
});
