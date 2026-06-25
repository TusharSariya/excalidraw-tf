/**
 * RCLL (Recursive Compound Layered Layout) — Coordinated per-column permutation
 * re-pack (Milestone M5b). A **never-worse refinement** applied on top of the M5
 * Brandes–Köpf straightener (`terraformPipelineStraighten.ts`).
 *
 * ## Why this exists
 * The straightener does an in-place pairwise alignment that is ~0 % reclaimable on
 * dense charts (the "third-sibling block": aligning one leaf needs evicting a third
 * sibling already in the row). A feasibility probe measured that a **coordinated joint
 * solve** — re-permuting each column's leaves together and re-placing their Y, **inside
 * the fixed container band** — reclaims an exact 27.2 % of intra-container dataflow edge
 * |ΔY| on `staging-extended-localstack-v2` (crossing-preserving, fully CON-feasible).
 * The win is specific to many-small-column topologies; it is ~0 % on presets dominated
 * by one large column or with few intra-container edges. That is acceptable: ship it
 * default-OFF.
 *
 * ## The hard constraint (do not remove)
 * The flashy 39–96 % ceilings the probe also saw are a MIRAGE — they require letting the
 * column band GROW (CON-3 violation), which is exactly how a prior dummy-chain attempt
 * failed (+1045 px span). **The band [bandTop, bandBottom] is a hard constraint. Never
 * grow it.** Every candidate stack is clamped inside the band; a stack that cannot fit
 * is rejected.
 *
 * ## The algorithm
 * Per container (one call), per column (fixed ascending order):
 *   - Search PERMUTATIONS of the column's leaves.
 *     - ≤ `BRUTE_FORCE_MAX` leaves → brute-force ALL permutations (exact, deterministic).
 *     - above that → a DETERMINISTIC candidate set: barycenter-sort plus a bounded set
 *       of deterministic adjacent-swap refinements (coordinate descent). NO RANDOM
 *       SHUFFLES (CON-8 determinism: no Math.random, no Date).
 *   - For each candidate permutation, place the column as a top-down sequential stack
 *     with `height + gap` separation, each leaf pulled toward the barycenter (mean Y) of
 *     its already-placed intra-container dataflow neighbours, then clamped so the whole
 *     stack stays within [bandTop, bandBottom] (the fixed band).
 *   - Objective: minimize total intra-container dataflow edge |ΔY| for the container.
 *     Iterate columns via monotonic coordinate descent (total |ΔY| only decreases)
 *     until no column improves or a fixed iteration cap.
 *
 * ## Never-worse accept gate (the caller adopts per container only if all hold)
 *   - improvement: total intra-container |ΔY| strictly decreases;
 *   - CON-3 containment: every leaf stays within [bandTop, bandBottom];
 *   - CON-4/5 non-overlap: height+gap separation among siblings (the sequential stack
 *     guarantees it; asserted);
 *   - crossing-preserving: intra-container edge crossings must not INCREASE;
 *   - CON-12 forwardness: X / columns are NEVER touched — only Y + within-column order;
 *   - CON-8 determinism: fixed iteration order, stable tiebreak by key, no RNG.
 *
 * Pure + deterministic. Returns `null` when it cannot improve (caller keeps the
 * straightened result untouched).
 */

/** One leaf to re-pack. `y` is its current (straightened) top-Y. */
export type RepackLeaf = {
  key: string;
  clusterId: string;
  /** column index (the layer; NEVER changed by the re-pack). */
  col: number;
  /** placed box height (size-aware separation). */
  height: number;
  /** current (straightened) top-Y — the starting point we refine from. */
  y: number;
};

export type RepackResult = {
  /** new top-Y per leaf key. */
  y: number;
  /** new within-column order index (0 = topmost). */
  order: number;
};

type Adjacency = ReadonlyMap<string, readonly string[]>;

/** Brute-force every permutation at or below this column size; deterministic search above. */
export const REPACK_BRUTE_FORCE_MAX = 8;

/** Coordinate-descent sweep cap (monotonic — each sweep can only lower total |ΔY|). */
const MAX_SWEEPS = 8;

