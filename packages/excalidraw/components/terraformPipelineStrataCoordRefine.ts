/**
 * Strata engine — A7 coordinate assignment (Y refinement, WP-3b / M1b).
 *
 * Spec: docs/rcll-v2-spec-v2.md §6-A7 ("priority/median nudge", OD-5 Option 1),
 * amended by v3.1. Runs AFTER A0 fixes X + within-hull order; refines Y to
 * straighten E′ chords without violating order, hull bands, or non-overlap. It
 * transforms a finished {@link StrataPlacementResult} into a new one (pure
 * function; two runs over the same inputs are deep-equal), gated by the engine's
 * `coordinateRefine` flag — when OFF the engine never calls this, so flag-off
 * geometry is byte-identical to A0.
 *
 * Objective (per hull h, respecting A0 bands): minimize Σ over E′-chords whose
 * LCA is h of |yCenter(source) − yCenter(target)|, subject to (a) the A2
 * within-column order is preserved, (b) blocks stay inside h (h grows to fit),
 * (c) min gaps maintained.
 *
 * Method — Option 1 fixed sweep (2 down + 2 up), per column in sweep direction:
 *   1. target y = median of the block's E′-neighbours' centres in the swept-from
 *      direction (down: neighbours whose home column is STRICTLY LESS; up:
 *      STRICTLY GREATER — the coherent OD-3A reading, long edges as direct
 *      chords, same-column partners excluded from the median but still counted
 *      in acceptance);
 *   2. project the swept column's movable blocks once onto the order-preserving,
 *      gap-preserving, fixed-neighbour-clamped feasible set (pool-adjacent-
 *      violators isotonic regression + a monotone box clamp — Jacobi batch, not
 *      Gauss-Seidel, so within-column results are order-free);
 *   3. accept the column iff the GLOBAL Σ|Δy| over the hull's chords strictly
 *      decreases and the projection is feasible; else keep the prior positions.
 *
 * Nesting is bottom-up: children refine first (then a child hull is RIGID at the
 * parent level, moving as one block of its recomputed height); after all hulls
 * refine, hull extents recompute bottom-up (A0 step 5) and absolute coordinates
 * re-apply top-down. A7 output is final only after this re-anchoring pass, and an
 * in-engine R2 dev-assert runs immediately after it — a violation throws with the
 * "Strata A7 " prefix so the engine degrades honestly to the v2 fallback.
 *
 * Determinism (C3′): fixed sweep counts, pinned tiebreaks (content comparator on
 * ids for equal Y; even-count median = MEAN of the two central order statistics),
 * no RNG / wall-clock — statically asserted by the finalize test suite over the
 * `terraformPipelineStrata*` module family. Spacing constants are CALL-TIME reads
 * (never module-level consts derived from LayoutShared — the
 * planParsing→layoutCore import cycle froze such a const as NaN in W2, SDEC-34).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataCoordRefine.test.ts
 */
import {
  PIPELINE_FRAME_PAD,
  PIPELINE_MARGIN,
} from "./terraformPipelineLayoutShared";
import {
  liftStrataEdgesToUnits,
  strataUnitId,
} from "./terraformPipelineStrataOrdering";
import { checkStrataStructure } from "./terraformPipelineStrataPlacement";
import { strataGapBetween } from "./terraformPipelineStrataSeparation";
import { compareStrataContentKeys } from "./terraformPipelineStrataTypes";

import type {
  StrataBox,
  StrataBoxedHull,
  StrataHullNode,
  StrataModel,
  StrataPlacedUnit,
  StrataPlacementResult,
  StrataPrimeEdge,
  StrataUnit,
} from "./terraformPipelineStrataTypes";

// ── call-time spacing reads (never module-level consts, SDEC-34) ───────────────
/** Title strip reserved at the top of a non-root hull box (HULL_TITLE_BAND). */
const titleReserve = (): number => PIPELINE_FRAME_PAD * 2;
/** Frame pad on every hull side. */
const framePad = (): number => PIPELINE_FRAME_PAD;

