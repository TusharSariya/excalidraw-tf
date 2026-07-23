/**
 * Probe P2 edge-angle metric unit tests (hand-computed fixtures). Covers the
 * four families added to the strata diagnostics:
 *   (1) bendCount per edge + total   (2) nearFlatShare (<15° & >40px)
 *   (3) sharpCrossingShare70 (<70°)  (4) endpointAngularResolution (per side)
 *
 * FAILS on pre-change code: `edgeAngles` / `sharpShare70` did not exist on the
 * diagnostics struct, so every assertion below references a missing property.
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  crossingAngleSummaryOf,
  diagnosePipelineScene,
  edgeAngleSummaryOf,
} from "./terraformPipelineCollisionDiagnostics";

type Pt = readonly [number, number];

let idSeq = 0;
const arrow = (
  x: number,
  y: number,
  points: Pt[],
  source = "S",
  target = "T",
): ExcalidrawElement =>
  ({
    id: `arrow-${idSeq++}`,
    type: "arrow",
    x,
    y,
    width: 0,
    height: 0,
    isDeleted: false,
    points,
    customData: { relationship: { source, target } },
  } as unknown as ExcalidrawElement);

const card = (
  address: string,
  x: number,
  y: number,
  w: number,
  h: number,
): ExcalidrawElement =>
  ({
    id: `card-${address}`,
    type: "frame",
    x,
    y,
    width: w,
    height: h,
    isDeleted: false,
    customData: {
      terraformTopologyRole: "primaryCluster",
      terraformPrimaryAddress: address,
    },
  } as unknown as ExcalidrawElement);

describe("edgeAngleSummaryOf — bends", () => {
  it("counts orthogonal Z corners as 2 bends; a straight chord as 0", () => {
    // Z: (0,0)->(50,0)->(50,50)->(100,50): two 90° turns.
    const z = diagnosePipelineScene([
      arrow(0, 0, [
        [0, 0],
        [50, 0],
        [50, 50],
        [100, 50],
      ]),
    ]).edgeAngles;
    expect(z.bendCountTotal).toBe(2);
    expect(z.bendCountMax).toBe(2);
    expect(z.edgeCount).toBe(1);
    expect(z.bendCountMeanPerEdge).toBe(2);

    const straight = diagnosePipelineScene([
      arrow(0, 0, [
        [0, 0],
        [100, 0],
      ]),
    ]).edgeAngles;
    expect(straight.bendCountTotal).toBe(0);
    expect(straight.bendCountMax).toBe(0);
  });
});

describe("edgeAngleSummaryOf — nearFlatShare (metric v2: (1°,15°] diagonals)", () => {
  it("excludes exact horizontals (≤1°) — they are deliberate, tallied separately", () => {
    // Z with 50px legs: seg1 horizontal (0°), seg2 vertical (90°), seg3
    // horizontal (0°). All three > 40px. Under metric v2 the two 0° runs are
    // DELIBERATE horizontals, not near-flat: horizontalSegments=2,
    // nearFlatSegments=0, share=0 (fairness fix for orthogonal routing).
    const m = diagnosePipelineScene([
      arrow(0, 0, [
        [0, 0],
        [50, 0],
        [50, 50],
        [100, 50],
      ]),
    ]).edgeAngles;
    expect(m.longSegments).toBe(3);
    expect(m.horizontalSegments).toBe(2);
    expect(m.nearFlatSegments).toBe(0);
    expect(m.nearFlatShare).toBe(0);
  });

  it("counts a true near-flat diagonal in (1°,15°] as near-flat", () => {
    // (0,0)->(100,10): length 100.5 > 40, angle atan2(10,100)=5.71° ∈ (1,15].
    const m = diagnosePipelineScene([
      arrow(0, 0, [
        [0, 0],
        [100, 10],
      ]),
    ]).edgeAngles;
    expect(m.longSegments).toBe(1);
    expect(m.horizontalSegments).toBe(0);
    expect(m.nearFlatSegments).toBe(1);
    expect(m.nearFlatShare).toBe(1);
  });

  it("mixes a near-flat diagonal and a deliberate horizontal in one edge", () => {
    // seg1 (0,0)->(100,10): 5.71° near-flat; seg2 (100,10)->(200,10): 0°
    // horizontal. Both long. near-flat numerator = 1, share = 1/2 = 0.5.
    const m = diagnosePipelineScene([
      arrow(0, 0, [
        [0, 0],
        [100, 10],
        [200, 10],
      ]),
    ]).edgeAngles;
    expect(m.longSegments).toBe(2);
    expect(m.horizontalSegments).toBe(1);
    expect(m.nearFlatSegments).toBe(1);
    expect(m.nearFlatShare).toBe(0.5);
  });

  it("ignores short segments (≤40px) in the denominator", () => {
    // One 30px horizontal segment: below the length floor → not counted.
    const m = diagnosePipelineScene([
      arrow(0, 0, [
        [0, 0],
        [30, 0],
      ]),
    ]).edgeAngles;
    expect(m.longSegments).toBe(0);
    expect(m.horizontalSegments).toBe(0);
    expect(m.nearFlatSegments).toBe(0);
    expect(m.nearFlatShare).toBe(0);
  });

  it("a steep (>15°) long segment is neither near-flat nor horizontal", () => {
    // (0,0)->(100,50): length 111.8 > 40, angle atan2(50,100)=26.6° > 15.
    const m = diagnosePipelineScene([
      arrow(0, 0, [
        [0, 0],
        [100, 50],
      ]),
    ]).edgeAngles;
    expect(m.longSegments).toBe(1);
    expect(m.horizontalSegments).toBe(0);
    expect(m.nearFlatSegments).toBe(0);
    expect(m.nearFlatShare).toBe(0);
  });
});

describe("crossingAngleSummaryOf — sharpShare70 alongside sharpShare(30)", () => {
  it("reports the 70° share without changing the 30° share", () => {
    const s = crossingAngleSummaryOf([80, 45, 20]);
    // <30: just 20 → 1/3 = 0.33. <70: 45 and 20 → 2/3 = 0.67.
    expect(s.sharpShare).toBe(0.33);
    expect(s.sharpShare70).toBe(0.67);
    expect(s.nCross).toBe(3);
    expect(s.minDeg).toBe(20);
  });

  it("is 0 (vacuous) when there are no crossings", () => {
    const s = crossingAngleSummaryOf([]);
    expect(s.nCross).toBe(0);
    expect(s.sharpShare).toBe(0);
    expect(s.sharpShare70).toBe(0);
  });
});

describe("edgeAngleSummaryOf — endpoint angular resolution", () => {
  it("computes the min gap between departures on the same card side", () => {
    // Card A centre (50,50). Two arrows both leave A's RIGHT side at (100,50):
    //   arrow1 dir (100,-10) → -5.71°, arrow2 dir (100,70) → 34.99°.
    // Gap = 40.70°; one side with ≥2 departures.
    const els = [
      card("A", 0, 0, 100, 100),
      arrow(
        100,
        50,
        [
          [0, 0],
          [100, -10],
        ],
        "A",
        "B",
      ),
      arrow(
        100,
        50,
        [
          [0, 0],
          [100, 70],
        ],
        "A",
        "C",
      ),
    ];
    const m = diagnosePipelineScene(els).edgeAngles;
    expect(m.endpointSidesConsidered).toBe(1);
    expect(m.endpointAngularResolutionMinDeg).toBeCloseTo(40.7, 1);
    expect(m.endpointAngularResolutionMeanDeg).toBeCloseTo(40.7, 1);
  });

  it("is vacuous (0, sidesConsidered 0) with fewer than 2 departures per side", () => {
    const m = edgeAngleSummaryOf([], [], new Map());
    expect(m.endpointSidesConsidered).toBe(0);
    expect(m.endpointAngularResolutionMinDeg).toBe(0);
    expect(m.endpointAngularResolutionMeanDeg).toBe(0);
  });
});
