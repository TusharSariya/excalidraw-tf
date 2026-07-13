/**
 * Strata engine — A0 compound placement (M1a) + R2 structural checks.
 *
 * Spec: docs/rcll-v2-spec-v2.md §6-A0 (verbatim semantics) with the A2 sequence
 * from `orderStrataUnits` (K=0 in M1a). `layoutHull(h)` runs post-order over the
 * hull tree:
 *   1. lay out every child hull first (children become fixed-size boxes);
 *   2. units(h) = child hulls + leaf clusters directly in h; colSpan = [min,max]
 *      rank over the unit's leaves;
 *   3. order units by A2 — ONE sequence over units(h);
 *   4. place by policy: **packed** (region/vpc/subnetZone) = per-hull skyline via
 *      {@link dropY} over each unit's ACTUAL padded x-extent (never the bare column
 *      span, OD-6 monotone-downward); **banded** (provider/account/root) = a
 *      full-width vertical stack in sequence order with the shared LANE_GAP_Y;
 *   5. h.box = bbox(units) + FRAME_PAD all sides + TITLE_RESERVE at top (title
 *      inside the box — positive sibling gaps keep frames+titles disjoint).
 * After the root pass, absolute coords are assigned top-down (children offset by
 * parent origin in Y; X is pinned to the global columnX grid throughout).
 *
 * Geometry constants are the shared v3.1-frozen as-built values (asserted in the
 * test): FRAME_PAD=28, LANE_GAP_Y=96, TITLE_RESERVE=FRAME_PAD*2=56. Leaf unit
 * dims use the frame's TRUE local rect (`clusterFrameLocalRect`, D10 #5) — a
 * full-mode cluster's frame can sit at a nonzero local offset and be larger than
 * `build.width/height`.
 */
import {
  PIPELINE_CLUSTER_GAP_Y,
  PIPELINE_FRAME_PAD,
  PIPELINE_LANE_GAP_Y,
  PIPELINE_MARGIN,
} from "./terraformPipelineLayoutShared";
import { clusterFrameLocalRect } from "./terraformPipelineV2Pack";
import {
  liftStrataEdgesToUnits,
  orderStrataUnits,
  strataPackedCandidateSequences,
  strataUnitId,
} from "./terraformPipelineStrataOrdering";

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

// The three derived spacing values are CALL-TIME reads, never module-level
// consts: this module sits inside the repo's pre-existing
// terraformPlanParsing→terraformLayoutCore import cycle (via the Strata engine
// dispatch), so at module-init time the LayoutShared constants can still be
// uninitialized (undefined ⇒ a module-level `PAD * 2` freezes as NaN — a real,
// test-caught failure). Call-time reads always see the initialized bindings.
/** Title strip reserved at the top of a hull box (v3.1-frozen HULL_TITLE_BAND). */
const strataTitleReserve = (): number => PIPELINE_FRAME_PAD * 2;
/** Stacked-gap when a framed hull is involved (clears its border + title). */
const strataHullGapY = (): number => PIPELINE_LANE_GAP_Y;
/** Stacked-gap between two plain leaf cards. */
const strataLeafGapY = (): number => PIPELINE_CLUSTER_GAP_Y;

/** A rectangle already occupied in a hull's local frame (for geometric drop). */
type SkylineRect = { x0: number; x1: number; y1: number; isHull: boolean };

/** Stacked gap between two blocks: wide if either is a framed hull. */
function gapBetween(aIsHull: boolean, bIsHull: boolean): number {
  return aIsHull || bIsHull ? strataHullGapY() : strataLeafGapY();
}

/**
 * Lowest y ≥ startY where [x0,x1) × [y, y+h) clears every placed rect (with the
 * hull/leaf stacked gap). Monotone downward, no gap back-fill (OD-6). Strata's
 * own copy of the Pack.ts:137-208 skyline geometry (no coupling to V2Pack's Block
 * machinery, D3′).
 */