/**
 * Minimum vertical gap between two consecutive blocks in a hull. Mirrors A0
 * placement exactly (so a no-op refinement reproduces A0 byte-for-byte): a
 * BANDED hull stacks every band with `PIPELINE_LANE_GAP_Y`; a PACKED hull uses
 * the skyline `gapBetween` (LANE_GAP_Y if either block is a framed child hull,
 * else the tighter CLUSTER_GAP_Y between two plain leaf cards).
 */
function minGap(
  policy: "banded" | "packed",
  aIsHull: boolean,
  bIsHull: boolean,
  rowGap: number = 1,
): number {
  // Delegates to the SHARED rule (terraformPipelineStrataSeparation.ts) so this
  // pass, A0 placement, and the post-A7 movers cannot drift apart. The E3.3
  // `rowGap` factor is the SAME one A0 placement used (both read the resolved
  // `strataRowGap`), so "minGap mirrors A0 byte-for-byte" holds at any factor.
  return strataGapBetween(policy, aIsHull, bIsHull, rowGap);
}

/** Numerical noise floor for feasibility + strict-decrease comparisons. */
const EPS = 1e-6;

/** Fixed sweep schedule (spec default: 2 down + 2 up, alternating, OD-2 order). */
const SWEEP_DIRECTIONS = ["down", "up", "down", "up"] as const;
type SweepDir = typeof SWEEP_DIRECTIONS[number];

// ── pure numeric helpers (exported for unit tests) ────────────────────────────

/**
 * L1 median of a multiset of values (the minimiser of Σ|x − vᵢ|). Even-count
 * convention is PINNED to the MEAN of the two central order statistics (a
 * deterministic true median; any point in the central interval is L1-optimal, so
 * this choice is a determinism tiebreak, not a correctness one).
 */
export function l1Median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Pool-adjacent-violators isotonic regression: the monotone non-decreasing
 * least-squares fit to `targets` (equal weights). Classic O(n) stack algorithm;
 * pooled blocks take the mean of their targets. Deterministic.
 */
function pavMonotone(targets: readonly number[]): number[] {
  const stack: { val: number; w: number }[] = [];
  for (const t of targets) {
    let cur = { val: t, w: 1 };
    while (stack.length > 0 && stack[stack.length - 1]!.val > cur.val + EPS) {
      const prev = stack.pop()!;
      const w = prev.w + cur.w;
      cur = { val: (prev.val * prev.w + cur.val * cur.w) / w, w };
    }
    stack.push(cur);
  }
  const out: number[] = [];
  for (const b of stack) {
    for (let k = 0; k < b.w; k++) {
      out.push(b.val);
    }
  }
  return out;
}

/**
 * Project a column's blocks (in current Y order) onto the feasible set:
 *   pₙ ≥ pₙ₋₁ + gaps[n−1]   (order + min-gap)   and   loᵢ ≤ pᵢ ≤ hiᵢ  (clamps)
 * minimising Σ(pᵢ − targetsᵢ)² via PAV in gap-removed coordinates, then a
 * monotone box clamp. Returns the projected positions, or `null` when the box +
 * monotone constraints are jointly infeasible (⇒ the caller REJECTS the move).
 *
 * `gaps` has length `n − 1` (gap between block i and i+1). `lo`/`hi` are the
 * per-block clamps (use `+Infinity` for an absent upper bound). The result is
 * feasible but not the box-constrained least-squares optimum — the exact optimum
 * is unnecessary because acceptance re-gates on the global objective, and a
 * deterministic feasible projection is all the nudge needs.
 */
