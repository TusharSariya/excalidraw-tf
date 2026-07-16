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
 *   upstream co-moves it — the leaf-sink pull-in (which relocates ONE degree-1
 *   leaf toward ITS single source) cannot help. The block is stranded +N columns
 *   to the far RIGHT, so every cross-account arrow feeding it is a long chord and
 *   the diagram is needlessly wide.
 *
 * WHAT IT DOES: a near-clone of `refineStrataSinkPullIn`, generalized from
 * "translate one leaf" to "rigid-translate a whole account subtree LEFT." It
 * enumerates every account-role hull, keeps only PURE-SINK blocks (no effective
 * edge leaves the block; ≥1 effective edge enters it), clamps the block to
 * `max(external source rank) + 1` (the largest LR-feasible leftward move),
 * rigidly translates the entire subtree (account box + every descendant hull box
 * + every internal placed unit + every block leaf box) by a single ΔX in pixels,
 * and adopts the largest move that survives the SAME gate stack the sink-pull-in
 * uses (X-containment, R2 `checkStrataStructure` all-zero, height maintain-or-
 * decrease, weighted-C + hard edge-cross cap + ε via `strataRelocateAdoptable`).
 *
 * WHY RIGID BLOCK TRANSLATE, NOT RANK REASSIGNMENT OR GRID X-COMPACTION: it
 * NEVER re-ranks (colSpan retained on every placed unit ⇒ the -42% height lever
 * is preserved), NEVER re-runs dropY (Y/width/height untouched — a pure X
 * translate), and does NOT reintroduce grid X-compaction (forbidden by
 * docs/strata-xcompact-removed-findings.md) — it is a single per-block rigid
 * pixel translate onto ONE existing on-grid left column, internal spacing
 * preserved, nothing else reflowed. Because every block node shifts by the same
 * ΔX, all INTERNAL block edges are inversion-proof by construction; only EXTERNAL
 * inbound edges constrain the move, and (pure-sink) there are no external
 * outbound edges. There is no Y-candidate search (unlike the sink pull-in): the
 * block moves as a rigid unit, so the only free parameter is k (columns left).
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
 * CORRECTNESS INVARIANT (on-grid landing, gate a0): the pass only ever adopts a
 * move where EVERY block leaf lands exactly on an existing grid column
 * (columnX[rank − k]). A block whose leaves were perturbed off their columns by
 * an upstream pass (e.g. `refineStrataSinkPullIn`, which moves a leaf's pixel box
 * without changing its rank), or a block spanning non-uniform column widths, is
 * conservatively SKIPPED rather than translated off-grid. This keeps the rigid
 * pixel translate exact and guarantees checkStrataStructure's exact-`box.x`-keyed
 * contiguity referee still sees every block leaf in its true rank column (no
 * hidden interleave). Also: because it never re-derives ancestor frame extents
 * (phase 1 holds provider/region boxes fixed), the pass shortens the long inbound
 * chords but does NOT itself reclaim overall diagram width — width reclaim is a
 * deferred phase-2 box-recompute.
 *
 * Import-cycle rule (SDEC NaN): no module-level consts derived from
 * terraformPipelineLayoutShared — `PIPELINE_FRAME_PAD` is read at call time.
 */
