/**
 * Unit tests for the P3-pierce border-exit routing pass —
 * terraformPipelineStrataBorderRoute.ts.
 *
 * Covers: a source-inside-VPC → region-level-target chord getting a clean
 * single-side exit (routed, exactly-one boundary crossing, endpoints frozen,
 * strict interior-span decrease, marker set); an intra-VPC edge (ancestor of
 * both) left straight; a detour that would newly pierce a foreign card falling
 * back to the chord (unclean); the no-gain case; the deep-nesting waypoint cap;
 * and determinism.
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataBorderRoute.test.ts --exclude "**\/.claude/**"
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import {
  routeStrataBorderExits,
  type StrataBorderRouteMeta,
} from "./terraformPipelineStrataBorderRoute";
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

const strictlyInsideBox = (p: Pt, r: StrataBox): boolean =>
  p[0] > r.x && p[0] < r.x + r.width && p[1] > r.y && p[1] < r.y + r.height;

/** Count strictly-inside ↔ strictly-outside transitions of a polyline vs a box
 * (a boundary-touching vertex like W is neither, so a clean exit registers
 * exactly one transition). */
const boundaryCrossings = (poly: readonly Pt[], r: StrataBox): number => {
  const samples: boolean[] = [];
  for (let s = 0; s + 1 < poly.length; s++) {
    const a = poly[s]!;
    const b = poly[s + 1]!;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      samples.push(
        strictlyInsideBox(
          [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])],
          r,
        ),
      );
    }
  }
  let crossings = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i] !== samples[i - 1]) {
      crossings += 1;
    }
  }
  return crossings;
};

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

const mkModelPlacement = (
  root: StrataHullNode,
  hullBoxes: Array<[string, StrataHullNode, StrataBox]>,
  leafBoxes: Array<[string, StrataBox]>,
): { model: StrataModel; placement: StrataPlacementResult } => {
  const boxedHulls = new Map(
    hullBoxes.map(([id, h, b]) => [
      id,
      { hull: h, box: b, placed: [] as const },
    ]),
  );
  const model = {
    clusters: new Map(),
    hullRoot: root,
    edges: [],
    selfLoops: [],
    addressOf: (id: string) => id,
  } as unknown as StrataModel;
  const placement = {
    boxedHulls,
    leafBoxes: new Map(leafBoxes),
  } as unknown as StrataPlacementResult;
  return { model, placement };
};

/**
 * Fixture: root → { vpcA(src, sib), sink at root level }. The src→sink chord
 * runs diagonally out of vpcA toward a region-level sink outside it (the P3
 * case). vpcA box is (0,0,100,100); src is centred (50,50); sink is a card at
 * (300,300).
 */
function baseFixture() {
  const root = hull("__root__", [], ["sink"]);
  const vpcA = hull("hull-a", ["vpc-a"], ["src", "sib"]);
  root.children = [vpcA];
  return mkModelPlacement(
    root,
    [
      ["__root__", root, box(-50, -50, 500, 500)],
      ["hull-a", vpcA, box(0, 0, 100, 100)],
    ],
    [
      ["src", box(40, 40, 20, 20)],
      ["sib", box(10, 10, 20, 20)],
      ["sink", box(300, 300, 40, 40)],
    ],
  );
}