export function isotonicWithGaps(
  targets: readonly number[],
  gaps: readonly number[],
  lo: readonly number[],
  hi: readonly number[],
): number[] | null {
  const n = targets.length;
  if (n === 0) {
    return [];
  }
  // offsetᵢ = Σ_{k<i} gaps[k]; the substitution uᵢ = pᵢ − offsetᵢ turns the
  // min-gap chain pᵢ₊₁ ≥ pᵢ + gapᵢ into plain monotonicity uᵢ₊₁ ≥ uᵢ.
  const offset = new Array<number>(n);
  offset[0] = 0;
  for (let i = 1; i < n; i++) {
    offset[i] = offset[i - 1]! + gaps[i - 1]!;
  }
  const tau = targets.map((t, i) => t - offset[i]!);
  const loU = lo.map((v, i) => v - offset[i]!);
  const hiU = hi.map((v, i) => v - offset[i]!);

  // Effective bounds that a monotone sequence must satisfy: Lᵢ non-decreasing,
  // Uᵢ non-decreasing; infeasible iff any Lᵢ > Uᵢ.
  const L = new Array<number>(n);
  const U = new Array<number>(n);
  L[0] = loU[0]!;
  for (let i = 1; i < n; i++) {
    L[i] = Math.max(loU[i]!, L[i - 1]!);
  }
  U[n - 1] = hiU[n - 1]!;
  for (let i = n - 2; i >= 0; i--) {
    U[i] = Math.min(hiU[i]!, U[i + 1]!);
  }
  for (let i = 0; i < n; i++) {
    if (L[i]! > U[i]! + EPS) {
      return null; // empty feasible set ⇒ reject
    }
  }

  const p = pavMonotone(tau);
  // Clamp the monotone PAV fit into [Lᵢ, Uᵢ]. With p, L, U all non-decreasing and
  // Lᵢ ≤ Uᵢ, min(max(pᵢ, Lᵢ), Uᵢ) stays non-decreasing and inside every box.
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const clamped = Math.min(Math.max(p[i]!, L[i]!), U[i]!);
    out[i] = clamped + offset[i]!;
  }
  return out;
}

// ── mutable local model (rebuilt from the absolute placement) ─────────────────

/** One movable block of a hull: a direct leaf or a rigid child-hull box. */
type RefBlock = {
  kind: "hull" | "leaf";
  /** {@link strataUnitId} (namespaced) — the chord/adjacency key. */
  id: string;
  /** Leaf clusterId or child hullId (for leafBoxes / childById lookup). */
  memberId: string;
  x0: number;
  x1: number;
  /** Home column = colSpan.min (leaf: its rank; child hull: min over members). */
  homeColumn: number;
  colSpan: readonly [number, number];
  /** Box height (a child hull's grows when it refines) — mutable. */
  height: number;
  /** Top relative to the owning hull's box top — mutable (the refined output). */
  top: number;
  unit: StrataUnit;
};

/** A hull laid out in local Y; X is already global + fixed. */
type RefHull = {
  hull: StrataHullNode;
  policy: "banded" | "packed";
  /**
   * The policy A7's CONSTRAINTS follow — always the hull's RESOLVED `policy`
   * (fully-generic: a packed hull uses geometric x-overlap at
   * `blocksConstrain` + leaf-leaf CLUSTER gaps at `minGap`, mirroring the A0
   * skyline it was placed with; a banded hull pins the full-width stack). Kept
   * as a distinct field so those readers stay policy-agnostic.
   */
  constraintPolicy: "banded" | "packed";
  /** E3.3 row-gap scale factor for this refinement (default 1). Carried on the
   * hull so `minGap` reads the SAME factor A0 placement used, via params (never a
   * module-level derived const — the SDEC NaN rule). */
  rowGap: number;
  topInset: number;
  boxXLeft: number;
  boxWidth: number;
  /** Recomputed after refinement (A0 step 5 re-run) — mutable. */
  boxHeight: number;
  /** In A2 sequence order (= A0 placed order). */
  blocks: RefBlock[];
  /** child hullId → its RefHull (for rigid-subtree re-anchoring). */
  childById: Map<string, RefHull>;
};

/** yCentre of a block from its current top. */
function centreOf(b: RefBlock): number {
  return b.top + b.height / 2;
}

/**
 * Two blocks share vertical constraints. A BANDED hull's children are full-width
 * bands (P5) — every pair is treated as overlapping so the vertical stack order +
 * spacing is fully pinned. A PACKED hull uses true geometric x-overlap (skyline).
 */
function blocksConstrain(
  policy: "banded" | "packed",
  a: RefBlock,
  b: RefBlock,
): boolean {
  if (policy === "banded") {
    return true;
  }
  return a.x0 < b.x1 && b.x0 < a.x1;
}

// ── build / re-anchor ─────────────────────────────────────────────────────────