/** Heap's algorithm: all permutations of indices [0..n). Deterministic order. */
function permutations<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  const a = [...items];
  const c = new Array<number>(a.length).fill(0);
  out.push([...a]);
  let i = 0;
  while (i < a.length) {
    if (c[i]! < i) {
      const swap = i % 2 === 0 ? 0 : c[i]!;
      const tmp = a[swap]!;
      a[swap] = a[i]!;
      a[i] = tmp;
      out.push([...a]);
      c[i]!++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
  return out;
}

/**
 * Place one column's leaves (already in the candidate order) as a sequential top-down
 * stack with `height + gap` separation, each leaf pulled toward the barycenter of its
 * already-placed intra-container neighbours (Y taken from `neighborY`), then clamped so
 * the whole stack fits inside [bandTop, bandBottom]. Returns `null` if the column's
 * total height exceeds the band (cannot fit ⇒ CON-3 would be violated).
 *
 * `neighborY` is the current Y of every leaf NOT in this column (other columns are
 * frozen while this column is optimized — the coordinate-descent step).
 */
function placeColumnStack(
  order: readonly RepackLeaf[],
  adjacency: ReadonlyMap<string, readonly string[]>,
  neighborY: ReadonlyMap<string, number>,
  bandTop: number,
  bandBottom: number,
  gap: number,
): Map<string, number> | null {
  const n = order.length;
  if (n === 0) {
    return new Map();
  }
  // total span the stack needs; if it cannot fit the band, reject (never grow the band).
  let totalHeight = 0;
  for (let i = 0; i < n; i++) {
    totalHeight += order[i]!.height;
  }
  totalHeight += gap * (n - 1);
  if (totalHeight > bandBottom - bandTop + 1e-6) {
    return null;
  }

  // desired top-Y per leaf = barycenter of its placed neighbours, minus half its own
  // height (so the leaf's CENTER lands on the neighbour barycenter). Leaves with no
  // placed neighbour keep their current order position (desired = -Infinity sentinel ⇒
  // packed against the leaf above).
  const desired = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const leaf = order[i]!;
    const neighbors = adjacency.get(leaf.clusterId) ?? [];
    let sum = 0;
    let count = 0;
    for (const nb of neighbors) {
      const ny = neighborY.get(nb);
      if (ny != null) {
        sum += ny;
        count++;
      }
    }
    desired[i] =
      count > 0 ? sum / count - leaf.height / 2 : Number.NEGATIVE_INFINITY;
  }

  // top-down sequential placement honouring separation: each leaf's top is the max of
  // its desired top and the running cursor (top of prev + prevHeight + gap).
  const top = new Array<number>(n);
  let cursor = bandTop;
  for (let i = 0; i < n; i++) {
    const want =
      desired[i]! === Number.NEGATIVE_INFINITY ? cursor : desired[i]!;
    const placed = Math.max(want, cursor);
    top[i] = placed;
    cursor = placed + order[i]!.height + gap;
  }
  // clamp the whole stack into the band: if the bottom overshoots, shift the entire
  // stack up by the overshoot (preserves all separations). It fits because totalHeight
  // <= band height was checked above. Then clamp the top into the band.
  const stackTop = top[0]!;
  const stackBottom = top[n - 1]! + order[n - 1]!.height;
  let shift = 0;
  if (stackBottom > bandBottom) {
    shift = bandBottom - stackBottom;
  }
  if (stackTop + shift < bandTop) {
    shift = bandTop - stackTop;
  }
  const out = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    out.set(order[i]!.key, top[i]! + shift);
  }
  return out;
}

/**
 * Total intra-container dataflow edge |ΔY| over the container, given each leaf's
 * CENTER-Y. Each edge is counted once (fanout direction); `centers` maps clusterId →
 * center-Y. Edges to clusters not present in `centers` (cross-container) are ignored.
 */
function totalEdgeDeltaY(
  leaves: readonly RepackLeaf[],
  fanout: Adjacency,
  centers: ReadonlyMap<string, number>,
): number {
  let total = 0;
  for (const leaf of leaves) {
    const sc = centers.get(leaf.clusterId);
    if (sc == null) {
      continue;
    }
    for (const t of fanout.get(leaf.clusterId) ?? []) {
      if (t === leaf.clusterId) {
        continue;
      }
      const tc = centers.get(t);
      if (tc != null) {
        total += Math.abs(sc - tc);
      }
    }
  }
  return total;
}

/**
 * Count intra-container edge crossings: an edge pair (a→b, c→d) crosses when one
 * source is above the other but the targets are in the opposite vertical order. Uses
 * center-Y. Only counts edges between distinct columns (col(source) != col(target));
 * same-column edges have no meaningful crossing here. Deterministic O(E²) — fine for
 * per-container leaf counts.
 */
function countCrossings(
  leaves: readonly RepackLeaf[],
  fanout: Adjacency,
  centers: ReadonlyMap<string, number>,
  colOf: ReadonlyMap<string, number>,
): number {
  const edges: { sy: number; ty: number; sCol: number; tCol: number }[] = [];
  for (const leaf of leaves) {
    const sy = centers.get(leaf.clusterId);
    const sCol = colOf.get(leaf.clusterId);
    if (sy == null || sCol == null) {
      continue;
    }
    for (const t of fanout.get(leaf.clusterId) ?? []) {
      if (t === leaf.clusterId) {
        continue;
      }
      const ty = centers.get(t);
      const tCol = colOf.get(t);
      if (ty != null && tCol != null && sCol !== tCol) {
        edges.push({ sy, ty, sCol, tCol });
      }
    }
  }
  let crossings = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i]!;
      const b = edges[j]!;
      // only edges spanning the same column pair can cross in this 2-layer sense.
      if (a.sCol !== b.sCol || a.tCol !== b.tCol) {
        continue;
      }
      const srcOrder = Math.sign(a.sy - b.sy);
      const tgtOrder = Math.sign(a.ty - b.ty);
      if (srcOrder !== 0 && tgtOrder !== 0 && srcOrder !== tgtOrder) {
        crossings++;
      }
    }
  }
  return crossings;
}

