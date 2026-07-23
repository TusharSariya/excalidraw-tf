/**
 * Strata engine — shared sibling SEPARATION predicate (the stacked-gap invariant).
 *
 * WHY THIS MODULE EXISTS:
 *
 * A0 placement (terraformPipelineStrataPlacement.ts) establishes a standing
 * geometric invariant its header states as "POSITIVE SIBLING GAPS keep
 * frames+titles disjoint". `dropY` is what enforces it: a block only ever lands
 * at `rect.y1 + gapBetween(rect.isHull, isHull)` below any rect whose X-extent it
 * overlaps.
 *
 * That gap is LOAD-BEARING, not cosmetic. Every frame — hull AND leaf — renders
 * its name label OUTSIDE the box, in negative-y space above the top edge
 * (`FRAME_STYLE.nameOffsetY`; `PIPELINE_FRAME_TITLE_HEIGHT` = 20.5px codifies the
 * band). The sibling gap is the ONLY thing that clears that label from the box
 * stacked above — which is why it widens to LANE_GAP_Y once a framed hull is
 * involved, and why the leaf↔leaf CLUSTER_GAP_Y (36) still comfortably exceeds
 * 20.5. At gap 0 the label lands ON the box above: the reported defect.
 *
 * A LEAF CARRIES A LABEL TOO — do not "simplify" this away. A reviewer argued the
 * leaf arm is moot because strata builds leaf cluster frames with `name: ""` and
 * therefore "unnamed leaves render no label". That is FALSE and the reported
 * screenshot is the counterexample: `newElement` coerces the falsy `""` to `null`
 * (`name: opts?.name || null`), and `getFrameLikeTitle` maps `null` to
 * `DEFAULT_FRAME_NAME` — so every such leaf renders a literal "Frame" label above
 * its box. The compact builder's "no title" intent does not produce "no title".
 *
 * (Caveat for the next reader: placement.ts's "title inside the box" parenthetical
 * and V2Pack's "renders the title inside the top border" are both WRONG about the
 * renderer — the label is above the box, per FRAME_STYLE/scene export. The
 * separate `TITLE_RESERVE` strip reserved INSIDE a hull box is a different
 * mechanism and is not what clears the label. Because 36 > 20.5 already, this
 * predicate needs NO title term — adding one would invent a constant.)
 *
 * The post-A7 MOVERS (`refineStrataVerticalSlots`, `refineStrataBlockClamp`)
 * re-place boxes WITHOUT going through `dropY`. Each independently rebuilt a
 * candidate-Y set out of RAW sibling boundaries (`sib.y` and `sib.y + sib.height`)
 * with no gap term, so "sink's top == sibling's bottom" — a zero-gap, flush
 * stack — was a first-class candidate. Nothing downstream rejected it:
 *
 *   - `checkStrataStructure` builds its entries from RAW boxes and tests them
 *     with a STRICT `boxesOverlap` (`a.y + a.height > b.y`), so two boxes that
 *     exactly touch are provably NOT an overlap. The R2 gate is blind to it.
 *   - the packed scorer prices crossings/penetrations/length, not clearance, and
 *     a pull-in strictly shortens its own edge — so the scorer ACTIVELY PREFERS
 *     the flush placement.
 *
 * Result: gate-approved, structurally "clean", visibly broken geometry — frames
 * butted edge-to-edge with their titles overlapping the box above (the reported
 * "no margin/padding" defect).
 *
 * This module is the single source of truth for that invariant so the movers
 * enforce the SAME rule `dropY` does instead of each carrying its own copy of a
 * raw-boundary hack. `strataGapBetween` here and `gapBetween` in placement.ts are
 * pinned equal by a test.
 *
 * Import-cycle rule (SDEC NaN): no module-level consts derived from
 * terraformPipelineLayoutShared — the gap constants are read at CALL TIME. This
 * module sits inside the pre-existing terraformPlanParsing→terraformLayoutCore
 * cycle; a module-level `PIPELINE_LANE_GAP_Y` binding can still be `undefined` at
 * module-init and would freeze as NaN.
 */
