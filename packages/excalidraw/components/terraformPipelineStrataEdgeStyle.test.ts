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
