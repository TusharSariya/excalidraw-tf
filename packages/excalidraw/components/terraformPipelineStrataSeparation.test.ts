/**
 * Strata shared SEPARATION predicate — unit tests.
 *
 * The predicate exists because the post-A7 movers re-place boxes WITHOUT going
 * through A0's `dropY`, and neither `checkStrataStructure` (raw boxes + STRICT
 * overlap ⇒ touching is not overlapping) nor the packed scorer (prices length,
 * not clearance) can reject a flush placement. See the module header.
 *
 * Covers:
 *   (a) DRIFT GUARD: the gap values reproduce placement.ts `gapBetween` (packed
 *       arm) and coordRefine.ts `minGap` (both arms). Those two are module-
 *       private, so this pins the shared copy against the SHARED CONSTANTS they
 *       are both built from — if LANE/CLUSTER ever diverge, this fails.
 *   (b) X-overlap is STRICT (abutting extents are disjoint, owe nothing)
 *   (c) banded policy constrains EVERY pair regardless of X
 *   (d) strataSeparationOk accepts/rejects on the owed gap
 *   (e) strataSeparatedTops emits gap-correct seats, and raw tops only for
 *       genuinely unconstrained blocks
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataSeparation.test.ts
 */
import { describe, expect, it } from "vitest";

import {
  PIPELINE_CLUSTER_GAP_Y,
  PIPELINE_LANE_GAP_Y,
} from "./terraformPipelineLayoutShared";
import {
  strataBlocksConstrain,
  strataGapBetween,
  strataSeparatedTops,
  strataSeparationOk,
  strataVerticalClearance,
  strataXOverlaps,
} from "./terraformPipelineStrataSeparation";

import type { StrataSeparationBlock } from "./terraformPipelineStrataSeparation";

const box = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
});

// ── (a) drift guard ───────────────────────────────────────────────────────────

describe("strataGapBetween — mirrors the canonical gap rule", () => {
  it("packed: LANE if either block is a hull, else CLUSTER (placement gapBetween)", () => {
    expect(strataGapBetween("packed", false, false)).toBe(
      PIPELINE_CLUSTER_GAP_Y,
    );
    expect(strataGapBetween("packed", true, false)).toBe(PIPELINE_LANE_GAP_Y);
    expect(strataGapBetween("packed", false, true)).toBe(PIPELINE_LANE_GAP_Y);
    expect(strataGapBetween("packed", true, true)).toBe(PIPELINE_LANE_GAP_Y);
  });

  it("banded: LANE unconditionally — a full-width stack (coordRefine minGap)", () => {
    expect(strataGapBetween("banded", false, false)).toBe(PIPELINE_LANE_GAP_Y);
    expect(strataGapBetween("banded", true, false)).toBe(PIPELINE_LANE_GAP_Y);
    expect(strataGapBetween("banded", true, true)).toBe(PIPELINE_LANE_GAP_Y);
  });

  it("the leaf<->leaf gap still clears a frame's name label (36 > 20.5)", () => {
    // Frame labels render ABOVE the box (FRAME_STYLE.nameOffsetY); the band is
    // PIPELINE_FRAME_TITLE_HEIGHT = 20.5. The gap is what clears it — which is
    // why the predicate needs no separate title term. If CLUSTER_GAP_Y ever
    // drops below the label band, flush titles come back and this fails.
    expect(PIPELINE_CLUSTER_GAP_Y).toBeGreaterThan(20.5);
  });
});

// ── (b)(c) the constrains predicate ───────────────────────────────────────────

describe("strataXOverlaps / strataBlocksConstrain", () => {
  it("is STRICT: abutting X-extents do NOT overlap", () => {
    // [0,100) and [100,200) touch at 100 — disjoint, so they may share a Y-row.
    expect(strataXOverlaps(box(0, 0, 100, 10), box(100, 0, 100, 10))).toBe(
      false,
    );
    expect(strataXOverlaps(box(0, 0, 100, 10), box(99, 0, 100, 10))).toBe(true);
  });

  it("packed: only X-overlapping blocks constrain", () => {
    expect(
      strataBlocksConstrain("packed", box(0, 0, 100, 10), box(500, 0, 100, 10)),
    ).toBe(false);
  });

  it("banded: EVERY pair constrains, even X-disjoint ones (full-width bands)", () => {
    expect(
      strataBlocksConstrain("banded", box(0, 0, 100, 10), box(500, 0, 100, 10)),
    ).toBe(true);
  });
});