function buildRefHull(
  hull: StrataHullNode,
  placement: StrataPlacementResult,
  rowGap: number = 1,
): RefHull {
  const bh = placement.boxedHulls.get(hull.id);
  if (bh === undefined) {
    throw new Error(`Strata A7: hull "${hull.id}" is missing from placement`);
  }
  const policy = hull.policy;
  // Constraints follow the RESOLVED policy exactly — skyline-placed (packed)
  // hulls get skyline constraints (geometric overlap + CLUSTER gaps), banded
  // hulls pin the full-width stack. The band-depth cut already lives in
  // `hull.policy`, so nothing else is threaded here.
  const constraintPolicy: "banded" | "packed" = policy;
  const topInset = framePad() + (hull.role === "root" ? 0 : titleReserve());
  const blocks: RefBlock[] = bh.placed.map((pu) => ({
    kind: pu.unit.kind,
    id: strataUnitId(pu.unit),
    memberId: pu.unit.kind === "hull" ? pu.unit.hullId : pu.unit.clusterId,
    x0: pu.box.x,
    x1: pu.box.x + pu.box.width,
    homeColumn: pu.colSpan[0],
    colSpan: pu.colSpan,
    height: pu.box.height,
    top: pu.box.y - bh.box.y,
    unit: pu.unit,
  }));
  const childById = new Map<string, RefHull>();
  for (const child of hull.children) {
    childById.set(child.id, buildRefHull(child, placement, rowGap));
  }
  return {
    hull,
    policy,
    constraintPolicy,
    rowGap,
    topInset,
    boxXLeft: bh.box.x,
    boxWidth: bh.box.width,
    boxHeight: bh.box.height,
    blocks,
    childById,
  };
}

/** A0 step 5 re-run: box height = maxBottom + FRAME_PAD (X untouched). */
function recomputeHeight(rh: RefHull): void {
  if (rh.blocks.length === 0) {
    return; // empty hull keeps its placement box height
  }
  let maxBottom = rh.topInset;
  for (const b of rh.blocks) {
    maxBottom = Math.max(maxBottom, b.top + b.height);
  }
  rh.boxHeight = maxBottom + framePad();
}

/** Re-apply absolute coordinates top-down; child subtrees ride their block top. */
function reanchor(
  rh: RefHull,
  absTop: number,
  boxedHulls: Map<string, StrataBoxedHull>,
  leafBoxes: Map<string, StrataBox>,
): void {
  const box: StrataBox = {
    x: rh.boxXLeft,
    y: absTop,
    width: rh.boxWidth,
    height: rh.boxHeight,
  };
  const placed: StrataPlacedUnit[] = [];
  for (const b of rh.blocks) {
    const blockTop = absTop + b.top;
    const blockBox: StrataBox = {
      x: b.x0,
      y: blockTop,
      width: b.x1 - b.x0,
      height: b.height,
    };
    placed.push({ unit: b.unit, box: blockBox, colSpan: b.colSpan });
    if (b.kind === "leaf") {
      leafBoxes.set(b.memberId, blockBox);
    } else {
      reanchor(rh.childById.get(b.memberId)!, blockTop, boxedHulls, leafBoxes);
    }
  }
  boxedHulls.set(rh.hull.id, { hull: rh.hull, box, placed });
}

// ── per-hull refinement ───────────────────────────────────────────────────────

/** A lifted E′ chord between two blocks of one hull (block-id endpoints). */
type Chord = { from: string; to: string };

/**
 * Downward-only, order-preserving min-gap compaction: removes any overlap a
 * child hull's growth introduced into the parent's A0 layout. Identity when the
 * layout is already feasible (so it never perturbs A0 geometry on its own).
 */
function seedCompact(rh: RefHull): void {
  const ordered = [...rh.blocks].sort(
    (a, b) => a.top - b.top || compareStrataContentKeys(a.id, b.id),
  );
  for (let i = 0; i < ordered.length; i++) {
    const bi = ordered[i]!;
    let floor = rh.topInset;
    for (let j = 0; j < i; j++) {
      const bj = ordered[j]!;
      if (blocksConstrain(rh.constraintPolicy, bi, bj)) {
        floor = Math.max(
          floor,
          bj.top +
            bj.height +
            minGap(
              rh.constraintPolicy,
              bj.kind === "hull",
              bi.kind === "hull",
              rh.rowGap,
            ),
        );
      }
    }
    if (bi.top < floor) {
      bi.top = floor;
    }
  }
}

