/**
 * Unit tests for the loop-2 container-boundary CLIP pass —
 * terraformPipelineStrataEdgeClip.ts — and its typed repair gate in
 * terraformVisibility.ts.
 *
 * Coverage: endpoints exactly ON the source-frame RIGHT face / target-frame
 * LEFT face (the clip), write-back re-origin (points[0] === [0,0]), horizontal
 * tangent departures/arrivals, perpendicular hull port-chain crossings on the
 * correct faces (never top/bottom), per-face port ordering + ≥12px separation
 * across 3 edges sharing a face, same-column skips (byte-identical,
 * unstamped), E2.4 over-the-top lanes (cross-band X-overlap + net-backward
 * edges: above/below selection, lane never enters a hull, deterministic
 * stable-by-id lane allocation with 16px stacking), E2.3 gutter nudging
 * (≥12px track separation at the 25%/75% waypoint columns), and the repair
 * gate: a VALID clip polyline (including a lane polyline) survives
 * `repairTerraformEdgeBindings` with provenance intact while a STALE one
 * (frame moved → >2px face miss) or a foreign-frame anchor is flattened and
 * stripped (fail-closed).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataEdgeClip.test.ts --exclude "**\/.claude/**"
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  STRATA_CLIP_LANE_CLEARANCE_PX,
  STRATA_CLIP_LANE_SEPARATION_PX,
  STRATA_CLIP_PORT_INSET_PX,
  STRATA_CLIP_PORT_SEPARATION_PX,
  assignFacePorts,
  routeStrataEdgeClip,
} from "./terraformPipelineStrataEdgeClip";
import {
  createTerraformEdgeRepairStats,
  repairTerraformEdgeBindings,
} from "./terraformVisibility";
import { STRATA_HULL_POLICY } from "./terraformPipelineStrataTypes";

import type {
  StrataBox,
  StrataHullNode,
  StrataModel,
  StrataPlacementResult,
} from "./terraformPipelineStrataTypes";

type Pt = readonly [number, number];

const box = (
  x: number,
  y: number,
  width: number,
  height: number,
): StrataBox => ({ x, y, width, height });

const hull = (
  id: string,
  path: string[],
  leaves: string[],
  children: StrataHullNode[] = [],
): StrataHullNode => ({
  id,
  role: "vpc",
  policy: STRATA_HULL_POLICY.vpc,
  path,
  children,
  leafClusterIds: leaves,
});

const tfdArrow = (
  source: string,
  target: string,
  start: Pt,
  end: Pt,
  customData: Record<string, unknown> = {},
): ExcalidrawElementSkeleton =>
  ({
    type: "arrow",
    id: `arrow-${source}-${target}`,
    x: start[0],
    y: start[1],
    width: Math.abs(end[0] - start[0]),
    height: Math.abs(end[1] - start[1]),
    points: [
      [0, 0],
      [end[0] - start[0], end[1] - start[1]],
    ],
    customData: {
      terraform: true,
      terraformEdgeLayer: "declaredDataFlow",
      relationship: { source, target, directed: true },
      ...customData,
    },
  } as unknown as ExcalidrawElementSkeleton);

const absPointsOf = (el: ExcalidrawElementSkeleton): Pt[] => {
  const a = el as unknown as { x: number; y: number; points: Pt[] };
  return a.points.map(([px, py]) => [a.x + px, a.y + py]);
};

const isAxisAligned = (poly: readonly Pt[]): boolean => {
  const EPS = 1e-6;
  for (let i = 0; i + 1 < poly.length; i++) {
    const dx = Math.abs(poly[i + 1]![0] - poly[i]![0]);
    const dy = Math.abs(poly[i + 1]![1] - poly[i]![1]);
    if (dx > EPS && dy > EPS) {
      return false;
    }
  }
  return true;
};

/** Ys at which the polyline crosses the vertical line x=faceX (horizontal
 * segments spanning it only — a perpendicular crossing). */
const horizontalCrossingsAt = (
  poly: readonly Pt[],
  faceX: number,
): number[] => {
  const EPS = 1e-6;
  const ys: number[] = [];
  for (let i = 0; i + 1 < poly.length; i++) {
    const [x0, y0] = poly[i]!;
    const [x1, y1] = poly[i + 1]!;
    if (Math.abs(y1 - y0) <= EPS) {
      const lo = Math.min(x0, x1);
      const hi = Math.max(x0, x1);
      if (lo < faceX - EPS && hi > faceX + EPS) {
        ys.push(y0);
      }
    }
  }
  return ys;
};

/** Does any segment cross the horizontal border y=lineY within [x0,x1]? */
const crossesHorizontalBorder = (
  poly: readonly Pt[],
  lineY: number,
  x0: number,
  x1: number,
): boolean => {
  const EPS = 1e-6;
  for (let i = 0; i + 1 < poly.length; i++) {
    const [ax, ay] = poly[i]!;
    const [bx, by] = poly[i + 1]!;
    if (Math.abs(bx - ax) <= EPS) {
      const lo = Math.min(ay, by);
      const hi = Math.max(ay, by);
      if (lo < lineY - EPS && hi > lineY + EPS && ax >= x0 && ax <= x1) {
        return true;
      }
    }
  }
  return false;
};

const modelOf = (root: StrataHullNode): StrataModel =>
  ({
    clusters: new Map(),
    hullRoot: root,
    edges: [],
    selfLoops: [],
    addressOf: (id: string) => id,
  } as unknown as StrataModel);

const placementOf = (
  leafBoxes: Map<string, StrataBox>,
  boxedHulls: Map<string, { hull: StrataHullNode; box: StrataBox }>,
): StrataPlacementResult =>
  ({
    boxedHulls: new Map(
      [...boxedHulls.entries()].map(([id, v]) => [
        id,
        { ...v, placed: [] as const },
      ]),
    ),
    leafBoxes,
  } as unknown as StrataPlacementResult);

/** Two-column fixture: root → hull-a(a1) / hull-b(b1). a1 (0,0,80,40) in
 * column 0, b1 (400,120,80,40) in column 1. */
const basicFixture = () => {
  const root = hull("__root__", [], []);
  const a = hull("hull-a", ["vpc-a"], ["a1"]);
  const b = hull("hull-b", ["vpc-b"], ["b1"]);
  root.children = [a, b];
  const leafBoxes = new Map<string, StrataBox>([
    ["a1", box(0, 0, 80, 40)],
    ["b1", box(400, 120, 80, 40)],
  ]);
  const boxedHulls = new Map([
    ["__root__", { hull: root, box: box(-40, -40, 600, 240) }],
    ["hull-a", { hull: a, box: box(-20, -20, 120, 80) }],
    ["hull-b", { hull: b, box: box(380, 100, 120, 80) }],
  ]);
  return { root, leafBoxes, boxedHulls };
};