function dropY(
  rects: readonly SkylineRect[],
  x0: number,
  x1: number,
  startY: number,
  isHull: boolean,
): number {
  let y = startY;
  let moved = true;
  while (moved) {
    moved = false;
    for (const rect of rects) {
      if (x0 < rect.x1 && rect.x0 < x1 && y < rect.y1) {
        const floor = rect.y1 + gapBetween(rect.isHull, isHull);
        if (floor > y) {
          y = floor;
          moved = true;
        }
      }
    }
  }
  return y;
}

/** A unit resolved to its global x-extent + fixed height, before Y placement. */
type UnitInfo = {
  unit: StrataUnit;
  unitId: string;
  x0: number;
  x1: number;
  height: number;
  colSpan: readonly [number, number];
  contentKey: string;
};

/** A placed unit with its top position local to the owning hull's box top. */
type LocalPlaced = { info: UnitInfo; localYTop: number };

/** A hull laid out in local Y (box top = 0); X is already global. */
type LocalHull = {
  hull: StrataHullNode;
  boxXLeft: number;
  boxWidth: number;
  boxHeight: number;
  placed: LocalPlaced[];
};

/**
 * A0 compound placement over the whole hull tree. `edgesPrime` (E′ from A3) is
 * lifted per-hull for A2 scoping; `rank` supplies per-cluster columns + the
 * global columnX grid; `options.sweeps` threads the K seam (K=0 in M1a).
 */