/** Global objective for one hull: Σ|Δcentre| over its chords, current tops. */
function hullObjective(
  chords: readonly Chord[],
  byId: ReadonlyMap<string, RefBlock>,
): number {
  let sum = 0;
  for (const c of chords) {
    const a = byId.get(c.from);
    const b = byId.get(c.to);
    if (a && b) {
      sum += Math.abs(centreOf(a) - centreOf(b));
    }
  }
  return sum;
}

/**
 * Build the order-/gap-/clamp-feasible projected tops for one column's movable
 * blocks toward the targets `buildTargets` returns (one per movable block, in
 * that column's current top order). Factored out of {@link sweepHull} so the
 * directional sweep AND the A7 tie-cascade honour the IDENTICAL constraint set
 * (min-gap chain + topInset floor + fixed x-overlapping [lo, hi] clamps). Returns
 * the movable list paired with its projection, or `null` when the column is empty
 * or the box+monotone constraints are jointly infeasible (⇒ caller rejects). Pure
 * w.r.t. block tops — never mutates.
 */
function projectColumn(
  rh: RefHull,
  c: number,
  buildTargets: (movable: readonly RefBlock[]) => number[],
): { movable: RefBlock[]; projected: number[] } | null {
  const movable = rh.blocks
    .filter((b) => b.homeColumn === c)
    .sort((a, b) => a.top - b.top || compareStrataContentKeys(a.id, b.id));
  if (movable.length === 0) {
    return null;
  }
  const fixed = rh.blocks.filter((b) => b.homeColumn !== c);

  const targetTops = buildTargets(movable);

  // constraints — min-gap chain between consecutive movable blocks + the
  // topInset floor + fixed x-overlapping neighbours as [lo, hi] clamps.
  // gaps[i] = minimum top-to-top separation between movable i and i+1 =
  // height_i + the min inter-block gap (isotonicWithGaps's contract).
  const gaps: number[] = [];
  for (let i = 0; i < movable.length - 1; i++) {
    gaps.push(
      movable[i]!.height +
        minGap(
          rh.constraintPolicy,
          movable[i]!.kind === "hull",
          movable[i + 1]!.kind === "hull",
          rh.rowGap,
        ),
    );
  }
  const lo = movable.map(() => rh.topInset);
  const hi = movable.map(() => Number.POSITIVE_INFINITY);
  for (let i = 0; i < movable.length; i++) {
    const m = movable[i]!;
    for (const f of fixed) {
      if (!blocksConstrain(rh.constraintPolicy, m, f)) {
        continue;
      }
      const gap = minGap(
        rh.constraintPolicy,
        m.kind === "hull",
        f.kind === "hull",
        rh.rowGap,
      );
      // Preserve the current relative order against the fixed block (ties
      // broken by the content comparator for determinism).
      const mAbove =
        m.top < f.top ||
        (m.top === f.top && compareStrataContentKeys(m.id, f.id) < 0);
      if (mAbove) {
        hi[i] = Math.min(hi[i]!, f.top - gap - m.height);
      } else {
        lo[i] = Math.max(lo[i]!, f.top + f.height + gap);
      }
    }
  }

  const projected = isotonicWithGaps(targetTops, gaps, lo, hi);
  if (projected === null) {
    return null; // infeasible ⇒ reject
  }
  return { movable, projected };
}

/**
 * One directional sweep over a hull (P3): columns ascending for "down"
 * (neighbours strictly LEFT drive the median), descending for "up" (strictly
 * RIGHT). Each column's movable blocks are projected once from a pre-projection
 * snapshot (Jacobi) and the move is accepted iff the hull objective strictly
 * decreases and the projection is feasible.
 */
