/**
 * Strata engine — post-A7 exclusive-downstream CHAIN relocation
 * (`strataChainRelocate`, default off, opt-in).
 *
 * WHY THIS PASS EXISTS (two measured owner cases the X-DISJOINT vertical-relocate
 * (`refineStrataVerticalSlots`), the transpose, and A0/A7 all structurally miss):
 *
 *   Case A — module.api6 `aws_lambda_function.this[0]` strands ~45px ABOVE its
 *   exclusive downstream aws_ssm_parameter / aws_db_instance (which live in
 *   DIFFERENT columns, one slot to the right). The lambda's chords split evenly
 *   above/below its own row, so a SOLO vertical move is net-zero edge length and
 *   A7 (per-column strict-decrease Jacobi) rejects it. The lambda is NOT
 *   X-disjoint from its column siblings, so `refineStrataVerticalSlots` never
 *   proposes it either. Only a move that co-translates the lambda TOGETHER WITH
 *   its exclusive downstream group makes the two internal chords ride along
 *   (0 change) while the external chords net a strict length decrease.
 *
 *   Case B — module.api7 `aws_ecs_service.api` — the same shape (all four
 *   partners below; solo move blocked, joint move wins).
 *
 * THE OPERATOR: for each placed unit U (leaf or child hull) in every hull, build
 * its EXCLUSIVE DOWNSTREAM GROUP G(U) — the greatest set of downstream leaves
 * ALL of whose incident edges stay internal to {U}∪G (the same "every edge
 * internal" closure `pushGroupSift` uses, computed here directly over E′), capped
 * at {@link CHAIN_GROUP_CAP}. The whole set {U}∪G(U) is then rigidly translated
 * in Y by a single `dy` — EACH member within its OWN stationary parent hull box,
 * so members in different columns/hulls all move together. Candidate offsets are
 * the L1-optimal external-chord median plus a few nearby sibling slot boundaries,
 * clamped so every member stays inside its parent box (⇒ NO hull box ever grows;
 * scene height is invariant by construction — the height gate is satisfied
 * trivially). Each candidate is validated against the R2 structural invariant
 * (`checkStrataStructure`, all-zero) and adopted through the shared
 * `strataRelocateAdoptable` kernel (crossings non-increasing lex-first, then
 * lengthL1 strictly decreasing; the ε budget + hard edge-cross cap ride too).
 * Per-move greedy adoption over a fixed 2-pass deterministic schedule.
 *
 * FLAG OFF ⇒ the input `placement` is returned by reference (byte-identical).
 *
 * Import-cycle rule (SDEC NaN): no module-level consts derived from
 * terraformPipelineLayoutShared — `PIPELINE_FRAME_PAD` is read at call time.
 * Determinism (C3′): fixed hull/unit/candidate iteration, integer coordinates,
 * no RNG / wall-clock.
 */
import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";
import { checkStrataStructure } from "./terraformPipelineStrataPlacement";
import {
  resolveInheritedEdgeCrossCap,
  scoreStrataPlacementGeometry,
  strataRelocateAdoptable,
} from "./terraformPipelineStrataPackedScoring";
import { strataUnitId } from "./terraformPipelineStrataOrdering";

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
  StrataUnit,
} from "./terraformPipelineStrataTypes";

/** Max size of the exclusive downstream group G(U) (excludes U). A larger closed
 * set is left alone — chain-relocating a big subtree risks it never fitting any
 * feasible dy, and the two owner cases have |G| = 2. */
const CHAIN_GROUP_CAP = 4;

/** Nearest sibling slot boundaries tried as extra candidate offsets, on top of
 * the always-kept external-chord median. Bounds per-anchor work to O(N). */
const CHAIN_SLOT_BUDGET = 6;

/** Bounded downstream-cone BFS ceiling (before the leak fixpoint prunes it). */
const CHAIN_CONE_CAP = 32;

/** Anchors with more subtree leaves than this are skipped — chain-relocate
 * targets small stranded units, not large hulls. */
const CHAIN_ANCHOR_LEAF_CAP = 6;

// ── call-time spacing reads (never module-level — LayoutShared import cycle) ───
const framePad = (): number => PIPELINE_FRAME_PAD;
const titleReserve = (): number => PIPELINE_FRAME_PAD * 2;
const topInsetOf = (role: StrataHullNode["role"]): number =>
  framePad() + (role === "root" ? 0 : titleReserve());

