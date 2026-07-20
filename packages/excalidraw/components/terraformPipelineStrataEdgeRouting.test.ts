/**
 * Unit tests for the Package C routing spike (W9) —
 * terraformPipelineStrataEdgeRouting.ts.
 *
 * Pure-geometry coverage of the routing core (single-obstacle detour,
 * chained two-obstacle detour, waypoint-cap fallback, determinism) plus the
 * skeleton-level pass (endpoint-ancestor permeability, unrelated-card
 * obstacles, flag-off no-op via the scene-build seam, byte-identity of
 * unrouted arrows).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataEdgeRouting.test.ts --exclude "**\/.claude/**"
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import {
  routeStrataEdge,
  routeStrataSkeletonEdges,
  STRATA_EDGE_ROUTING_MAX_WAYPOINTS,
  strataEdgeRoutingClearance,
} from "./terraformPipelineStrataEdgeRouting";
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
): StrataBox => ({
  x,
  y,
  width,
  height,
});

const segmentHitsBox = (a: Pt, b: Pt, r: StrataBox): boolean => {
  // Sampling-based independent check (midpoint sweep) — test-only oracle.
  for (let i = 1; i < 200; i++) {
    const t = i / 200;
    const px = a[0] + t * (b[0] - a[0]);
    const py = a[1] + t * (b[1] - a[1]);
    if (px > r.x && px < r.x + r.width && py > r.y && py < r.y + r.height) {
      return true;
    }
  }
  return false;
};

const polylineAvoids = (poly: readonly Pt[], r: StrataBox): boolean => {
  for (let i = 0; i + 1 < poly.length; i++) {
    if (segmentHitsBox(poly[i]!, poly[i + 1]!, r)) {
      return false;
    }
  }
  return true;
};

describe("routeStrataEdge (pure core)", () => {
  it("detours a single obstacle with two shallow bends and avoids its interior", () => {
    const obstacle = box(100, -50, 100, 100); // straddles the chord y=0
    const route = routeStrataEdge([0, 0], [300, 0], [obstacle]);
    expect(route).not.toBeNull();
    expect(route!.waypoints).toBeGreaterThan(0);
    expect(route!.waypoints).toBeLessThanOrEqual(
      STRATA_EDGE_ROUTING_MAX_WAYPOINTS,
    );
    expect(route!.points[0]).toEqual([0, 0]);
    expect(route!.points[route!.points.length - 1]).toEqual([300, 0]);
    expect(polylineAvoids(route!.points, obstacle)).toBe(true);
    // Clearance respected: no waypoint inside the inflated band.
    const clr = strataEdgeRoutingClearance();
    for (const [, py] of route!.points.slice(1, -1)) {
      expect(
        py <= obstacle.y - clr + 1e-9 ||
          py >= obstacle.y + obstacle.height + clr - 1e-9,
      ).toBe(true);
    }
  });

  it("chains a detour when the first detour hits a second obstacle", () => {
    const first = box(100, -40, 60, 80);
    // Second obstacle sits exactly where the "above" corner route of the
    // first would run, forcing either a below route or a nested detour.
    const second = box(80, -120, 100, 70);
    const route = routeStrataEdge([0, 0], [300, 0], [first, second]);
    expect(route).not.toBeNull();
    expect(polylineAvoids(route!.points, first)).toBe(true);
    expect(polylineAvoids(route!.points, second)).toBe(true);
    expect(route!.waypoints).toBeLessThanOrEqual(
      STRATA_EDGE_ROUTING_MAX_WAYPOINTS,
    );
  });

  it("falls back (null) when no clean route fits the waypoint cap", () => {
    // A dense picket fence of tall obstacles with sub-clearance gaps: every
    // detour immediately re-blocks, exhausting the budget.
    const fence: StrataBox[] = [];
    for (let i = 0; i < 12; i++) {
      fence.push(box(50 + i * 20, -500 + (i % 2) * 20, 18, 1000));
    }
    const route = routeStrataEdge([0, 0], [400, 0], fence, 14);
    expect(route).toBeNull();
  });

  it("returns null (leave straight) when every blocker's clearance zone contains an endpoint", () => {
    // Obstacle whose inflated box swallows the start point — un-routable by
    // the drop rule, so the caller keeps the straight chord.
    const hugger = box(5, -20, 40, 40);
    const route = routeStrataEdge([0, 0], [300, 0], [hugger], 14);
    expect(route).toBeNull();
  });

  it("is deterministic: routing twice yields byte-identical polylines", () => {
    const obstacles = [
      box(100, -50, 100, 100),
      box(250, -30, 60, 120),
      box(40, 30, 500, 40),
    ];
    const a = routeStrataEdge([0, 0], [600, 10], obstacles);
    const b = routeStrataEdge([0, 0], [600, 10], obstacles);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("prefers the minimal-added-L1 side (Wybrow/Xu: shortest, least deviation)", () => {
    // Obstacle mostly below the chord: the above route is much shorter.
    const obstacle = box(100, -10, 100, 200);
    const route = routeStrataEdge([0, 0], [300, 0], [obstacle]);
    expect(route).not.toBeNull();
    for (const [, py] of route!.points.slice(1, -1)) {
      expect(py).toBeLessThan(0); // routed above
    }
  });
});

// ── skeleton-level pass ───────────────────────────────────────────────────────

const leafHull = (
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

/**
 * Fixture: root → { vpcA(a1, a2), vpcB(b1) }. vpcB's box sits between a1 and
 * a2's boxes horizontally, so the a1→a2 chord tunnels through it (a foreign
 * hull) while a1/a2's OWN ancestor (vpcA) must stay permeable even though the
 * chord crosses vpcA's interior by construction.
 */