/** Build center-Y map (clusterId → center) from a top-Y map keyed by leaf key. */
function centersFromTops(
  leaves: readonly RepackLeaf[],
  tops: ReadonlyMap<string, number>,
): Map<string, number> {
  const centers = new Map<string, number>();
  for (const leaf of leaves) {
    const top = tops.get(leaf.key);
    if (top != null) {
      centers.set(leaf.clusterId, top + leaf.height / 2);
    }
  }
  return centers;
}

/**
 * Deterministic candidate orderings for a column with more than `REPACK_BRUTE_FORCE_MAX`
 * leaves. (1) the current order; (2) a barycenter-sort by neighbour mean-Y (stable
 * tiebreak by current y then key); (3) bounded adjacent-swap refinements of the
 * barycenter order (coordinate descent over adjacent pairs). NO RNG.
 */
function deterministicCandidates(
  column: readonly RepackLeaf[],
  adjacency: ReadonlyMap<string, readonly string[]>,
  neighborY: ReadonlyMap<string, number>,
): RepackLeaf[][] {
  const baryKey = (leaf: RepackLeaf): number => {
    const neighbors = adjacency.get(leaf.clusterId) ?? [];
    let sum = 0;
    let count = 0;
    for (const nb of neighbors) {
      const ny = neighborY.get(nb);
      if (ny != null) {
        sum += ny;
        count++;
      }
    }
    // leaves with no placed neighbour sort to their current Y (keep their slot).
    return count > 0 ? sum / count : leaf.y;
  };
  const bary = [...column].sort(
    (a, b) =>
      baryKey(a) - baryKey(b) ||
      a.y - b.y ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
  const candidates: RepackLeaf[][] = [[...column], bary];
  // adjacent-swap refinements of the barycenter order (deterministic single swaps).
  for (let i = 0; i + 1 < bary.length; i++) {
    const swapped = [...bary];
    const tmp = swapped[i]!;
    swapped[i] = swapped[i + 1]!;
    swapped[i + 1] = tmp;
    candidates.push(swapped);
  }
  return candidates;
}

/**
 * Re-pack a single container's leaves (RFC §9 / M5b). Returns a `key → {y, order}` map,
 * or `null` when no improving, gate-passing re-pack exists (caller keeps the
 * straightened placement untouched).
 *
 * `bandTop`/`bandBottom` are the FIXED container band — the re-pack never places a leaf
 * outside it (CON-3). `gap` is the inter-sibling separation. `fanout`/`fanin` are the
 * intra-container dataflow adjacency (cluster-id keyed); both directions are unioned per
 * leaf to form its neighbour set for the barycenter pull and for the |ΔY| objective.
 */
export function repackColumns(
  leaves: readonly RepackLeaf[],
  fanout: Adjacency,
  fanin: Adjacency,
  bandTop: number,
  bandBottom: number,
  gap: number,
): Map<string, RepackResult> | null {
  if (leaves.length === 0 || bandBottom <= bandTop) {
    return null;
  }

  // Union adjacency (fanout ∪ fanin) restricted to clusters present in this container —
  // the neighbour set used for the barycenter pull and crossing/|ΔY| accounting.
  const present = new Set(leaves.map((l) => l.clusterId));
  const colOf = new Map<string, number>(
    leaves.map((l) => [l.clusterId, l.col]),
  );
  const adjacency = new Map<string, string[]>();
  const addNeighbor = (a: string, b: string) => {
    if (a === b || !present.has(a) || !present.has(b)) {
      return;
    }
    let arr = adjacency.get(a);
    if (!arr) {
      arr = [];
      adjacency.set(a, arr);
    }
    if (!arr.includes(b)) {
      arr.push(b);
    }
  };
  for (const leaf of leaves) {
    for (const t of fanout.get(leaf.clusterId) ?? []) {
      addNeighbor(leaf.clusterId, t);
      addNeighbor(t, leaf.clusterId);
    }
    for (const s of fanin.get(leaf.clusterId) ?? []) {
      addNeighbor(leaf.clusterId, s);
      addNeighbor(s, leaf.clusterId);
    }
  }

  // columns in fixed ascending order; within a column, current top→down order.
  const cols = [...new Set(leaves.map((l) => l.col))].sort((a, b) => a - b);
  const byCol = new Map<number, RepackLeaf[]>();
  for (const c of cols) {
    byCol.set(
      c,
      leaves
        .filter((l) => l.col === c)
        .sort(
          (a, b) => a.y - b.y || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
        ),
    );
  }

  // working top-Y per leaf (starts at the straightened placement).
  const tops = new Map<string, number>(leaves.map((l) => [l.key, l.y]));
  // working within-column order per column (the RepackLeaf[] in placed order).
  const colOrder = new Map<number, RepackLeaf[]>(byCol);

  const fanoutMap: Adjacency = fanout;

  const baselineCenters = centersFromTops(leaves, tops);
  const baselineCost = totalEdgeDeltaY(leaves, fanoutMap, baselineCenters);
  const baselineCrossings = countCrossings(
    leaves,
    fanoutMap,
    baselineCenters,
    colOf,
  );

  /** current best-known cost over the whole container (monotonic non-increasing). */
  let currentCost = baselineCost;

  // monotonic coordinate descent: optimize one column at a time, freezing the others.
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let improvedThisSweep = false;
    for (const c of cols) {
      const column = colOrder.get(c)!;
      if (column.length <= 1) {
        continue; // a single leaf has no permutation to search
      }
      // neighbour Y = current top-Y of every leaf NOT in this column, as a CENTER-Y
      // (barycenter pull aims leaf centers at neighbour centers).
      const neighborY = new Map<string, number>();
      for (const leaf of leaves) {
        if (leaf.col === c) {
          continue;
        }
        neighborY.set(leaf.clusterId, tops.get(leaf.key)! + leaf.height / 2);
      }

      const candidateOrders =
        column.length <= REPACK_BRUTE_FORCE_MAX
          ? permutations(column)
          : deterministicCandidates(column, adjacency, neighborY);

      let bestOrder: RepackLeaf[] | null = null;
      let bestTops: Map<string, number> | null = null;
      let bestCost = currentCost;

      for (const order of candidateOrders) {
        const placed = placeColumnStack(
          order,
          adjacency,
          neighborY,
          bandTop,
          bandBottom,
          gap,
        );
        if (!placed) {
          continue; // does not fit the band ⇒ rejected (CON-3)
        }
        // evaluate the whole-container cost with this column re-placed.
        const trialTops = new Map(tops);
        for (const [k, v] of placed) {
          trialTops.set(k, v);
        }
        const centers = centersFromTops(leaves, trialTops);
        const cost = totalEdgeDeltaY(leaves, fanoutMap, centers);
        // deterministic: only a strictly-lower cost replaces the best (ties keep the
        // earlier candidate, which is the more stable order). No RNG tiebreak.
        if (cost < bestCost - 1e-6) {
          bestCost = cost;
          bestOrder = order;
          bestTops = placed;
        }
      }

      if (bestOrder && bestTops && bestCost < currentCost - 1e-6) {
        for (const [k, v] of bestTops) {
          tops.set(k, v);
        }
        colOrder.set(c, [...bestOrder]);
        currentCost = bestCost;
        improvedThisSweep = true;
      }
    }
    if (!improvedThisSweep) {
      break;
    }
  }

  // ── ACCEPT GATES (never-worse) ──
  // 1. improvement: total intra-container |ΔY| strictly decreased.
  if (!(currentCost < baselineCost - 1e-6)) {
    return null;
  }

  const finalCenters = centersFromTops(leaves, tops);

  // 2. CON-3 containment: every leaf within [bandTop, bandBottom].
  for (const leaf of leaves) {
    const top = tops.get(leaf.key)!;
    if (top < bandTop - 1e-6 || top + leaf.height > bandBottom + 1e-6) {
      return null;
    }
  }

  // 3. CON-4/5 non-overlap: per column, height+gap separation (assert the stack).
  for (const c of cols) {
    const ordered = colOrder.get(c)!;
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1]!;
      const cur = ordered[i]!;
      const prevTop = tops.get(prev.key)!;
      const curTop = tops.get(cur.key)!;
      if (curTop < prevTop + prev.height + gap - 1e-6) {
        return null; // overlap / under-separation ⇒ reject (should not happen)
      }
    }
  }

  // 4. crossing-preserving: intra-container crossings must not INCREASE.
  const finalCrossings = countCrossings(leaves, fanoutMap, finalCenters, colOf);
  if (finalCrossings > baselineCrossings) {
    return null;
  }

  // 5. CON-12: columns/X untouched by construction (we only ever wrote Y + order).

  const result = new Map<string, RepackResult>();
  for (const c of cols) {
    const ordered = colOrder.get(c)!;
    ordered.forEach((leaf, idx) => {
      result.set(leaf.key, { y: tops.get(leaf.key)!, order: idx });
    });
  }
  return result;
}
