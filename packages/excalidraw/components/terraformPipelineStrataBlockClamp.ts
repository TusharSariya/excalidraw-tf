/**
 * Strata engine — post-A7 pure-sink account block clamp (`strataBlockClamp`,
 * default off).
 *
 * WHY THIS PASS EXISTS (P4: over-ranked pure-sink account block):
 *
 *   rankSeparate's longest-path columning over-columns a whole DEAD-END account
 *   subtree. When an entire account only RECEIVES cross-account edges (an org
 *   audit/security account whose resources are pure sinks) and its inbound edges
 *   fan in from multiple sources (e.g. `sns.ops` with 8 sources), no single
 *   upstream co-moves it. The block is stranded +N columns
 *   to the far RIGHT, so every cross-account arrow feeding it is a long chord and
 *   the diagram is needlessly wide.
 *
 * WHAT IT DOES: rigid-translates a whole account subtree LEFT. It
 * enumerates every account-role hull, keeps only PURE-SINK blocks (no effective
 * edge leaves the block; ≥1 effective edge enters it), clamps the block to
 * `max(external source rank) + 1` (the largest LR-feasible leftward move),
 * rigidly translates the entire subtree (account box + every descendant hull box
 * + every internal placed unit + every block leaf box) LEFT by k grid columns via
 * PER-RANK COLUMN-SNAP (each box's anchor column columnX[i] → columnX[i − k],
 * intra-column offset preserved), and adopts the largest move that survives the
 * SAME gate stack the relocate uses (X-containment, R2 `checkStrataStructure`
 * all-zero, height maintain-or-decrease, weighted-C + hard edge-cross cap + ε via
 * `strataRelocateAdoptable`).
 *
 * WHY RIGID RANK-SPACE TRANSLATE, NOT RANK REASSIGNMENT OR GRID X-COMPACTION: it
 * NEVER re-ranks (colSpan retained on every placed unit ⇒ the -42% height lever
 * is preserved), NEVER re-runs dropY (Y/width/height untouched — a pure X
 * translate), and does NOT reintroduce grid X-compaction (forbidden by
 * docs/strata-xcompact-removed-findings.md) — it snaps each block box onto an
 * EXISTING on-grid column k ranks to its left, internal rank-space spacing
 * preserved, nothing else reflowed. Because every block node shifts by the same
 * k RANKS (a fixed pixel ΔX only under uniform columns — the per-rank snap makes
 * k reachable for ANY column-width profile), all INTERNAL block edges are
 * inversion-proof by construction; only EXTERNAL inbound edges constrain the
 * move, and (pure-sink) there are no external outbound edges. There is no
 * Y-candidate search: the block moves as a rigid unit, so the only free parameter
 * is k (columns left).
 *
 * FLAG OFF ⇒ the input `placement` is returned by reference (byte-identical).
 *
 * NOTE (frozen-preset measurement, staging-extended-localstack-v2 / seed
 * 20260704): the pass correctly identifies account 000000000004 as the pure-sink
 * block (9 leaves, over-ranked to rank 27, 6 columns of leftward slack, 12
 * external inbound pairs — no hardcode), but the largest geometrically-feasible
 * rigid leftward clamp (k=2) is a genuine crossing/pierce REGRESSION there:
 * straight-chord scorer +4 crossings / +2 penetrations (rendered diagnostics
 * agree: +4 / +2) against −23.8k px edge length, and it does NOT shrink overall
 * width (account-04 is near- but not the- rightmost). So on the frozen preset the
 * weighted-C + hard edge-cross cap gate correctly VETOES it and the pass is a
 * safe no-op. It fires only where a block's leftward move is a net win under the
 * active guardrail.
 *
 * CORRECTNESS INVARIANT (on-grid landing): the pass only ever adopts a move where
 * EVERY block leaf lands exactly on an existing grid column (columnX[rank − k]).
 * The per-rank snap makes this exact for ANY column-width profile (a leaf at rank
 * r snaps from its own on-grid column columnX[r] to columnX[r − k], offset 0), so
 * NON-UNIFORM column spans are now handled rather than skipped — the single
 * remaining skip is a block whose leaf was perturbed OFF its grid column by an
 * upstream pass (e.g. a leaf-relocate that moves a pixel box without changing its
 * rank); such a block has no clean anchor column and is conservatively left put.
 * A post-snap assert re-verifies exact on-grid landing so checkStrataStructure's
 * exact-`box.x`-keyed contiguity referee always sees every block leaf in its true
 * rank column (no hidden interleave). Hull/frame/placed anchors are recovered by
 * nearest-column rounding (they sit FRAME_PAD left of a column origin); a mis-
 * round (pathologically deep nesting under tight columns) can only fail the
 * DESCENDANT-CONTAINMENT gate (a1) and be vetoed there — never a silent off-grid
 * leaf. Also: because it never re-derives ancestor frame extents (phase 1 holds
 * provider/region boxes fixed) and retains each hull's pixel WIDTH, the snap
 * shortens the long inbound chords but does NOT itself reclaim overall diagram
 * width; and a hull spanning a destination band WIDER than its origin band would
 * overhang its leaves — that spill is NOT R2-visible (checkStrataStructure
 * exempts ancestor↔descendant overlaps, placement :480), so it is caught by gate
 * (a1) `blockContainmentOk`, which rejects any candidate where a block leaf or
 * child frame lands outside its own ancestor frame. Width reclaim + actually
 * SUPPORTING the wider-destination case (rather than vetoing it) are a deferred
 * phase-2 box-recompute (sub-flag `strataBlockClampReframe`, not built here).
 *
 * Import-cycle rule (SDEC NaN): no module-level consts derived from
 * terraformPipelineLayoutShared — `PIPELINE_FRAME_PAD` is read at call time.
 */