describe("routeStrataBorderExits (P3 border-exit)", () => {
  it("routes a source-inside-VPC → region sink to a clean single-side exit", () => {
    const { model, placement } = baseFixture();
    const skeleton = [tfdArrow("src", "sink", [50, 50], [300, 300])];
    const meta = routeStrataBorderExits(skeleton, model, placement);
    expect(meta.routed).toBe(1);
    expect(meta.unclean).toBe(0);
    expect(meta.noGain).toBe(0);
    expect(meta.waypointsTotal).toBe(1);
    expect(meta.interiorLenSavedL1).toBeGreaterThan(0);
    // Faithful headline scalar: the inserted waypoint pulls off the straight
    // chord (> 0 perpendicular deviation).
    expect(meta.maxWaypointPerpDev).toBeGreaterThan(0);

    const routed = skeleton[0] as unknown as {
      x: number;
      y: number;
      points: Array<[number, number]>;
      customData: Record<string, unknown>;
    };
    // (b) endpoints byte-identical: only an interior waypoint was added.
    expect(routed.x).toBe(50);
    expect(routed.y).toBe(50);
    expect(routed.points[0]).toEqual([0, 0]);
    expect(routed.points[routed.points.length - 1]).toEqual([250, 250]);
    expect(routed.points.length).toBe(3);
    // (d) polyline marker set so bindings-repair keeps the waypoints.
    expect(routed.customData.terraformRoutedPolyline).toBe(true);
    // (a) exactly one crossing of the VPC boundary.
    const abs: Pt[] = routed.points.map(([px, py]) => [
      routed.x + px,
      routed.y + py,
    ]);
    expect(
      boundaryCrossings(abs, placement.boxedHulls.get("hull-a")!.box),
    ).toBe(1);
  });

  it("leaves an intra-VPC edge (ancestor of both) straight — empty exit set", () => {
    const { model, placement } = baseFixture();
    const arrow = tfdArrow("src", "sib", [50, 50], [20, 20]);
    const frozen = JSON.stringify(arrow);
    const skeleton = [arrow];
    const meta = routeStrataBorderExits(skeleton, model, placement);
    expect(meta).toEqual({
      routed: 0,
      unclean: 0,
      noGain: 0,
      waypointsTotal: 0,
      interiorLenSavedL1: 0,
      maxWaypointPerpDev: 0,
    });
    expect(skeleton[0]).toBe(arrow); // untouched reference
    expect(JSON.stringify(skeleton[0])).toBe(frozen);
  });

  it("falls back to the chord (unclean) when the exit would newly pierce a foreign card", () => {
    const { model, placement } = baseFixture();
    // Foreign card sitting on the routed W→end leg (which dips below the y=x
    // chord) but OFF the straight chord itself.
    (placement.leafBoxes as Map<string, StrataBox>).set(
      "obs",
      box(145, 133, 12, 10),
    );
    const arrow = tfdArrow("src", "sink", [50, 50], [300, 300]);
    const frozen = JSON.stringify(arrow);
    const skeleton = [arrow];
    const meta = routeStrataBorderExits(skeleton, model, placement);
    expect(meta.routed).toBe(0);
    expect(meta.unclean).toBe(1);
    expect(JSON.stringify(skeleton[0])).toBe(frozen);
  });

  it("counts noGain (keeps chord) when the side exit does not shorten the interior span", () => {
    const { model, placement } = baseFixture();
    // A near-horizontal exit whose facing side IS the natural exit side and
    // whose crossing needs no clamp: routed interior == straight interior.
    const arrow = tfdArrow("src", "sink", [50, 50], [400, 55]);
    const frozen = JSON.stringify(arrow);
    const skeleton = [arrow];
    const meta = routeStrataBorderExits(skeleton, model, placement);
    expect(meta.routed).toBe(0);
    expect(meta.noGain).toBe(1);
    expect(JSON.stringify(skeleton[0])).toBe(frozen);
  });

  it("inserts one waypoint per nested ancestor, inner→outer, within the cap", () => {
    // root → h1 → h2 → h3(src); sink at root. Three exited hulls ⇒ 3 waypoints.
    const root = hull("__root__", [], ["sink"]);
    const h3 = hull("h3", ["a", "b", "c"], ["src"]);
    const h2 = hull("h2", ["a", "b"], [], [h3]);
    const h1 = hull("h1", ["a"], [], [h2]);
    root.children = [h1];
    const { model, placement } = mkModelPlacement(
      root,
      [
        ["__root__", root, box(-100, -100, 800, 800)],
        ["h1", h1, box(0, 0, 300, 300)],
        ["h2", h2, box(30, 30, 240, 240)],
        ["h3", h3, box(60, 60, 180, 180)],
      ],
      [
        ["src", box(140, 140, 20, 20)],
        ["sink", box(600, 600, 40, 40)],
      ],
    );
    const skeleton = [tfdArrow("src", "sink", [150, 150], [600, 600])];
    const meta = routeStrataBorderExits(skeleton, model, placement);
    expect(meta.routed).toBe(1);
    expect(meta.waypointsTotal).toBe(3);
    const routed = skeleton[0] as unknown as {
      x: number;
      y: number;
      points: Array<[number, number]>;
    };
    expect(routed.points.length).toBe(5); // start + 3 waypoints + end
    // Every exited box (inner, mid, outer) is crossed EXACTLY once — the
    // "single clean exit" guarantee holds per-box, not just for the outermost.
    const abs: Pt[] = routed.points.map(([px, py]) => [
      routed.x + px,
      routed.y + py,
    ]);
    for (const id of ["h1", "h2", "h3"]) {
      expect(boundaryCrossings(abs, placement.boxedHulls.get(id)!.box)).toBe(1);
    }
    // Monotone staircase: x and y both non-decreasing along the polyline (the
    // src→sink chord heads down-right, so a clean exit never doubles back).
    for (let i = 1; i < abs.length; i++) {
      expect(abs[i]![0]).toBeGreaterThanOrEqual(abs[i - 1]![0]);
      expect(abs[i]![1]).toBeGreaterThanOrEqual(abs[i - 1]![1]);
    }
  });

  it("is DISJOINT from edgeRouting: skips an arrow already carrying the routed-polyline marker", () => {
    const { model, placement } = baseFixture();
    // An arrow edgeRouting already rewrote into a foreign-detour polyline: it
    // carries interior waypoints AND the shared marker. border-route must leave
    // it byte-identical (yield to whichever pass fired first) so the two passes
    // own genuinely disjoint edge sets — no clobber of edgeRouting's waypoints.
    const preRouted = tfdArrow(
      "src",
      "sink",
      [50, 50],
      [300, 300],
    ) as unknown as {
      points: Array<[number, number]>;
      customData: Record<string, unknown>;
    };
    preRouted.points = [
      [0, 0],
      [90, 10],
      [250, 250],
    ];
    preRouted.customData.terraformRoutedPolyline = true;
    const arrow = preRouted as unknown as ExcalidrawElementSkeleton;
    const frozen = JSON.stringify(arrow);
    const skeleton = [arrow];
    const meta = routeStrataBorderExits(skeleton, model, placement);
    expect(meta.routed).toBe(0);
    expect(skeleton[0]).toBe(arrow); // untouched reference
    expect(JSON.stringify(skeleton[0])).toBe(frozen); // waypoints preserved
  });

  it("respects the waypoint cap: > MAX nested ancestors falls back (unclean)", () => {
    // 7 concentric hulls all ancestors of src, none of sink ⇒ exceeds the cap.
    const root = hull("__root__", [], ["sink"]);
    const chain: StrataHullNode[] = [];
    for (let i = 0; i < 7; i++) {
      chain.push(
        hull(
          `h${i}`,
          Array.from({ length: i + 1 }, (_, k) => `s${k}`),
          [],
        ),
      );
    }
    chain[6]!.leafClusterIds = ["src"];
    for (let i = 0; i < 6; i++) {
      chain[i]!.children = [chain[i + 1]!];
    }
    root.children = [chain[0]!];
    const hullBoxes: Array<[string, StrataHullNode, StrataBox]> = [
      ["__root__", root, box(-200, -200, 2000, 2000)],
    ];
    for (let i = 0; i < 7; i++) {
      hullBoxes.push([
        `h${i}`,
        chain[i]!,
        box(i * 15, i * 15, 400 - i * 30, 400 - i * 30),
      ]);
    }
    const { model, placement } = mkModelPlacement(root, hullBoxes, [
      ["src", box(180, 180, 20, 20)],
      ["sink", box(900, 900, 40, 40)],
    ]);
    const arrow = tfdArrow("src", "sink", [190, 190], [900, 900]);
    const frozen = JSON.stringify(arrow);
    const skeleton = [arrow];
    const meta = routeStrataBorderExits(skeleton, model, placement);
    expect(meta.routed).toBe(0);
    expect(meta.unclean).toBe(1);
    expect(JSON.stringify(skeleton[0])).toBe(frozen);
  });

  it("is deterministic: routing the same skeleton twice is byte-identical", () => {
    const mk = () => {
      const { model, placement } = baseFixture();
      const skeleton = [
        tfdArrow("src", "sink", [50, 50], [300, 300]),
        tfdArrow("src", "sib", [50, 50], [20, 20]),
      ];
      const meta = routeStrataBorderExits(skeleton, model, placement);
      return { skeleton, meta };
    };
    const a = mk();
    const b = mk();
    expect(JSON.stringify(a.meta)).toBe(JSON.stringify(b.meta));
    expect(JSON.stringify(a.skeleton)).toBe(JSON.stringify(b.skeleton));
  });

  it("skips aggregated + non-TFD arrows entirely", () => {
    const { model, placement } = baseFixture();
    const aggregated = tfdArrow(
      "src",
      "sink",
      [50, 50],
      [300, 300],
    ) as ExcalidrawElementSkeleton & { customData: Record<string, unknown> };
    (aggregated.customData.relationship as Record<string, unknown>).aggregated =
      true;
    const otherLayer = tfdArrow(
      "src",
      "sink",
      [50, 50],
      [300, 300],
    ) as ExcalidrawElementSkeleton & { customData: Record<string, unknown> };
    otherLayer.customData.terraformEdgeLayer = "networking";
    const skeleton = [aggregated, otherLayer];
    const meta: StrataBorderRouteMeta = routeStrataBorderExits(
      skeleton,
      model,
      placement,
    );
    expect(meta.routed).toBe(0);
    expect(skeleton[0]).toBe(aggregated);
    expect(skeleton[1]).toBe(otherLayer);
  });
});