function fixture(): {
  model: StrataModel;
  placement: StrataPlacementResult;
} {
  const root = leafHull("__root__", [], []);
  const vpcA = leafHull("hull-a", ["vpc-a"], ["a1", "a2"]);
  const vpcB = leafHull("hull-b", ["vpc-b"], ["b1"]);
  root.children = [vpcA, vpcB];

  const leafBoxes = new Map<string, StrataBox>([
    ["a1", box(0, 0, 80, 40)],
    ["a2", box(400, 0, 80, 40)],
    ["b1", box(210, -10, 60, 60)],
  ]);
  const boxedHulls = new Map([
    [
      "__root__",
      { hull: root, box: box(-40, -80, 600, 240), placed: [] as const },
    ],
    [
      "hull-a",
      { hull: vpcA, box: box(-20, -60, 540, 160), placed: [] as const },
    ],
    [
      "hull-b",
      { hull: vpcB, box: box(190, -30, 100, 100), placed: [] as const },
    ],
  ]);

  const model = {
    clusters: new Map(),
    hullRoot: root,
    edges: [],
    selfLoops: [],
    addressOf: (id: string) => id,
  } as unknown as StrataModel;
  const placement = {
    boxedHulls,
    leafBoxes,
  } as unknown as StrataPlacementResult;
  return { model, placement };
}

const tfdArrow = (
  source: string,
  target: string,
  start: Pt,
  end: Pt,
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
    },
  } as unknown as ExcalidrawElementSkeleton);