import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";
import { strataHeightGateAdmits } from "./terraformPipelineStrataHeightGate";
import { checkStrataStructure } from "./terraformPipelineStrataPlacement";
import {
  resolveInheritedEdgeCrossCap,
  scoreStrataPlacementGeometry,
  strataRelocateAdoptable,
} from "./terraformPipelineStrataPackedScoring";

import type { StrataPackedScore } from "./terraformPipelineStrataPackedScoring";
import type {
  StrataBox,
  StrataBoxedHull,
  StrataEngineOptions,
  StrataHullNode,
  StrataModel,
  StrataPlacedUnit,
  StrataPlacementResult,
  StrataPrimeEdge,
  StrataRankResult,
} from "./terraformPipelineStrataTypes";

/** Call-time read (never module-level — pre-existing LayoutShared import cycle). */
const framePad = (): number => PIPELINE_FRAME_PAD;

/**
 * Float tolerance for the on-grid gates. A block leaf is placed EXACTLY on its
 * `columnX[rank]` (placement :400 `x0`, no FP arithmetic) and the snap lands it
 * EXACTLY on `columnX[rank − k]` (see `shiftLeaf`), so the true residual is 0.
 * This tolerance therefore only absorbs pure FP dust — it must NOT be loose
 * enough to admit a genuinely off-grid leaf. A larger value (the previous 0.5px)
 * silently accepted a leaf at `columnX[r] + 0.25`: the input pre-gate passed it,
 * the offset-preserving snap carried the 0.25 residual through, and — because
 * checkStrataStructure keys column contiguity by EXACT `box.x` (placement :540) —
 * that off-grid leaf landed in its own column bucket, hiding exactly the
 * interleave the gate exists to catch. Keep this at true FP-noise scale.
 */
const ON_GRID_EPS = 1e-6;

/** A candidate account block: the account hull + its whole subtree membership. */
type StrataBlock = {
  accountId: string;
  /** the account hull node itself (root of the block subtree — walked by the
   * descendant-containment gate to check every frame contains its own leaves). */
  accountNode: StrataHullNode;
  /** account hull id + every descendant hull id (region/vpc/subnetZone). */
  hullIds: Set<string>;
  /** union of leafClusterIds over the whole subtree. */
  leafIds: Set<string>;
};