describe("routeStrataEdgeClip (scene pass)", () => {
  it("clips a net-forward edge ON the frame borders: origin on the source R face, terminus on the target L face, re-origined at points[0]===[0,0]", () => {
    const { root, leafBoxes, boxedHulls } = basicFixture();
    const skeleton = [tfdArrow("a1", "b1", [80, 20], [400, 140])];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.clipped).toBe(1);
    expect(meta.skippedBackward).toBe(0);
    expect(meta.skippedSameColumn).toBe(0);
    // 4 faces got ports: a1 R, hull-a R, hull-b L, b1 L.
    expect(meta.portFaces).toBe(4);

    const el = skeleton[0] as unknown as {
      x: number;
      y: number;
      points: Pt[];
      customData: Record<string, unknown>;
    };
    const abs = absPointsOf(skeleton[0]!);
    // ORIGIN exactly ON the source frame's RIGHT face (x = 0 + 80).
    expect(abs[0]![0]).toBe(80);
    expect(abs[0]![1]).toBeGreaterThanOrEqual(0);
    expect(abs[0]![1]).toBeLessThanOrEqual(40);
    // TERMINUS exactly ON the target frame's LEFT face (x = 400).
    expect(abs[abs.length - 1]![0]).toBe(400);
    expect(abs[abs.length - 1]![1]).toBeGreaterThanOrEqual(120);
    expect(abs[abs.length - 1]![1]).toBeLessThanOrEqual(160);
    // Write-back re-origin: el.x/el.y anchor the first point, points[0]=[0,0].
    expect(el.x).toBe(80);
    expect(el.points[0]).toEqual([0, 0]);
    // Manhattan geometry throughout.
    expect(abs.length).toBeGreaterThan(2);
    expect(isAxisAligned(abs)).toBe(true);
    // Stamp + typed anchors.
    expect(el.customData.terraformRoutedPolyline).toBe(true);
    expect(el.customData.terraformRoutedBy).toBe("clip");
    expect(el.customData.terraformClipAnchor).toEqual({
      start: { frameKey: "a1", side: "right" },
      end: { frameKey: "b1", side: "left" },
    });
  });

  it("pins departure/arrival tangents horizontal with stubs outside each clip face", () => {
    const { root, leafBoxes, boxedHulls } = basicFixture();
    const skeleton = [tfdArrow("a1", "b1", [80, 20], [400, 140])];
    routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    const abs = absPointsOf(skeleton[0]!);
    // Departure: first segment is horizontal, heading RIGHT (out of the R face).
    expect(abs[1]![1]).toBe(abs[0]![1]);
    expect(abs[1]![0]).toBeGreaterThan(abs[0]![0]);
    // Arrival: last segment is horizontal, heading RIGHT (into the L face).
    const n = abs.length;
    expect(abs[n - 2]![1]).toBe(abs[n - 1]![1]);
    expect(abs[n - 2]![0]).toBeLessThan(abs[n - 1]![0]);
  });

  it("crosses each intermediate hull perpendicular on the correct face (source R, target L) and never through top/bottom", () => {
    const { root, leafBoxes, boxedHulls } = basicFixture();
    const skeleton = [tfdArrow("a1", "b1", [80, 20], [400, 140])];
    routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    const abs = absPointsOf(skeleton[0]!);
    const hullA = boxedHulls.get("hull-a")!.box; // R face x=100, Y [-20,60]
    const hullB = boxedHulls.get("hull-b")!.box; // L face x=380, Y [100,180]
    // Perpendicular (horizontal) crossing of hull-a's RIGHT face, inside its
    // Y-extent.
    const aCross = horizontalCrossingsAt(abs, hullA.x + hullA.width);
    expect(aCross.length).toBeGreaterThan(0);
    for (const y of aCross) {
      expect(y).toBeGreaterThanOrEqual(hullA.y);
      expect(y).toBeLessThanOrEqual(hullA.y + hullA.height);
    }
    // Perpendicular crossing of hull-b's LEFT face, inside its Y-extent.
    const bCross = horizontalCrossingsAt(abs, hullB.x);
    expect(bCross.length).toBeGreaterThan(0);
    for (const y of bCross) {
      expect(y).toBeGreaterThanOrEqual(hullB.y);
      expect(y).toBeLessThanOrEqual(hullB.y + hullB.height);
    }
    // NEVER through a top/bottom face of either hull.
    for (const h of [hullA, hullB]) {
      expect(crossesHorizontalBorder(abs, h.y, h.x, h.x + h.width)).toBe(false);
      expect(
        crossesHorizontalBorder(abs, h.y + h.height, h.x, h.x + h.width),
      ).toBe(false);
    }
  });

  it("orders 3 ports sharing one face by the opposite endpoint's y and spreads them ≥12px apart inside the corner inset", () => {
    const root = hull("__root__", [], []);
    // Tall source cluster so the shared R face can hold 3 separated ports.
    const a = hull("hull-a", ["vpc-a"], ["a1"]);
    const b = hull("hull-b", ["vpc-b"], ["b1", "b2", "b3"]);
    root.children = [a, b];
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 0, 80, 200)],
      ["b1", box(400, 280, 80, 40)], // desired y 300
      ["b2", box(400, 80, 80, 40)], // desired y 100
      ["b3", box(400, 480, 80, 40)], // desired y 500
    ]);
    const boxedHulls = new Map([
      ["__root__", { hull: root, box: box(-40, -40, 600, 600) }],
      ["hull-a", { hull: a, box: box(-20, -20, 120, 260) }],
      ["hull-b", { hull: b, box: box(380, 60, 120, 480) }],
    ]);
    const skeleton = [
      tfdArrow("a1", "b1", [80, 100], [400, 300]),
      tfdArrow("a1", "b2", [80, 100], [400, 100]),
      tfdArrow("a1", "b3", [80, 100], [400, 500]),
    ];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.clipped).toBe(3);
    expect(meta.maxPortsOnFace).toBe(3);

    // All three originate ON the a1 R face (x=80) at DISTINCT ys, ordered by
    // the target's y: b2 (100) < b1 (300) < b3 (500).
    const yOf = (i: number) => absPointsOf(skeleton[i]!)[0]![1];
    const yB1 = yOf(0);
    const yB2 = yOf(1);
    const yB3 = yOf(2);
    for (const i of [0, 1, 2]) {
      expect(absPointsOf(skeleton[i]!)[0]![0]).toBe(80);
    }
    expect(yB2).toBeLessThan(yB1);
    expect(yB1).toBeLessThan(yB3);
    // ≥12px separation between adjacent ports.
    expect(yB1 - yB2).toBeGreaterThanOrEqual(STRATA_CLIP_PORT_SEPARATION_PX);
    expect(yB3 - yB1).toBeGreaterThanOrEqual(STRATA_CLIP_PORT_SEPARATION_PX);
    // Inside the 20px corner inset of the face [0, 200].
    for (const y of [yB1, yB2, yB3]) {
      expect(y).toBeGreaterThanOrEqual(20);
      expect(y).toBeLessThanOrEqual(180);
    }
  });

  it("skips same-column edges byte-identically (unstamped — the style-pass orbit owns them)", () => {
    const root = hull("__root__", [], []);
    const a = hull("hull-a", ["vpc-a"], ["a1", "a2"]);
    const b = hull("hull-b", ["vpc-b"], ["b1"]);
    root.children = [a, b];
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 0, 80, 40)],
      ["a2", box(0, 200, 80, 40)],
      ["b1", box(400, 120, 80, 40)],
    ]);
    const boxedHulls = new Map([
      ["__root__", { hull: root, box: box(-40, -40, 600, 320) }],
      ["hull-a", { hull: a, box: box(-20, -20, 120, 300) }],
      ["hull-b", { hull: b, box: box(380, 100, 120, 80) }],
    ]);
    const sameColumn = tfdArrow("a1", "a2", [40, 40], [40, 200]);
    const beforeSameColumn = JSON.stringify(sameColumn);
    const skeleton = [sameColumn];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.clipped).toBe(0);
    expect(meta.skippedSameColumn).toBe(1);
    expect(JSON.stringify(skeleton[0])).toBe(beforeSameColumn);
  });

  it("skips an edge already stamped by another pass (first-stamper-wins)", () => {
    const { root, leafBoxes, boxedHulls } = basicFixture();
    const original = tfdArrow("a1", "b1", [80, 20], [400, 140], {
      terraformRoutedPolyline: true,
      terraformRoutedBy: "channel",
    });
    const before = JSON.stringify(original);
    const skeleton = [original];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.clipped).toBe(0);
    expect(meta.skippedAlreadyRouted).toBe(1);
    expect(JSON.stringify(skeleton[0])).toBe(before);
  });
});