import {
  PIPELINE_CLUSTER_GAP_Y,
  PIPELINE_LANE_GAP_Y,
} from "./terraformPipelineLayoutShared";

import type { StrataBox } from "./terraformPipelineStrataTypes";

/** A block that a candidate must stay clear of. `isHull` selects the gap width. */
export type StrataSeparationBlock = {
  box: StrataBox;
  /** True iff the block is a framed hull (wider gap clears its border + title). */
  isHull: boolean;
};

/**
 * The stacked gap owed between two blocks inside a hull of the given POLICY.
 *
 * Policy-aware because the two placement policies space their children
 * differently, and a mover must reproduce whichever one owns the block it moves:
 *
 *   - BANDED (provider/account/root): a full-width vertical stack, so placement
 *     advances `cursor += height + PIPELINE_LANE_GAP_Y` unconditionally — every
 *     band pair owes the WIDE gap regardless of hull/leaf, because full-width
 *     bands always overlap in X.
 *   - PACKED (region/vpc/subnetZone): the `dropY` skyline, which owes
 *     LANE_GAP_Y only when a framed hull is involved (clearing its border +
 *     title) and the tighter CLUSTER_GAP_Y between two plain leaf cards.
 *
 * This is the SINGLE SOURCE OF TRUTH, not a fourth copy: placement.ts's
 * `gapBetween` and coordRefine.ts's `minGap` are now thin delegators to this
 * function, so drift is impossible by construction rather than by a pinning test
 * (an earlier revision of this header claimed "a test pins all three equal" —
 * that was FALSE while they were independent private implementations, since a
 * test can only reach this copy). Call-time constant reads only (SDEC NaN rule).
 *
 * E3.3 `rowGap` (default 1): a scale factor that widens the vertical stacked gap
 * for edge-routing corridors. Both base constants are scaled multiplicatively and
 * rounded to an integer px, at CALL TIME (never a module-level derived const — the
 * SDEC NaN rule). `rowGap === 1` reproduces the base constants exactly
 * (`Math.round(k * 1) === k`), so the off path is byte-identical. The factor
 * threads identically through placement's `dropY`/banded stack and coordRefine's
 * `minGap`, so "minGap mirrors A0 placement byte-for-byte" holds at any factor.
 */
export function strataGapBetween(
  policy: "banded" | "packed",
  aIsHull: boolean,
  bIsHull: boolean,
  rowGap: number = 1,
): number {
  const lane = Math.round(PIPELINE_LANE_GAP_Y * rowGap);
  const cluster = Math.round(PIPELINE_CLUSTER_GAP_Y * rowGap);
  if (policy === "banded") {
    return lane;
  }
  return aIsHull || bIsHull ? lane : cluster;
}

/**
 * `dropY`'s X-overlap predicate, verbatim (`x0 < rect.x1 && rect.x0 < x1`) and
 * deliberately STRICT: blocks whose X-extents merely abut are X-disjoint and owe
 * each other NO vertical gap. This is what lets X-disjoint siblings legitimately
 * share a Y-row, so the predicate must not over-constrain them.
 *
 * Extents are used RAW. The padding is already baked in by construction — a hull
 * unit's box is `minX0 - FRAME_PAD .. maxX1 + FRAME_PAD` and a leaf's is its true
 * `clusterFrameLocalRect` width. Placement's "ACTUAL padded x-extent" wording
 * contrasts pixel extents against integer `colSpan` rank indices; it does NOT ask
 * callers to add FRAME_PAD. Adding it here would double-count.
 */
export function strataXOverlaps(a: StrataBox, b: StrataBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width;
}

