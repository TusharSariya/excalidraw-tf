import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { repairTerraformEdgeBindings } from "./terraformVisibility";
import { smoothStepPolyline } from "./terraformPipelineStrataEdgeStyle";

// ── fixtures ────────────────────────────────────────────────────────────────

const depEdge = (
  id: string,
  source: string,
  target: string,
  overrides: Partial<ExcalidrawElement> = {},
): ExcalidrawElement =>
  ({
    id,
    type: "arrow",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    angle: 0,
    strokeColor: "#000",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    points: [
      [0, 0],
      [10, 10],
    ],
    lastCommittedPoint: null,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    customData: {
      terraformEdgeLayer: "dependency",
      relationship: { source, target },
    },
    ...overrides,
  } as unknown as ExcalidrawElement);

const resourceRect = (
  id: string,
  key: string,
  x: number,
  y: number,
): ExcalidrawElement =>
  ({
    id,
    type: "rectangle",
    x,
    y,
    width: 40,
    height: 20,
    angle: 0,
    strokeColor: "#000",
    backgroundColor: "#fff",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: 1,
    version: 1,
    versionNonce: 1,
    isDeleted: false,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    customData: {
      terraform: true,
      terraformVisibilityRole: "resource",
      terraformVisibilityKey: key,
      nodePath: key,
    },
  } as unknown as ExcalidrawElement);

const A = "aws_instance.a";
const B = "aws_instance.b";

type RepairedArrow = ExcalidrawElement & {
  points: [number, number][];
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
};

/** Run one repair pass, returning the arrow with the given id. */
const repairEdge = (
  elements: readonly ExcalidrawElement[],
  edgeId: string,
): RepairedArrow =>
  repairTerraformEdgeBindings(elements).find(
    (e) => e.id === edgeId,
  )! as unknown as RepairedArrow;

/**
 * Build a LEGITIMATE routed polyline: derive the exact centre-clipped chord the
 * repair produces for a straight edge, then bend it with an interior waypoint
 * while keeping the same first/last endpoints and marking it routed. This is a
 * faithful stand-in for what terraformPipelineStrataEdgeRouting.ts stamps.
 */
const buildLegitRoutedArrow = (
  rectA: ExcalidrawElement,
  rectB: ExcalidrawElement,
): ExcalidrawElement => {
  const straight = repairEdge(
    [rectA, rectB, depEdge("routed", A, B)],
    "routed",
  );
  const pts = (straight as unknown as { points: [number, number][] }).points;
  const [sRel, eRel] = [pts[0]!, pts[pts.length - 1]!];
  const midRel: [number, number] = [
    (sRel[0] + eRel[0]) / 2 + 25, // push the waypoint off the chord
    (sRel[1] + eRel[1]) / 2 - 25,
  ];
  const xs = [sRel[0], midRel[0], eRel[0]];
  const ys = [sRel[1], midRel[1], eRel[1]];
  return depEdge("routed", A, B, {
    x: straight.x,
    y: straight.y,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    points: [sRel, midRel, eRel],
    customData: {
      terraformEdgeLayer: "dependency",
      relationship: { source: A, target: B },
      terraformRoutedPolyline: true,
    },
  } as unknown as Partial<ExcalidrawElement>);
};

// ── tests ───────────────────────────────────────────────────────────────────