// ── E2.4 over-the-top lanes + E2.3 gutter nudging ───────────────────────────

/** Does the axis-aligned segment a→b overlap the STRICT interior of box r? */
const segmentEntersInterior = (a: Pt, b: Pt, r: StrataBox): boolean => {
  const EPS = 1e-6;
  const ix0 = Math.max(Math.min(a[0], b[0]), r.x);
  const ix1 = Math.min(Math.max(a[0], b[0]), r.x + r.width);
  const iy0 = Math.max(Math.min(a[1], b[1]), r.y);
  const iy1 = Math.min(Math.max(a[1], b[1]), r.y + r.height);
  if (ix0 > ix1 || iy0 > iy1) {
    return false;
  }
  const midX = (ix0 + ix1) / 2;
  const midY = (iy0 + iy1) / 2;
  return (
    midX > r.x + EPS &&
    midX < r.x + r.width - EPS &&
    midY > r.y + EPS &&
    midY < r.y + r.height - EPS &&
    (ix1 - ix0 > EPS || iy1 - iy0 > EPS)
  );
};

const polylineEntersBox = (poly: readonly Pt[], r: StrataBox): boolean => {
  for (let i = 0; i + 1 < poly.length; i++) {
    if (segmentEntersInterior(poly[i]!, poly[i + 1]!, r)) {
      return true;
    }
  }
  return false;
};

/** Three side-by-side single-leaf hulls in one band — the backward edge
 * b1→a1 must fly a lane OVER hull-mid, never through it. */
const backwardFixture = () => {
  const root = hull("__root__", [], []);
  const a = hull("hull-a", ["vpc-a"], ["a1"]);
  const mid = hull("hull-mid", ["vpc-mid"], ["m1"]);
  const b = hull("hull-b", ["vpc-b"], ["b1"]);
  root.children = [a, mid, b];
  const leafBoxes = new Map<string, StrataBox>([
    ["a1", box(0, 0, 80, 40)],
    ["m1", box(200, 0, 80, 40)],
    ["b1", box(400, 0, 80, 40)],
  ]);
  const boxedHulls = new Map([
    ["hull-a", { hull: a, box: box(-20, -20, 120, 80) }],
    ["hull-mid", { hull: mid, box: box(180, -20, 120, 80) }],
    ["hull-b", { hull: b, box: box(380, -20, 120, 80) }],
  ]);
  return { root, leafBoxes, boxedHulls };
};