function sweepHull(
  rh: RefHull,
  chords: readonly Chord[],
  adjacency: ReadonlyMap<string, readonly string[]>,
  byId: ReadonlyMap<string, RefBlock>,
  direction: SweepDir,
): void {
  const columns = [...new Set(rh.blocks.map((b) => b.homeColumn))].sort(
    (a, b) => (direction === "down" ? a - b : b - a),
  );

  for (const c of columns) {
    // (1) targets — median of swept-from-direction neighbour centres (P2). All
    // computed from the CURRENT snapshot before any projection (Jacobi batch).
    const result = projectColumn(rh, c, (movable) =>
      movable.map((b) => {
        const centres: number[] = [];
        for (const otherId of adjacency.get(b.id) ?? []) {
          const p = byId.get(otherId);
          if (p === undefined) {
            continue;
          }
          const relevant =
            direction === "down" ? p.homeColumn < c : p.homeColumn > c;
          if (relevant) {
            centres.push(centreOf(p));
          }
        }
        // No swept-direction neighbour ⇒ hold this block's own position.
        return centres.length === 0 ? b.top : l1Median(centres) - b.height / 2;
      }),
    );
    if (result === null) {
      continue;
    }
    const { movable, projected } = result;

    // (3) acceptance — GLOBAL Σ|Δy| over the hull's chords (chords not touching
    // this column are unchanged, so this is equivalent to the touching subset).
    const before = hullObjective(chords, byId);
    const saved = movable.map((b) => b.top);
    movable.forEach((b, i) => {
      b.top = projected[i]!;
    });
    const after = hullObjective(chords, byId);
    if (!(after < before - EPS)) {
      movable.forEach((b, i) => {
        b.top = saved[i]!;
      });
    }
  }
}

// ── A7 tie-cascade (strataCoordCascade, opt-in, default off) ──────────────────
/**
 * Per-seed chase depth (determinism): each tentative tie move is followed by
 * exactly this many strict Gauss-Seidel chase rounds before the whole cascade is
 * adopted-or-rolled-back on a NET strict hull-objective (Σ|Δcentre|, the A7
 * length proxy) decrease. Bounding the CHASE depth (not the number of seed
 * columns) keeps the pass deterministic and terminating while still letting EVERY
 * column get a chance to escape — the api6 lambda sits at a mid/right column, so
 * capping the number of seeds (an earlier design) starved it. Each seed is a
 * bounded snapshot→apply→chase→compare with its own rollback, so trying all
 * columns stays O(columns) and monotone (never worsens length).
 */
const CASCADE_CHASE_ROUNDS = 2;
/** Hard safety cap on adopted cascades per hull (termination guard; far above
 * any real column count, so it never truncates a legitimate hull). */
const CASCADE_MAX_ADOPTIONS = 64;

/**
 * A7 tie-cascade (strataCoordCascade). Runs AFTER the fixed directional sweeps
 * converge. The directional sweeps only ADOPT a column move when it STRICTLY
 * lowers the hull objective; a unit whose best (barycentric) move is exactly
 * net-zero — e.g. a block with equally many chord partners above and below — is
 * a fixed point the sweeps refuse to leave, even though nudging it to its
 * two-sided median UNLOCKS a strict decrease once its chord-connected downstream
 * columns chase the new position (the diagnosed api6 lambda stranding).
 *
 * For each column (ascending order, deterministic; every column gets a chance,
 * capped only by the {@link CASCADE_MAX_ADOPTIONS} termination guard): snapshot
 * the whole hull, tentatively
 * apply the column's two-sided-median projection (the escape the sweeps reject
 * as non-strict), run {@link CASCADE_CHASE_ROUNDS} strict Gauss-Seidel sweeps,
 * then ADOPT the entire cascade iff the final hull objective is strictly below
 * the pre-seed objective — else roll the hull back verbatim. Adopt-or-rollback
 * on the shared length proxy makes it monotone (never worsens length) and
 * deterministic (fixed bounds, pinned column/tiebreak order, no RNG/wall-clock).
 * Order-preserving throughout (the projection is the same feasible set the
 * sweeps use), so it introduces no intra-hull overlap.
 */