describe("repairTerraformEdgeBindings — routed polyline validate-before-trust", () => {
  it("preserves a legitimate routed polyline whose endpoints still match", () => {
    const rectA = resourceRect("r-a", A, 0, 0);
    const rectB = resourceRect("r-b", B, 400, 300);
    const routed = buildLegitRoutedArrow(rectA, rectB);

    const out = repairEdge([rectA, rectB, routed], "routed");
    const pts = out.points;

    // Detour geometry kept (still 3 points, still marked).
    expect(pts.length).toBe(3);
    expect(out.customData?.terraformRoutedPolyline).toBe(true);
    // Bindings still (re)anchored to the two rects.
    expect(out.startBinding?.elementId).toBe("r-a");
    expect(out.endBinding?.elementId).toBe("r-b");
  });

  it("flattens + strips the marker when the target moved (stale geometry)", () => {
    const rectA = resourceRect("r-a", A, 0, 0);
    const rectB = resourceRect("r-b", B, 400, 300);
    const routed = buildLegitRoutedArrow(rectA, rectB);

    // Target jumps far away: the polyline's stored endpoints no longer match
    // the freshly repaired chord anchors.
    const movedRectB = resourceRect("r-b", B, 900, 700);

    const out = repairEdge([rectA, movedRectB, routed], "routed");
    const pts = out.points;

    expect(pts.length).toBe(2); // flattened to the straight chord
    expect(out.customData?.terraformRoutedPolyline).toBeUndefined(); // marker stripped
    expect(out.customData?.terraformEdgeLayer).toBe("dependency"); // other keys kept
    expect(out.startBinding?.elementId).toBe("r-a");
    expect(out.endBinding?.elementId).toBe("r-b");
  });

  it("strips the flag from a marked 2-point arrow even when geometry already matches", () => {
    const rectA = resourceRect("r-a", A, 0, 0);
    const rectB = resourceRect("r-b", B, 400, 300);
    // Derive the exact repaired chord, then re-tag it with the routed flag but
    // only 2 points — the resurrection hazard: geometry is already correct, so
    // a geometry-equality short-circuit must not skip the marker strip.
    const straight = repairEdge(
      [rectA, rectB, depEdge("routed", A, B)],
      "routed",
    );
    const marked = depEdge("routed", A, B, {
      x: straight.x,
      y: straight.y,
      width: straight.width,
      height: straight.height,
      points: straight.points,
      startBinding: straight.startBinding,
      endBinding: straight.endBinding,
      customData: {
        terraformEdgeLayer: "dependency",
        relationship: { source: A, target: B },
        terraformRoutedPolyline: true,
      },
    } as unknown as Partial<ExcalidrawElement>);

    const out = repairEdge([rectA, rectB, marked], "routed");
    expect(out.points.length).toBe(2);
    expect(out.customData?.terraformRoutedPolyline).toBeUndefined();
  });

  it("preserves a probe-P2 smoothstep polyline whose endpoints still match (edge-style round-trip)", () => {
    const rectA = resourceRect("r-a", A, 0, 0);
    const rectB = resourceRect("r-b", B, 400, 300);
    // Derive the exact repaired chord, then reshape it with the P2 step style
    // between the SAME absolute endpoints — the geometry applyStrataEdgeStyle
    // stamps. Endpoints are unchanged, so validate-before-trust must keep it.
    const straight = repairEdge(
      [rectA, rectB, depEdge("routed", A, B)],
      "routed",
    );
    const pts = (straight as unknown as { points: [number, number][] }).points;
    const sRel = pts[0]!;
    const eRel = pts[pts.length - 1]!;
    const start: readonly [number, number] = [
      straight.x + sRel[0],
      straight.y + sRel[1],
    ];
    const end: readonly [number, number] = [
      straight.x + eRel[0],
      straight.y + eRel[1],
    ];
    const poly = smoothStepPolyline(start, end);
    expect(poly.length).toBeGreaterThan(2);
    const relPoints = poly.map(
      ([px, py]) => [px - straight.x, py - straight.y] as [number, number],
    );
    const xs = relPoints.map((p) => p[0]);
    const ys = relPoints.map((p) => p[1]);
    const stepped = depEdge("routed", A, B, {
      x: straight.x,
      y: straight.y,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      points: relPoints,
      customData: {
        terraformEdgeLayer: "dependency",
        relationship: { source: A, target: B },
        terraformRoutedPolyline: true,
      },
    } as unknown as Partial<ExcalidrawElement>);

    const out = repairEdge([rectA, rectB, stepped], "routed");
    expect(out.points.length).toBe(poly.length); // step geometry kept
    expect(out.customData?.terraformRoutedPolyline).toBe(true);
    expect(out.startBinding?.elementId).toBe("r-a");
    expect(out.endBinding?.elementId).toBe("r-b");
  });

  it("preserves a probe-P1 channel-route orthogonal polyline whose endpoints still match (round-trip)", () => {
    const rectA = resourceRect("r-a", A, 0, 0);
    const rectB = resourceRect("r-b", B, 400, 300);
    // Derive the exact repaired chord endpoints, then build the orthogonal
    // channel polyline routeStrataChannelEdges emits between the SAME absolute
    // endpoints: exit stub → vertical run at a mid-channel track X → entry stub.
    const straight = repairEdge(
      [rectA, rectB, depEdge("routed", A, B)],
      "routed",
    );
    const pts = (straight as unknown as { points: [number, number][] }).points;
    const sRel = pts[0]!;
    const eRel = pts[pts.length - 1]!;
    const start: readonly [number, number] = [
      straight.x + sRel[0],
      straight.y + sRel[1],
    ];
    const end: readonly [number, number] = [
      straight.x + eRel[0],
      straight.y + eRel[1],
    ];
    const trackX = (start[0] + end[0]) / 2;
    const channelPoly: Array<readonly [number, number]> = [
      start,
      [trackX, start[1]],
      [trackX, end[1]],
      end,
    ];
    const relPoints = channelPoly.map(
      ([px, py]) => [px - straight.x, py - straight.y] as [number, number],
    );
    const xs = relPoints.map((p) => p[0]);
    const ys = relPoints.map((p) => p[1]);
    const routed = depEdge("routed", A, B, {
      x: straight.x,
      y: straight.y,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      points: relPoints,
      customData: {
        terraformEdgeLayer: "dependency",
        relationship: { source: A, target: B },
        terraformRoutedPolyline: true,
      },
    } as unknown as Partial<ExcalidrawElement>);

    const out = repairEdge([rectA, rectB, routed], "routed");
    expect(out.points.length).toBe(channelPoly.length); // channel geometry kept
    expect(out.customData?.terraformRoutedPolyline).toBe(true);
    expect(out.startBinding?.elementId).toBe("r-a");
    expect(out.endBinding?.elementId).toBe("r-b");
  });

  it("flattens + strips a foreign arrow carrying the flag with garbage points", () => {
    const rectA = resourceRect("r-a", A, 0, 0);
    const rectB = resourceRect("r-b", B, 400, 300);
    // Rendered at x=300 with points far from either card anchor (rectA at the
    // origin, rectB at 400,300) — a stale/foreign marker in practice.
    const foreign = depEdge("routed", A, B, {
      x: 300,
      y: 300,
      width: 300,
      height: 300,
      points: [
        [0, 0],
        [150, 150],
        [300, 300],
      ],
      customData: {
        terraformEdgeLayer: "dependency",
        relationship: { source: A, target: B },
        terraformRoutedPolyline: true,
      },
    } as unknown as Partial<ExcalidrawElement>);

    const out = repairEdge([rectA, rectB, foreign], "routed");
    const pts = out.points;

    expect(pts.length).toBe(2);
    expect(out.customData?.terraformRoutedPolyline).toBeUndefined();
    expect(out.startBinding?.elementId).toBe("r-a");
    expect(out.endBinding?.elementId).toBe("r-b");
  });
});