describe("routeStrataEdgeClip — E2.4 lanes + E2.3 gutter nudging", () => {
  it("routes a net-backward edge over an ABOVE lane: source R-face egress, target L-face ingress, lane clear of every hull", () => {
    const { root, leafBoxes, boxedHulls } = backwardFixture();
    const skeleton = [tfdArrow("b1", "a1", [400, 20], [80, 20])];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.clipped).toBe(1);
    expect(meta.skippedBackward).toBe(0);
    expect(meta.laneEdges).toBe(1);
    expect(meta.laneBackward).toBe(1);
    expect(meta.laneAbove).toBe(1);
    expect(meta.laneBelow).toBe(0);
    expect(meta.laneFallback).toBe(0);

    const el = skeleton[0] as unknown as {
      customData: Record<string, unknown>;
    };
    expect(el.customData.terraformRoutedPolyline).toBe(true);
    expect(el.customData.terraformRoutedBy).toBe("clip");
    expect(el.customData.terraformClipLane).toBe("above");
    expect(el.customData.terraformClipAnchor).toEqual({
      start: { frameKey: "b1", side: "right" },
      end: { frameKey: "a1", side: "left" },
    });

    const abs = absPointsOf(skeleton[0]!);
    expect(isAxisAligned(abs)).toBe(true);
    // Side discipline: origin ON the source leaf's RIGHT face, terminus ON
    // the target leaf's LEFT face — same ports the repair gate validates.
    expect(abs[0]![0]).toBe(480);
    expect(abs[abs.length - 1]![0]).toBe(0);
    // The lane rides ABOVE the union of every transited hull:
    // laneY = unionTop − 24 (laneIndex 0).
    const minY = Math.min(...abs.map((p) => p[1]));
    expect(minY).toBe(-20 - STRATA_CLIP_LANE_CLEARANCE_PX);
    // The lane NEVER enters any hull — in particular not the sibling band
    // hull-mid it flies over (the box a chord would pierce).
    for (const key of ["hull-a", "hull-mid", "hull-b"] as const) {
      const h = boxedHulls.get(key)!.box;
      expect(
        crossesHorizontalBorder(abs, h.y, h.x, h.x + h.width),
        `${key} top border pierced`,
      ).toBe(false);
      expect(
        crossesHorizontalBorder(abs, h.y + h.height, h.x, h.x + h.width),
        `${key} bottom border pierced`,
      ).toBe(false);
    }
    expect(polylineEntersBox(abs, boxedHulls.get("hull-mid")!.box)).toBe(false);
    expect(polylineEntersBox(abs, leafBoxes.get("m1")!)).toBe(false);
  });

  it("keeps a cross-band edge on the Z-detour when the Z is measurably clear (no lane needed)", () => {
    // Two X-disjoint bands with a clean gap between them: the Z's verticals
    // sit outside both boxes and its horizontal rides the band gap — no lane.
    const { root, leafBoxes, boxedHulls } = basicFixture();
    const skeleton = [tfdArrow("a1", "b1", [80, 20], [400, 140])];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.clipped).toBe(1);
    expect(meta.laneEdges).toBe(0);
    expect(meta.laneFallback).toBe(0);
    const el = skeleton[0] as unknown as {
      customData: Record<string, unknown>;
    };
    expect(el.customData.terraformClipLane).toBeUndefined();
    const abs = absPointsOf(skeleton[0]!);
    // Still clip-disciplined and clean: no top/bottom border crossing.
    expect(abs[0]![0]).toBe(80);
    expect(abs[abs.length - 1]![0]).toBe(400);
    for (const key of ["hull-a", "hull-b"] as const) {
      const h = boxedHulls.get(key)!.box;
      expect(crossesHorizontalBorder(abs, h.y, h.x, h.x + h.width)).toBe(false);
      expect(
        crossesHorizontalBorder(abs, h.y + h.height, h.x, h.x + h.width),
      ).toBe(false);
    }
  });

  it("routes a cross-band X-OVERLAP forward edge through the INTER-BAND strip (E3.2 — no longer over the whole union)", () => {
    // hull-a is a wide top band whose X-extent overlaps hull-b's (the bottom
    // band); sibling band hull-c sits exactly where the Z-detour's first
    // vertical would run — the edge must lane instead. E3.2 strip selection
    // finds the genuine inter-band gap between hull-a's bottom (60) and
    // hull-c's top (90) — closer to both ports than E2.4's over-the-top
    // settle (laneY −44) and equally crossing-free.
    const root = hull("__root__", [], []);
    const a = hull("hull-a", ["vpc-a"], ["a1"]);
    const c = hull("hull-c", ["vpc-c"], ["c1"]);
    const b = hull("hull-b", ["vpc-b"], ["b1"]);
    root.children = [a, c, b];
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 0, 80, 40)],
      ["c1", box(320, 110, 80, 40)],
      ["b1", box(400, 220, 80, 40)],
    ]);
    const boxedHulls = new Map([
      ["hull-a", { hull: a, box: box(-20, -20, 520, 80) }],
      ["hull-c", { hull: c, box: box(300, 90, 300, 90) }],
      ["hull-b", { hull: b, box: box(380, 200, 120, 80) }],
    ]);
    const skeleton = [tfdArrow("a1", "b1", [80, 20], [400, 240])];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.clipped).toBe(1);
    expect(meta.laneEdges).toBe(1);
    expect(meta.laneAbove).toBe(1);
    expect(meta.laneBackward).toBe(0);
    expect(meta.laneFallback).toBe(0);
    const el = skeleton[0] as unknown as {
      customData: Record<string, unknown>;
    };
    expect(el.customData.terraformClipLane).toBe("above");

    const abs = absPointsOf(skeleton[0]!);
    expect(isAxisAligned(abs)).toBe(true);
    expect(abs[0]![0]).toBe(80); // a1 R face
    expect(abs[abs.length - 1]![0]).toBe(400); // b1 L face
    // E3.2: the lane's travel sits INSIDE the inter-band strip (60, 90) —
    // centred at 75 — and the polyline never flies above the union (the old
    // E2.4 settle put it at unionTop − 24 = −44).
    const horizontalYs = new Set<number>();
    for (let i = 0; i + 1 < abs.length; i++) {
      const [x0, y0] = abs[i]!;
      const [x1, y1] = abs[i + 1]!;
      if (Math.abs(y1 - y0) < 1e-6 && Math.abs(x1 - x0) > 1) {
        horizontalYs.add(y0);
      }
    }
    expect(horizontalYs.has(75)).toBe(true);
    expect(Math.min(...abs.map((p) => p[1]))).toBeGreaterThan(-20);
    // No top/bottom border crossing on any band, and the sibling band the
    // Z-detour would have pierced is never entered.
    for (const key of ["hull-a", "hull-b", "hull-c"] as const) {
      const h = boxedHulls.get(key)!.box;
      expect(crossesHorizontalBorder(abs, h.y, h.x, h.x + h.width)).toBe(false);
      expect(
        crossesHorizontalBorder(abs, h.y + h.height, h.x, h.x + h.width),
      ).toBe(false);
    }
    expect(polylineEntersBox(abs, boxedHulls.get("hull-c")!.box)).toBe(false);
  });

  it("ORBITS the shared top-level unit when an in-hull lane is impossible: legal side-face exit/re-entry, staircase offsets, no hull entered", () => {
    // Both endpoints live under one top-level hull P whose three bands TILE
    // its interior gaplessly in Y and span nearly its full width — no
    // inter-band strip exists inside P and the open strips above/below sit
    // OUTSIDE P (laneFits rejects them), so E3.2 strip placement fails. The
    // lane must ride AROUND P: out its RIGHT face, over its top, back in its
    // LEFT face.
    const root = hull("__root__", [], []);
    const p = hull("P", ["prov"], []);
    const a = hull("hull-a", ["prov", "band-a"], ["a1"]);
    const c = hull("hull-c", ["prov", "band-c"], ["c1"]);
    const b = hull("hull-b", ["prov", "band-b"], ["b1"]);
    p.children = [a, c, b];
    root.children = [p];
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 0, 80, 40)],
      ["c1", box(0, 110, 80, 40)],
      ["b1", box(400, 220, 80, 40)],
    ]);
    const boxedHulls = new Map([
      ["P", { hull: p, box: box(-40, -40, 700, 340) }],
      ["hull-a", { hull: a, box: box(-36, -36, 692, 112) }],
      ["hull-c", { hull: c, box: box(-36, 76, 692, 112) }],
      ["hull-b", { hull: b, box: box(-36, 188, 692, 108) }],
    ]);
    const skeleton = [tfdArrow("a1", "b1", [80, 20], [400, 240])];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.clipped).toBe(1);
    expect(meta.laneEdges).toBe(1);
    expect(meta.laneAbove).toBe(1);
    expect(meta.laneFallback).toBe(0);
    const el = skeleton[0] as unknown as {
      customData: Record<string, unknown>;
    };
    expect(el.customData.terraformClipLane).toBe("above");

    const abs = absPointsOf(skeleton[0]!);
    const P = boxedHulls.get("P")!.box;
    // Orbit: lane above P (laneY = P.top − 24), riser beyond P's right face,
    // descender beyond its left face (staircase offset 24 at laneIndex 0).
    const minY = Math.min(...abs.map((p2) => p2[1]));
    expect(minY).toBe(P.y - STRATA_CLIP_LANE_CLEARANCE_PX);
    const maxX = Math.max(...abs.map((p2) => p2[0]));
    const minX = Math.min(...abs.map((p2) => p2[0]));
    expect(maxX).toBe(P.x + P.width + STRATA_CLIP_LANE_CLEARANCE_PX);
    expect(minX).toBe(P.x - STRATA_CLIP_LANE_CLEARANCE_PX);
    // Side discipline everywhere: NO top/bottom border crossing on P or any
    // band (P is exited/re-entered through its vertical faces only), and the
    // wide sibling band is never entered.
    for (const [, boxed] of boxedHulls) {
      const h = boxed.box;
      expect(crossesHorizontalBorder(abs, h.y, h.x, h.x + h.width)).toBe(false);
      expect(
        crossesHorizontalBorder(abs, h.y + h.height, h.x, h.x + h.width),
      ).toBe(false);
    }
    expect(polylineEntersBox(abs, boxedHulls.get("hull-c")!.box)).toBe(false);
  });

  it("picks a BELOW lane when the union's bottom is closer to both endpoints", () => {
    const root = hull("__root__", [], []);
    const a = hull("hull-a", ["vpc-a"], ["a1"]);
    const b = hull("hull-b", ["vpc-b"], ["b1"]);
    root.children = [a, b];
    // Tall hulls, leaves parked near the BOTTOM: both ports sit closer to the
    // union's bottom than its top.
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 220, 80, 40)],
      ["b1", box(400, 220, 80, 40)],
    ]);
    const boxedHulls = new Map([
      ["hull-a", { hull: a, box: box(-20, -20, 120, 300) }],
      ["hull-b", { hull: b, box: box(380, -20, 120, 300) }],
    ]);
    const skeleton = [tfdArrow("b1", "a1", [400, 240], [80, 240])];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.laneEdges).toBe(1);
    expect(meta.laneBelow).toBe(1);
    expect(meta.laneAbove).toBe(0);
    const el = skeleton[0] as unknown as {
      customData: Record<string, unknown>;
    };
    expect(el.customData.terraformClipLane).toBe("below");
    const abs = absPointsOf(skeleton[0]!);
    // laneY = unionBottom + 24 (laneIndex 0): union bottom = −20 + 300 = 280.
    const maxY = Math.max(...abs.map((p) => p[1]));
    expect(maxY).toBe(280 + STRATA_CLIP_LANE_CLEARANCE_PX);
    for (const key of ["hull-a", "hull-b"] as const) {
      const h = boxedHulls.get(key)!.box;
      expect(crossesHorizontalBorder(abs, h.y, h.x, h.x + h.width)).toBe(false);
      expect(
        crossesHorizontalBorder(abs, h.y + h.height, h.x, h.x + h.width),
      ).toBe(false);
    }
  });

  it("allocates laneIndex deterministically (stable by edge id, 16px stacking) regardless of skeleton order", () => {
    const buildFixture = () => {
      const root = hull("__root__", [], []);
      const a = hull("hull-a", ["vpc-a"], ["a1", "a2"]);
      const b = hull("hull-b", ["vpc-b"], ["b1", "b2"]);
      root.children = [a, b];
      const leafBoxes = new Map<string, StrataBox>([
        ["a1", box(0, 20, 80, 40)],
        ["a2", box(0, 80, 80, 40)],
        ["b1", box(400, 20, 80, 40)],
        ["b2", box(400, 80, 80, 40)],
      ]);
      const boxedHulls = new Map([
        ["hull-a", { hull: a, box: box(-20, -20, 120, 300) }],
        ["hull-b", { hull: b, box: box(380, -20, 120, 300) }],
      ]);
      return { root, leafBoxes, boxedHulls };
    };
    const minYOf = (el: ExcalidrawElementSkeleton): number =>
      Math.min(...absPointsOf(el).map((p) => p[1]));

    // Two X-overlapping backward lanes — laneIndex by edge id, 16px apart.
    const f1 = buildFixture();
    const first = [
      tfdArrow("b1", "a1", [400, 40], [80, 40]),
      tfdArrow("b2", "a2", [400, 100], [80, 100]),
    ];
    const meta1 = routeStrataEdgeClip(
      first,
      modelOf(f1.root),
      placementOf(f1.leafBoxes, f1.boxedHulls),
    );
    expect(meta1.laneEdges).toBe(2);
    const laneY1 = minYOf(first[0]!); // arrow-b1-a1 → laneIndex 0
    const laneY2 = minYOf(first[1]!); // arrow-b2-a2 → laneIndex 1
    expect(laneY1).toBe(-20 - STRATA_CLIP_LANE_CLEARANCE_PX);
    expect(laneY2).toBe(laneY1 - STRATA_CLIP_LANE_SEPARATION_PX);

    // Same edges, reversed skeleton order → identical lane Ys per edge id.
    const f2 = buildFixture();
    const reversed = [
      tfdArrow("b2", "a2", [400, 100], [80, 100]),
      tfdArrow("b1", "a1", [400, 40], [80, 40]),
    ];
    routeStrataEdgeClip(
      reversed,
      modelOf(f2.root),
      placementOf(f2.leafBoxes, f2.boxedHulls),
    );
    expect(minYOf(reversed[1]!)).toBe(laneY1); // b1→a1 unchanged
    expect(minYOf(reversed[0]!)).toBe(laneY2); // b2→a2 unchanged
  });

  it("spreads E2.3 gutter tracks ≥12px apart at the 25%/75% waypoint columns when mean-y ties collide", () => {
    const root = hull("__root__", [], []);
    const a = hull("hull-a", ["vpc-a"], ["a1", "a2", "a3"]);
    const b = hull("hull-b", ["vpc-b"], ["b1", "b2", "b3"]);
    root.children = [a, b];
    // Sources top→bottom, targets mirrored bottom→top: every edge's mid-
    // gutter mean y is identical (160) — the nudge must separate the tracks.
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 40, 80, 40)],
      ["a2", box(0, 140, 80, 40)],
      ["a3", box(0, 240, 80, 40)],
      ["b1", box(400, 240, 80, 40)],
      ["b2", box(400, 140, 80, 40)],
      ["b3", box(400, 40, 80, 40)],
    ]);
    const boxedHulls = new Map([
      ["hull-a", { hull: a, box: box(-20, -20, 120, 340) }],
      ["hull-b", { hull: b, box: box(380, -20, 120, 340) }],
    ]);
    const skeleton = [
      tfdArrow("a1", "b1", [80, 60], [400, 260]),
      tfdArrow("a2", "b2", [80, 160], [400, 160]),
      tfdArrow("a3", "b3", [80, 260], [400, 60]),
    ];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.clipped).toBe(3);
    expect(meta.laneEdges).toBe(0);

    // The mid gutter runs hull-a R (x=100) → hull-b L (x=380); its waypoint
    // columns sit at 25%/75% (rank-staggered inward) → the track is the
    // horizontal segment spanning the gutter's centre (x=240). Extract it
    // per edge.
    const trackOf = (el: ExcalidrawElementSkeleton): number => {
      const abs = absPointsOf(el);
      for (let i = 0; i + 1 < abs.length; i++) {
        const [x0, y0] = abs[i]!;
        const [x1, y1] = abs[i + 1]!;
        if (
          Math.abs(y1 - y0) < 1e-6 &&
          Math.min(x0, x1) <= 235 &&
          Math.max(x0, x1) >= 245
        ) {
          return y0;
        }
      }
      throw new Error("no mid-gutter track segment found");
    };
    const tracks = skeleton.map(trackOf);
    const sorted = [...tracks].sort((x, y) => x - y);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(
        STRATA_CLIP_PORT_SEPARATION_PX,
      );
    }
  });

  it("round-trips a BACKWARD lane polyline through the unchanged repair gate (kept under clip provenance)", () => {
    const { root, leafBoxes, boxedHulls } = backwardFixture();
    const skeleton = [tfdArrow("b1", "a1", [400, 20], [80, 20])];
    routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    const routed = skeleton[0] as unknown as {
      x: number;
      y: number;
      width: number;
      height: number;
      points: Pt[];
      customData: Record<string, unknown>;
    };
    const el = (o: Record<string, unknown>): ExcalidrawElement =>
      ({
        angle: 0,
        isDeleted: false,
        groupIds: [],
        frameId: null,
        boundElements: null,
        version: 1,
        versionNonce: 0,
        updated: 1,
        locked: false,
        opacity: 100,
        ...o,
      } as unknown as ExcalidrawElement);
    const elements: ExcalidrawElement[] = [
      el({
        id: "frame-b1",
        type: "frame",
        x: 400,
        y: 0,
        width: 80,
        height: 40,
        customData: {
          terraform: true,
          terraformTopologyRole: "primaryCluster",
          terraformTopologyKey: "frame-b1",
          terraformPrimaryAddress: "b1",
        },
      }),
      el({
        id: "frame-a1",
        type: "frame",
        x: 0,
        y: 0,
        width: 80,
        height: 40,
        customData: {
          terraform: true,
          terraformTopologyRole: "primaryCluster",
          terraformTopologyKey: "frame-a1",
          terraformPrimaryAddress: "a1",
        },
      }),
      el({
        id: "card-b1",
        type: "rectangle",
        x: 410,
        y: 5,
        width: 60,
        height: 30,
        customData: {
          terraform: true,
          terraformVisibilityRole: "resource",
          terraformVisibilityKey: "b1",
        },
      }),
      el({
        id: "card-a1",
        type: "rectangle",
        x: 10,
        y: 5,
        width: 60,
        height: 30,
        customData: {
          terraform: true,
          terraformVisibilityRole: "resource",
          terraformVisibilityKey: "a1",
        },
      }),
      el({
        id: "arrow-b1-a1",
        type: "arrow",
        x: routed.x,
        y: routed.y,
        width: routed.width,
        height: routed.height,
        points: routed.points,
        customData: routed.customData,
      }),
    ];
    const stats = createTerraformEdgeRepairStats();
    const out = repairTerraformEdgeBindings(elements, stats);
    const arrow = out.find((e) => e.id === "arrow-b1-a1") as
      | (ExcalidrawElement & { points: Pt[] })
      | undefined;
    expect(arrow).toBeDefined();
    expect(stats.keptBy.clip).toBe(1);
    expect(stats.routedFlattened).toBe(0);
    expect(arrow!.points.length).toBe(routed.points.length);
    expect(arrow!.customData?.terraformRoutedBy).toBe("clip");
    expect(arrow!.customData?.terraformClipLane).toBe("above");
  });
});