describe("routeStrataSkeletonEdges (scene pass)", () => {
  it("routes a chord through a foreign hull; endpoint-ancestor hulls stay permeable", () => {
    const { model, placement } = fixture();
    // a1 right edge centre → a2 left edge centre: crosses hull-b + card b1,
    // and (by construction) runs inside hull-a — its shared ancestor.
    const skeleton = [tfdArrow("a1", "a2", [80, 20], [400, 20])];
    const meta = routeStrataSkeletonEdges(skeleton, model, placement);
    expect(meta).toEqual({
      routed: 1,
      unroutable: 0,
      waypointsTotal: expect.any(Number),
    });
    const routed = skeleton[0] as unknown as {
      x: number;
      y: number;
      points: Array<[number, number]>;
    };
    expect(routed.points.length).toBeGreaterThan(2);
    // Start anchor unchanged (bindings key off it).
    expect(routed.x).toBe(80);
    expect(routed.y).toBe(20);
    expect(routed.points[0]).toEqual([0, 0]);
    // Absolute polyline avoids the foreign hull AND the foreign card, and is
    // ALLOWED to remain inside the shared ancestor hull-a.
    const abs: Pt[] = routed.points.map(([px, py]) => [
      routed.x + px,
      routed.y + py,
    ]);
    expect(polylineAvoids(abs, placement.boxedHulls.get("hull-b")!.box)).toBe(
      true,
    );
    expect(polylineAvoids(abs, placement.leafBoxes.get("b1")!)).toBe(true);
  });

  it("leaves non-penetrating edges byte-identical", () => {
    const { model, placement } = fixture();
    // b1 → a2: chord from b1's right edge to a2's left edge passes through no
    // foreign interior (hull-b/hull-a are its endpoint ancestors... hull-a IS
    // foreign to b1 but permeable for a2 — the endpoint rule is either-endpoint).
    const arrow = tfdArrow("b1", "a2", [270, 20], [400, 20]);
    const frozen = JSON.stringify(arrow);
    const skeleton = [arrow];
    const meta = routeStrataSkeletonEdges(skeleton, model, placement);
    expect(meta.routed).toBe(0);
    expect(meta.unroutable).toBe(0);
    expect(skeleton[0]).toBe(arrow); // same reference — untouched
    expect(JSON.stringify(skeleton[0])).toBe(frozen);
  });

  it("skips aggregated arrows and non-TFD layers entirely", () => {
    const { model, placement } = fixture();
    const aggregated = {
      ...(tfdArrow("a1", "a2", [80, 20], [400, 20]) as object),
    } as ExcalidrawElementSkeleton & { customData: Record<string, unknown> };
    (aggregated.customData.relationship as Record<string, unknown>).aggregated =
      true;
    const otherLayer = tfdArrow(
      "a1",
      "a2",
      [80, 20],
      [400, 20],
    ) as ExcalidrawElementSkeleton & { customData: Record<string, unknown> };
    otherLayer.customData.terraformEdgeLayer = "networking";
    const skeleton = [aggregated, otherLayer];
    const meta = routeStrataSkeletonEdges(skeleton, model, placement);
    expect(meta).toEqual({ routed: 0, unroutable: 0, waypointsTotal: 0 });
    expect(skeleton[0]).toBe(aggregated);
    expect(skeleton[1]).toBe(otherLayer);
  });

  it("counts an eligible-but-uncappable edge as unroutable and keeps its chord", () => {
    const { model, placement } = fixture();
    // Build a picket fence of foreign cards so no route fits the cap.
    for (let i = 0; i < 12; i++) {
      (placement.leafBoxes as Map<string, StrataBox>).set(
        `fence-${i}`,
        box(100 + i * 22, -500 + (i % 2) * 20, 18, 1000),
      );
    }
    const arrow = tfdArrow("a1", "a2", [80, 20], [400, 20]);
    const frozen = JSON.stringify(arrow);
    const skeleton = [arrow];
    const meta = routeStrataSkeletonEdges(skeleton, model, placement);
    expect(meta.routed).toBe(0);
    expect(meta.unroutable).toBe(1);
    expect(JSON.stringify(skeleton[0])).toBe(frozen);
  });

  it("is deterministic: routing the same skeleton twice is byte-identical", () => {
    const { model, placement } = fixture();
    const mk = () => [
      tfdArrow("a1", "a2", [80, 20], [400, 20]),
      tfdArrow("a2", "b1", [400, 10], [270, 10]),
    ];
    const s1 = mk();
    const s2 = mk();
    const m1 = routeStrataSkeletonEdges(s1, model, placement);
    const m2 = routeStrataSkeletonEdges(s2, model, placement);
    expect(JSON.stringify(m1)).toBe(JSON.stringify(m2));
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
  });
});