function cascadeHull(
  rh: RefHull,
  chords: readonly Chord[],
  adjacency: ReadonlyMap<string, readonly string[]>,
  byId: ReadonlyMap<string, RefBlock>,
): void {
  const columns = [...new Set(rh.blocks.map((b) => b.homeColumn))].sort(
    (a, b) => a - b,
  );
  let adopted = 0;
  for (const seed of columns) {
    if (adopted >= CASCADE_MAX_ADOPTIONS) {
      break;
    }
    // Escape target = median of ALL chord neighbours (both directions) — the
    // net-zero barycentric position the strict directional sweeps reject.
    const result = projectColumn(rh, seed, (movable) =>
      movable.map((b) => {
        const centres: number[] = [];
        for (const otherId of adjacency.get(b.id) ?? []) {
          const p = byId.get(otherId);
          if (p !== undefined) {
            centres.push(centreOf(p));
          }
        }
        return centres.length === 0 ? b.top : l1Median(centres) - b.height / 2;
      }),
    );
    if (result === null) {
      continue;
    }
    const { movable, projected } = result;

    // Whole-hull snapshot for adopt-or-rollback of the ENTIRE cascade.
    const snapshot = rh.blocks.map((b) => b.top);
    const objBefore = hullObjective(chords, byId);

    // Tentatively apply the seed escape.
    const seedSaved = movable.map((b) => b.top);
    movable.forEach((b, i) => {
      b.top = projected[i]!;
    });
    const moved = movable.some((b, i) => Math.abs(b.top - seedSaved[i]!) > EPS);
    const objAfterSeed = hullObjective(chords, byId);
    // Skip a no-op seed, or one that strictly WORSENS before any chase (only a
    // genuine tie/near-tie is a useful escape; a worsening seed is not).
    if (!moved || objAfterSeed > objBefore + EPS) {
      movable.forEach((b, i) => {
        b.top = seedSaved[i]!;
      });
      continue;
    }

    // Chase: bounded strict Gauss-Seidel over chord-connected columns.
    for (let r = 0; r < CASCADE_CHASE_ROUNDS; r++) {
      for (const direction of SWEEP_DIRECTIONS) {
        sweepHull(rh, chords, adjacency, byId, direction);
      }
    }

    if (hullObjective(chords, byId) < objBefore - EPS) {
      adopted += 1; // net strict improvement ⇒ keep the whole cascade
    } else {
      rh.blocks.forEach((b, i) => {
        b.top = snapshot[i]!;
      });
    }
  }
}

/** Bottom-up: refine children (then rigid), seed-compact, sweep, recompute. */
function refineHull(
  rh: RefHull,
  chordsByHull: ReadonlyMap<string, readonly Chord[]>,
  cascade: boolean,
): void {
  for (const b of rh.blocks) {
    if (b.kind === "hull") {
      const child = rh.childById.get(b.memberId)!;
      refineHull(child, chordsByHull, cascade);
      b.height = child.boxHeight; // child may have grown/shrunk
    }
  }
  if (rh.blocks.length <= 1) {
    seedCompact(rh); // keeps the single block ≥ topInset (identity for A0)
    recomputeHeight(rh);
    return;
  }

  seedCompact(rh);

  const chords = chordsByHull.get(rh.hull.id) ?? [];
  const byId = new Map<string, RefBlock>(rh.blocks.map((b) => [b.id, b]));
  const adjacency = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    const list = adjacency.get(from);
    if (list) {
      list.push(to);
    } else {
      adjacency.set(from, [to]);
    }
  };
  for (const c of chords) {
    link(c.from, c.to);
    link(c.to, c.from);
  }

  for (const direction of SWEEP_DIRECTIONS) {
    sweepHull(rh, chords, adjacency, byId, direction);
  }
  // A7 tie-cascade (opt-in): let net-zero fixed points escape and chase. Runs
  // only when requested; flag-off leaves the sweeps' output byte-identical.
  if (cascade) {
    cascadeHull(rh, chords, adjacency, byId);
  }
  recomputeHeight(rh);
}

// ── LCA chord lifting (one entry per E′ chord, at its owning hull) ────────────

/**
 * Lift E′ onto every hull's direct blocks: each chord contributes at the hull
 * that owns BOTH endpoints (their LCA), where the endpoints resolve to two
 * different direct blocks (child hulls rigid). This is exactly
 * {@link liftStrataEdgesToUnits} run per hull with that hull's cluster→block map,
 * so cross-hull edges are deferred to their LCA rather than dropped.
 */