// ── Repair gate (terraformVisibility.ts typed "clip" extension) ─────────────

/** Element-time fixture: two leaf cluster frames (primaryCluster role +
 * terraformPrimaryAddress — the serialized key repair resolves), the two
 * resource CARD rects inside them (bindings stay on these), and one
 * clip-stamped polyline whose endpoints sit exactly ON the frame faces. */
const repairFixture = (opts?: {
  frameAX?: number;
  anchorStartKey?: string;
}) => {
  const frameAX = opts?.frameAX ?? 0;
  const el = (o: Record<string, unknown>): ExcalidrawElement =>
    ({
      angle: 0,
      isDeleted: false,
      groupIds: [],
      frameId: null,
      boundElements: null,
      version: 1,
      versionNonce: 0,
      updated: 1,
      locked: false,
      opacity: 100,
      ...o,
    } as unknown as ExcalidrawElement);
  const frameA = el({
    id: "frame-a1",
    type: "frame",
    x: frameAX,
    y: 0,
    width: 80,
    height: 40,
    customData: {
      terraform: true,
      terraformTopologyRole: "primaryCluster",
      terraformTopologyKey: "frame-a1",
      terraformPrimaryAddress: "a1",
    },
  });
  const frameB = el({
    id: "frame-b1",
    type: "frame",
    x: 400,
    y: 120,
    width: 80,
    height: 40,
    customData: {
      terraform: true,
      terraformTopologyRole: "primaryCluster",
      terraformTopologyKey: "frame-b1",
      terraformPrimaryAddress: "b1",
    },
  });
  const cardA = el({
    id: "card-a1",
    type: "rectangle",
    x: frameAX + 10,
    y: 5,
    width: 60,
    height: 30,
    customData: {
      terraform: true,
      terraformVisibilityRole: "resource",
      terraformVisibilityKey: "a1",
    },
  });
  const cardB = el({
    id: "card-b1",
    type: "rectangle",
    x: 410,
    y: 125,
    width: 60,
    height: 30,
    customData: {
      terraform: true,
      terraformVisibilityRole: "resource",
      terraformVisibilityKey: "b1",
    },
  });
  // Clip polyline: [80,20] (a1 R face at the UNMOVED frame) → stub → vertical
  // → [400,130] (b1 L face).
  const arrow = el({
    id: "arrow-a1-b1",
    type: "arrow",
    x: 80,
    y: 20,
    width: 320,
    height: 110,
    points: [
      [0, 0],
      [24, 0],
      [24, 110],
      [320, 110],
    ],
    customData: {
      terraform: true,
      terraformEdgeLayer: "declaredDataFlow",
      relationship: { source: "a1", target: "b1", directed: true },
      terraformRoutedPolyline: true,
      terraformRoutedBy: "clip",
      terraformClipAnchor: {
        start: {
          frameKey: opts?.anchorStartKey ?? "a1",
          side: "right" as const,
        },
        end: { frameKey: "b1", side: "left" as const },
      },
    },
  });
  return {
    elements: [frameA, frameB, cardA, cardB, arrow],
    arrowId: "arrow-a1-b1",
  };
};

