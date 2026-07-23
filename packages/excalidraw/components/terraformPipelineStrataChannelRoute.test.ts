/**
 * Unit tests for the probe-P1 inter-rank channel routing pass —
 * terraformPipelineStrataChannelRoute.ts.
 *
 * Coverage: column derivation (X-interval merge), orthogonal rewrite of an
 * inter-rank edge (axis-aligned segments + preserved endpoints + stamp),
 * same-rank (flat) edges left as chords, already-stamped edges skipped, the
 * pierce acceptance guard (routed pierces a foreign hull the chord misses →
 * chord kept), and multi-edge track assignment (overlapping Y-spans in one
 * channel get distinct track X + occupancy report).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataChannelRoute.test.ts --exclude "**\/.claude/**"
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import {
  deriveStrataColumns,
  routeStrataChannelEdges,
} from "./terraformPipelineStrataChannelRoute";
import { segmentIntersectsStrataBoxInterior } from "./terraformPipelineStrataPackedScoring";
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

const verticalRunXs = (poly: readonly Pt[]): number[] => {
  const EPS = 1e-6;
  const xs: number[] = [];
  for (let i = 0; i + 1 < poly.length; i++) {
    if (
      Math.abs(poly[i + 1]![0] - poly[i]![0]) <= EPS &&
      Math.abs(poly[i + 1]![1] - poly[i]![1]) > EPS
    ) {
      xs.push(poly[i]![0]);
    }
  }
  return xs;
};

/** Minimal two-column model: root → { hull-a(a…), hull-b(b…) }. Extra hulls /
 * leaves can be appended by the caller for guard / track fixtures. */
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

describe("deriveStrataColumns", () => {
  it("merges X-overlapping boxes into one column and separates disjoint ranks", () => {
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 0, 80, 40)],
      ["a2", box(10, 200, 80, 40)], // same column as a1 (X overlaps)
      ["b1", box(400, 0, 80, 40)], // column 1
      ["c1", box(800, 0, 80, 40)], // column 2
    ]);
    const { columns, columnOf } = deriveStrataColumns(
      placementOf(leafBoxes, new Map()),
    );
    expect(columns.length).toBe(3);
    expect(columnOf.get("a1")).toBe(0);
    expect(columnOf.get("a2")).toBe(0);
    expect(columnOf.get("b1")).toBe(1);
    expect(columnOf.get("c1")).toBe(2);
    // Column 0 extent spans both its cards.
    expect(columns[0]!.left).toBe(0);
    expect(columns[0]!.right).toBe(90);
  });
});

