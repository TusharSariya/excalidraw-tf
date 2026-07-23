/**
 * Unit tests for the shared edge-anchor helper (M2).
 *
 *  (b) `computeTerraformChordAnchors` reproduces the previous inline composition
 *      in `repairTerraformEdgeBindings`
 *      (`offsetLineSegment(getCenterClippedBindingPoints(...), structuralPair?18:0)`)
 *      for representative rect pairs, BOTH branches — pinned to GOLDEN LITERALS
 *      (not re-derived from the moved helpers, which would be circular).
 *  (c) the style pass falls back to the skeleton chord endpoints when either
 *      endpoint key has no body rect (still styling + stamping the arrow).
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import {
  TERRAFORM_STRUCTURAL_DEP_CHORD_OFFSET_PX,
  computeTerraformChordAnchors,
  type ChordAnchorPoints,
  type EdgeAnchorRect,
} from "./terraformEdgeAnchors";
import {
  applyStrataEdgeStyle,
  type StrataEdgeStyleAnchors,
} from "./terraformPipelineStrataEdgeStyle";

import type {
  StrataModel,
  StrataPlacementResult,
} from "./terraformPipelineStrataTypes";

/**
 * GOLDEN parity fixtures. Each `plain` / `struct` value is the frozen output of
 * `computeTerraformChordAnchors` for that rect pair — captured once from the
 * extracted implementation and hard-coded here as literal numbers so the test
 * DOES NOT re-derive its expectation by calling the moved helpers
 * (`getCenterClippedBindingPoints` + `offsetLineSegment`), which would be
 * circular (the extracted `computeTerraformChordAnchors` is exactly that
 * composition — comparing it to itself proves nothing).
 *
 * Golden values frozen 2026-07-22 from the extracted implementation, which was
 * verified byte-identical to the pre-extraction inline code in
 * `repairTerraformEdgeBindings` by A/B freeze-regen (the extraction was a pure
 * move: same primitives, same order, same 18px offset).
 */
const PAIRS: Array<{
  name: string;
  rectA: EdgeAnchorRect;
  rectB: EdgeAnchorRect;
  plain: ChordAnchorPoints;
  struct: ChordAnchorPoints;
}> = [
  {
    name: "forward, offset rects",
    rectA: { x: 0, y: 0, width: 100, height: 40 },
    rectB: { x: 300, y: 200, width: 80, height: 60 },
    plain: {
      startPoint: { x: 77.61904761904762, y: 40 },
      endPoint: { x: 300, y: 201.0344827586207 },
    },
    struct: {
      startPoint: { x: 67.06187100031445, y: 54.57895818777438 },
      endPoint: { x: 289.4428233812668, y: 215.6134409463951 },
    },
  },
  {
    name: "backward (target left+up)",
    rectA: { x: 400, y: 300, width: 120, height: 50 },
    rectB: { x: 40, y: 20, width: 90, height: 40 },
    plain: {
      startPoint: { x: 427.10526315789474, y: 300 },
      endPoint: { x: 111.3157894736842, y: 60 },
    },
    struct: {
      startPoint: { x: 437.9967619734988, y: 285.66908050578417 },
      endPoint: { x: 122.20728828928824, y: 45.66908050578415 },
    },
  },
  {
    name: "vertical-major",
    rectA: { x: 100, y: 0, width: 60, height: 60 },
    rectB: { x: 110, y: 500, width: 60, height: 60 },
    plain: {
      startPoint: { x: 130.6, y: 60 },
      endPoint: { x: 139.4, y: 500 },
    },
    struct: {
      startPoint: { x: 112.60359892035987, y: 60.3599280215928 },
      endPoint: { x: 121.40359892035988, y: 500.3599280215928 },
    },
  },
  {
    name: "identical-center degenerate-ish",
    rectA: { x: 0, y: 0, width: 100, height: 100 },
    rectB: { x: 10, y: 10, width: 100, height: 100 },
    plain: {
      startPoint: { x: 100, y: 100 },
      endPoint: { x: 10, y: 10 },
    },
    struct: {
      startPoint: { x: 112.72792206135786, y: 87.27207793864214 },
      endPoint: { x: 22.727922061357855, y: -2.727922061357855 },
    },
  },
];

const expectAnchorsCloseTo = (
  got: ChordAnchorPoints,
  golden: ChordAnchorPoints,
) => {
  expect(got.startPoint.x).toBeCloseTo(golden.startPoint.x, 6);
  expect(got.startPoint.y).toBeCloseTo(golden.startPoint.y, 6);
  expect(got.endPoint.x).toBeCloseTo(golden.endPoint.x, 6);
  expect(got.endPoint.y).toBeCloseTo(golden.endPoint.y, 6);
};