export function placeStrataHulls(
  model: StrataModel,
  edgesPrime: readonly StrataPrimeEdge[],
  rank: StrataRankResult,
  options: StrataEngineOptions,
  /**
   * ADDITIVE-OPTIONAL (round 9, `strataPackedScoring`): when set, PACKED hulls
   * use their unconditional sweep-chain snapshot instead of the v2.0
   * acceptance-chain order — the whole-layout scorer trial-places candidates
   * and picks the winner. A plain number applies that snapshot index to every
   * packed hull (clamped per hull); a map selects PER HULL by `hull.id`, and a
   * packed hull absent from the map keeps the legacy acceptance-chain order.
   * Banded hulls are unaffected. `undefined` ⇒ byte-identical legacy behavior.
   */
  packedCandidateIndex?: number | ReadonlyMap<string, number>,
  /**
   * ADDITIVE-OPTIONAL: when provided, reports each packed hull's candidate
   * count (snapshots + sifting variants) so the whole-layout descent can
   * iterate exact per-hull candidate ranges. Costs one extra candidate
   * generation per packed hull on the reporting run only.
   */
  onPackedCandidateCount?: (hullId: string, count: number) => void,
): StrataPlacementResult {
  const rankOf = (clusterId: string): number => {
    const r = rank.rank.get(clusterId);
    if (r === undefined) {
      throw new Error(
        `Strata A0: cluster ${clusterId} has no rank (off-grid; C1′)`,
      );
    }
    return r;
  };
  const columnLeft = (r: number): number => {
    const x = rank.columnX[r];
    if (x === undefined) {
      throw new Error(
        `Strata A0: rank ${r} is outside the columnX grid (length ${rank.columnX.length})`,
      );
    }
    return x;
  };

  const subtreeCache = new Map<string, readonly string[]>();
  const subtreeClusterIds = (hull: StrataHullNode): readonly string[] => {
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

  const minAddress = (clusterIds: readonly string[]): string => {
    let min: string | undefined;
    for (const id of clusterIds) {
      const addr = model.addressOf(id);
      if (min === undefined || addr < min) {
        min = addr;
      }
    }
    return min ?? "";
  };

  const localByHullId = new Map<string, LocalHull>();

  const layoutHull = (hull: StrataHullNode): LocalHull => {
    for (const child of hull.children) {
      layoutHull(child);
    }

    // Step 2: units(h) = child hulls + direct leaves, with colSpan + content key.
    const infos: UnitInfo[] = [];
    for (const child of hull.children) {
      const cl = localByHullId.get(child.id)!;
      const leaves = subtreeClusterIds(child);
      let colMin = Number.POSITIVE_INFINITY;
      let colMax = Number.NEGATIVE_INFINITY;
      for (const leaf of leaves) {
        const r = rankOf(leaf);
        colMin = Math.min(colMin, r);
        colMax = Math.max(colMax, r);
      }
      infos.push({
        unit: { kind: "hull", hullId: child.id },
        unitId: `H:${child.id}`,
        x0: cl.boxXLeft,
        x1: cl.boxXLeft + cl.boxWidth,
        height: cl.boxHeight,
        colSpan: [colMin, colMax],
        contentKey: minAddress(leaves),
      });
    }
    for (const leafId of hull.leafClusterIds) {
      const cluster = model.clusters.get(leafId)!;
      const rect = clusterFrameLocalRect(cluster);
      const r = rankOf(leafId);
      const x0 = columnLeft(r);
      infos.push({
        unit: { kind: "leaf", clusterId: leafId },
        unitId: `L:${leafId}`,
        x0,
        x1: x0 + rect.width,
        height: rect.height,
        colSpan: [r, r],
        contentKey: model.addressOf(leafId),
      });
    }

    const infoByUnitId = new Map(infos.map((info) => [info.unitId, info]));

    // clusterId → owning unit id at THIS hull (leaves + child-hull subtrees).
    const unitOfCluster = new Map<string, string>();
    for (const child of hull.children) {
      const uid = `H:${child.id}`;
      for (const cid of subtreeClusterIds(child)) {
        unitOfCluster.set(cid, uid);
      }
    }
    for (const leafId of hull.leafClusterIds) {
      unitOfCluster.set(leafId, `L:${leafId}`);
    }

    // Step 3: A2 orders ONE sequence over units(h); edges lifted to units(h).
    const liftedEdges = liftStrataEdgesToUnits(edgesPrime, (cid) =>
      unitOfCluster.get(cid),
    );
    // WP-3a wiring: the real x-extents + rank spans MUST reach the A2 pass —
    // without them K>0 silently degrades to the ordering module's documented
    // fallbacks (all-x=0 collinear chords ⇒ packed acceptance can never fire;
    // layer-0-for-all merges down/up sweeps and voids the crossings tiebreak).
    // Defensiveness convention: same `??`-degenerate as `unitHeightOf` — an
    // unknown id is unreachable by construction (every queried id comes from
    // `infos` / the lift over this hull), and inside the engine's failure
    // contract a deterministic degenerate answer for an unreachable case beats
    // adding a new throw path (so no new "Strata A2"-prefixed throw is needed).
    const orderParams = {
      units: infos.map((info) => info.unit),
      contentKeyOf: (unit: StrataUnit) =>
        infoByUnitId.get(strataUnitId(unit))!.contentKey,
      liftedEdges,
      unitHeightOf: (id: string) => infoByUnitId.get(id)?.height ?? 0,
      policy: hull.policy,
      sweeps: options.sweeps,
      unitXSpanOf: (id: string): readonly [number, number] => {
        const info = infoByUnitId.get(id);
        return info ? [info.x0, info.x1] : [0, 0];
      },
      unitColSpanOf: (id: string): readonly [number, number] =>
        infoByUnitId.get(id)?.colSpan ?? [0, 0],
    };
    let ordered: readonly StrataUnit[];
    const packedIndexForHull =
      packedCandidateIndex === undefined
        ? undefined
        : typeof packedCandidateIndex === "number"
          ? packedCandidateIndex
          : packedCandidateIndex.get(hull.id);
    if (hull.policy === "packed" && onPackedCandidateCount) {
      onPackedCandidateCount(
        hull.id,
        strataPackedCandidateSequences(orderParams).length,
      );
    }
    if (packedIndexForHull !== undefined && hull.policy === "packed") {
      const cands = strataPackedCandidateSequences(orderParams);
      ordered = cands[Math.min(packedIndexForHull, cands.length - 1)]!;
    } else {
      ordered = orderStrataUnits(orderParams);
    }

    // Step 4: place by policy. Content starts below FRAME_PAD + TITLE_RESERVE
    // (root carries no title strip — it is the canvas, not a titled frame).
    const topInset =
      PIPELINE_FRAME_PAD + (hull.role === "root" ? 0 : strataTitleReserve());
    const placed: LocalPlaced[] = [];

    if (hull.policy === "packed") {
      const rects: SkylineRect[] = [];
      for (const unit of ordered) {
        const info = infoByUnitId.get(strataUnitId(unit))!;
        const isHull = unit.kind === "hull";
        const y = dropY(rects, info.x0, info.x1, topInset, isHull);
        placed.push({ info, localYTop: y });
        rects.push({ x0: info.x0, x1: info.x1, y1: y + info.height, isHull });
      }
    } else {
      let cursor = topInset;
      for (const unit of ordered) {
        const info = infoByUnitId.get(strataUnitId(unit))!;
        placed.push({ info, localYTop: cursor });
        cursor += info.height + PIPELINE_LANE_GAP_Y;
      }
    }

    // Step 5: h.box = bbox(units) + FRAME_PAD all sides + TITLE_RESERVE at top.
    let minX0 = Number.POSITIVE_INFINITY;
    let maxX1 = Number.NEGATIVE_INFINITY;
    let maxBottom = topInset;
    for (const p of placed) {
      minX0 = Math.min(minX0, p.info.x0);
      maxX1 = Math.max(maxX1, p.info.x1);
      maxBottom = Math.max(maxBottom, p.localYTop + p.info.height);
    }
    if (placed.length === 0) {
      minX0 = PIPELINE_MARGIN;
      maxX1 = PIPELINE_MARGIN;
    }
    const local: LocalHull = {
      hull,
      boxXLeft: minX0 - PIPELINE_FRAME_PAD,
      boxWidth: maxX1 - minX0 + 2 * PIPELINE_FRAME_PAD,
      boxHeight: maxBottom + PIPELINE_FRAME_PAD,
      placed,
    };
    localByHullId.set(hull.id, local);
    return local;
  };

  layoutHull(model.hullRoot);

  // Absolute pass: X is already global; only Y accumulates the parent origin.
  const boxedHulls = new Map<string, StrataBoxedHull>();
  const leafBoxes = new Map<string, StrataBox>();

  const assignAbsolute = (local: LocalHull, absTop: number): void => {
    const box: StrataBox = {
      x: local.boxXLeft,
      y: absTop,
      width: local.boxWidth,
      height: local.boxHeight,
    };
    const placedAbs: StrataPlacedUnit[] = [];
    for (const p of local.placed) {
      const unitTop = absTop + p.localYTop;
      const unitBox: StrataBox = {
        x: p.info.x0,
        y: unitTop,
        width: p.info.x1 - p.info.x0,
        height: p.info.height,
      };
      placedAbs.push({
        unit: p.info.unit,
        box: unitBox,
        colSpan: p.info.colSpan,
      });
      if (p.info.unit.kind === "leaf") {
        leafBoxes.set(p.info.unit.clusterId, unitBox);
      } else {
        assignAbsolute(localByHullId.get(p.info.unit.hullId)!, unitTop);
      }
    }
    boxedHulls.set(local.hull.id, { hull: local.hull, box, placed: placedAbs });
  };

  assignAbsolute(localByHullId.get(model.hullRoot.id)!, PIPELINE_MARGIN);

  return { boxedHulls, leafBoxes };
}

// ── R2 structural checks (S0b acceptance; standing T9 invariant) ───────────────

/** Axis-aligned strict overlap (touching edges do NOT overlap). */
function boxesOverlap(a: StrataBox, b: StrataBox): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * R2 acceptance checks on a placement (all three must be 0):
 *  - `nonAncestorOverlaps`: overlapping padded boxes where neither contains the
 *    other in the hull tree (ancestor containment is allowed);
 *  - `titleCollisions`: a non-descendant/non-ancestor box overlapping a hull's
 *    top TITLE_RESERVE strip;
 *  - `contiguityViolations`: per (hull, column) a foreign leaf whose Y-centre
 *    falls inside the hull's own leaf Y-span in that column (an interleave).
 */
export function checkStrataStructure(
  placement: StrataPlacementResult,
  model: StrataModel,
): {
  nonAncestorOverlaps: number;
  titleCollisions: number;
  contiguityViolations: number;
} {
  // hullId → set of all descendant ids (child hull ids + subtree leaf ids).
  const descendantsOf = new Map<string, Set<string>>();
  const collect = (hull: StrataHullNode): Set<string> => {
    const set = new Set<string>();
    for (const leaf of hull.leafClusterIds) {
      set.add(leaf);
    }
    for (const child of hull.children) {
      set.add(child.id);
      for (const d of collect(child)) {
        set.add(d);
      }
    }
    descendantsOf.set(hull.id, set);
    return set;
  };
  collect(model.hullRoot);

  type Entry = { id: string; kind: "hull" | "leaf"; box: StrataBox };
  const entries: Entry[] = [];
  for (const [id, bh] of placement.boxedHulls) {
    entries.push({ id, kind: "hull", box: bh.box });
  }
  for (const [id, box] of placement.leafBoxes) {
    entries.push({ id, kind: "leaf", box });
  }

  const containsRel = (a: Entry, b: Entry): boolean => {
    const da = a.kind === "hull" ? descendantsOf.get(a.id) : undefined;
    if (da && da.has(b.id)) {
      return true;
    }
    const db = b.kind === "hull" ? descendantsOf.get(b.id) : undefined;
    return db ? db.has(a.id) : false;
  };

  let nonAncestorOverlaps = 0;
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (containsRel(entries[i]!, entries[j]!)) {
        continue;
      }
      if (boxesOverlap(entries[i]!.box, entries[j]!.box)) {
        nonAncestorOverlaps += 1;
      }
    }
  }

  let titleCollisions = 0;
  for (const [hullId, bh] of placement.boxedHulls) {
    if (bh.hull.role === "root") {
      continue; // root carries no title strip
    }
    const desc = descendantsOf.get(hullId)!;
    const strip: StrataBox = {
      x: bh.box.x,
      y: bh.box.y,
      width: bh.box.width,
      height: PIPELINE_FRAME_PAD + strataTitleReserve(),
    };
    for (const e of entries) {
      if (e.id === hullId || desc.has(e.id)) {
        continue; // self or descendant
      }
      const ed = e.kind === "hull" ? descendantsOf.get(e.id) : undefined;
      if (ed && ed.has(hullId)) {
        continue; // ancestor of this hull
      }
      if (boxesOverlap(strip, e.box)) {
        titleCollisions += 1;
      }
    }
  }

  const leafEntries = [...placement.leafBoxes.entries()].map(([id, box]) => ({
    id,
    box,
  }));
  let contiguityViolations = 0;
  for (const [hullId] of placement.boxedHulls) {
    const desc = descendantsOf.get(hullId)!;
    // hull's own leaf Y-span per column (column key = leaf box left / columnX).
    const cols = new Map<number, { min: number; max: number }>();
    for (const le of leafEntries) {
      if (!desc.has(le.id)) {
        continue;
      }
      const span = cols.get(le.box.x) ?? {
        min: Number.POSITIVE_INFINITY,
        max: Number.NEGATIVE_INFINITY,
      };
      span.min = Math.min(span.min, le.box.y);
      span.max = Math.max(span.max, le.box.y + le.box.height);
      cols.set(le.box.x, span);
    }
    for (const le of leafEntries) {
      if (desc.has(le.id)) {
        continue; // inside this hull's subtree
      }
      const span = cols.get(le.box.x);
      if (!span) {
        continue; // no shared column with this hull
      }
      const yCentre = le.box.y + le.box.height / 2;
      if (yCentre > span.min && yCentre < span.max) {
        contiguityViolations += 1;
      }
    }
  }

  return { nonAncestorOverlaps, titleCollisions, contiguityViolations };
}
