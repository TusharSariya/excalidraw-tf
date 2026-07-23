/**
 * Unit suite for the loop-3 E3.1 GLEE smoothing pass
 * (terraformPipelineStrataEdgeSmooth.ts).
 *
 * Pins the design contract:
 *  - the inflection shortcut drops an S-kink ONLY when triangle (a,b,c) is
 *    clear of card body rects;
 *  - corner rounding escalates k through {1/2, 3/4, 7/8} against the
 *    12px-inflated card rects, and leaves the corner sharp when no k clears;
 *  - processed records get `roundness:null` (exact-path rendering), even when
 *    the geometry needed no change;
 *  - endpoints / `terraformRoutedBy` provenance / `terraformClipAnchor` /
 *    `terraformClipLane` are NEVER touched, and el.x/el.y never move (no
 *    re-origin — points[0] stays fixed);
 *  - the ≥3-point floor (repair's `points.length > 2` marker gate);
 *  - the ≤16-point per-edge budget;
 *  - "style" records and unstamped/degenerate arrows are skipped untouched.
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataEdgeSmooth.test.ts
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import {
  STRATA_EDGE_SMOOTH_POINT_BUDGET,
  smoothStrataRoutedEdges,
} from "./terraformPipelineStrataEdgeSmooth";

import type { EdgeAnchorRect } from "./terraformEdgeAnchors";

type Pt = readonly [number, number];

type ArrowLike = {
  type: "arrow";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  points: ReadonlyArray<readonly [number, number]>;
  roundness: { type: number } | null;
  customData?: Record<string, unknown>;
};

/** Build an arrow skeleton from ABSOLUTE points, re-origined at points[0] —
 * exactly the shape the routers/clip stampers write back. */
const arrowOf = (
  absPts: readonly Pt[],
  customData: Record<string, unknown> | undefined,
  id = "edge-1",
): ExcalidrawElementSkeleton => {
  const [ox, oy] = absPts[0]!;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [px, py] of absPts) {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }
  return {
    type: "arrow",
    id,
    x: ox,
    y: oy,
    width: maxX - minX,
    height: maxY - minY,
    points: absPts.map(([px, py]) => [px - ox, py - oy] as const),
    roundness: { type: 2 },
    ...(customData ? { customData } : {}),
  } as unknown as ExcalidrawElementSkeleton;
};

const absPointsOf = (el: ExcalidrawElementSkeleton): Pt[] => {
  const a = el as unknown as ArrowLike;
  return a.points.map(([px, py]) => [a.x + px, a.y + py] as const);
};

const routedData = (
  by: "channel" | "route" | "border" | "clip" | "style",
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  terraformEdgeLayer: "declaredDataFlow",
  relationship: { source: "s", target: "t" },
  terraformRoutedPolyline: true,
  terraformRoutedBy: by,
  ...extra,
});

describe("smoothStrataRoutedEdges — inflection shortcut", () => {
  it("drops an S-kink when triangle (a,b,c) is clear of card rects", () => {
    // Z-step: turn flips at (100,0)→(100,50) — an inflection pair.
    const skeleton = [
      arrowOf(
        [
          [0, 0],
          [100, 0],
          [100, 50],
          [200, 50],
        ],
        routedData("route"),
      ),
    ];
    const meta = smoothStrataRoutedEdges(skeleton, []);
    expect(meta.smoothed).toBe(1);
    expect(meta.kinksRemoved).toBe(1);
    const pts = absPointsOf(skeleton[0]!);
    // (100,0) is gone; endpoints intact.
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([200, 50]);
    expect(pts.some(([x, y]) => x === 100 && y === 0)).toBe(false);
  });

  it("keeps the kink when a card body rect sits inside the shortcut triangle", () => {
    const card: EdgeAnchorRect = { x: 80, y: 10, width: 10, height: 10 };
    const skeleton = [
      arrowOf(
        [
          [0, 0],
          [100, 0],
          [100, 50],
          [200, 50],
        ],
        routedData("route"),
      ),
    ];
    const meta = smoothStrataRoutedEdges(skeleton, [card]);
    expect(meta.kinksRemoved).toBe(0);
    const pts = absPointsOf(skeleton[0]!);
    expect(pts.some(([x, y]) => x === 100 && y === 0)).toBe(true);
  });
});

