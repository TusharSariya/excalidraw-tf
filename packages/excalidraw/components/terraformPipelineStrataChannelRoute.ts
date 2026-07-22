/**
 * Strata inter-rank CHANNEL routing pass (probe P1 — the owner's "dummy
 * routing column" idea). A post-geometry rewrite alongside
 * terraformPipelineStrataEdgeRouting.ts / terraformPipelineStrataBorderRoute.ts
 * / terraformPipelineStrataEdgeStyle.ts, but structural rather than endpoint-
 * local: every inter-rank TFD edge becomes exit-stub → one vertical run per
 * traversed inter-column channel at an assigned track X → entry-stub. All
 * cross-axis (Y) displacement therefore happens INSIDE the channels at 90°, so
 * the shallow near-flat diagonals that slice across foreign cards are replaced
 * by axis-aligned Manhattan geometry.
 *
 * NOT all Y-displacement is confined to the channels. An edge spanning ≥3
 * columns transfers between consecutive channels with a HORIZONTAL run across an
 * intermediate rank; v1 placed that transfer at a uniform fractional Y, which
 * sliced the intermediate column's cards (measured: on the preset ~117 such
 * multi-channel transfers, several crossing cards). The transfer Y is now slid
 * onto a clear corridor row of that column (`clearTransferY`), so the transfer
 * runs BETWEEN cards, not through them — the "all cross-axis motion happens
 * inside channels" claim held only for 2-column edges.
 *
 * v1 uses the EXISTING inter-rank gaps as ZERO-WIDTH channels — NO card geometry
 * moves. Columns are derived purely from `placement.leafBoxes` by X-interval
 * merging (columnar layouts are X-disjoint between ranks and X-overlapping
 * within a rank), so the pass needs no rank map from the model.
 *
 * Literature grounding (graph-layout corpus, cited in
 * docs/edge-routing-research-2026-07-22.md repo-audit §2): VLSI channel routing
 * (Hashimoto & Stevens 1971), Sander's hierarchical Manhattan layout
 * (doi-10-1007-bfb0021828 — layered + compound + Manhattan + border nodes),
 * Raykov 2021 (forward-10-5121-csit-2021-111821), ELK/KIELER vertical-segment
 * routing. NOTE: the earlier "channels do not change crossing COUNT" claim is
 * REFUTED empirically — orthogonalising every inter-rank edge into shared
 * corridors weaves the polylines and RAISES scene crossings substantially on
 * the preset (channel arm ≈279 vs straight ≈107). What channels genuinely do is
 * turn the surviving crossings to ~90° and push Y-motion off the shallow
 * card-slicing diagonals; the count is a net regression on this scene, which is
 * why the router stays opt-in and pierce-guarded per edge.
 *
 * Track assignment per channel: collect the vertical runs' Y-spans, interval-
 * graph-colour them left-edge style (sort by span start, reuse a track whose
 * last span ended at/below this span's start), then ORDER the resulting tracks
 * across the channel by mean target-Y (Sander's heuristic) to reduce
 * in-channel crossings. Track gap is clamped to the channel width; on overflow
 * tracks stack at a 2px minimum and the occupancy report records it.
 *
 * Per-edge acceptance guard ("never emit a worse mess", mirroring
 * terraformPipelineStrataEdgeRouting.ts:434-464): the routed polyline is kept
 * only if it pierces FEWER foreign cards/hulls than the straight chord, or the
 * SAME number with its pierced SET a subset of the chord's (no new card
 * occluded). A pierce-count TIE that merely swaps one pierced card for another
 * is rejected — the chord is kept for that edge.
 *
 * COMPOSITION. Runs FIRST among the edge passes and owns the polyline topology;
 * it stamps `terraformRoutedPolyline`, so edgeRouting / borderRoute / edgeStyle
 * (all first-stamper-wins) SKIP the edges it routed — no double-routing. When
 * `strataEdgeStyle` is `step`/`curve`, channel polylines are emitted with
 * Excalidraw `roundness:{type:2}` so the renderer softens their corners (the
 * minimal edge-style integration; edgeStyle never re-routes them).
 *
 * Same-rank (flat, source-col === target-col) edges are left as chords in v1
 * (they have no channel to traverse; a dot-style same-rank rule is future work).
 *
 * ENDPOINTS NEVER MOVE. `el.x`/`el.y` and the final absolute point equal the
 * centre-clipped chord endpoints, so bindings survive `repairTerraformEdgeBindings`
 * (the `terraformRoutedPolyline` stamp keeps it from flattening the polyline).
 *
 * Determinism (C4′): no RNG, no clock. Column order = X then content key; edge
 * order = skeleton emission order; track colouring/ordering are pure sorts with
 * content-key tie-breaks. Clearances are read inside functions, never as
 * module-level consts derived from a layout import (SDEC-34 NaN hazard).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataChannelRoute.test.ts --exclude "**\/.claude/**"
 */
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import { PIPELINE_FRAME_PAD } from "./terraformPipelineLayoutShared";
import { segmentIntersectsStrataBoxInterior } from "./terraformPipelineStrataPackedScoring";
import { compareStrataContentKeys } from "./terraformPipelineStrataTypes";