import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";
import { checkStrataStructure } from "./terraformPipelineStrataPlacement";
import {
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
 * Float tolerance for the on-grid landing gate. A rigid pixel translate is exact
 * arithmetic (destColumnX − originColumnX added back to a column-aligned box), so
 * the residual is 0 in practice; a sub-pixel epsilon only absorbs FP noise.
 */
const ON_GRID_EPS = 0.5;

/** A candidate account block: the account hull + its whole subtree membership. */
type StrataBlock = {
  accountId: string;
  /** account hull id + every descendant hull id (region/vpc/subnetZone). */
  hullIds: Set<string>;
  /** union of leafClusterIds over the whole subtree. */
  leafIds: Set<string>;
};

/** Max `box.y + box.height` over all hull + leaf boxes (the diagram bottom). */
const maxBottomOf = (placement: StrataPlacementResult): number => {
  let maxBottom = Number.NEGATIVE_INFINITY;
  for (const [, bh] of placement.boxedHulls) {
    maxBottom = Math.max(maxBottom, bh.box.y + bh.box.height);
  }
  for (const [, box] of placement.leafBoxes) {
    maxBottom = Math.max(maxBottom, box.y + box.height);
  }
  return maxBottom;
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
  const edgeCrossCap =
    options.strataEdgeCrossCap ?? options.packedScoringEpsilon ?? 0;
  const weights = { penW, crossW, epsilon, edgeCrossCap };

  const columnX = rank.columnX;

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
      blocks.push({ accountId: node.id, hullIds, leafIds });
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
   * Build a fresh placement rigidly translating the whole block subtree by ΔX.
   * Every box in `hullIds`/`leafIds` shifts by ΔX (x only); colSpan retained on
   * every placed unit (NEVER re-rank). Everything else copied by reference; the
   * source placement is never mutated. Y/width/height untouched.
   */
  const translateBlock = (
    from: StrataPlacementResult,
    block: StrataBlock,
    dx: number,
  ): StrataPlacementResult => {
    const shift = (box: StrataBox): StrataBox => ({
      x: box.x + dx,
      y: box.y,
      width: box.width,
      height: box.height,
    });

    const leafBoxes = new Map<string, StrataBox>();
    for (const [id, box] of from.leafBoxes) {
      leafBoxes.set(id, block.leafIds.has(id) ? shift(box) : box);
    }

    const boxedHulls = new Map<string, StrataBoxedHull>();
    for (const [id, bh] of from.boxedHulls) {
      if (block.hullIds.has(id)) {
        boxedHulls.set(id, {
          hull: bh.hull,
          box: shift(bh.box),
          placed: bh.placed.map((pu) => ({
            unit: pu.unit,
            box: shift(pu.box),
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
                ? { unit: pu.unit, box: shift(pu.box), colSpan: pu.colSpan }
                : pu,
            ),
          });
        } else {
          boxedHulls.set(id, bh); // untouched — preserve referential identity.
        }
      }
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

    // Candidate ΔX set, largest-move-first: adopt the FIRST k that passes every
    // gate (maximizes width shortening). ΔX(k) shifts the block's leftmost
    // column onto columnX[blockMinRank − k] (negative — moving left).
    const originX = columnX[blockMinRank];
    if (originX === undefined) {
      continue;
    }
    for (let k = kMaxRank; k >= 1; k--) {
      const destIndex = blockMinRank - k;
      if (destIndex < 0 || destIndex >= columnX.length) {
        continue;
      }
      const destX = columnX[destIndex]!;
      const dx = destX - originX;
      if (dx >= 0) {
        continue; // not a leftward move (variable column widths) — skip.
      }

      // Gate (a0): ON-GRID LANDING. Every block leaf must land EXACTLY on an
      // existing grid column (columnX[rank − k]) after the rigid shift. This
      // closes three overlapping hazards at once:
      //   • composition (an upstream pass such as `refineStrataSinkPullIn` moves
      //     a block leaf's pixel box WITHOUT changing its rank; a grid-derived ΔX
      //     applied to that perturbed box lands it off-grid);
      //   • variable column widths (a single pixel ΔX keyed off blockMinRank does
      //     NOT carry a higher-rank leaf onto columnX[r−k] unless the span is
      //     uniform — otherwise non-min leaves scatter off-grid);
      //   • the R2 blind spot — checkStrataStructure keys its contiguity columns
      //     by EXACT `leafBox.x`, so an off-grid leaf silently shares no column
      //     with its true rank-mates and a real interleave would evade the check.
      // Any off-grid landing is therefore conservatively rejected (the block is
      // left put rather than risk a hidden interleave). Under the common uniform-
      // width, unperturbed case this is a strict pass (residual 0).
      let onGrid = true;
      for (const leafId of block.leafIds) {
        const r = rank.rank.get(leafId)!; // every block leaf validated finite.
        const destCol = columnX[r - k];
        const box = incumbent.leafBoxes.get(leafId);
        if (
          destCol === undefined ||
          box === undefined ||
          Math.abs(box.x + dx - destCol) > ON_GRID_EPS
        ) {
          onGrid = false;
          break;
        }
      }
      if (!onGrid) {
        continue;
      }

      const candidate = translateBlock(incumbent, block, dx);

      // Gate (a): X-CONTAINMENT — the translated account box must stay inside
      // its parent hull box horizontally (checkStrataStructure exempts
      // ancestor↔descendant overlaps, so an escaped subtree would pass R2 yet
      // render outside its frame). Moving left keeps a far-right block inside,
      // but guard explicitly.
      const newAccountX = accountBh.box.x + dx;
      const pad = framePad();
      const minX = parentBh.box.x + pad;
      const maxX =
        parentBh.box.x + parentBh.box.width - pad - accountBh.box.width;
      if (newAccountX < minX || newAccountX > maxX) {
        continue;
      }

      // Gate (b): PIXEL LR feasibility — for every external (leaf, source)
      // pair, the translated leaf centre must stay ≥ its source centre (reject
      // any inversion the rank arithmetic missed under variable column widths).
      let lrOk = true;
      for (const { leafId, sourceId } of extPairs) {
        const leafBox = incumbent.leafBoxes.get(leafId);
        const srcBox = incumbent.leafBoxes.get(sourceId);
        if (leafBox === undefined || srcBox === undefined) {
          lrOk = false;
          break;
        }
        const leafCentre = leafBox.x + dx + leafBox.width / 2;
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

      // Gate (d): HEIGHT maintain-or-decrease. INERT under phase 1 — a rigid
      // X-only translate touches no box's y/height, so maxBottom is identical
      // and this can never fire today. Kept as a real comparison so a future
      // box-recompute phase (which WOULD move Y) inherits a live height gate.
      if (maxBottomOf(candidate) > maxBottomOf(incumbent)) {
        continue;
      }

      // Gate (e): SCORER — the identical weighted-C + hard edge-cross cap + ε
      // gate the sink-pull-in / vertical-relocate passes use.
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