/**
 * Post-A7 pure-sink account block clamp. Flag off ⇒ returns `placement` by
 * reference (byte-identical). Otherwise per-block, largest-move-first adoption of
 * width-shortening, LR-feasible, structurally-clean, gate-approved rigid subtree
 * translations of whole pure-sink account blocks toward their sources.
 */
export function refineStrataBlockClamp(
  placement: StrataPlacementResult,
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
  rank: StrataRankResult,
  options: StrataEngineOptions,
): StrataPlacementResult {
  if (!options.strataBlockClamp) {
    return placement; // byte-identical path — referential identity preserved.
  }

  const penW = options.strataCrossWeightPenetration ?? 1;
  const crossW = options.strataCrossWeightEdge ?? 1;
  const epsilon = options.packedScoringEpsilon ?? 0;
  // S1-1 FIX: `edgeCrossCap`/`weights` are resolved AFTER `baselineScore` below
  // (a blank `strataEdgeCrossCap` inherits the descent's RESOLVED δ, which needs
  // the baseline crossings, NOT the raw fractional ε the old
  // `?? options.packedScoringEpsilon ?? 0` collapsed to a ~0 absolute cap).

  const columnX = rank.columnX;

  /**
   * Nearest grid-column index for a pixel x (binary search over the strictly
   * increasing `columnX`, rounding to the closest column).
   *
   * WHY NEAREST (rounding), NOT nearest-≤: a block leaf sits EXACTLY on
   * `columnX[rank]` (offset 0 ⇒ rounds to its own rank, exact), but a hull /
   * frame / placed-hull left edge sits `PIPELINE_FRAME_PAD` (×nesting depth) to
   * the LEFT of its anchor column origin (`boxXLeft = minX0 − FRAME_PAD`,
   * placement :374). nearest-≤ would resolve that inset edge to the PREVIOUS
   * column and, under NON-UNIFORM column spacing, snap the hull by a different
   * rank-delta than its own leftmost leaf — reintroducing exactly the
   * variable-width scatter this rewrite exists to kill. Rounding recovers the
   * true anchor column so long as the PAD inset is < half the column gap (always
   * true for the real grid: gap ≥ minColWidth + PIPELINE_COLUMN_GAP ≫ 2·PAD).
   * When it is not (pathologically deep nesting under tight columns) the hull
   * snaps a column off, the account subtree fails to contain its leaves, and
   * gate (c) R2 VETOES — an honest no-op, never a silent off-grid corruption
   * (block leaves are re-asserted exactly on-grid post-snap independently).
   */
  const colIndexOf = (x: number): number => {
    const n = columnX.length;
    if (n === 0) {
      return -1;
    }
    if (x <= columnX[0]!) {
      return 0;
    }
    if (x >= columnX[n - 1]!) {
      return n - 1;
    }
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (columnX[mid]! < x) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    // `lo` = smallest index with columnX[lo] ≥ x; compare it with its predecessor.
    const hiIdx = lo;
    const loIdx = lo - 1;
    return x - columnX[loIdx]! <= columnX[hiIdx]! - x ? loIdx : hiIdx;
  };

  // Effective-direction adjacency over E′ (honor A3 `reversed`: a reversed edge
  // participates with source/target swapped, matching the ranker's effective
  // DAG). Per leaf: its effective outbound targets + inbound sources.
  const outTargets = new Map<string, string[]>();
  const inSources = new Map<string, string[]>();
  const pushInto = (m: Map<string, string[]>, k: string, v: string): void => {
    const list = m.get(k);
    if (list === undefined) {
      m.set(k, [v]);
    } else {
      list.push(v);
    }
  };
  for (const pe of edgesPrime) {
    const effSource = pe.reversed ? pe.edge.target : pe.edge.source;
    const effTarget = pe.reversed ? pe.edge.source : pe.edge.target;
    pushInto(outTargets, effSource, effTarget);
    pushInto(inSources, effTarget, effSource);
  }

  // Enumerate candidate blocks = every account-role hull, sorted by a stable
  // string key for determinism (`addressOf` returns the canonical address for
  // cluster ids and falls back to the raw hull id otherwise, so the effective
  // order is by hull-id string — deterministic, which is all this loop needs).
  // Recursively collect the subtree's hull ids + leaf ids (same recursion shape
  // as checkStrataStructure's `collect`).
  const collectBlock = (
    account: StrataHullNode,
  ): { hullIds: Set<string>; leafIds: Set<string> } => {
    const hullIds = new Set<string>();
    const leafIds = new Set<string>();
    const walk = (node: StrataHullNode): void => {
      hullIds.add(node.id);
      for (const leaf of node.leafClusterIds) {
        leafIds.add(leaf);
      }
      for (const child of node.children) {
        walk(child);
      }
    };
    walk(account);
    return { hullIds, leafIds };
  };

  const blocks: StrataBlock[] = [];
  const collectAccounts = (node: StrataHullNode): void => {
    if (node.role === "account") {
      const { hullIds, leafIds } = collectBlock(node);
      blocks.push({ accountId: node.id, accountNode: node, hullIds, leafIds });
      return; // accounts do not nest — no need to descend past one.
    }
    for (const child of node.children) {
      collectAccounts(child);
    }
  };
  collectAccounts(model.hullRoot);
  blocks.sort((a, b) =>
    model.addressOf(a.accountId) < model.addressOf(b.accountId) ? -1 : 1,
  );

  // account hull id → parent hull id (for the X-containment guard).
  const parentHullOf = new Map<string, string>();
  const mapParents = (node: StrataHullNode): void => {
    for (const child of node.children) {
      parentHullOf.set(child.id, node.id);
      mapParents(child);
    }
  };
  mapParents(model.hullRoot);

  const baselineScore = scoreStrataPlacementGeometry(
    placement,
    model,
    edgesPrime,
  );
  // S1-1 FIX: blank cap inherits the descent's RESOLVED δ, not raw fractional ε.
  // Byte-identical at integer ε (resolve(N)===N); only fractional ε changes.
  const edgeCrossCap = resolveInheritedEdgeCrossCap(
    options.strataEdgeCrossCap,
    epsilon,
    baselineScore.crossings,
  );
  const weights = { penW, crossW, epsilon, edgeCrossCap };
  let incumbent = placement;
  let incumbentScore: StrataPackedScore = baselineScore;

  const r2Valid = (candidate: StrataPlacementResult): boolean => {
    const s = checkStrataStructure(candidate, model);
    return (
      s.nonAncestorOverlaps === 0 &&
      s.titleCollisions === 0 &&
      s.contiguityViolations === 0
    );
  };

  /**
   * Sub-pixel tolerance for the descendant-containment gate. Real spill (a leaf
   * re-spread across a WIDER destination band than a rigid-width hull frame can
   * hold) is tens–hundreds of px; this only forgives FP dust at the frame edge
   * (in a well-formed block the leftmost leaf sits EXACTLY at `hull.x + PAD` and
   * the rightmost leaf right edge at `hull.x + width − PAD`, so equality is the
   * baseline and must not be a false veto).
   */
  const CONTAIN_EPS = 1;

  /**
   * Gate (a1): DESCENDANT CONTAINMENT. `checkStrataStructure`'s overlap referee
   * EXEMPTS ancestor↔descendant pairs (placement :480 `containsRel`), so R2 does
   * NOT veto a block whose per-rank snap spread its leaves BEYOND their own
   * retained-width ancestor frames — the width the snap keeps is measured at the
   * ORIGIN column spacing, so a destination band whose columns are wider-spaced
   * than the origin band overhangs a rigid-width hull (leaf right edge > frame
   * right edge) while the referee stays silent. Verify, over the whole block
   * subtree, that every hull frame horizontally contains its own direct leaves
   * (PAD-inset interior) and its own child hull boxes (raw nesting). Any spill —
   * or a mis-rounded hull anchor, which manifests the same way — is vetoed here
   * rather than adopting geometry that renders leaves outside their frames.
   */
  const blockContainmentOk = (
    candidate: StrataPlacementResult,
    accountNode: StrataHullNode,
  ): boolean => {
    const pad = framePad();
    const check = (node: StrataHullNode): boolean => {
      const hb = candidate.boxedHulls.get(node.id)?.box;
      if (hb === undefined) {
        return false; // a block hull with no box — cannot verify ⇒ veto.
      }
      const interiorLeft = hb.x + pad;
      const interiorRight = hb.x + hb.width - pad;
      for (const leafId of node.leafClusterIds) {
        const lb = candidate.leafBoxes.get(leafId);
        if (lb === undefined) {
          return false;
        }
        if (
          lb.x < interiorLeft - CONTAIN_EPS ||
          lb.x + lb.width > interiorRight + CONTAIN_EPS
        ) {
          return false; // this leaf spilled outside its own frame.
        }
      }
      for (const child of node.children) {
        const cb = candidate.boxedHulls.get(child.id)?.box;
        if (cb === undefined) {
          return false;
        }
        if (
          cb.x < hb.x - CONTAIN_EPS ||
          cb.x + cb.width > hb.x + hb.width + CONTAIN_EPS
        ) {
          return false; // a child frame overhangs its parent frame.
        }
        if (!check(child)) {
          return false;
        }
      }
      return true;
    };
    return check(accountNode);
  };

  /**
   * Build a fresh placement rigidly translating the whole block subtree LEFT by
   * `k` grid columns via PER-RANK COLUMN-SNAP. Each block box's left edge moves
   * from its anchor column `columnX[i]` (i = `colIndexOf(box.x)`) onto
   * `columnX[i − k]`, preserving its intra-column pixel offset
   * (`box.x − columnX[i]`). Unlike the previous single-fixed-ΔX translate, this
   * lands EVERY block leaf exactly on `columnX[rank − k]` for ANY k even when
   * column widths are non-uniform (the old translate only did so for the
   * smallest feasible k / uniform spans). colSpan retained on every placed unit
   * (NEVER re-rank); Y/width/height untouched; everything outside the block
   * copied by reference; the source placement is never mutated.
   *
   * Returns `null` if any block box would snap to an out-of-range column
   * (`i − k < 0`), so the caller can skip that k. Under the loop's `destIndex ≥
   * 0` bound this cannot fire for on-grid leaves/anchors, but the guard keeps the
   * snap total.
   */
  const translateBlock = (
    from: StrataPlacementResult,
    block: StrataBlock,
    k: number,
  ): StrataPlacementResult | null => {
    let snapOk = true;
    // Offset-preserving snap for HULL/FRAME boxes: they sit `PIPELINE_FRAME_PAD`
    // (×nesting depth) LEFT of their anchor column origin, so their intra-column
    // offset is meaningful and must be carried onto the destination column.
    const shift = (box: StrataBox): StrataBox => {
      const i = colIndexOf(box.x);
      const dest = i - k;
      if (i < 0 || dest < 0 || dest >= columnX.length) {
        snapOk = false;
        return box;
      }
      return {
        x: box.x - columnX[i]! + columnX[dest]!,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    };
    // EXACT snap for LEAF boxes: a leaf is placed with offset 0 on its own
    // column, so it must land EXACTLY on `columnX[dest]` (x set to the column
    // origin, not offset-preserved). This normalizes away any sub-pixel residual
    // an upstream pass may have left, guaranteeing checkStrataStructure's
    // exact-`box.x`-keyed contiguity referee (placement :540) buckets every block
    // leaf in its true rank column — no off-grid landing can leak through the
    // arithmetic even if the (now strict) input pre-gate is FP-tolerant.
    const shiftLeaf = (box: StrataBox): StrataBox => {
      const i = colIndexOf(box.x);
      const dest = i - k;
      if (i < 0 || dest < 0 || dest >= columnX.length) {
        snapOk = false;
        return box;
      }
      return { x: columnX[dest]!, y: box.y, width: box.width, height: box.height };
    };

    const leafBoxes = new Map<string, StrataBox>();
    for (const [id, box] of from.leafBoxes) {
      leafBoxes.set(id, block.leafIds.has(id) ? shiftLeaf(box) : box);
    }

    const boxedHulls = new Map<string, StrataBoxedHull>();
    for (const [id, bh] of from.boxedHulls) {
      if (block.hullIds.has(id)) {
        boxedHulls.set(id, {
          hull: bh.hull,
          box: shift(bh.box),
          placed: bh.placed.map((pu) => ({
            unit: pu.unit,
            // leaf placed-units mirror `leafBoxes` (exact snap); hull units
            // mirror `boxedHulls[].box` (offset-preserving snap).
            box: pu.unit.kind === "leaf" ? shiftLeaf(pu.box) : shift(pu.box),
            colSpan: pu.colSpan, // rank span retained — never re-ranks.
          })),
        });
      } else {
        // A hull OUTSIDE the block may still hold an in-block unit in its own
        // `placed` list — specifically the account hull-unit inside its parent
        // provider, the single boundary the block subtree crosses. Shift those
        // units too so `placed` never carries a stale second box for a child
        // whose `boxedHulls`/`leafBoxes` entry just moved. (Defensive: no live
        // consumer reads cross-boundary `placed` unit boxes today — scene build
        // and checkStrataStructure both read `boxedHulls[].box`/`leafBoxes` — but
        // a self-consistent result must not report two positions for one box.)
        const inBlockUnit = (pu: StrataPlacedUnit): boolean =>
          (pu.unit.kind === "hull" && block.hullIds.has(pu.unit.hullId)) ||
          (pu.unit.kind === "leaf" && block.leafIds.has(pu.unit.clusterId));
        if (bh.placed.some(inBlockUnit)) {
          boxedHulls.set(id, {
            hull: bh.hull,
            box: bh.box, // this hull is outside the block — its own box is fixed.
            placed: bh.placed.map((pu) =>
              inBlockUnit(pu)
                ? {
                    unit: pu.unit,
                    box:
                      pu.unit.kind === "leaf"
                        ? shiftLeaf(pu.box)
                        : shift(pu.box),
                    colSpan: pu.colSpan,
                  }
                : pu,
            ),
          });
        } else {
          boxedHulls.set(id, bh); // untouched — preserve referential identity.
        }
      }
    }

    if (!snapOk) {
      return null;
    }
    return { boxedHulls, leafBoxes };
  };

  for (const block of blocks) {
    // Guard: the block must have a real account box + a mappable parent hull.
    const accountBh = incumbent.boxedHulls.get(block.accountId);
    if (accountBh === undefined) {
      continue;
    }
    const parentHullId = parentHullOf.get(block.accountId);
    if (parentHullId === undefined) {
      continue; // an account directly under root with no parent hull — skip.
    }
    const parentBh = incumbent.boxedHulls.get(parentHullId);
    if (parentBh === undefined) {
      continue;
    }

    // PURE-SINK test: (a) no effective edge leaves the block, and (b) at least
    // one effective inbound edge crosses INTO the block from outside. Also
    // gather the external (blockLeaf, externalSource) incidence pairs used by
    // the clamp + the pixel LR check.
    let hasExternalOutbound = false;
    let hasExternalInbound = false;
    const extPairs: { leafId: string; sourceId: string }[] = [];
    for (const leafId of block.leafIds) {
      for (const target of outTargets.get(leafId) ?? []) {
        if (!block.leafIds.has(target)) {
          hasExternalOutbound = true;
          break;
        }
      }
      if (hasExternalOutbound) {
        break;
      }
    }
    if (hasExternalOutbound) {
      continue; // not a pure sink — protects LR feasibility + the P4 premise.
    }
    for (const leafId of block.leafIds) {
      for (const source of inSources.get(leafId) ?? []) {
        if (!block.leafIds.has(source)) {
          hasExternalInbound = true;
          extPairs.push({ leafId, sourceId: source });
        }
      }
    }
    if (!hasExternalInbound) {
      continue; // isolated island, not a real sink block.
    }

    // CLAMP: k columns left, bounded by the binding (leaf, external source)
    // pair. blockMinRank = min rank over block leaves (the leftmost column).
    let blockMinRank = Number.POSITIVE_INFINITY;
    let rankMissing = false;
    for (const leafId of block.leafIds) {
      const r = rank.rank.get(leafId);
      if (r === undefined) {
        rankMissing = true;
        break;
      }
      if (r < blockMinRank) {
        blockMinRank = r;
      }
    }
    if (rankMissing || !Number.isFinite(blockMinRank)) {
      continue;
    }

    let kMaxRank = Number.POSITIVE_INFINITY;
    let pairRankMissing = false;
    for (const { leafId, sourceId } of extPairs) {
      const rl = rank.rank.get(leafId);
      const rs = rank.rank.get(sourceId);
      if (rl === undefined || rs === undefined) {
        pairRankMissing = true;
        break;
      }
      const margin = rl - rs - 1;
      if (margin < kMaxRank) {
        kMaxRank = margin;
      }
    }
    if (pairRankMissing || !Number.isFinite(kMaxRank) || kMaxRank < 1) {
      continue; // no legal leftward slack — leave the block put.
    }

    // Gate (a0-pre): PERTURBED-INPUT SKIP (k-independent). Per-rank snap can only
    // land a leaf exactly on `columnX[rank − k]` if the leaf STARTS on its own
    // grid column. An upstream pass (e.g. a leaf-relocate) can move a leaf's
    // pixel box WITHOUT changing its rank, leaving it off-grid; a snap keyed off
    // its nearest column would then carry it off-grid, where
    // checkStrataStructure's exact-`box.x`-keyed contiguity referee could miss a
    // real interleave. If ANY block leaf is off its grid column, conservatively
    // skip the whole block (referential identity preserved for it). Unlike the
    // OLD single-ΔX on-grid gate, this no longer rejects non-uniform column
    // spans — the per-rank snap handles those exactly (that was the whole point).
    let blockOnGrid = true;
    for (const leafId of block.leafIds) {
      const box = incumbent.leafBoxes.get(leafId);
      if (box === undefined) {
        blockOnGrid = false;
        break;
      }
      const i = colIndexOf(box.x);
      if (i < 0 || Math.abs(box.x - columnX[i]!) > ON_GRID_EPS) {
        blockOnGrid = false;
        break;
      }
    }
    if (!blockOnGrid) {
      continue;
    }

    // Candidate set, largest-move-first: adopt the FIRST k that passes every gate
    // (maximizes width shortening). k shifts the block LEFT by k grid columns via
    // per-rank column-snap (every leaf at rank r lands on columnX[r − k]).
    for (let k = kMaxRank; k >= 1; k--) {
      const destIndex = blockMinRank - k;
      if (destIndex < 0 || destIndex >= columnX.length) {
        continue;
      }

      const candidate = translateBlock(incumbent, block, k);
      if (candidate === null) {
        continue; // some block box could not snap (out-of-range column).
      }

      // Gate (a0): POST-SNAP ON-GRID DEV-ASSERT. Every block leaf must land
      // EXACTLY on columnX[rank − k] after the snap. This is invariant-by-
      // construction (each leaf snaps from its own on-grid column, offset 0), and
      // it is re-verified here because it is the load-bearing correctness
      // property: it guarantees checkStrataStructure's exact-`box.x`-keyed
      // contiguity referee still sees every block leaf in its true rank column
      // (no hidden interleave), INDEPENDENT of how hull/frame anchors rounded.
      // A violation (impossible unless colIndexOf mis-rounds a leaf) skips the
      // candidate rather than ever adopting an off-grid landing.
      let onGrid = true;
      for (const leafId of block.leafIds) {
        const r = rank.rank.get(leafId)!; // every block leaf validated finite.
        const destCol = columnX[r - k];
        const box = candidate.leafBoxes.get(leafId);
        if (
          destCol === undefined ||
          box === undefined ||
          Math.abs(box.x - destCol) > ON_GRID_EPS
        ) {
          onGrid = false;
          break;
        }
      }
      if (!onGrid) {
        continue;
      }

      // Gate (a): X-CONTAINMENT — the snapped account box must stay inside its
      // parent hull box horizontally (checkStrataStructure exempts
      // ancestor↔descendant overlaps, so an escaped subtree would pass R2 yet
      // render outside its frame). Uses the account frame's ACTUAL snapped left
      // edge (per-rank snap ⇒ NOT a single fixed ΔX off blockMinRank).
      const snappedAccountBox = candidate.boxedHulls.get(block.accountId)?.box;
      if (snappedAccountBox === undefined) {
        continue;
      }
      const newAccountX = snappedAccountBox.x;
      const pad = framePad();
      const minX = parentBh.box.x + pad;
      const maxX =
        parentBh.box.x + parentBh.box.width - pad - accountBh.box.width;
      if (newAccountX < minX || newAccountX > maxX) {
        continue;
      }

      // Gate (a1): DESCENDANT CONTAINMENT — every block frame must still contain
      // its own leaves and child frames after the per-rank snap. R2 (gate c)
      // cannot see this: it exempts ancestor↔descendant overlaps, so a leaf
      // re-spread beyond its rigid-width ancestor frame (wider destination band)
      // would otherwise be adopted as a shorter-chord win with a leaf rendered
      // outside its frame. This is the veto the header formerly (wrongly)
      // attributed to R2.
      if (!blockContainmentOk(candidate, block.accountNode)) {
        continue;
      }

      // Gate (b): PIXEL LR feasibility — for every external (leaf, source) pair,
      // the SNAPPED leaf centre must stay ≥ its source centre (reject any
      // inversion the rank arithmetic missed under variable column widths).
      let lrOk = true;
      for (const { leafId, sourceId } of extPairs) {
        const leafBox = candidate.leafBoxes.get(leafId);
        const srcBox = incumbent.leafBoxes.get(sourceId);
        if (leafBox === undefined || srcBox === undefined) {
          lrOk = false;
          break;
        }
        const leafCentre = leafBox.x + leafBox.width / 2;
        const srcCentre = srcBox.x + srcBox.width / 2;
        if (leafCentre < srcCentre) {
          lrOk = false;
          break;
        }
      }
      if (!lrOk) {
        continue;
      }

      // Gate (c): R2 structural — the load-bearing overlap/interleave referee.
      if (!r2Valid(candidate)) {
        continue;
      }

      // Gate (d): HEIGHT maintain-or-decrease (P5 / Lever C). Still INERT under
      // phase 1 — a rigid X-only translate touches no box's y/height, so no
      // hull's implied height can change and this cannot fire today.
      //
      // It is nonetheless REPAIRED here, because the previous formulation was
      // not merely inert but VACUOUS-BY-CONSTRUCTION: it compared a scene-global
      // `max(box.y + box.height)` scalar, which is dominated by the tallest/root
      // extent and therefore ADMITS a non-tallest hull growing arbitrarily. A
      // future box-recompute phase would have inherited a gate that silently
      // passes exactly the moves it exists to reject. `strataHeightGateAdmits`
      // quantifies per-hull over implied content heights instead; the vacuity
      // regression test in terraformPipelineStrataHeightGate.test.ts pins the
      // difference (old check admits, new check rejects, same candidate).
      //
      // NOTE (measured, BlockClamp header :41-51): this pass's null result is
      // NOT height-vetoed — at the frozen preset the largest feasible clamp
      // (k=2) is +4 crossings / +2 penetrations against −23.8k px length and the
      // weighted-C + edge-cross cap gate (e) correctly VETOES it. No height gate
      // can change that outcome.
      if (
        options.strataHeightGate === true &&
        !strataHeightGateAdmits(candidate, incumbent)
      ) {
        continue;
      }

      // Gate (e): SCORER — the identical weighted-C + hard edge-cross cap + ε
      // gate the vertical-relocate pass uses.
      const candScore = scoreStrataPlacementGeometry(
        candidate,
        model,
        edgesPrime,
      );
      if (
        strataRelocateAdoptable(
          candScore,
          baselineScore,
          incumbentScore,
          weights,
        )
      ) {
        incumbent = candidate;
        incumbentScore = candScore;
        break; // largest adoptable move wins — roll to the next block.
      }
    }
  }

  return incumbent;
}
