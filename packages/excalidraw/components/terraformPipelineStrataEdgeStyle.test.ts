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
  clampOwnCardReentry,
  removeOneLens,
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
    const meta = applyStrataEdgeStyle(skeleton, model, placement, "curve");
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

  // Stage C: refinement passes leave a clean single-edge scene untouched but
  // report their new meta counters. FAILS pre-change (meta had no lensSwaps /
  // reentryClamped fields — `toBe(0)` sees `undefined`).
  it("Stage-C: single un-crossed curve edge is a no-op (lensSwaps=0, reentryClamped=0)", () => {
    const skeleton = [tfdArrow(0, 0, [200, 40])];
    const meta = applyStrataEdgeStyle(skeleton, model, placement, "curve");
    expect(meta.styled).toBe(1);
    expect(meta.lensSwaps).toBe(0);
    expect(meta.reentryClamped).toBe(0);
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
    const meta = applyStrataEdgeStyle(skeleton, model, placement, "curve");
    expect(meta.styled).toBe(0);
    expect(JSON.stringify(skeleton[0])).toBe(before);
  });
});

// Local proper-crossing check for the lens tests (mirrors the module's private
// guard kernel; interior-interior only, shared endpoints excluded).
const properCross = (
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
): boolean => {
  const o = (
    p: readonly [number, number],
    q: readonly [number, number],
    r: readonly [number, number],
  ) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const E = 1e-9;
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return (
    ((d1 > E && d2 < -E) || (d1 < -E && d2 > E)) &&
    ((d3 > E && d4 < -E) || (d3 < -E && d4 > E))
  );
};
const countCrossings = (
  p: ReadonlyArray<readonly [number, number]>,
  q: ReadonlyArray<readonly [number, number]>,
): number => {
  let n = 0;
  for (let i = 0; i + 1 < p.length; i++) {
    for (let j = 0; j + 1 < q.length; j++) {
      if (properCross(p[i]!, p[i + 1]!, q[j]!, q[j + 1]!)) {
        n += 1;
      }
    }
  }
  return n;
};

// W3-4 (spec SECTION 3): same-pair lens/bigon removal. FAILS pre-change
// (removeOneLens did not exist).
describe("removeOneLens (W3-4 empty-bigon swap)", () => {
  it("swaps the sub-arcs of an empty bigon, removing exactly 2 crossings", () => {
    const P: Array<[number, number]> = [
      [0, 0],
      [4, 4],
      [8, 0],
    ];
    const Q: Array<[number, number]> = [
      [0, 4],
      [4, 0],
      [8, 4],
    ];
    // Pre: they cross twice (at (2,2) and (6,2)).
    expect(countCrossings(P, Q)).toBe(2);
    const out = removeOneLens(P, Q);
    expect(out).not.toBeNull();
    const { p, q } = out!;
    // Endpoints preserved.
    expect(p[0]).toEqual([0, 0]);
    expect(p[p.length - 1]).toEqual([8, 0]);
    expect(q[0]).toEqual([0, 4]);
    expect(q[q.length - 1]).toEqual([8, 4]);
    // The arcs were swapped: P now carries Q's midpoint (4,0), Q carries (4,4).
    expect(p).toContainEqual([4, 0]);
    expect(q).toContainEqual([4, 4]);
    // Post: the bigon is gone — zero proper crossings between the two.
    expect(countCrossings(p, q)).toBe(0);
  });

  it("returns null when the pair crosses at most once (no bigon)", () => {
    const P: Array<[number, number]> = [
      [0, 0],
      [8, 0],
    ];
    const Q: Array<[number, number]> = [
      [4, -4],
      [4, 4],
    ];
    expect(countCrossings(P, Q)).toBe(1);
    expect(removeOneLens(P, Q)).toBeNull();
  });
});

// W3-2 (spec SECTION 3): own-card re-entry clamp. FAILS pre-change
// (clampOwnCardReentry did not exist).
describe("clampOwnCardReentry (W3-2 own-card re-entry clamp)", () => {
  it("returns null for a clean forward curve (no own-card re-entry)", () => {
    const far: StrataBox = { x: -500, y: -500, width: 10, height: 10 };
    expect(
      clampOwnCardReentry([0, 0], [200, 20], far, null),
    ).toBeNull();
  });

  it("returns null when the re-entry is irreducible (anchor embedded > one stub inside its own card — the straight chord re-enters too)", () => {
    // Start 30px inside the source card's right border; a forward chord to the
    // right necessarily stays in the card past the 20px stub-skip. No control-arm
    // shortening can clear it, so the clamp declines (placement artifact).
    const srcBox: StrataBox = { x: 0, y: 0, width: 100, height: 100 };
    expect(
      clampOwnCardReentry([70, 50], [400, 50], srcBox, null),
    ).toBeNull();
  });
});