/** A box translated rigidly in Y (new object; input untouched). */
const shiftBox = (b: StrataBox, dy: number): StrataBox => ({
  x: b.x,
  y: b.y + dy,
  width: b.width,
  height: b.height,
});

/** Integer median of a non-empty list (even length ⇒ rounded mean of the two). */
function integerMedian(values: readonly number[]): number {
  const sorted = [...values].sort((p, q) => p - q);
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** One member of a rigid chain move: the unit + its stationary parent hull. */
type MoveEntry = { unit: StrataUnit; parentHullId: string };

/**
 * Post-A7 exclusive-downstream chain relocation. Flag off ⇒ returns `placement`
 * by reference (byte-identical). Otherwise per-move greedy adoption of
 * length-improving rigid Y-translations of {U}∪G(U).
 */
export function refineStrataChainRelocate(
  placement: StrataPlacementResult,
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
  rank: StrataRankResult,
  options: StrataEngineOptions,
): StrataPlacementResult {
  void rank; // part of the shared signature; geometry here reads boxes.
  if (!options.strataChainRelocate) {
    return placement; // byte-identical path — referential identity preserved.
  }

  const penW = options.strataCrossWeightPenetration ?? 1;
  const crossW = options.strataCrossWeightEdge ?? 1;
  const epsilon = options.packedScoringEpsilon ?? 0;

  const baselineScore = scoreStrataPlacementGeometry(
    placement,
    model,
    edgesPrime,
  );
  const edgeCrossCap = resolveInheritedEdgeCrossCap(
    options.strataEdgeCrossCap,
    epsilon,
    baselineScore.crossings,
  );
  const weights = { penW, crossW, epsilon, edgeCrossCap };

  // ── hull index + subtree helpers ────────────────────────────────────────────
  const hullById = new Map<string, StrataHullNode>();
  const hullOrder: StrataHullNode[] = [];
  const indexHulls = (hull: StrataHullNode): void => {
    hullById.set(hull.id, hull);
    hullOrder.push(hull);
    for (const child of hull.children) {
      indexHulls(child);
    }
  };
  indexHulls(model.hullRoot);

  // leaf id → its locality key = the ancestor hull id at role "region" (or, when
  // no region ancestor exists, the shallowest non-root ancestor). The group is
  // confined to the anchor's own locality so a dominated-but-DISTANT downstream
  // leaf (e.g. the api6 lambda also feeds three cross-region API gateways) is
  // never co-moved — only the local chain (its own-region ssm / db).
  const leafLocality = new Map<string, string>();
  const walkLocality = (
    hull: StrataHullNode,
    regionAncestorId: string | undefined,
    shallowestNonRootId: string | undefined,
  ): void => {
    const nextRegion =
      hull.role === "region" ? hull.id : regionAncestorId;
    const nextShallow =
      shallowestNonRootId ?? (hull.role === "root" ? undefined : hull.id);
    const key = nextRegion ?? nextShallow ?? hull.id;
    for (const leaf of hull.leafClusterIds) {
      leafLocality.set(leaf, key);
    }
    for (const child of hull.children) {
      walkLocality(child, nextRegion, nextShallow);
    }
  };
  walkLocality(model.hullRoot, undefined, undefined);

  const subtreeLeafIds = (unit: StrataUnit): Set<string> => {
    const leaves = new Set<string>();
    if (unit.kind === "leaf") {
      leaves.add(unit.clusterId);
      return leaves;
    }
    const walk = (h: StrataHullNode): void => {
      for (const leaf of h.leafClusterIds) {
        leaves.add(leaf);
      }
      for (const child of h.children) {
        walk(child);
      }
    };
    walk(hullById.get(unit.hullId)!);
    return leaves;
  };

  const subtreeHullIds = (unit: StrataUnit): Set<string> => {
    const hulls = new Set<string>();
    if (unit.kind === "hull") {
      const walk = (h: StrataHullNode): void => {
        hulls.add(h.id);
        for (const child of h.children) {
          walk(child);
        }
      };
      walk(hullById.get(unit.hullId)!);
    }
    return hulls;
  };

  // ── E′ effective-direction adjacency (A3-reversed edges rank swapped, C10′) ───
  const downstream = new Map<string, Set<string>>();
  const upstream = new Map<string, Set<string>>();
  const link = (m: Map<string, Set<string>>, a: string, b: string): void => {
    const s = m.get(a);
    if (s) {
      s.add(b);
    } else {
      m.set(a, new Set([b]));
    }
  };
  for (const pe of edgesPrime) {
    const s = pe.edge.source;
    const t = pe.edge.target;
    const effSource = pe.reversed ? t : s;
    const effTarget = pe.reversed ? s : t;
    link(downstream, effSource, effTarget); // effSource → effTarget
    link(upstream, effTarget, effSource); // effTarget's predecessor = effSource
  }

  /**
   * Exclusive downstream group of `anchorLeaves`: the greatest set of downstream
   * leaves DOMINATED by the anchor — every effective-UPSTREAM predecessor of a
   * group leaf lies in {anchorLeaves}∪G (the leaf is fed ONLY through the anchor
   * chain). This is the tractable, real-graph reading of the diagnosis's
   * "exclusive downstream" — a pure fan-out child (api6 ssm / db) qualifies even
   * though it has its OWN downstream edges (to secretsmanager etc.); those are
   * priced by the scorer, not used to disqualify the group. Cross-region
   * gateways that are nominally downstream of the lambda are pruned because they
   * carry predecessors of their own outside the chain. Returns null when empty
   * or over the cap. Greatest-fixpoint by cascading removal of non-dominated
   * leaves.
   */
  const exclusiveDownstreamGroup = (
    anchorLeaves: ReadonlySet<string>,
  ): Set<string> | null => {
    // The anchor's locality/localities — group members must share one of them.
    const allowedLocalities = new Set<string>();
    for (const a of anchorLeaves) {
      const loc = leafLocality.get(a);
      if (loc !== undefined) {
        allowedLocalities.add(loc);
      }
    }
    const local = (l: string): boolean => {
      const loc = leafLocality.get(l);
      return loc !== undefined && allowedLocalities.has(loc);
    };
    // Bounded downstream cone (effective direction), excluding the anchor and
    // any leaf outside the anchor's locality (a distant cross-region sink).
    const cone = new Set<string>();
    const queue: string[] = [];
    for (const a of anchorLeaves) {
      for (const nx of downstream.get(a) ?? []) {
        if (!anchorLeaves.has(nx) && local(nx)) {
          queue.push(nx);
        }
      }
    }
    while (queue.length > 0 && cone.size < CHAIN_CONE_CAP) {
      const l = queue.shift()!;
      if (cone.has(l) || anchorLeaves.has(l)) {
        continue;
      }
      cone.add(l);
      for (const nx of downstream.get(l) ?? []) {
        if (!anchorLeaves.has(nx) && !cone.has(nx) && local(nx)) {
          queue.push(nx);
        }
      }
    }
    // Greatest fixpoint: drop any leaf with an effective-predecessor OUTSIDE
    // {anchor}∪G (not dominated by the anchor chain), cascading until stable.
    const group = new Set(cone);
    let changed = true;
    while (changed) {
      changed = false;
      for (const l of group) {
        let dominated = true;
        for (const pred of upstream.get(l) ?? []) {
          if (!anchorLeaves.has(pred) && !group.has(pred)) {
            dominated = false;
            break;
          }
        }
        if (!dominated) {
          group.delete(l);
          changed = true;
        }
      }
    }
    if (group.size === 0 || group.size > CHAIN_GROUP_CAP) {
      return null;
    }
    return group;
  };

  const r2Valid = (candidate: StrataPlacementResult): boolean => {
    const s = checkStrataStructure(candidate, model);
    return (
      s.nonAncestorOverlaps === 0 &&
      s.titleCollisions === 0 &&
      s.contiguityViolations === 0
    );
  };

  let incumbent = placement;
  let incumbentScore: StrataPackedScore = baselineScore;

  // unit id → parent hull id, rebuilt from the ROLLING incumbent each pass so a
  // prior adoption is respected. Leaf/child-hull units both resolve to the hull
  // whose `placed` list contains them (a leaf's DEEPEST hull).
  const buildParentIndex = (
    p: StrataPlacementResult,
  ): Map<string, string> => {
    const idx = new Map<string, string>();
    for (const [hullId, bh] of p.boxedHulls) {
      for (const pu of bh.placed) {
        idx.set(strataUnitId(pu.unit), hullId);
      }
    }
    return idx;
  };

  /**
   * Rigidly translate a set of move entries (each a unit within a stationary
   * parent hull) by `dy` into a fresh placement. Every moved unit's subtree
   * (hull boxes + placed boxes + descendant leaf boxes) rides along; the moved
   * units' own placed entries in their (stationary) parent hulls shift. New maps
   * — `from` is never mutated.
   */
  const translateChain = (
    from: StrataPlacementResult,
    entries: readonly MoveEntry[],
    movedLeafIds: ReadonlySet<string>,
    movedHullIds: ReadonlySet<string>,
    dy: number,
  ): StrataPlacementResult => {
    // parentHullId → set of moved unit ids to shift in that (stationary) parent.
    const parentShifts = new Map<string, Set<string>>();
    for (const e of entries) {
      if (movedHullIds.has(e.parentHullId)) {
        continue; // parent itself rides along ⇒ entry already moves with it.
      }
      const uid = strataUnitId(e.unit);
      const set = parentShifts.get(e.parentHullId);
      if (set) {
        set.add(uid);
      } else {
        parentShifts.set(e.parentHullId, new Set([uid]));
      }
    }

    const leafBoxes = new Map<string, StrataBox>();
    for (const [id, box] of from.leafBoxes) {
      leafBoxes.set(id, movedLeafIds.has(id) ? shiftBox(box, dy) : box);
    }

    const boxedHulls = new Map<string, StrataBoxedHull>();
    for (const [id, bh] of from.boxedHulls) {
      if (movedHullIds.has(id)) {
        boxedHulls.set(id, {
          hull: bh.hull,
          box: shiftBox(bh.box, dy),
          placed: bh.placed.map((pu) => ({
            unit: pu.unit,
            box: shiftBox(pu.box, dy),
            colSpan: pu.colSpan,
          })),
        });
        continue;
      }
      const shiftUids = parentShifts.get(id);
      if (shiftUids) {
        boxedHulls.set(id, {
          hull: bh.hull,
          box: bh.box,
          placed: bh.placed.map((pu) =>
            shiftUids.has(strataUnitId(pu.unit))
              ? {
                  unit: pu.unit,
                  box: shiftBox(pu.box, dy),
                  colSpan: pu.colSpan,
                }
              : pu,
          ),
        });
        continue;
      }
      boxedHulls.set(id, bh);
    }

    return { boxedHulls, leafBoxes };
  };

  // Fixed 2-pass deterministic schedule (task: small fixed pass count).
  for (let pass = 0; pass < 2; pass++) {
    let changedThisPass = false;
    const parentIndex = buildParentIndex(incumbent);

    for (const hull of hullOrder) {
      const bh = incumbent.boxedHulls.get(hull.id);
      if (bh === undefined || bh.placed.length === 0) {
        continue;
      }
      // Snapshot the anchor list for this hull (stable order) — adoptions during
      // the loop only translate boxes, never add/remove units.
      const anchors = [...bh.placed];

      for (const anchor of anchors) {
        const anchorUnit = anchor.unit;
        const anchorLeaves = subtreeLeafIds(anchorUnit);
        // Chain-relocate targets small stranded units; a large hull subtree is
        // not a "chain" and computing its cone is wasteful. Skip big anchors.
        if (anchorLeaves.size > CHAIN_ANCHOR_LEAF_CAP) {
          continue;
        }
        const group = exclusiveDownstreamGroup(anchorLeaves);
        if (group === null) {
          continue;
        }

        // Build the move set: the anchor + one leaf-unit per group leaf. Resolve
        // each member's stationary parent hull from the rolling index; skip the
        // whole anchor if any member's parent can't be resolved (defensive).
        const entries: MoveEntry[] = [
          { unit: anchorUnit, parentHullId: hull.id },
        ];
        let ok = true;
        for (const leafId of group) {
          const uid = `L:${leafId}`;
          const parentHullId = parentIndex.get(uid);
          if (parentHullId === undefined) {
            ok = false;
            break;
          }
          entries.push({
            unit: { kind: "leaf", clusterId: leafId },
            parentHullId,
          });
        }
        if (!ok) {
          continue;
        }

        // Union of everything that shifts.
        const movedLeafIds = new Set<string>();
        const movedHullIds = new Set<string>();
        for (const e of entries) {
          for (const l of subtreeLeafIds(e.unit)) {
            movedLeafIds.add(l);
          }
          for (const h of subtreeHullIds(e.unit)) {
            movedHullIds.add(h);
          }
        }

        // Feasible dy = ∩ per-member containment inside its stationary parent.
        let dyLo = Number.NEGATIVE_INFINITY;
        let dyHi = Number.POSITIVE_INFINITY;
        const liveBoxOf = (unit: StrataUnit): StrataBox | undefined =>
          unit.kind === "leaf"
            ? incumbent.leafBoxes.get(unit.clusterId)
            : incumbent.boxedHulls.get(unit.hullId)?.box;
        let feasible = true;
        for (const e of entries) {
          const parentBH = incumbent.boxedHulls.get(e.parentHullId);
          const memberBox = liveBoxOf(e.unit);
          if (parentBH === undefined || memberBox === undefined) {
            feasible = false;
            break;
          }
          const minTop = parentBH.box.y + topInsetOf(parentBH.hull.role);
          const maxTop =
            parentBH.box.y + parentBH.box.height - framePad() - memberBox.height;
          if (maxTop < minTop) {
            feasible = false;
            break;
          }
          dyLo = Math.max(dyLo, minTop - memberBox.y);
          dyHi = Math.min(dyHi, maxTop - memberBox.y);
        }
        if (!feasible || dyLo > dyHi) {
          continue;
        }

        // Candidate offsets. Primary = L1-optimal external-chord median: for each
        // chord with exactly one endpoint inside the moved set, align the near
        // (moving) leaf centre onto the far (stationary) one; median minimises
        // Σ|Δy|. Plus a few nearest sibling slot boundaries for the anchor.
        const offsets: number[] = [];
        for (const pe of edgesPrime) {
          const sIn = movedLeafIds.has(pe.edge.source);
          const tIn = movedLeafIds.has(pe.edge.target);
          if (sIn === tIn) {
            continue; // internal or wholly external — not a boundary chord.
          }
          const nearId = sIn ? pe.edge.source : pe.edge.target;
          const farId = sIn ? pe.edge.target : pe.edge.source;
          const nearBox = incumbent.leafBoxes.get(nearId);
          const farBox = incumbent.leafBoxes.get(farId);
          if (nearBox && farBox) {
            const nearCentre = nearBox.y + nearBox.height / 2;
            const farCentre = farBox.y + farBox.height / 2;
            offsets.push(farCentre - nearCentre);
          }
        }
        if (offsets.length === 0) {
          continue; // no external chords ⇒ length is dy-invariant, nothing to do.
        }

        const anchorBox = liveBoxOf(anchorUnit)!;
        const rawDys: number[] = [integerMedian(offsets)];
        // Nearest sibling boundaries in the anchor's hull as extra alignment dys.
        const sibBoundaries: number[] = [];
        for (const pu of bh.placed) {
          if (strataUnitId(pu.unit) === strataUnitId(anchorUnit)) {
            continue;
          }
          sibBoundaries.push(pu.box.y - anchorBox.y);
          sibBoundaries.push(pu.box.y + pu.box.height - anchorBox.y);
        }
        sibBoundaries.sort(
          (a, b) => Math.abs(a) - Math.abs(b) || a - b,
        );
        rawDys.push(...sibBoundaries.slice(0, CHAIN_SLOT_BUDGET));

        // Clamp to the feasible interval, integer-round, dedupe, drop 0.
        const seen = new Set<number>();
        const candidateDys: number[] = [];
        for (const raw of rawDys) {
          const clamped = Math.round(Math.min(dyHi, Math.max(dyLo, raw)));
          if (clamped !== 0 && !seen.has(clamped)) {
            seen.add(clamped);
            candidateDys.push(clamped);
          }
        }

        for (const dy of candidateDys) {
          const candidate = translateChain(
            incumbent,
            entries,
            movedLeafIds,
            movedHullIds,
            dy,
          );
          if (!r2Valid(candidate)) {
            continue;
          }
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
            changedThisPass = true;
          }
        }
      }
    }
    if (!changedThisPass) {
      break; // fixpoint reached before the pass cap.
    }
  }

  return incumbent;
}