function buildChordsByHull(
  hullRoot: StrataHullNode,
  edgesPrime: readonly StrataPrimeEdge[],
): Map<string, Chord[]> {
  const subtreeCache = new Map<string, string[]>();
  const subtreeClusterIds = (hull: StrataHullNode): string[] => {
    const cached = subtreeCache.get(hull.id);
    if (cached) {
      return cached;
    }
    const out: string[] = [...hull.leafClusterIds];
    for (const child of hull.children) {
      out.push(...subtreeClusterIds(child));
    }
    subtreeCache.set(hull.id, out);
    return out;
  };

  const byHull = new Map<string, Chord[]>();
  const visit = (hull: StrataHullNode): void => {
    const unitOfCluster = new Map<string, string>();
    for (const child of hull.children) {
      const uid = strataUnitId({ kind: "hull", hullId: child.id });
      for (const cid of subtreeClusterIds(child)) {
        unitOfCluster.set(cid, uid);
      }
    }
    for (const leafId of hull.leafClusterIds) {
      unitOfCluster.set(
        leafId,
        strataUnitId({ kind: "leaf", clusterId: leafId }),
      );
    }
    const lifted = liftStrataEdgesToUnits(edgesPrime, (cid) =>
      unitOfCluster.get(cid),
    );
    byHull.set(
      hull.id,
      lifted.map((e) => ({ from: e.from, to: e.to })),
    );
    for (const child of hull.children) {
      visit(child);
    }
  };
  visit(hullRoot);
  return byHull;
}

// ── R2 dev-assert (immediately after re-anchor; honest degradation on failure) ─

/**
 * In-engine R2 standing invariant on the FINAL geometry (v3.1): non-ancestor
 * overlaps, title collisions, and contiguity violations must all be zero.
 * Throws with the "Strata A7 " prefix so the engine's catch re-tags stage "a7"
 * and degrades to the v2 fallback. Exported so a test can drive it directly.
 */
export function assertStrataR2(
  placement: StrataPlacementResult,
  model: StrataModel,
): void {
  const structure = checkStrataStructure(placement, model);
  if (
    structure.nonAncestorOverlaps > 0 ||
    structure.titleCollisions > 0 ||
    structure.contiguityViolations > 0
  ) {
    throw new Error(
      `Strata A7 re-anchor broke the R2 invariant: ${JSON.stringify(
        structure,
      )}`,
    );
  }
}

// ── public entry ──────────────────────────────────────────────────────────────

/**
 * A7 — refine Y over a finished A0 placement (spec §6-A7). Pure: returns a NEW
 * {@link StrataPlacementResult}; the input is never mutated. Deterministic
 * (run-twice deep-equal). Every throw carries the "Strata A7 " prefix.
 *
 * `edgesPrime` is A3's E′ (the same array A0/A2 consumed); `model` supplies the
 * hull tree. The re-anchoring pass + the R2 dev-assert run before returning, so
 * the result is final and structurally valid (or this throws honestly).
 *
 * `opts.cascade` (strataCoordCascade, default off) enables the post-sweep A7
 * tie-cascade ({@link cascadeHull}). When absent/false the pass is byte-identical
 * to the fixed 2-down/2-up sweep A7.
 */
export function refineStrataCoordinates(
  placement: StrataPlacementResult,
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
  opts?: { cascade?: boolean; rowGap?: number },
): StrataPlacementResult {
  const root = buildRefHull(model.hullRoot, placement, opts?.rowGap ?? 1);
  const chordsByHull = buildChordsByHull(model.hullRoot, edgesPrime);

  refineHull(root, chordsByHull, opts?.cascade === true);

  const boxedHulls = new Map<string, StrataBoxedHull>();
  const leafBoxes = new Map<string, StrataBox>();
  reanchor(root, PIPELINE_MARGIN, boxedHulls, leafBoxes);

  const refined: StrataPlacementResult = { boxedHulls, leafBoxes };
  assertStrataR2(refined, model);
  return refined;
}
