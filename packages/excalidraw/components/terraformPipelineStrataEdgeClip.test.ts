/**
 * Unit tests for the loop-2 container-boundary CLIP pass —
 * terraformPipelineStrataEdgeClip.ts — and its typed repair gate in
 * terraformVisibility.ts.
 *
 * Coverage: endpoints exactly ON the source-frame RIGHT face / target-frame
 * LEFT face (the clip), write-back re-origin (points[0] === [0,0]), horizontal
 * tangent stubs at departure/arrival, perpendicular hull port-chain crossings
 * on the correct faces (never top/bottom), per-face port ordering + ≥12px
 * separation across 3 edges sharing a face, net-backward + same-column skips
 * (byte-identical, unstamped), and the repair gate: a VALID clip polyline
 * survives `repairTerraformEdgeBindings` with provenance intact while a STALE
 * one (frame moved → >2px face miss) or a foreign-frame anchor is flattened
 * and stripped (fail-closed).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataEdgeClip.test.ts --exclude "**\/.claude/**"
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";
import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  STRATA_CLIP_PORT_SEPARATION_PX,
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

  it("skips net-backward and same-column edges byte-identically (unstamped — the style-pass orbit / E2.4 lanes own them)", () => {
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
    const backward = tfdArrow("b1", "a1", [400, 140], [80, 20]);
    const sameColumn = tfdArrow("a1", "a2", [40, 40], [40, 200]);
    const beforeBackward = JSON.stringify(backward);
    const beforeSameColumn = JSON.stringify(sameColumn);
    const skeleton = [backward, sameColumn];
    const meta = routeStrataEdgeClip(
      skeleton,
      modelOf(root),
      placementOf(leafBoxes, boxedHulls),
    );
    expect(meta.clipped).toBe(0);
    expect(meta.skippedBackward).toBe(1);
    expect(meta.skippedSameColumn).toBe(1);
    expect(JSON.stringify(skeleton[0])).toBe(beforeBackward);
    expect(JSON.stringify(skeleton[1])).toBe(beforeSameColumn);
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