describe("routeStrataChannelEdges (scene pass)", () => {
  it("rewrites an inter-rank edge to an axis-aligned channel polyline, preserving endpoints and stamping", () => {
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
    // a1 right-mid → b1 left-mid: different Y ⇒ a real staircase.
    const skeleton = [tfdArrow("a1", "b1", [80, 20], [400, 140])];
    const meta = routeStrataChannelEdges(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
      false,
    );
    expect(meta.routed).toBe(1);
    expect(meta.flat).toBe(0);
    expect(meta.guardReverted).toBe(0);
    expect(meta.columns).toBe(2);

    const el = skeleton[0]!;
    const a0 = el as unknown as {
      x: number;
      y: number;
      points: Pt[];
      customData: Record<string, unknown>;
    };
    // Endpoints (bindings key off them) are untouched.
    expect(a0.x).toBe(80);
    expect(a0.y).toBe(20);
    expect(a0.points[0]).toEqual([0, 0]);
    const abs = absPointsOf(el);
    expect(abs[abs.length - 1]).toEqual([400, 140]);
    // Genuine orthogonal detour: >2 points, every segment axis-aligned.
    expect(abs.length).toBeGreaterThan(2);
    expect(isAxisAligned(abs)).toBe(true);
    // Vertical run sits inside the inter-column channel [80, 400].
    const vx = verticalRunXs(abs);
    expect(vx.length).toBeGreaterThan(0);
    for (const x of vx) {
      expect(x).toBeGreaterThan(80);
      expect(x).toBeLessThan(400);
    }
    // Stamped so repairTerraformEdgeBindings won't flatten it.
    expect(a0.customData.terraformRoutedPolyline).toBe(true);
  });

  it("leaves a same-rank (flat) edge as a chord in v1", () => {
    const root = hull("__root__", [], []);
    const a = hull("hull-a", ["vpc-a"], ["a1", "a2"]);
    root.children = [a];
    // a1 and a2 share column 0 (X overlaps).
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 0, 80, 40)],
      ["a2", box(0, 200, 80, 40)],
    ]);
    const boxedHulls = new Map([
      ["__root__", { hull: root, box: box(-40, -40, 200, 320) }],
      ["hull-a", { hull: a, box: box(-20, -20, 120, 300) }],
    ]);
    const original = tfdArrow("a1", "a2", [40, 40], [40, 200]);
    const before = JSON.stringify(original);
    const skeleton = [original];
    const meta = routeStrataChannelEdges(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
      false,
    );
    expect(meta.flat).toBe(1);
    expect(meta.routed).toBe(0);
    // Byte-identical: not stamped, geometry unchanged.
    expect(JSON.stringify(skeleton[0])).toBe(before);
  });

  it("skips an edge already stamped by another routing pass", () => {
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
    const original = tfdArrow("a1", "b1", [80, 20], [400, 140], {
      terraformRoutedPolyline: true,
    });
    const before = JSON.stringify(original);
    const skeleton = [original];
    const meta = routeStrataChannelEdges(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
      false,
    );
    expect(meta.skipped).toBe(1);
    expect(meta.routed).toBe(0);
    expect(JSON.stringify(skeleton[0])).toBe(before);
  });

  it("keeps the chord when the channel route would pierce a foreign hull the chord misses (acceptance guard)", () => {
    const root = hull("__root__", [], []);
    const a = hull("hull-a", ["vpc-a"], ["a1"]);
    const b = hull("hull-b", ["vpc-b"], ["b1"]);
    // Foreign sibling hull frame with NO leaves ⇒ it is an obstacle but does
    // NOT create a column (only leaf boxes do). Its box straddles the vertical
    // run at the channel centre (x≈240, y 20..140) but sits BELOW the straight
    // a1→b1 chord (which passes x=240 at y=80), so the route pierces it and the
    // chord does not.
    const c = hull("hull-c", ["vpc-c"], []);
    root.children = [a, b, c];
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 0, 80, 40)],
      ["b1", box(400, 120, 80, 40)],
    ]);
    const boxedHulls = new Map([
      ["__root__", { hull: root, box: box(-40, -40, 600, 240) }],
      ["hull-a", { hull: a, box: box(-20, -20, 120, 80) }],
      ["hull-b", { hull: b, box: box(380, 100, 120, 80) }],
      ["hull-c", { hull: c, box: box(230, 100, 20, 30) }],
    ]);
    const original = tfdArrow("a1", "b1", [80, 20], [400, 140]);
    const before = JSON.stringify(original);
    const skeleton = [original];
    const meta = routeStrataChannelEdges(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
      false,
    );
    expect(meta.guardReverted).toBe(1);
    expect(meta.routed).toBe(0);
    // Chord kept byte-identical (not stamped).
    expect(JSON.stringify(skeleton[0])).toBe(before);
  });

  it("assigns distinct tracks to two edges whose Y-spans overlap in one channel and reports occupancy", () => {
    const root = hull("__root__", [], []);
    const a = hull("hull-a", ["vpc-a"], ["a1", "a2"]);
    const b = hull("hull-b", ["vpc-b"], ["b1", "b2"]);
    root.children = [a, b];
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 0, 80, 40)],
      ["a2", box(0, 100, 80, 40)],
      ["b1", box(400, 200, 80, 40)],
      ["b2", box(400, 300, 80, 40)],
    ]);
    const boxedHulls = new Map([
      ["__root__", { hull: root, box: box(-40, -40, 600, 420) }],
      ["hull-a", { hull: a, box: box(-20, -20, 120, 200) }],
      ["hull-b", { hull: b, box: box(380, 180, 120, 200) }],
    ]);
    // Two inter-rank edges sharing channel 0. Vertical spans [20,220] and
    // [120,320] overlap ⇒ they cannot share a track.
    const e1 = tfdArrow("a1", "b1", [80, 20], [400, 220]);
    const e2 = tfdArrow("a2", "b2", [80, 120], [400, 320]);
    const skeleton = [e1, e2];
    const meta = routeStrataChannelEdges(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
      false,
    );
    expect(meta.routed).toBe(2);
    expect(meta.maxTracksInChannel).toBe(2);
    expect(meta.occupancy).toHaveLength(1);
    expect(meta.occupancy[0]!.channelIndex).toBe(0);
    expect(meta.occupancy[0]!.tracksUsed).toBe(2);
    expect(meta.occupancy[0]!.runs).toBe(2);
    // The two edges' vertical runs sit at different X (distinct tracks).
    const x1 = verticalRunXs(absPointsOf(skeleton[0]!))[0]!;
    const x2 = verticalRunXs(absPointsOf(skeleton[1]!))[0]!;
    expect(x1).not.toBe(x2);
  });

  // DEFECT 2 (Fable attacker): a multi-channel edge's horizontal transfer over
  // an intermediate rank used a uniform fractional Y that sliced that rank's
  // cards; the pierce guard passed on TIES. The transfer Y is now slid onto a
  // clear corridor row. FAILS pre-fix (transfer [240,170]→[640,170] slices the
  // mid card at (400,150,80,40)).
  it("routes an inter-channel transfer along a clear corridor instead of slicing the intermediate rank's card", () => {
    const root = hull("__root__", [], []);
    const a = hull("hull-a", ["vpc-a"], ["a1"]);
    const b = hull("hull-b", ["vpc-b"], ["mid"]);
    const c = hull("hull-c", ["vpc-c"], ["c1"]);
    root.children = [a, b, c];
    const mid = box(400, 150, 80, 40);
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 80, 80, 40)],
      ["mid", mid], // column 1 — the intermediate rank the transfer crosses
      ["c1", box(800, 220, 80, 40)],
    ]);
    const boxedHulls = new Map([
      ["__root__", { hull: root, box: box(-40, -40, 960, 360) }],
      ["hull-a", { hull: a, box: box(-20, 60, 120, 80) }],
      ["hull-b", { hull: b, box: box(380, 130, 120, 80) }],
      ["hull-c", { hull: c, box: box(780, 200, 120, 80) }],
    ]);
    // a1 (col0, right-mid) → c1 (col2, left-mid) spans channels [0,1]; the
    // uniform transfer Y = (100+240)/2 = 170 lands inside mid's [150,190].
    const skeleton = [tfdArrow("a1", "c1", [80, 100], [800, 240])];
    const meta = routeStrataChannelEdges(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
      false,
    );
    expect(meta.routed).toBe(1);
    const abs = absPointsOf(skeleton[0]!);
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

  // DEFECT 3 (Fable attacker): occupancy was tallied during PLANNING from
  // `runsByChannel`, which is never pruned when the pierce guard reverts an
  // edge — so a reverted edge's phantom runs inflated tracksUsed / runs and
  // biased the P5 gate. Occupancy is now recomputed post-guard over accepted
  // runs only. FAILS pre-fix (occupancy has a phantom channel-0 entry).
  it("excludes a guard-reverted edge's runs from the occupancy report", () => {
    const root = hull("__root__", [], []);
    const a = hull("hull-a", ["vpc-a"], ["a1"]);
    const b = hull("hull-b", ["vpc-b"], ["b1"]);
    const cc = hull("hull-c", ["vpc-c"], []);
    root.children = [a, b, cc];
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 0, 80, 40)],
      ["b1", box(400, 120, 80, 40)],
    ]);
    const boxedHulls = new Map([
      ["__root__", { hull: root, box: box(-40, -40, 600, 240) }],
      ["hull-a", { hull: a, box: box(-20, -20, 120, 80) }],
      ["hull-b", { hull: b, box: box(380, 100, 120, 80) }],
      // Foreign hull straddling the vertical run at channel centre → the route
      // pierces it, the chord does not → guard reverts.
      ["hull-c", { hull: cc, box: box(230, 100, 20, 30) }],
    ]);
    const skeleton = [tfdArrow("a1", "b1", [80, 20], [400, 140])];
    const meta = routeStrataChannelEdges(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
      false,
    );
    expect(meta.guardReverted).toBe(1);
    expect(meta.routed).toBe(0);
    // No accepted runs ⇒ occupancy is empty and peak tracks is 0 (pre-fix these
    // carried the reverted edge's phantom channel-0 run).
    expect(meta.occupancy).toHaveLength(0);
    expect(meta.maxTracksInChannel).toBe(0);
    expect(meta.runsTotal).toBe(0);
  });

  it("keeps a degenerate same-Y inter-rank pair as a 3-point collinear stub (E1.2), stamped", () => {
    // Horizontally-aligned inter-rank cards: the (body-anchored) endpoints clip
    // to the SAME Y, so the orthogonal route is geometrically a straight chord
    // and simplifyPolyline reduces it to 2 points. The E1.2 degenerate branch
    // keeps the perpendicular exit stub as an explicit interior waypoint so the
    // stamped polyline stays >2 points (repair's `points.length > 2` gate) — and
    // the stub is COLLINEAR with the straight run, so the rendered edge is
    // visually unchanged.
    const root = hull("__root__", [], []);
    const a = hull("hull-a", ["vpc-a"], ["a1"]);
    const b = hull("hull-b", ["vpc-b"], ["b1"]);
    root.children = [a, b];
    const leafBoxes = new Map<string, StrataBox>([
      ["a1", box(0, 0, 80, 40)],
      ["b1", box(400, 0, 80, 40)], // SAME Y band as a1 ⇒ same-Y chord
    ]);
    const boxedHulls = new Map([
      ["__root__", { hull: root, box: box(-40, -40, 600, 140) }],
      ["hull-a", { hull: a, box: box(-20, -20, 120, 80) }],
      ["hull-b", { hull: b, box: box(380, -20, 120, 80) }],
    ]);
    // a1 right-mid → b1 left-mid, both at y=20: an inter-rank edge whose chord is
    // exactly horizontal.
    const skeleton = [tfdArrow("a1", "b1", [80, 20], [400, 20])];
    const meta = routeStrataChannelEdges(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
      false,
    );
    expect(meta.routed).toBe(1);
    expect(meta.flat).toBe(0);
    expect(meta.guardReverted).toBe(0);

    const el = skeleton[0] as unknown as {
      x: number;
      y: number;
      points: Pt[];
      customData: Record<string, unknown>;
    };
    // Endpoints preserved; exactly 3 points (start, collinear stub, end).
    expect(el.x).toBe(80);
    expect(el.y).toBe(20);
    expect(el.points[0]).toEqual([0, 0]);
    expect(el.points.length).toBe(3);
    const abs = absPointsOf(skeleton[0]!);
    expect(abs[abs.length - 1]).toEqual([400, 20]);
    // Exactly collinear: the cross product of the three points is 0.
    const [p0, p1, p2] = el.points as [Pt, Pt, Pt];
    const cross =
      (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    expect(cross).toBe(0);
    // Stamped so repair preserves the >2-point routed shape.
    expect(el.customData.terraformRoutedPolyline).toBe(true);
    expect(el.customData.terraformRoutedBy).toBe("channel");
  });

  it("emits roundness on channel polylines when corner-softening is requested (edgeStyle composition)", () => {
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
    const skeleton = [tfdArrow("a1", "b1", [80, 20], [400, 140])];
    routeStrataChannelEdges(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
      true, // softenCorners (edgeStyle step/curve also on)
    );
    const el = skeleton[0] as unknown as { roundness?: { type: number } };
    expect(el.roundness).toEqual({ type: 2 });
  });
});