import type {
  StrataBox,
  StrataHullNode,
  StrataModel,
  StrataPlacementResult,
} from "./terraformPipelineStrataTypes";

/** Perpendicular exit/entry stub length (px), clamped to the hull padding so a
 * stub never protrudes past a container's inner margin (React Flow default). */
export const STRATA_CHANNEL_STUB_PX = 20;
/** Desired spacing between adjacent tracks in a channel (px), before the
 * clamp-to-channel-width rule. */
export const STRATA_CHANNEL_TRACK_GAP_PX = 12;
/** Minimum track separation once a channel overflows its desired spacing (px). */
export const STRATA_CHANNEL_MIN_TRACK_GAP_PX = 2;
/** Clearance past a card edge when an inter-channel transfer must be pushed
 * above/below an intermediate rank's cards (no interior row gap available). */
export const STRATA_CHANNEL_CORRIDOR_MARGIN_PX = 12;

/** Per-channel occupancy — gates the future P5 reserved-width decision. */
export type StrataChannelOccupancy = {
  /** Channel index (between column `channelIndex` and `channelIndex + 1`). */
  channelIndex: number;
  /** Channel width in px (`nextColumn.left − thisColumn.right`, ≥ 0). */
  widthPx: number;
  /** Distinct tracks the interval colouring needed. */
  tracksUsed: number;
  /** Vertical runs assigned to this channel. */
  runs: number;
  /** Tracks that could not fit even at the 2px minimum separation. */
  overflow: number;
};

export type StrataChannelRouteMeta = {
  /** Inter-rank TFD edges rewritten to a channel polyline. */
  routed: number;
  /** Inter-rank edges reverted to their chord by the pierce guard. */
  guardReverted: number;
  /** Same-rank (flat) edges left as chords in v1. */
  flat: number;
  /** Eligible edges skipped (already stamped / degenerate / endpoint off-grid). */
  skipped: number;
  /** Columns derived from the leaf boxes. */
  columns: number;
  /** Total vertical runs emitted across all routed edges. */
  runsTotal: number;
  /** Peak tracks used in any single channel. */
  maxTracksInChannel: number;
  /** Channels whose desired track gap overflowed the channel width. */
  overflowChannels: number;
  /** Per-channel occupancy (only channels that carried ≥1 run). */
  occupancy: StrataChannelOccupancy[];
};

type Pt = readonly [number, number];

type ArrowSkeleton = ExcalidrawElementSkeleton & {
  type: "arrow";
  points?: ReadonlyArray<readonly [number, number]>;
  customData?: Record<string, unknown>;
};

const relationshipOf = (
  el: ArrowSkeleton,
): { source: string; target: string } | null => {
  const cd = el.customData;
  if (cd?.terraformEdgeLayer !== "declaredDataFlow") {
    return null;
  }
  const rel = cd?.relationship as Record<string, unknown> | undefined;
  if (
    !rel ||
    typeof rel.source !== "string" ||
    typeof rel.target !== "string" ||
    rel.aggregated === true ||
    rel.source === rel.target
  ) {
    return null;
  }
  return { source: rel.source, target: rel.target };
};

/** leaf clusterId → ids of every hull whose subtree contains it (local copy of
 * the packed-scoring/edge-routing helper; kept here so this module stays
 * dependency-light — the walk is 10 lines and pinned by the unit tests). */