/**
 * Whether two blocks in a hull of the given POLICY constrain each other in Y —
 * mirrors coordRefine.ts's private `blocksConstrain`.
 *
 * A BANDED hull is a FULL-WIDTH vertical stack: every band spans the hull, so
 * every pair overlaps in X by construction and the X test is skipped (returning
 * `true` unconditionally is not a shortcut — it is the geometry). Only a PACKED
 * hull's skyline admits X-disjoint siblings sharing a Y-row.
 *
 * Consequence worth naming: in a banded hull a leaf owes LANE_GAP_Y (96) to every
 * sibling, X-disjoint or not, which will decline most pulls there. That is
 * deliberate — it is exactly what A0/A7 encode, and a mover that declines is the
 * conservative failure. It is NOT relaxed to packed semantics for convenience.
 */
export function strataBlocksConstrain(
  policy: "banded" | "packed",
  a: StrataBox,
  b: StrataBox,
): boolean {
  return policy === "banded" ? true : strataXOverlaps(a, b);
}

/**
 * Signed vertical clearance between two boxes: the gap if they are vertically
 * disjoint, otherwise NEGATIVE (the overlap depth). Ignores X entirely — callers
 * gate on {@link strataXOverlaps} first.
 */
export function strataVerticalClearance(a: StrataBox, b: StrataBox): number {
  const aAboveB = b.y - (a.y + a.height);
  const bAboveA = a.y - (b.y + b.height);
  return Math.max(aAboveB, bAboveA);
}

/**
 * True iff `cand` honors the stacked-gap invariant against every block in
 * `others` — i.e. for each block whose X-extent it overlaps, the vertical
 * clearance is at least `strataGapBetween`. X-disjoint blocks are unconstrained.
 *
 * This is an ABSOLUTE predicate, not a non-regression one: A0 placement always
 * emits separation-valid geometry, so any candidate that fails is introducing the
 * violation and must be rejected outright. If a mover finds no valid candidate it
 * simply declines to move — the conservative outcome.
 */
export function strataSeparationOk(
  cand: StrataBox,
  candIsHull: boolean,
  others: readonly StrataSeparationBlock[],
  policy: "banded" | "packed",
  rowGap: number = 1,
): boolean {
  for (const other of others) {
    if (!strataBlocksConstrain(policy, cand, other.box)) {
      continue;
    }
    if (
      strataVerticalClearance(cand, other.box) <
      strataGapBetween(policy, other.isHull, candIsHull, rowGap)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Every separation-respecting TOP a box of height `h` at X-extent [x, x+w) can
 * take relative to `others` — the gap-correct replacement for pushing raw
 * `sib.y` / `sib.y + sib.height` boundaries.
 *
 * For each block it would collide with, two slots are proposed: seated directly
 * BELOW it (`box.y1 + gap`) and directly ABOVE it (`box.y0 - gap - h`). Blocks
 * that are X-disjoint from the candidate column contribute their raw top
 * (`box.y`) instead — sharing a Y-row with an X-disjoint sibling is exactly what
 * the packed skyline is for, and it owes no gap.
 *
 * The returned tops are NOT filtered against the full `others` set (a slot cut
 * for block A can still collide with block B) and are NOT clamped to the parent
 * box — callers must still run {@link strataSeparationOk} and their own
 * containment clamp. This only guarantees the CANDIDATE SET contains the
 * gap-correct seats, so a mover's slot budget is spent on placements that can
 * actually be adopted rather than on flush ones that should never be.
 */
export function strataSeparatedTops(
  x: number,
  w: number,
  h: number,
  candIsHull: boolean,
  others: readonly StrataSeparationBlock[],
  policy: "banded" | "packed",
  rowGap: number = 1,
): number[] {
  const probe: StrataBox = { x, y: 0, width: w, height: h };
  const tops: number[] = [];
  for (const other of others) {
    if (!strataBlocksConstrain(policy, probe, other.box)) {
      // Unconstrained (packed + X-disjoint): sharing this block's Y-row is
      // exactly what the skyline is for, so its raw top is a legal seat.
      tops.push(other.box.y);
      continue;
    }
    const gap = strataGapBetween(policy, other.isHull, candIsHull, rowGap);
    tops.push(other.box.y + other.box.height + gap);
    tops.push(other.box.y - gap - h);
  }
  return tops;
}
