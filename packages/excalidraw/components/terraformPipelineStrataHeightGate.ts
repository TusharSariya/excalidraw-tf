/**
 * Strata engine — P5 / Lever C: the per-hull implied-height acceptance gate
 * (`strataHeightGate`, default off).
 *
 * WHAT IT IS: a pure boolean PRECONDITION on candidate adoption — accept a
 * candidate only if EVERY hull's implied content height is maintained-or-
 * decreased against the incumbent. It is a GATE, never an objective term.
 *
 * WHY A GATE AND NOT A SCORE: empirical readability research ranks box height as
 * the WEAKEST comprehension driver (crossings > path-continuity/angle > pierces
 * >> height). Pricing height would let it trade against crossings. So this module
 * does NOT enter `StrataPackedScore` ({crossings, penetrations, lengthL1}), does
 * NOT touch `strataWeightedCross`, does NOT touch `strataRelocateScoreLess`'s
 * (weightedCross, lengthL1) key, and does NOT touch the ε-band or `edgeCrossCap`.
 * Those keep refereeing readability exactly as before; this only removes
 * candidates from the set they referee.
 *
 * MONOTONICITY: compare against the ROLLING INCUMBENT, never the baseline. Both
 * consuming passes thread `let incumbent = placement` and reassign only on
 * adoption, so with this gate as a conjunct on every adoption,
 * `∀h: impliedHeight(incumbent_{n+1}, h) <= impliedHeight(incumbent_n, h)`; by
 * induction every hull's final height ≤ its baseline height. That is why the gate
 * provably cannot regress rankSeparate's -42% height win. NOTE the honest limit:
 * this bounds HEIGHT only — adoption is greedy per-candidate, so vetoing an early
 * candidate changes the trajectory and crossings/length are NOT monotone under
 * the gate (`strataRelocateAdoptable`'s cap+ε still bounds crossings vs baseline).
 *
 * WHY PER-HULL IMPLIED, NOT THE STORED BOX, AND NOT A SCENE SCALAR:
 *   • The stored `box.height` is USELESS here: both consuming operators hold hull
 *     boxes FIXED (block-clamp shifts x only),
 *     so no stored height can change today and a gate over stored heights is
 *     provably vacuous. The metric must read what the box WOULD be, recomputed
 *     from the candidate's contents.
 *   • A scene-global `max(y + height)` scalar is the SHIPPED BUG this replaces
 *     (the former `maxBottomOf` in terraformPipelineStrataBlockClamp.ts): it is
 *     dominated by the tallest/root extent and is structurally blind to a
 *     non-tallest hull growing. Pinned by the vacuity regression test.
 *
 * NESTING IS SOUND WITHOUT A BOTTOM-UP PASS: a parent's `placed` list carries a
 * child hull's STORED box height, so if child C's implied height grows, parent P
 * would not see it (P still reads C's stale stored box). That hole closes for
 * free — C's OWN entry in the ∀ catches it. Checking every hull independently is
 * therefore a complete reject rule.
 *
 * Import-cycle rule (SDEC NaN): no module-level consts derived from
 * terraformPipelineLayoutShared — `PIPELINE_FRAME_PAD` is read at call time (a
 * module-level `PAD * 2` freezes as NaN; a real, test-caught failure here).
 */
import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";

import type {
  StrataHullRole,
  StrataPlacementResult,
} from "./terraformPipelineStrataTypes";

/** Call-time reads (never module-level — pre-existing LayoutShared import cycle). */
const framePad = (): number => PIPELINE_FRAME_PAD;
/** Title strip reserved at the top of a non-root hull box (HULL_TITLE_BAND). */
const titleReserve = (): number => PIPELINE_FRAME_PAD * 2;
/** Content top inset of a hull box (root carries no title strip). */
const topInsetOf = (role: StrataHullRole): number =>
  framePad() + (role === "root" ? 0 : titleReserve());

/**
 * Every hull's IMPLIED content height — what `placeStrataHulls` would store as
 * `box.height` for the given contents.
 *
 * Mirrors placeStrataHulls step 5 (terraformPipelineStrataPlacement.ts:346-360)
 * VERBATIM, or the gate would compare apples to oranges:
 *
 *   maxBottom     = max(topInset, max over placed of (localYTop + height))
 *   impliedHeight = maxBottom + FRAME_PAD
 *
 * `p.box.y - bh.box.y` reconstructs `localYTop` exactly, because `assignAbsolute`
 * sets `box.y = absTop` and `unitTop = absTop + localYTop`. The empty-hull case
 * falls out of the `topInset` seed, matching :352-355.
 *
 * Pinned to the placer's own arithmetic by the anti-vacuity ANCHOR test, which
 * asserts this reproduces `box.height` exactly for every hull on a real
 * placement. Without that anchor a future refactor silently re-vacuates the gate.
 */
export function strataHullImpliedHeights(
  placement: StrataPlacementResult,
): Map<string, number> {
  const out = new Map<string, number>();
  const pad = framePad();
  for (const [id, bh] of placement.boxedHulls) {
    let maxBottom = topInsetOf(bh.hull.role);
    for (const pu of bh.placed) {
      const localBottom = pu.box.y + pu.box.height - bh.box.y;
      if (localBottom > maxBottom) {
        maxBottom = localBottom;
      }
    }
    out.set(id, maxBottom + pad);
  }
  return out;
}

/**
 * The gate predicate: `∀ hull ∈ candidate: impliedHeight(cand, h) <=
 * impliedHeight(incumbent, h)`. Strict per-hull universal quantification — any
 * single hull growing rejects the whole candidate. A hull absent from the
 * incumbent is treated as new content and rejected (defensive; the consuming
 * operators never add hulls).
 *
 * Cost: O(Σ|placed|) integer ops — three orders of magnitude below the
 * `scoreStrataPlacementGeometry` O(E²) call already paid per candidate, so
 * callers put this BEFORE the scorer (and before the O(entries²) R2 check) to
 * strictly save work on rejected candidates.
 */
export function strataHeightGateAdmits(
  candidate: StrataPlacementResult,
  incumbent: StrataPlacementResult,
): boolean {
  const candHeights = strataHullImpliedHeights(candidate);
  const incHeights = strataHullImpliedHeights(incumbent);
  for (const [id, candH] of candHeights) {
    const incH = incHeights.get(id);
    if (incH === undefined || candH > incH) {
      return false;
    }
  }
  return true;
}