const findArrow = (
  elements: readonly ExcalidrawElement[],
  id: string,
): ExcalidrawElement => {
  const found = elements.find((e) => e.id === id);
  expect(found).toBeDefined();
  return found!;
};

describe("repairTerraformEdgeBindings — typed clip gate", () => {
  it("KEEPS a valid clip polyline (endpoints on the live frame faces) with provenance intact, bindings on the leaf cards", () => {
    const { elements, arrowId } = repairFixture();
    const stats = createTerraformEdgeRepairStats();
    const out = repairTerraformEdgeBindings(elements, stats);
    const arrow = findArrow(out, arrowId) as ExcalidrawElement & {
      points: Pt[];
      startBinding?: { elementId: string };
      endBinding?: { elementId: string };
    };
    // Geometry preserved (4-point clip polyline, endpoints untouched).
    expect(arrow.points.length).toBe(4);
    expect(arrow.x).toBe(80);
    expect(arrow.y).toBe(20);
    // Stamp + anchors survive.
    expect(arrow.customData?.terraformRoutedPolyline).toBe(true);
    expect(arrow.customData?.terraformRoutedBy).toBe("clip");
    expect(arrow.customData?.terraformClipAnchor).toBeDefined();
    // Bindings REMAIN on the leaf cards (unchanged contract).
    expect(arrow.startBinding?.elementId).toBe("card-a1");
    expect(arrow.endBinding?.elementId).toBe("card-b1");
    // Telemetry: kept under the "clip" provenance.
    expect(stats.routedSeen).toBe(1);
    expect(stats.routedKept).toBe(1);
    expect(stats.keptBy.clip).toBe(1);
    expect(stats.routedFlattened).toBe(0);
    expect(stats.staleMarkersStripped).toBe(0);
  });

  it("FLATTENS a stale clip polyline (frame moved → endpoint misses the live face by >2px) and strips marker + anchors", () => {
    // Frame A moved 300px right; the serialized endpoint at x=80 now misses
    // the live R face (x=380) by 300px — far beyond the 2px face tolerance.
    const { elements, arrowId } = repairFixture({ frameAX: 300 });
    const stats = createTerraformEdgeRepairStats();
    const out = repairTerraformEdgeBindings(elements, stats);
    const arrow = findArrow(out, arrowId) as ExcalidrawElement & {
      points: Pt[];
    };
    // Flattened to the standard 2-point chord.
    expect(arrow.points.length).toBe(2);
    // Marker AND clip anchors stripped (self-healing, fail-closed).
    expect(arrow.customData?.terraformRoutedPolyline).toBeUndefined();
    expect(arrow.customData?.terraformRoutedBy).toBeUndefined();
    expect(arrow.customData?.terraformClipAnchor).toBeUndefined();
    // Telemetry: flattened under the "clip" provenance + stale strip.
    expect(stats.routedSeen).toBe(1);
    expect(stats.routedFlattened).toBe(1);
    expect(stats.flattenedBy.clip).toBe(1);
    expect(stats.staleMarkersStripped).toBe(1);
  });

  it("FLATTENS a clip polyline whose anchor names a frame that is NOT the endpoint's own cluster (ancestry check)", () => {
    // The anchor claims the START clips to "b1"'s frame — a foreign frame for
    // the a1 endpoint. Even if some face happened to align geometrically, the
    // frameKey === relationship-endpoint identity check fails closed.
    const { elements, arrowId } = repairFixture({ anchorStartKey: "b1" });
    const stats = createTerraformEdgeRepairStats();
    const out = repairTerraformEdgeBindings(elements, stats);
    const arrow = findArrow(out, arrowId) as ExcalidrawElement & {
      points: Pt[];
    };
    expect(arrow.points.length).toBe(2);
    expect(arrow.customData?.terraformRoutedPolyline).toBeUndefined();
    expect(arrow.customData?.terraformClipAnchor).toBeUndefined();
    expect(stats.flattenedBy.clip).toBe(1);
  });

  it("round-trips a scene-pass clip polyline through repair unchanged (pass → gate integration)", () => {
    // Route with the SCENE pass, then hand the stamped arrow to repair with
    // frames/cards whose geometry matches the placement — repair must keep it.
    const { root, leafBoxes, boxedHulls } = basicFixture();
    const skeleton = [tfdArrow("a1", "b1", [80, 20], [400, 140])];
    routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    const routed = skeleton[0] as unknown as {
      x: number;
      y: number;
      width: number;
      height: number;
      points: Pt[];
      customData: Record<string, unknown>;
    };
    const { elements } = repairFixture();
    // Swap the fixture arrow's geometry for the scene pass's real output.
    const arrowIdx = elements.findIndex((e) => e.id === "arrow-a1-b1");
    elements[arrowIdx] = {
      ...elements[arrowIdx]!,
      x: routed.x,
      y: routed.y,
      width: routed.width,
      height: routed.height,
      points: routed.points,
      customData: routed.customData,
    } as unknown as ExcalidrawElement;
    const stats = createTerraformEdgeRepairStats();
    const out = repairTerraformEdgeBindings(elements, stats);
    const arrow = findArrow(out, "arrow-a1-b1") as ExcalidrawElement & {
      points: Pt[];
    };
    expect(stats.keptBy.clip).toBe(1);
    expect(arrow.points.length).toBe(routed.points.length);
    expect(arrow.customData?.terraformRoutedBy).toBe("clip");
  });
});