function leafAncestorsOf(root: StrataHullNode): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const walk = (hull: StrataHullNode, chain: readonly string[]): void => {
    const next = [...chain, hull.id];
    for (const leaf of hull.leafClusterIds) {
      out.set(leaf, new Set(next));
    }
    for (const child of hull.children) {
      walk(child, next);
    }
  };
  walk(root, []);
  return out;
}

/** A derived column (rank): an X-interval-merged group of leaf boxes. */
type Column = { left: number; right: number };

/**
 * Derive columns from the leaf boxes by X-interval merging. Sort boxes by left
 * X (content-key tie-break for determinism); a box joins the current column
 * when its left X overlaps the running column extent, else it opens a new
 * column. Columnar layouts are X-disjoint BETWEEN ranks (COLUMN_GAP) and
 * X-overlapping WITHIN a rank, so this recovers the rank columns without a rank
 * map. Returns the ordered columns plus a leaf-id → column-index map.
 */
export function deriveStrataColumns(placement: StrataPlacementResult): {
  columns: Column[];
  columnOf: Map<string, number>;
} {
  const entries = [...placement.leafBoxes.entries()]
    .map(([id, box]) => ({ id, left: box.x, right: box.x + box.width }))
    .sort((a, b) =>
      a.left !== b.left
        ? a.left - b.left
        : compareStrataContentKeys(a.id, b.id),
    );
  const columns: Column[] = [];
  const columnOf = new Map<string, number>();
  for (const e of entries) {
    const cur = columns[columns.length - 1];
    if (cur && e.left < cur.right) {
      cur.right = Math.max(cur.right, e.right);
    } else {
      columns.push({ left: e.left, right: e.right });
    }
    columnOf.set(e.id, columns.length - 1);
  }
  return { columns, columnOf };
}

/** Remove consecutive duplicate and collinear points so the polyline carries
 * only its genuine bends. Endpoints are always kept. */
function simplifyPolyline(pts: Pt[]): Pt[] {
  const EPS = 1e-6;
  const dedup: Pt[] = [];
  for (const p of pts) {
    const last = dedup[dedup.length - 1];
    if (
      !last ||
      Math.abs(last[0] - p[0]) > EPS ||
      Math.abs(last[1] - p[1]) > EPS
    ) {
      dedup.push(p);
    }
  }
  if (dedup.length <= 2) {
    return dedup;
  }
  const out: Pt[] = [dedup[0]!];
  for (let i = 1; i + 1 < dedup.length; i++) {
    const a = out[out.length - 1]!;
    const b = dedup[i]!;
    const c = dedup[i + 1]!;
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > EPS) {
      out.push(b);
    }
  }
  out.push(dedup[dedup.length - 1]!);
  return out;
}

/** The SET of `foreign` box indices whose interior the polyline pierces. The
 * guard compares sets (not just counts) so a route that swaps one pierced card
 * for a different one — same count, new occlusion — is still rejected. */
function piercedBoxIndices(
  poly: readonly Pt[],
  foreign: readonly StrataBox[],
): Set<number> {
  const out = new Set<number>();
  for (let bi = 0; bi < foreign.length; bi++) {
    const b = foreign[bi]!;
    for (let s = 0; s + 1 < poly.length; s++) {
      if (
        segmentIntersectsStrataBoxInterior(
          poly[s]![0],
          poly[s]![1],
          poly[s + 1]![0],
          poly[s + 1]![1],
          b.x,
          b.y,
          b.x + b.width,
          b.y + b.height,
        )
      ) {
        out.add(bi);
        break;
      }
    }
  }
  return out;
}

/**
 * Slide an inter-channel transfer Y onto a clear row of the intermediate rank
 * `column` so the horizontal transfer runs along a corridor instead of slicing
 * that column's cards at a fractional Y. If `ideal` already clears every card,
 * it is returned unchanged; otherwise the nearest clear candidate is chosen from
 * {above the topmost card, below the bottommost, each inter-card gap midpoint},
 * tie-broken toward the smaller Y for determinism. Returns `ideal` when the
 * column is empty or (degenerately) has no clear candidate.
 */