describe("smoothStrataRoutedEdges — LR-discipline hull guard", () => {
  it("keeps a kink whose shortcut chord would cross a hull's top border", () => {
    // Same clear Z-step as the shortcut test, but a hull frame's TOP border
    // (y=25, x 0..300) lies across the would-be diagonal (0,0)→(100,50). No
    // card blocks the triangle — only the hull guard can (and must) veto.
    // Control run (no hull) proves the veto is the guard's doing.
    const zStep: Pt[] = [
      [0, 0],
      [100, 0],
      [100, 50],
      [200, 50],
    ];
    const control = [arrowOf(zStep, routedData("clip"))];
    expect(smoothStrataRoutedEdges(control, []).kinksRemoved).toBe(1);

    const hull: EdgeAnchorRect = { x: 0, y: 25, width: 300, height: 200 };
    const guarded = [arrowOf(zStep, routedData("clip"))];
    const meta = smoothStrataRoutedEdges(guarded, [], [hull]);
    expect(meta.kinksRemoved).toBe(0);
  });

  it("escalates the chamfer k when the m–n cut crosses a hull's bottom border", () => {
    // Corner at (100,0) descending to (100,100); a hull BELOW with its bottom
    // border at y=20 (hull spans y -180..20, x 0..80): the k=1/2 cut
    // (50,0)→(100,50) crosses that horizontal border inside x 0..80; the
    // k=3/4 cut (75,0)→(100,25) crosses y=20 at x≈80.2 — outside the hull's
    // X span, so it clears.
    const hull: EdgeAnchorRect = { x: 0, y: -180, width: 80, height: 200 };
    const skeleton = [
      arrowOf(
        [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
        routedData("clip"),
      ),
    ];
    const meta = smoothStrataRoutedEdges(skeleton, [], [hull]);
    expect(meta.cornersRounded).toBe(1);
    const pts = absPointsOf(skeleton[0]!);
    expect(pts).toEqual([
      [0, 0],
      [75, 0],
      [100, 25],
      [100, 100],
    ]);
  });
});

describe("smoothStrataRoutedEdges — corner rounding", () => {
  it("chamfers a clear corner at k=1/2 (m and n at the segment midpoints)", () => {
    const skeleton = [
      arrowOf(
        [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
        routedData("border"),
      ),
    ];
    const meta = smoothStrataRoutedEdges(skeleton, []);
    expect(meta.cornersRounded).toBe(1);
    expect(meta.cornersBlocked).toBe(0);
    const pts = absPointsOf(skeleton[0]!);
    // b=(100,0) replaced by m=(50,0), n=(100,50).
    expect(pts).toEqual([
      [0, 0],
      [50, 0],
      [100, 50],
      [100, 100],
    ]);
  });

  it("escalates k until the corner region clears the 12px-inflated card rects", () => {
    // Card near the incoming run: the k=1/2 triangle (m=(50,0),b,(100,50))
    // touches its inflated rect (x 28..62 crosses y=0), but the k=3/4
    // triangle's bbox starts at x=75 — clear.
    const card: EdgeAnchorRect = { x: 40, y: 2, width: 10, height: 10 };
    const skeleton = [
      arrowOf(
        [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
        routedData("border"),
      ),
    ];
    const meta = smoothStrataRoutedEdges(skeleton, [card]);
    expect(meta.cornersRounded).toBe(1);
    const pts = absPointsOf(skeleton[0]!);
    // k=3/4: m = a + 3/4(b−a) = (75,0); n = c + 3/4(b−c) = (100,25).
    expect(pts).toEqual([
      [0, 0],
      [75, 0],
      [100, 25],
      [100, 100],
    ]);
  });

  it("leaves the corner sharp (counted blocked) when no k in the ladder clears", () => {
    // Card hugging the corner itself: every k's triangle contains part of the
    // inflated rect, so the corner must stay a genuine right angle.
    const card: EdgeAnchorRect = { x: 92, y: 2, width: 20, height: 20 };
    const skeleton = [
      arrowOf(
        [
          [0, 0],
          [100, 0],
          [100, 100],
        ],
        routedData("border"),
      ),
    ];
    const meta = smoothStrataRoutedEdges(skeleton, [card]);
    expect(meta.cornersRounded).toBe(0);
    expect(meta.cornersBlocked).toBe(1);
    const pts = absPointsOf(skeleton[0]!);
    expect(pts).toEqual([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
  });

  it("stops rounding at the 16-point budget and counts the shortfall", () => {
    // Clockwise inward spiral: 10 points, 8 genuine same-sign corners (no
    // inflections, nothing collinear). Budget 16−10 = 6 chamfers; the last 2
    // corners are budget-skipped.
    const spiral: Pt[] = [
      [0, 0],
      [200, 0],
      [200, 200],
      [0, 200],
      [0, 40],
      [160, 40],
      [160, 160],
      [40, 160],
      [40, 80],
      [120, 80],
    ];
    const skeleton = [arrowOf(spiral, routedData("clip"))];
    const meta = smoothStrataRoutedEdges(skeleton, []);
    expect(meta.kinksRemoved).toBe(0);
    expect(meta.cornersRounded).toBe(6);
    expect(meta.cornersBudget).toBe(2);
    const pts = absPointsOf(skeleton[0]!);
    expect(pts.length).toBeLessThanOrEqual(STRATA_EDGE_SMOOTH_POINT_BUDGET);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([120, 80]);
  });
});

describe("smoothStrataRoutedEdges — roundness + provenance discipline", () => {
  it("forces roundness:null on processed records even when geometry is unchanged", () => {
    // A single clear right angle chamfers, but ALSO: a record whose points
    // need no change (straight with retained midpoint) still gets
    // roundness:null — the exact-path rendering IS the fix.
    const skeleton = [
      arrowOf(
        [
          [0, 0],
          [60, 0],
          [120, 0],
        ],
        routedData("channel"),
      ),
    ];
    const meta = smoothStrataRoutedEdges(skeleton, []);
    expect(meta.smoothed).toBe(1);
    expect((skeleton[0] as unknown as ArrowLike).roundness).toBeNull();
  });

  it('skips "style" records untouched (already exact-path per E1.1)', () => {
    const styleArrow = arrowOf(
      [
        [0, 0],
        [50, 10],
        [100, 0],
      ],
      routedData("style"),
    );
    const before = JSON.stringify(styleArrow);
    const skeleton = [styleArrow];
    const meta = smoothStrataRoutedEdges(skeleton, []);
    expect(meta.smoothed).toBe(0);
    expect(meta.skippedStyle).toBe(1);
    expect(skeleton[0]).toBe(styleArrow);
    expect(JSON.stringify(skeleton[0])).toBe(before);
  });

  it("never moves endpoints, never restamps provenance, never touches clip anchors", () => {
    const clipAnchor = {
      start: { frameKey: "s", side: "right" },
      end: { frameKey: "t", side: "left" },
    };
    const customData = routedData("clip", {
      terraformClipAnchor: clipAnchor,
      terraformClipLane: "above",
    });
    const skeleton = [
      arrowOf(
        [
          [10, 20],
          [80, 20],
          [80, 120],
          [300, 120],
          [300, 40],
          [400, 40],
        ],
        customData,
      ),
    ];
    const before = absPointsOf(skeleton[0]!);
    const meta = smoothStrataRoutedEdges(skeleton, []);
    expect(meta.smoothed).toBe(1);
    const el = skeleton[0] as unknown as ArrowLike;
    const after = absPointsOf(skeleton[0]!);
    // Endpoints byte-identical; origin never re-derived (points[0] fixed).
    expect(after[0]).toEqual(before[0]);
    expect(after[after.length - 1]).toEqual(before[before.length - 1]);
    expect(el.x).toBe(10);
    expect(el.y).toBe(20);
    expect(el.points[0]).toEqual([0, 0]);
    // customData rides through by reference — provenance/anchors untouched.
    expect(el.customData).toBe(customData);
    expect(el.customData!.terraformRoutedBy).toBe("clip");
    expect(el.customData!.terraformClipAnchor).toBe(clipAnchor);
    expect(el.customData!.terraformClipLane).toBe("above");
    expect(el.customData!.terraformRoutedPolyline).toBe(true);
  });

  it("recomputes width/height from the smoothed extents", () => {
    const skeleton = [
      arrowOf(
        [
          [0, 0],
          [100, 0],
          [100, 50],
          [200, 50],
        ],
        routedData("route"),
      ),
    ];
    smoothStrataRoutedEdges(skeleton, []);
    const el = skeleton[0] as unknown as ArrowLike;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of absPointsOf(skeleton[0]!)) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    expect(el.width).toBe(maxX - minX);
    expect(el.height).toBe(maxY - minY);
  });
});

describe("smoothStrataRoutedEdges — floors and skips", () => {
  it("keeps ≥3 points: a fully-collinear polyline retains one interior midpoint", () => {
    const skeleton = [
      arrowOf(
        [
          [0, 0],
          [30, 0],
          [70, 0],
          [100, 0],
        ],
        routedData("channel"),
      ),
    ];
    const meta = smoothStrataRoutedEdges(skeleton, []);
    expect(meta.midpointRetained).toBe(1);
    const pts = absPointsOf(skeleton[0]!);
    expect(pts).toEqual([
      [0, 0],
      [50, 0],
      [100, 0],
    ]);
    expect((skeleton[0] as unknown as ArrowLike).roundness).toBeNull();
  });

  it("skips unstamped arrows and degenerate 2-point stamped records untouched", () => {
    const chord = arrowOf(
      [
        [0, 0],
        [100, 100],
      ],
      { terraformEdgeLayer: "declaredDataFlow" },
    );
    const twoPoint = arrowOf(
      [
        [0, 0],
        [100, 0],
      ],
      routedData("clip"),
      "edge-2",
    );
    const unknownProvenance = arrowOf(
      [
        [0, 0],
        [50, 40],
        [100, 0],
      ],
      routedData("clip", { terraformRoutedBy: "mystery" }),
      "edge-3",
    );
    const skeleton = [chord, twoPoint, unknownProvenance];
    const meta = smoothStrataRoutedEdges(skeleton, []);
    expect(meta.smoothed).toBe(0);
    expect(meta.skippedUnrouted).toBe(2);
    expect(skeleton[0]).toBe(chord);
    expect(skeleton[1]).toBe(twoPoint);
    expect(skeleton[2]).toBe(unknownProvenance);
  });

  it("counts pointsBefore/pointsAfter across processed edges", () => {
    const skeleton = [
      arrowOf(
        [
          [0, 0],
          [100, 0],
          [100, 50],
          [200, 50],
        ],
        routedData("route"),
      ),
      arrowOf(
        [
          [0, 200],
          [50, 200],
          [100, 200],
        ],
        routedData("channel"),
        "edge-2",
      ),
    ];
    const meta = smoothStrataRoutedEdges(skeleton, []);
    expect(meta.pointsBefore).toBe(7);
    expect(meta.pointsAfter).toBe(
      absPointsOf(skeleton[0]!).length + absPointsOf(skeleton[1]!).length,
    );
  });
});