// ── Loop-2 P1b: lane vs RENDERED-frame extents (strict interior) ─────────────
//
// The clip pass's lane clearance obstacles ARE the rendered frame extents: the
// scene emits every leaf-cluster / hull frame DIRECTLY at its
// `placement.leafBoxes` / `placement.boxedHulls` box (byte-identical emission —
// terraformPipelineStrataSceneBuild.ts; verified on the owner preset the
// emitted+converted rect equals the placement box to the pixel). So when a
// foreign frame is inside the lane's obstacle context, the settled lane clears
// its FULL rendered extent — 0 strict-interior violations. (E3.2 closed the
// remaining obstacle-SELECTION gap: lane strips, orbit pieces and dirty
// gutter columns all clear against the FULL box set now; the real-preset
// scoreboard probe asserts zero lane-vs-leaf-frame violations permanently.)
describe("routeStrataEdgeClip — lane clears rendered-frame extents (P1b)", () => {
  /** One band of five single-leaf hulls of VARYING height. A backward edge
   * e1→a1 must fly an above-lane over m1/m2/m3 — every one an in-context foreign
   * frame whose full rendered extent (== its placement leafBox) the lane clears. */
  const laneBandFixture = () => {
    const root = hull("__root__", [], []);
    const a = hull("hull-a", ["vpc-a"], ["a1"]);
    const m1h = hull("hull-m1", ["vpc-m1"], ["m1"]);
    const m2h = hull("hull-m2", ["vpc-m2"], ["m2"]);
    const m3h = hull("hull-m3", ["vpc-m3"], ["m3"]);
    const e = hull("hull-e", ["vpc-e"], ["e1"]);
    root.children = [a, m1h, m2h, m3h, e];
    // Leaf frames at varying heights so the lane must clear a non-uniform
    // skyline (its union top drives laneY).
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 40, 80, 40)],
      ["m1", box(200, 0, 80, 120)], // tallest
      ["m2", box(400, 30, 80, 60)],
      ["m3", box(600, 10, 80, 100)],
      ["e1", box(800, 40, 80, 40)],
    ]);
    const boxedHulls = new Map([
      ["hull-a", { hull: a, box: box(-20, 20, 120, 80) }],
      ["hull-m1", { hull: m1h, box: box(180, -20, 120, 160) }],
      ["hull-m2", { hull: m2h, box: box(380, 10, 120, 100) }],
      ["hull-m3", { hull: m3h, box: box(580, -10, 120, 140) }],
      ["hull-e", { hull: e, box: box(780, 20, 120, 80) }],
    ]);
    return { root, leafBoxes, boxedHulls };
  };

  it("an over-the-top lane strictly clears every foreign RENDERED leaf + hull frame (0 interior violations)", () => {
    const { root, leafBoxes, boxedHulls } = laneBandFixture();
    // e1 → a1 is net-backward across the whole band: it must lane over m1/m2/m3.
    const skeleton = [tfdArrow("e1", "a1", [800, 60], [80, 60])];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.clipped).toBe(1);
    expect(meta.laneEdges).toBe(1);
    expect(meta.laneFallback).toBe(0);

    const el = skeleton[0] as unknown as {
      customData: Record<string, unknown>;
    };
    expect(el.customData.terraformClipLane).toBe("above");
    const abs = absPointsOf(skeleton[0]!);

    // The endpoints legitimately sit ON the a1 / e1 faces; every OTHER foreign
    // rendered frame — leaf boxes AND hull boxes — must be strictly clear.
    const endpoints = new Set(["a1", "e1"]);
    let violations = 0;
    for (const [id, r] of leafBoxes) {
      if (endpoints.has(id)) {
        continue;
      }
      if (polylineEntersBox(abs, r)) {
        violations += 1;
      }
    }
    for (const [id, v] of boxedHulls) {
      // hull-a / hull-e host the endpoints; the lane egresses/ingresses through
      // their side faces, so only the FLOWN-OVER hulls are asserted here.
      if (id === "hull-a" || id === "hull-e") {
        continue;
      }
      if (polylineEntersBox(abs, v.box)) {
        violations += 1;
      }
    }
    expect(violations).toBe(0);
  });
});