function clearTransferY(
  ideal: number,
  boxes: readonly StrataBox[] | undefined,
): number {
  if (!boxes || boxes.length === 0) {
    return ideal;
  }
  const intervals = boxes
    .map((b) => [b.y, b.y + b.height] as [number, number])
    .sort((a, b) => (a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]));
  const covered = (y: number): boolean =>
    intervals.some(([lo, hi]) => y > lo && y < hi);
  if (!covered(ideal)) {
    return ideal;
  }
  let minLo = Infinity;
  let maxHi = -Infinity;
  for (const [lo, hi] of intervals) {
    minLo = Math.min(minLo, lo);
    maxHi = Math.max(maxHi, hi);
  }
  const candidates: number[] = [
    minLo - STRATA_CHANNEL_CORRIDOR_MARGIN_PX,
    maxHi + STRATA_CHANNEL_CORRIDOR_MARGIN_PX,
  ];
  for (let i = 0; i + 1 < intervals.length; i++) {
    const gapLo = intervals[i]![1];
    const gapHi = intervals[i + 1]![0];
    if (gapHi > gapLo) {
      candidates.push((gapLo + gapHi) / 2);
    }
  }
  let best = ideal;
  let bestDist = Infinity;
  for (const c of candidates) {
    if (covered(c)) {
      continue;
    }
    const d = Math.abs(c - ideal);
    if (d < bestDist || (d === bestDist && c < best)) {
      bestDist = d;
      best = c;
    }
  }
  return Number.isFinite(bestDist) ? best : ideal;
}

/** Distinct tracks the left-edge interval colouring needs for these runs (the
 * chromatic number of their Y-span interval graph). Used to recompute occupancy
 * over the ACCEPTED runs only, after the pierce guard. */
function intervalTrackCount(runs: readonly Run[]): number {
  const ordered = [...runs].sort((a, b) =>
    a.lo !== b.lo
      ? a.lo - b.lo
      : a.hi !== b.hi
      ? a.hi - b.hi
      : a.edgeIndex - b.edgeIndex,
  );
  const trackLastEnd: number[] = [];
  for (const run of ordered) {
    let assigned = -1;
    for (let t = 0; t < trackLastEnd.length; t++) {
      if (trackLastEnd[t]! <= run.lo) {
        assigned = t;
        break;
      }
    }
    if (assigned === -1) {
      trackLastEnd.push(run.hi);
    } else {
      trackLastEnd[assigned] = run.hi;
    }
  }
  return trackLastEnd.length;
}

/** A vertical run of one edge through one channel: a Y-interval + Sander key. */
type Run = {
  edgeIndex: number;
  channel: number;
  /** Position of this channel in the edge's source→target traversal order. */
  order: number;
  lo: number;
  hi: number;
  /** Target-Y of the owning edge (Sander in-channel ordering key). */
  targetY: number;
};

/**
 * Build the ordered source→target list of channel indices an edge traverses,
 * plus the Y-levels at each channel boundary. `channels` are `[loCol, hiCol-1]`;
 * the traversal is ascending for a forward edge (srcCol < tgtCol) and
 * descending for a backward one. Y-levels seed uniformly across the traversed
 * channels, then each INTERIOR boundary (a horizontal transfer that crosses one
 * intermediate rank column) is slid onto a clear corridor row of that column via
 * `clearTransferY`, so the transfer no longer slices the column's cards at a
 * fractional Y. Endpoints (j=0 at source, j=k at target) are fixed.
 */
function edgePlan(
  srcCol: number,
  tgtCol: number,
  sy: number,
  ey: number,
  columnBoxes: Map<number, StrataBox[]>,
): { channels: number[]; yLevels: number[] } {
  const lo = Math.min(srcCol, tgtCol);
  const hi = Math.max(srcCol, tgtCol);
  const ascending: number[] = [];
  for (let c = lo; c < hi; c++) {
    ascending.push(c);
  }
  const channels = srcCol < tgtCol ? ascending : [...ascending].reverse();
  const k = channels.length;
  const yLevels: number[] = [];
  for (let j = 0; j <= k; j++) {
    yLevels.push(sy + ((ey - sy) * j) / k);
  }
  for (let j = 1; j < k; j++) {
    // The horizontal transfer at boundary j crosses the rank column between the
    // two adjacent channel gaps channels[j-1] and channels[j]; that column's
    // index is the larger of the two (gap c sits right of column c).
    const col = Math.max(channels[j - 1]!, channels[j]!);
    yLevels[j] = clearTransferY(yLevels[j]!, columnBoxes.get(col));
  }
  return { channels, yLevels };
}