describe("strataVerticalClearance", () => {
  it("is the gap when disjoint and NEGATIVE when overlapping", () => {
    expect(strataVerticalClearance(box(0, 0, 10, 100), box(0, 140, 10, 100)));
    expect(
      strataVerticalClearance(box(0, 0, 10, 100), box(0, 140, 10, 100)),
    ).toBe(40);
    // symmetric
    expect(
      strataVerticalClearance(box(0, 140, 10, 100), box(0, 0, 10, 100)),
    ).toBe(40);
    // overlapping ⇒ negative
    expect(
      strataVerticalClearance(box(0, 0, 10, 100), box(0, 50, 10, 100)),
    ).toBeLessThan(0);
  });
});

// ── (d) the validity predicate ────────────────────────────────────────────────

describe("strataSeparationOk", () => {
  const leafAbove: StrataSeparationBlock = {
    box: box(0, 0, 100, 60),
    isHull: false,
  };

  it("REJECTS a flush seat against an X-overlapping leaf (the reported defect)", () => {
    // top == sibling's bottom ⇒ gap 0. This is precisely the seat the old raw
    // `sib.y + sib.height` candidate asked for, and R2 cannot see it.
    expect(
      strataSeparationOk(box(0, 60, 100, 60), false, [leafAbove], "packed"),
    ).toBe(false);
  });

  it("ACCEPTS a seat exactly one CLUSTER_GAP_Y below (the boundary is inclusive)", () => {
    expect(
      strataSeparationOk(
        box(0, 60 + PIPELINE_CLUSTER_GAP_Y, 100, 60),
        false,
        [leafAbove],
        "packed",
      ),
    ).toBe(true);
    // one pixel tighter must fail
    expect(
      strataSeparationOk(
        box(0, 60 + PIPELINE_CLUSTER_GAP_Y - 1, 100, 60),
        false,
        [leafAbove],
        "packed",
      ),
    ).toBe(false);
  });

  it("ACCEPTS a flush seat when X-DISJOINT (sharing a Y-row is the skyline's job)", () => {
    expect(
      strataSeparationOk(box(500, 60, 100, 60), false, [leafAbove], "packed"),
    ).toBe(true);
  });

  it("demands the WIDER lane gap when the neighbour is a framed hull", () => {
    const hullAbove: StrataSeparationBlock = {
      box: box(0, 0, 100, 60),
      isHull: true,
    };
    expect(
      strataSeparationOk(
        box(0, 60 + PIPELINE_CLUSTER_GAP_Y, 100, 60),
        false,
        [hullAbove],
        "packed",
      ),
    ).toBe(false);
    expect(
      strataSeparationOk(
        box(0, 60 + PIPELINE_LANE_GAP_Y, 100, 60),
        false,
        [hullAbove],
        "packed",
      ),
    ).toBe(true);
  });

  it("banded: an X-DISJOINT neighbour still owes the lane gap", () => {
    expect(
      strataSeparationOk(box(500, 60, 100, 60), false, [leafAbove], "banded"),
    ).toBe(false);
    expect(
      strataSeparationOk(
        box(500, 60 + PIPELINE_LANE_GAP_Y, 100, 60),
        false,
        [leafAbove],
        "banded",
      ),
    ).toBe(true);
  });
});

// ── (e) the seat generator ────────────────────────────────────────────────────

describe("strataSeparatedTops", () => {
  it("emits gap-correct seats above and below an X-overlapping block", () => {
    const others: StrataSeparationBlock[] = [
      { box: box(0, 100, 100, 60), isHull: false },
    ];
    const tops = strataSeparatedTops(0, 100, 60, false, others, "packed");
    // below: 160 + 36 = 196 ; above: 100 - 36 - 60 = 4
    expect(tops).toContain(196);
    expect(tops).toContain(4);
    // and crucially NOT the raw flush boundary
    expect(tops).not.toContain(160);
    // every emitted seat is actually valid against that block
    for (const top of tops) {
      expect(
        strataSeparationOk(box(0, top, 100, 60), false, others, "packed"),
      ).toBe(true);
    }
  });

  it("emits the RAW top for an unconstrained (X-disjoint) block — row sharing", () => {
    const others: StrataSeparationBlock[] = [
      { box: box(500, 100, 100, 60), isHull: false },
    ];
    const tops = strataSeparatedTops(0, 100, 60, false, others, "packed");
    expect(tops).toEqual([100]);
  });
});