// ── E3.2: full-span obstacle union + crossing-aware strip selection ──────────
describe("routeStrataEdgeClip — E3.2 strip selection + full-span union", () => {
  it("a backward lane takes the INTER-BAND strip nearest its ports instead of flying over the whole union", () => {
    // Top band: three single-leaf hulls (ports at y=40); a second full-width
    // band hz sits below at y[110,190]. The gap (60,110) between the bands is
    // a genuine strip and is CLOSER to the ports (dist 90) than the
    // over-the-top strip at −44 (dist 168) — E3.2 picks it; E2.4's settle
    // fixpoint could only escape past the whole stack.
    const root = hull("__root__", [], []);
    const a = hull("hull-a", ["vpc-a"], ["a1"]);
    const m = hull("hull-m", ["vpc-m"], ["m1"]);
    const b = hull("hull-b", ["vpc-b"], ["b1"]);
    const z = hull("hull-z", ["vpc-z"], ["z1"]);
    root.children = [a, m, b, z];
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 20, 80, 40)],
      ["m1", box(200, 20, 80, 40)],
      ["b1", box(400, 20, 80, 40)],
      ["z1", box(0, 120, 80, 40)],
    ]);
    const boxedHulls = new Map([
      ["hull-a", { hull: a, box: box(-20, -20, 120, 80) }],
      ["hull-m", { hull: m, box: box(180, -20, 120, 80) }],
      ["hull-b", { hull: b, box: box(380, -20, 120, 80) }],
      ["hull-z", { hull: z, box: box(-20, 110, 520, 80) }],
    ]);
    const skeleton = [tfdArrow("b1", "a1", [400, 40], [80, 40])];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.clipped).toBe(1);
    expect(meta.laneEdges).toBe(1);
    expect(meta.laneBackward).toBe(1);
    expect(meta.laneFallback).toBe(0);
    const el = skeleton[0] as unknown as {
      customData: Record<string, unknown>;
    };
    // The strip at (60,110) sits below the port midline → attributed "below".
    expect(el.customData.terraformClipLane).toBe("below");

    const abs = absPointsOf(skeleton[0]!);
    expect(isAxisAligned(abs)).toBe(true);
    // Lane travel at the strip centre y=85 …
    const horizontalYs = new Set<number>();
    for (let i = 0; i + 1 < abs.length; i++) {
      const [x0, y0] = abs[i]!;
      const [x1, y1] = abs[i + 1]!;
      if (Math.abs(y1 - y0) < 1e-6 && Math.abs(x1 - x0) > 1) {
        horizontalYs.add(y0);
      }
    }
    expect(horizontalYs.has(85)).toBe(true);
    // … the polyline never flies over the top band (E2.4 settled at −44) …
    expect(Math.min(...abs.map((p) => p[1]))).toBeGreaterThanOrEqual(0);
    // … and the FULL-SPAN union holds: no foreign rendered frame is entered —
    // in particular not the second band the strip is adjacent to.
    for (const key of ["hull-m", "hull-z"] as const) {
      expect(polylineEntersBox(abs, boxedHulls.get(key)!.box)).toBe(false);
    }
    for (const key of ["m1", "z1"] as const) {
      expect(polylineEntersBox(abs, leafBoxes.get(key)!)).toBe(false);
    }
  });

  it("a DIRTY chain gutter stops its entry-level run SHORT of a deep sibling frame instead of hopping past it (loop-2 violation mechanism)", () => {
    // a1 sits in tall hull SA with a deep sibling leaf k1 straddling a1's
    // port level between a1's R face (x=80) and SA's R face (x=300). The old
    // corridor walk treated k1 as a plain blocker and HOPPED PAST it — the
    // entry-level horizontal at y=30 then cut straight through k1 (the
    // loop-2 lane-vs-leaf-frame deep-violation mechanism). E3.2 caps the
    // column at k1's left edge instead.
    const root = hull("__root__", [], []);
    const sa = hull("hull-sa", ["vpc-sa"], ["a1", "k1"]);
    const hb = hull("hull-b", ["vpc-b"], ["b1"]);
    root.children = [sa, hb];
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 0, 80, 40)],
      ["k1", box(120, 10, 80, 40)],
      ["b1", box(400, 680, 80, 40)],
    ]);
    const boxedHulls = new Map([
      ["hull-sa", { hull: sa, box: box(-20, -20, 320, 820) }],
      ["hull-b", { hull: hb, box: box(380, 660, 120, 80) }],
    ]);
    const skeleton = [tfdArrow("a1", "b1", [80, 20], [400, 700])];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.clipped).toBe(1);
    expect(meta.staircaseRelieved).toBe(0); // monotone L-route, ratio < 2

    const abs = absPointsOf(skeleton[0]!);
    expect(isAxisAligned(abs)).toBe(true);
    // The deep sibling frame is never entered — neither by the entry-level
    // run nor by the corridor vertical.
    expect(polylineEntersBox(abs, leafBoxes.get("k1")!)).toBe(false);
    // And the route still crosses SA's RIGHT face perpendicular (port
    // discipline unchanged).
    const saFaceX = -20 + 320;
    expect(horizontalCrossingsAt(abs, saFaceX).length).toBeGreaterThan(0);
  });
});

// ── Loop-2 P1b/E2.2: crowded-face port containment + monotone order ──────────
describe("assignFacePorts — crowded-face containment + barycenter order", () => {
  it("12 ports on a 100px face span the inset interval at the feasibility bound, monotone by desiredY", () => {
    const face = { y0: 0, y1: 100 };
    // Deliberately shuffled input order; wide-spread desiredY (some outside the
    // face) to force the full span.
    const entries = [
      { edgeId: "e07", desiredY: 70 },
      { edgeId: "e00", desiredY: -50 },
      { edgeId: "e11", desiredY: 200 },
      { edgeId: "e03", desiredY: 30 },
      { edgeId: "e09", desiredY: 90 },
      { edgeId: "e01", desiredY: 5 },
      { edgeId: "e05", desiredY: 50 },
      { edgeId: "e10", desiredY: 120 },
      { edgeId: "e02", desiredY: 20 },
      { edgeId: "e08", desiredY: 80 },
      { edgeId: "e04", desiredY: 40 },
      { edgeId: "e06", desiredY: 60 },
    ];
    const out = assignFacePorts(face, entries);
    expect(out.size).toBe(12);

    // Usable interval after the 20px corner inset (H/4=25 ≥ 20 ⇒ inset 20).
    const lo = 20;
    const hi = 80;
    const feasSep = (hi - lo) / (entries.length - 1); // 60/11 ≈ 5.4545
    expect(feasSep).toBeLessThan(STRATA_CLIP_PORT_SEPARATION_PX);

    // In barycenter (desiredY) order the assigned ys are strictly increasing and
    // EVERY port sits inside [lo, hi] (never escapes the face extent).
    const byDesired = [...entries].sort((a, b) => a.desiredY - b.desiredY);
    const ys = byDesired.map((e) => out.get(e.edgeId)!);
    for (let i = 0; i < ys.length; i++) {
      expect(ys[i]!).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(ys[i]!).toBeLessThanOrEqual(hi + 1e-6);
    }
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(feasSep - 1e-6);
    }
    // Feasibility bound: the ports fully span [lo, hi] at the uniform sep.
    expect(ys[0]!).toBeCloseTo(lo, 3);
    expect(ys[ys.length - 1]!).toBeCloseTo(hi, 3);
  });

  it("14 ports on a 30px face degrade separation but NEVER escape the face extent", () => {
    const face = { y0: 0, y1: 30 };
    const entries = Array.from({ length: 14 }, (_, i) => ({
      edgeId: `p${String(i).padStart(2, "0")}`,
      desiredY: i * 3 - 5, // spread beyond the face on both ends
    }));
    const out = assignFacePorts(face, entries);
    expect(out.size).toBe(14);

    // inset = min(20, 30/4=7.5) = 7.5 ⇒ usable [7.5, 22.5].
    const inset = Math.min(STRATA_CLIP_PORT_INSET_PX, face.y1 / 4);
    const lo = face.y0 + inset;
    const hi = face.y1 - inset;
    const ys = [...entries]
      .sort((a, b) => a.desiredY - b.desiredY)
      .map((e) => out.get(e.edgeId)!);

    // Separation has DEGRADED well below the 12px ideal (crowded) ...
    const feasSep = (hi - lo) / (entries.length - 1);
    expect(feasSep).toBeLessThan(STRATA_CLIP_PORT_SEPARATION_PX);
    // ... yet no port ESCAPES the face extent [y0, y1] — nor even the inset
    // interval — and order stays monotone non-decreasing.
    for (let i = 0; i < ys.length; i++) {
      expect(ys[i]!).toBeGreaterThanOrEqual(face.y0 - 1e-6);
      expect(ys[i]!).toBeLessThanOrEqual(face.y1 + 1e-6);
      expect(ys[i]!).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(ys[i]!).toBeLessThanOrEqual(hi + 1e-6);
    }
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeGreaterThanOrEqual(ys[i - 1]! - 1e-6);
    }
  });
});