/**
 * Scene-level pass: rewrite, IN PLACE in the skeleton array, every inter-rank
 * TFD arrow into a channel polyline. Two passes: (1) plan every routable edge
 * and collect its vertical runs per channel; (2) colour + order tracks per
 * channel, then build each polyline, apply the pierce guard, and emit. Only
 * `points`/`width`/`height`/`roundness`/`customData` change; endpoints
 * (`el.x`/`el.y` and the final point) never move.
 */
export function routeStrataChannelEdges(
  skeleton: ExcalidrawElementSkeleton[],
  model: StrataModel,
  placement: StrataPlacementResult,
  softenCorners: boolean,
): StrataChannelRouteMeta {
  const ancestors = leafAncestorsOf(model.hullRoot);
  const { columns, columnOf } = deriveStrataColumns(placement);

  // Obstacle catalogue for the pierce guard (mirrors edgeRouting): non-root
  // hull frames + all leaf cards, each filtered per-edge to the FOREIGN set.
  type Obstacle = { id: string; kind: "hull" | "card"; box: StrataBox };
  const obstacles: Obstacle[] = [];
  for (const id of [...placement.boxedHulls.keys()]
    .filter((hid) => hid !== model.hullRoot.id)
    .sort(compareStrataContentKeys)) {
    obstacles.push({
      id,
      kind: "hull",
      box: placement.boxedHulls.get(id)!.box,
    });
  }
  for (const id of [...placement.leafBoxes.keys()].sort(
    compareStrataContentKeys,
  )) {
    obstacles.push({ id, kind: "card", box: placement.leafBoxes.get(id)! });
  }

  // Column index → its cards, for the inter-channel transfer-corridor search
  // (defect-2 fix): a transfer over an intermediate rank must clear that rank's
  // card rows rather than slice them at a fractional Y.
  const columnBoxes = new Map<number, StrataBox[]>();
  for (const [id, box] of placement.leafBoxes) {
    const col = columnOf.get(id);
    if (col === undefined) {
      continue;
    }
    const list = columnBoxes.get(col);
    if (list) {
      list.push(box);
    } else {
      columnBoxes.set(col, [box]);
    }
  }

  const meta: StrataChannelRouteMeta = {
    routed: 0,
    guardReverted: 0,
    flat: 0,
    skipped: 0,
    columns: columns.length,
    runsTotal: 0,
    maxTracksInChannel: 0,
    overflowChannels: 0,
    occupancy: [],
  };

  const stub = Math.min(STRATA_CHANNEL_STUB_PX, PIPELINE_FRAME_PAD);

  type Plan = {
    index: number;
    el: ArrowSkeleton;
    start: Pt;
    end: Pt;
    channels: number[];
    yLevels: number[];
    foreign: StrataBox[];
    chordPierceSet: Set<number>;
  };
  const plans: Plan[] = [];
  // channel index → runs collected in it (populated during planning).
  const runsByChannel = new Map<number, Run[]>();

  for (let i = 0; i < skeleton.length; i++) {
    const el = skeleton[i] as ArrowSkeleton;
    if (el.type !== "arrow") {
      continue;
    }
    const rel = relationshipOf(el);
    if (!rel) {
      continue;
    }
    // First-stamper-wins: an already-routed arrow keeps its geometry.
    if (el.customData?.terraformRoutedPolyline === true) {
      meta.skipped += 1;
      continue;
    }
    const pts = el.points;
    if (!Array.isArray(pts) || pts.length < 2) {
      meta.skipped += 1;
      continue;
    }
    const srcCol = columnOf.get(rel.source);
    const tgtCol = columnOf.get(rel.target);
    if (srcCol === undefined || tgtCol === undefined) {
      meta.skipped += 1; // endpoint not a placed leaf card (off-grid)
      continue;
    }
    if (srcCol === tgtCol) {
      meta.flat += 1; // same-rank flat edge — chord in v1
      continue;
    }
    const sx = el.x;
    const sy = el.y;
    const lastPt = pts[pts.length - 1]!;
    const start: Pt = [sx, sy];
    const end: Pt = [sx + lastPt[0], sy + lastPt[1]];

    const srcAnc = ancestors.get(rel.source);
    const tgtAnc = ancestors.get(rel.target);
    const foreign: StrataBox[] = [];
    for (const o of obstacles) {
      if (o.kind === "hull") {
        if (srcAnc?.has(o.id) || tgtAnc?.has(o.id)) {
          continue;
        }
      } else if (o.id === rel.source || o.id === rel.target) {
        continue;
      }
      foreign.push(o.box);
    }
    const chordPierceSet = piercedBoxIndices([start, end], foreign);

    const { channels, yLevels } = edgePlan(
      srcCol,
      tgtCol,
      sy,
      end[1],
      columnBoxes,
    );
    for (let p = 0; p < channels.length; p++) {
      const c = channels[p]!;
      const y0 = yLevels[p]!;
      const y1 = yLevels[p + 1]!;
      const run: Run = {
        edgeIndex: plans.length,
        channel: c,
        order: p,
        lo: Math.min(y0, y1),
        hi: Math.max(y0, y1),
        targetY: end[1],
      };
      const list = runsByChannel.get(c);
      if (list) {
        list.push(run);
      } else {
        runsByChannel.set(c, [run]);
      }
    }
    plans.push({
      index: i,
      el,
      start,
      end,
      channels,
      yLevels,
      foreign,
      chordPierceSet,
    });
  }

  // ── Track assignment per channel: interval colouring (left-edge) then Sander
  // ordering of the colours by mean target-Y. Yields a track X per run. ──
  // (edgeIndex, order) → assigned track X.
  const trackXOf = new Map<string, number>();
  const runKey = (edgeIndex: number, order: number): string =>
    `${edgeIndex}:${order}`;

  for (const [channelIdx, runs] of [...runsByChannel.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const col = columns[channelIdx];
    const next = columns[channelIdx + 1];
    const left = col ? col.right : 0;
    const right = next ? next.left : left;
    const width = Math.max(0, right - left);

    // Interval-graph colouring, left-edge algorithm. Sort by span start
    // (content-stable ties), reuse the first track whose last span ends at/below
    // this span's start.
    const ordered = [...runs].sort((a, b) =>
      a.lo !== b.lo
        ? a.lo - b.lo
        : a.hi !== b.hi
        ? a.hi - b.hi
        : a.edgeIndex - b.edgeIndex,
    );
    const trackLastEnd: number[] = [];
    const colourOf = new Map<Run, number>();
    for (const run of ordered) {
      let assigned = -1;
      for (let t = 0; t < trackLastEnd.length; t++) {
        if (trackLastEnd[t]! <= run.lo) {
          assigned = t;
          break;
        }
      }
      if (assigned === -1) {
        assigned = trackLastEnd.length;
        trackLastEnd.push(run.hi);
      } else {
        trackLastEnd[assigned] = run.hi;
      }
      colourOf.set(run, assigned);
    }
    const trackCount = trackLastEnd.length;

    // Sander: order the colours across the channel by mean target-Y so edges
    // heading to lower targets take the left tracks (fewer in-channel crossings).
    const colourStats = new Map<number, { sum: number; n: number }>();
    for (const run of ordered) {
      const c = colourOf.get(run)!;
      const s = colourStats.get(c) ?? { sum: 0, n: 0 };
      s.sum += run.targetY;
      s.n += 1;
      colourStats.set(c, s);
    }
    const colourOrder = [...colourStats.entries()]
      .map(([colour, s]) => ({ colour, mean: s.sum / s.n }))
      .sort((a, b) =>
        a.mean !== b.mean ? a.mean - b.mean : a.colour - b.colour,
      );
    const trackIndexOfColour = new Map<number, number>();
    colourOrder.forEach((c, i) => trackIndexOfColour.set(c.colour, i));

    // Track gap: desired, clamped to fit the channel. Band centred in the
    // channel. (Occupancy / overflow are computed POST-GUARD below over the
    // ACCEPTED runs only — a guard-reverted edge must not inflate the report.)
    let trackGap = 0;
    if (trackCount > 1) {
      const maxFitGap = width / (trackCount - 1);
      trackGap = Math.max(
        STRATA_CHANNEL_MIN_TRACK_GAP_PX,
        Math.min(STRATA_CHANNEL_TRACK_GAP_PX, maxFitGap),
      );
    }
    const bandWidth = trackCount > 1 ? (trackCount - 1) * trackGap : 0;
    const startX =
      trackCount <= 1
        ? left + width / 2
        : left + Math.max(0, (width - bandWidth) / 2);

    for (const run of ordered) {
      const ti = trackIndexOfColour.get(colourOf.get(run)!)!;
      trackXOf.set(
        runKey(run.edgeIndex, run.order),
        trackCount <= 1 ? startX : startX + ti * trackGap,
      );
    }
  }

  // ── Pass 2: build each polyline, apply the pierce guard, emit. Runs were
  // keyed by the plan's OWN index (its position in `plans`), so reuse that. ──
  const acceptedEdges = new Set<number>();
  for (let planEdgeIndex = 0; planEdgeIndex < plans.length; planEdgeIndex++) {
    const plan = plans[planEdgeIndex]!;
    const [sx, sy] = plan.start;
    const [ex, ey2] = plan.end;
    const dir = ex >= sx ? 1 : -1;
    const poly: Pt[] = [
      [sx, sy],
      [sx + dir * stub, sy],
    ];
    for (let p = 0; p < plan.channels.length; p++) {
      // Fallback X (should never trigger — every planned run got a track) keeps
      // the polyline well-formed rather than NaN if a channel had no assignment.
      const x = trackXOf.get(runKey(planEdgeIndex, p)) ?? sx;
      poly.push([x, plan.yLevels[p]!]);
      poly.push([x, plan.yLevels[p + 1]!]);
    }
    poly.push([ex - dir * stub, ey2]);
    poly.push([ex, ey2]);
    const simplified = simplifyPolyline(poly);

    // Guard ("never emit worse"): accept only if the route pierces FEWER foreign
    // boxes than the chord, OR the same number AND its pierced SET is a subset of
    // the chord's (no NEW card gets occluded — a pierce TIE that merely swaps one
    // card for another is rejected).
    const routedSet = piercedBoxIndices(simplified, plan.foreign);
    const chordSet = plan.chordPierceSet;
    const accept =
      routedSet.size < chordSet.size ||
      (routedSet.size === chordSet.size &&
        [...routedSet].every((idx) => chordSet.has(idx)));
    if (!accept) {
      meta.guardReverted += 1;
      continue;
    }
    acceptedEdges.add(planEdgeIndex);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [px, py] of simplified) {
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    skeleton[plan.index] = {
      ...plan.el,
      points: simplified.map(([px, py]) =>
        pointFrom<LocalPoint>(px - sx, py - sy),
      ),
      width: maxX - minX,
      height: maxY - minY,
      // Minimal edge-style integration: when a non-"straight" edge style is
      // requested, round the orthogonal corners in the renderer (edgeStyle then
      // SKIPS these arrows — no double-route).
      ...(softenCorners ? { roundness: { type: 2 } } : {}),
      customData: {
        ...(plan.el.customData ?? {}),
        terraformRoutedPolyline: true,
      },
    } as ExcalidrawElementSkeleton;
    meta.routed += 1;
    meta.runsTotal += plan.channels.length;
  }

  // ── Occupancy (post-guard): recompute per-channel congestion from the runs of
  // ACCEPTED edges only, so a guard-reverted edge's phantom runs never inflate
  // tracksUsed / runs / overflow (defect-3 fix — the P5 reserved-width gate reads
  // this). Track colouring is redone over the surviving subset. ──
  for (const [channelIdx, runs] of [...runsByChannel.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    const kept = runs.filter((r) => acceptedEdges.has(r.edgeIndex));
    if (kept.length === 0) {
      continue;
    }
    const col = columns[channelIdx];
    const next = columns[channelIdx + 1];
    const left = col ? col.right : 0;
    const right = next ? next.left : left;
    const width = Math.max(0, right - left);
    const trackCount = intervalTrackCount(kept);
    let overflow = 0;
    if (
      trackCount > 1 &&
      (trackCount - 1) * STRATA_CHANNEL_MIN_TRACK_GAP_PX > width
    ) {
      overflow =
        trackCount - (Math.floor(width / STRATA_CHANNEL_MIN_TRACK_GAP_PX) + 1);
    }
    meta.maxTracksInChannel = Math.max(meta.maxTracksInChannel, trackCount);
    if (overflow > 0) {
      meta.overflowChannels += 1;
    }
    meta.occupancy.push({
      channelIndex: channelIdx,
      widthPx: Math.round(width),
      tracksUsed: trackCount,
      runs: kept.length,
      overflow: Math.max(0, overflow),
    });
  }
  meta.occupancy.sort((a, b) => a.channelIndex - b.channelIndex);

  return meta;
}
