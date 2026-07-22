/**
 * Wave-3 badPatterns metric unit tests (hand-computed fixtures). Covers the
 * four owner-theory validation metrics added to the strata diagnostics:
 *   M1 samePairMultiCross  M2 parallelCross (+ bundleGridCross)
 *   M3 backwardTurn        M4 endpointOcclusion (own-card re-entry + anchor)
 * plus a byte-identity guard that `dataflow.crossings` / `crossingAngles` are
 * unchanged by the additive refactor.
 *
 * FAILS on pre-change code: `badPatterns` did not exist on the diagnostics
 * struct, so every `badPatterns.*` assertion references a missing property.
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  diagnoseBadPatternOffenders,
  diagnosePipelineScene,
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

describe("badPatterns M1 — samePairMultiCross", () => {
  it("counts a clean same-pair double-cross (empty bigon) as one offending pair, excess 1", () => {
    // A: (0,0)->(100,40)->(200,0)  a shallow "^" (down then up in screen-y).
    // B: (0,40)->(100,0)->(200,40) a "v". They cross twice: near (50,20) and
    // (150,20), 100px apart (> CROSS_DEDUP_PX=12 → both survive dedup).
    const els = [
      arrow(0, 0, [
        [0, 0],
        [100, 40],
        [200, 0],
      ]),
      arrow(0, 0, [
        [0, 40],
        [100, 0],
        [200, 40],
      ]),
    ];
    const bp = diagnosePipelineScene(els).badPatterns;
    expect(bp.samePairMultiCross.pairs).toBe(1);
    expect(bp.samePairMultiCross.excess).toBe(1);
    expect(bp.samePairMultiCross.maxPerPair).toBe(2);
    expect(bp.samePairMultiCross.totalCrossEvents).toBe(2);

    const off = diagnoseBadPatternOffenders(els).samePairMultiCross;
    expect(off).toHaveLength(1);
    expect(off[0]!.crossCount).toBe(2);
    expect(off[0]!.points).toHaveLength(2);
    // Crossing points at (50,20) and (150,20).
    const xs = off[0]!.points.map((p) => p[0]).sort((a, b) => a - b);
    expect(xs).toEqual([50, 150]);
  });

  it("a single crossing is not multi-cross (pairs 0, excess 0)", () => {
    const els = [
      arrow(0, 0, [
        [0, 0],
        [200, 0],
      ]),
      arrow(0, 0, [
        [100, -50],
        [100, 50],
      ]),
    ];
    const bp = diagnosePipelineScene(els).badPatterns;
    expect(bp.samePairMultiCross.pairs).toBe(0);
    expect(bp.samePairMultiCross.excess).toBe(0);
    expect(bp.samePairMultiCross.maxPerPair).toBe(1);
    expect(bp.samePairMultiCross.totalCrossEvents).toBe(1);
  });
});

describe("badPatterns M2 — parallelCross (near-parallel small-angle bundle)", () => {
  it("counts near-parallel small-angle crossings with a third-edge neighbor", () => {
    // A: (0,0)->(200,10)   ~+2.86°
    // B: (0,10)->(200,0)   ~-2.86°  (A×B at (100,5), acute ≈5.7° < 20°)
    // C: (0,5)->(200,15)   ~+2.86°  parallel to A; C×B at (50,7.5), acute ≈5.7°
    // The two crossings are 50px apart (≤ D_NEIGH=75), each has a THIRD edge
    // in the other event, aligned within 15° → both qualify.
    const els = [
      arrow(0, 0, [
        [0, 0],
        [200, 10],
      ]),
      arrow(0, 0, [
        [0, 10],
        [200, 0],
      ]),
      arrow(0, 0, [
        [0, 5],
        [200, 15],
      ]),
    ];
    const bp = diagnosePipelineScene(els).badPatterns;
    expect(bp.parallelCross.totalEvents).toBe(2);
    expect(bp.parallelCross.events).toBe(2);
    expect(bp.parallelCross.share).toBe(1);
  });

  it("a lone perpendicular crossing is not a parallel bundle (events 0)", () => {
    const els = [
      arrow(0, 0, [
        [0, 0],
        [200, 0],
      ]),
      arrow(0, 0, [
        [100, -50],
        [100, 50],
      ]),
    ];
    const bp = diagnosePipelineScene(els).badPatterns;
    expect(bp.parallelCross.totalEvents).toBe(1);
    expect(bp.parallelCross.events).toBe(0);
    expect(bp.parallelCross.gridEvents).toBe(0);
  });
});

describe("badPatterns M3 — backwardTurn", () => {
  it("flags a backward S-run beyond one stub (Δx −40)", () => {
    // dx runs: +100, −40, +100. The −40 run exceeds H_BACKTRACK=20 → survives.
    const els = [
      arrow(0, 0, [
        [0, 0],
        [100, 0],
        [60, 0],
        [160, 0],
      ]),
    ];
    const bp = diagnosePipelineScene(els).badPatterns;
    expect(bp.backwardTurn.edges).toBe(1);
    expect(bp.backwardTurn.countTotal).toBe(1);
    expect(bp.backwardTurn.backtrackPxTotal).toBe(40);
    expect(bp.backwardTurn.backtrackPxMax).toBe(40);

    const off = diagnoseBadPatternOffenders(els).backwardTurn;
    expect(off).toHaveLength(1);
    expect(off[0]!.worstRun).toEqual({ fromX: 100, toX: 60, y: 0 });
  });

  it("folds a sub-stub jitter (Δx −10) into the surrounding forward run", () => {
    // dx runs: +100, −10, +100. The −10 (≤20) folds away, +100s merge → no
    // surviving backward run.
    const els = [
      arrow(0, 0, [
        [0, 0],
        [100, 0],
        [90, 0],
        [200, 0],
      ]),
    ];
    const bp = diagnosePipelineScene(els).badPatterns;
    expect(bp.backwardTurn.edges).toBe(0);
    expect(bp.backwardTurn.countTotal).toBe(0);
    expect(bp.backwardTurn.backtrackPxTotal).toBe(0);
  });
});

describe("badPatterns M4 — endpointOcclusion", () => {
  it("detects own-card re-entry beyond the 20px stub", () => {
    // Edge leaves A's right side, runs 50px right (clears the stub), then dips
    // back left into A's interior at (50,50). Target card B is far away.
    const els = [
      card("A", 0, 0, 100, 100),
      card("B", 400, 0, 100, 100),
      arrow(
        0,
        0,
        [
          [100, 50],
          [150, 50],
          [50, 50],
        ],
        "A",
        "B",
      ),
    ];
    const bp = diagnosePipelineScene(els).badPatterns;
    expect(bp.endpointOcclusion.ownCardReentryCount).toBe(1);
    expect(bp.endpointOcclusion.ownCardReentryEdges).toBe(1);
    expect(bp.endpointOcclusion.endpointsResolved).toBe(2);
    expect(bp.endpointOcclusion.endpointsUnresolved).toBe(0);

    const off = diagnoseBadPatternOffenders(els).endpointOcclusion;
    expect(off).toHaveLength(1);
    expect(off[0]!.reentry).toBe("src");
    expect(off[0]!.reentryRect?.frameId).toBe("card-A");
  });

  it("classifies an anchor-region crossing as own (within 28px of an attachment point)", () => {
    // A runs left→right from its start anchor (0,0). C crosses A at (15,0),
    // which is 15px (≤ R_ANCHOR=28) from A's start anchor → endpointCrossOwn.
    const els = [
      arrow(
        0,
        0,
        [
          [0, 0],
          [200, 0],
        ],
        "A",
        "B",
      ),
      arrow(
        0,
        0,
        [
          [15, -30],
          [15, 30],
        ],
        "C",
        "D",
      ),
    ];
    const bp = diagnosePipelineScene(els).badPatterns;
    expect(bp.endpointOcclusion.endpointCrossOwn).toBe(1);
    expect(bp.endpointOcclusion.endpointCrossForeign).toBe(0);
    expect(bp.endpointOcclusion.anchorCount).toBe(4);
  });
});

describe("badPatterns — byte-identity of dataflow.crossings + crossingAngles", () => {
  it("the additive refactor leaves crossings and crossingAngles unchanged", () => {
    // Same double-cross scene as M1: pair-once semantics ⇒ crossings=1, and the
    // crossing-angle summary is over that single pair (both crossings 43.6°).
    const els = [
      arrow(0, 0, [
        [0, 0],
        [100, 40],
        [200, 0],
      ]),
      arrow(0, 0, [
        [0, 40],
        [100, 0],
        [200, 40],
      ]),
    ];
    const diag = diagnosePipelineScene(els);
    expect(diag.dataflow.crossings).toBe(1);
    expect(diag.crossingAngles.nCross).toBe(1);
    expect(diag.crossingAngles.minDeg).toBeCloseTo(43.6, 1);
    expect(diag.crossingAngles.sharpShare).toBe(0); // 43.6 ≥ 30
    expect(diag.crossingAngles.sharpShare70).toBe(1); // 43.6 < 70
  });
});