describe("computeTerraformChordAnchors — golden parity with the inline repair composition (M2 §b)", () => {
  it("18px offset constant matches the repair literal", () => {
    expect(TERRAFORM_STRUCTURAL_DEP_CHORD_OFFSET_PX).toBe(18);
  });

  for (const { name, rectA, rectB, plain, struct } of PAIRS) {
    it(`${name}: plain branch (structuralPair=false) matches golden`, () => {
      expectAnchorsCloseTo(
        computeTerraformChordAnchors(rectA, rectB, { structuralPair: false }),
        plain,
      );
    });

    it(`${name}: structural-dependency branch (18px offset) matches golden`, () => {
      const got = computeTerraformChordAnchors(rectA, rectB, {
        structuralPair: true,
      });
      expectAnchorsCloseTo(got, struct);
      // The offset actually MOVED the endpoints (not a no-op branch) — asserted
      // as a property of two REAL outputs, not against a helper-derived value.
      const plainGot = computeTerraformChordAnchors(rectA, rectB, {
        structuralPair: false,
      });
      expect(got.startPoint).not.toEqual(plainGot.startPoint);
    });
  }
});

// ── (c) fallback: a missing keyed rect keeps the original chord endpoints ──

const model = null as unknown as StrataModel;
const placement = null as unknown as StrataPlacementResult;

const tfdArrow = (
  x: number,
  y: number,
  end: readonly [number, number],
  source: string,
  target: string,
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
      relationship: { source, target },
    },
  } as unknown as ExcalidrawElementSkeleton);

const absEndpoints = (el: ExcalidrawElementSkeleton) => {
  const e = el as unknown as {
    x: number;
    y: number;
    points: [number, number][];
  };
  const first = e.points[0]!;
  const last = e.points[e.points.length - 1]!;
  return {
    start: [e.x + first[0], e.y + first[1]] as [number, number],
    end: [e.x + last[0], e.y + last[1]] as [number, number],
  };
};

describe("applyStrataEdgeStyle — anchor fallback on a missing keyed rect (M2 §c)", () => {
  it("keeps the skeleton chord endpoints (and still styles + stamps) when a key has no body rect", () => {
    // Edge A→B: only A resolves to a body rect (B is missing) ⇒ fall back to the
    // skeleton chord endpoints. Edge C→D: both resolve ⇒ anchored endpoints.
    const missing = tfdArrow(0, 0, [200, 40], "A", "B");
    const anchored = tfdArrow(1000, 1000, [200, 40], "C", "D");
    const skeleton = [missing, anchored];

    const bodyRectByKey = new Map<string, EdgeAnchorRect>([
      ["A", { x: -10, y: -10, width: 40, height: 40 }],
      // "B" intentionally absent.
      ["C", { x: 980, y: 980, width: 60, height: 40 }],
      ["D", { x: 1240, y: 1180, width: 60, height: 40 }],
    ]);
    const anchors: StrataEdgeStyleAnchors = {
      bodyRectByKey,
      structuralPairKeys: new Set<string>(),
    };

    const meta = applyStrataEdgeStyle(
      skeleton,
      model,
      placement,
      "step",
      anchors,
    );
    expect(meta.styled).toBe(2);
    expect(meta.skipped).toBe(0);

    // Missing-key edge: endpoints unchanged from the original chord, still stamped.
    const mEl = skeleton[0] as ExcalidrawElementSkeleton & {
      customData: Record<string, unknown>;
    };
    expect(mEl.customData.terraformRoutedPolyline).toBe(true);
    expect(mEl.customData.terraformRoutedBy).toBe("style");
    const mAbs = absEndpoints(skeleton[0]!);
    expect(mAbs.start).toEqual([0, 0]);
    expect(mAbs.end).toEqual([200, 40]);

    // Anchored edge: endpoints moved to the shared chord anchors (NOT the chord).
    const expected = computeTerraformChordAnchors(
      bodyRectByKey.get("C")!,
      bodyRectByKey.get("D")!,
      { structuralPair: false },
    );
    const aAbs = absEndpoints(skeleton[1]!);
    expect(aAbs.start[0]).toBeCloseTo(expected.startPoint.x, 6);
    expect(aAbs.start[1]).toBeCloseTo(expected.startPoint.y, 6);
    expect(aAbs.end[0]).toBeCloseTo(expected.endPoint.x, 6);
    expect(aAbs.end[1]).toBeCloseTo(expected.endPoint.y, 6);
    // And it is genuinely different from the un-anchored chord end [1200,1040].
    expect(aAbs.end).not.toEqual([1200, 1040]);
  });
});
