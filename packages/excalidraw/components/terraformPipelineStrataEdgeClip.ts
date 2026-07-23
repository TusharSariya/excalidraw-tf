/**
 * Strata CONTAINER-CLIP edge pass (loop-2 E2.1+E2.2, refined by E2.3+E2.4 —
 * Graphviz lhead/ltail semantics). A post-geometry rewrite alongside the
 * channel / around-boxes / border routers, but with a DIFFERENT endpoint
 * contract: a declared dataflow edge's arrow TERMINATES ON the border of the
 * target's immediate containment box (its leaf cluster frame) and ORIGINATES
 * ON the source's leaf-cluster frame border — a TRUE clip, not a card-to-card
 * chord. Egress is the source frame's RIGHT face ONLY; ingress is the target
 * frame's LEFT face ONLY — never top/bottom (the LR port discipline;
 * wrongFaceCrossings from clipped edges is ≈ 0 by construction).
 *
 * Intermediate hulls between the two clusters (vpc / region / account — the
 * UNSHARED ancestor hulls of each endpoint) get perpendicular port-crossing
 * waypoints: the source side crosses each hull's RIGHT face inner→outer, the
 * target side crosses each hull's LEFT face outer→inner. Every face crossing
 * is a horizontal segment (perpendicular to the vertical face); vertical
 * adjustment between consecutive crossings happens strictly BETWEEN faces.
 *
 * PORT ASSIGNMENT (per face, across ALL clipped edges sharing that face): each
 * edge's desired y = the barycenter of the OPPOSITE endpoint's y (its leaf-box
 * centre). Edges on a face are sorted by desired y (stable tie-break by edge
 * id), then spread with ≥{@link STRATA_CLIP_PORT_SEPARATION_PX} separation —
 * clamped to faceHeight/(n+1) on crowded faces — inside a
 * {@link STRATA_CLIP_PORT_INSET_PX} corner inset (itself clamped on short
 * faces).
 *
 * E2.3 GUTTER NUDGING: a between-faces run (the "gutter" between two
 * consecutive port-chain crossings, including the mid-gutter between the two
 * outermost faces) is first CLASSIFIED by measurement:
 *   • a CLEAR run (no foreign box inside the gutter's strip) routes through
 *     TWO waypoint columns near 25% / 75% of the gutter width, staggered
 *     inward by the edge's per-gutter mean-y rank, with the vertical
 *     adjustment on a per-edge TRACK Y between them — all edges sharing the
 *     gutter are ordered by mean y (stable by edge id) and spread with
 *     ≥{@link STRATA_CLIP_PORT_SEPARATION_PX} separation (the same monotone
 *     1-D spread the face ports use), clamped to the run's verified-clear
 *     strip;
 *   • a DIRTY run (the gutter is hull-interior space holding sibling
 *     hulls/leaves — a waypoint column inside one would cross its border on
 *     the wrong face) keeps the E2.1 stub-hug/mid shape, with the vertical's
 *     column CORRIDOR-CHOSEN: the nearest column (with a small deterministic
 *     per-edge stagger) whose vertical span clears every foreign box —
 *     variable-width siblings make the naive stub X land inside a wider box.
 * Departure/arrival tangents stay horizontal by construction in both shapes.
 *
 * E2.4 OVER-THE-TOP LANES (Spönemann routing slots / TSE93 flat-edge
 * lineage): two edge classes cannot run the plain L→R mid-gutter —
 *   (a) CROSS-BAND edges (Y-disjoint outermost containers — the mid vertical
 *       would transit sibling bands; the X-OVERLAP subclass with no forward
 *       gutter at all is E2.1's Z-detour case), and
 *   (b) net-BACKWARD edges (target column left of source — previously left
 *       unstamped for the style-pass orbit; E2.4 brings them INTO the pass).
 * Resolution ladder, all deterministic:
 *   1. a class-(a) NON-overlap edge whose Z-detour measures obstacle-free
 *      keeps the Z (a clean band-gap hop needs no lane);
 *   2. IN-PLACE lane: exit the source-side chain, rise in the nearest clear
 *      gutter corridor to a lane at
 *      laneY = unionTop − {@link STRATA_CLIP_LANE_CLEARANCE_PX} −
 *      {@link STRATA_CLIP_LANE_SEPARATION_PX}·laneIndex above the union of
 *      the two outer containers plus every sibling the Z would transit —
 *      settled by a clearance FIXPOINT that absorbs any box the candidate Y
 *      still cuts (the lane lands in an inter-band gap when one fits, else
 *      past the whole stack) — travel, descend in the clear corridor nearest
 *      the target, enter the target-side chain. BELOW-the-union is chosen
 *      when the union's bottom is closer to BOTH endpoints, and allocation
 *      overflows to the opposite side when a pad runs out of slots.
 *      laneIndex: greedy interval coloring per (shared hull, direction) over
 *      X-overlapping lane spans, stable by edge id. The lane must stay
 *      INSIDE the deepest shared ancestor hull's box (an edge never crosses
 *      a border it owns no port on);
 *   3. ORBIT lane (X-overlap edges try this FIRST — their in-place lanes are
 *      canvas-scale): ride AROUND the top-level ancestor unit box — out its
 *      RIGHT face, over its top (or under its bottom), back in its LEFT face
 *      (legal side-face crossings), riser/descender/lane offset by
 *      CLEARANCE + SEPARATION·laneIndex so stacked orbits NEST (staircase, no
 *      mutual crossings), corridors walked past any other top-level unit;
 *      every orbit piece is verified clear before adoption;
 *   4. fallback (counted in `laneFallback`): class (a) keeps the Z-detour,
 *      class (b) stays unstamped (style orbit).
 * Lanes never enter any hull: obstacle sets are the child unit boxes of the
 * relevant ancestor context (every nested hull/leaf lies inside one). Lane
 * edges stamp `terraformClipLane: "above"|"below"` so scoreboard backwardXPx
 * on them is attributable (sanctioned lane travel, not a goofy detour). Side
 * discipline stays absolute: lane edges still terminate on the same R-egress
 * / L-ingress frame-face ports, so the typed repair gate
 * (terraformVisibility.ts) validates them UNCHANGED.
 *
 * SKIPS: same-column edges are left UNSTAMPED for the style pass. Off-grid /
 * already-routed edges likewise (counted in the meta).
 *
 * COMPOSITION: runs FIRST among the edge passes and owns the polyline
 * topology — it stamps `terraformRoutedPolyline` + `terraformRoutedBy:"clip"`
 * + per-end `terraformClipAnchor` (see below), so channelRoute / edgeRouting /
 * borderRoute / edgeStyle (all first-stamper-wins) SKIP its edges.
 *
 * REPAIR CONTRACT: because the endpoints sit on FRAME borders (typically far
 * beyond `ROUTED_ANCHOR_TOLERANCE` from the card body rects), the standard
 * endpoint-on-card validation in `repairTerraformEdgeBindings` would flatten
 * every clip polyline. The pass therefore stamps
 * `terraformClipAnchor: { start: {frameKey, side}, end: {frameKey, side} }`
 * where `frameKey` is the endpoint's CLUSTER ADDRESS (=== relationship
 * source/target === `terraformPrimaryAddress` on the leaf cluster frame), and
 * repair's typed "clip" gate validates each endpoint against the LIVE frame
 * rect resolved from that key (fail-closed; see terraformVisibility.ts).
 * Bindings REMAIN on the leaf cards exactly as today. Lane and nudged
 * polylines keep the identical endpoint contract — the gate needs NO changes.
 *
 * ROUNDNESS: the arrow's existing `roundness` (the shared TFD emitter's
 * `{type:2}`) is deliberately KEPT — orthogonal corners get properly smoothed
 * in loop 3; this pass never adds or removes roundness.
 *
 * Determinism (C4′): no RNG, no clock. Edge order = skeleton emission order;
 * port order = (desiredY, edge id); gutter track order = (mean y, edge id);
 * lane allocation = greedy interval coloring in edge-id order; all helpers
 * are pure sorts. Clearances are computed inside functions (SDEC-34 NaN
 * hazard).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataEdgeClip.test.ts --exclude "**\/.claude/**"
 */
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";
import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

import { deriveStrataColumns } from "./terraformPipelineStrataChannelRoute";

import type {
  StrataBox,
  StrataHullNode,
  StrataModel,
  StrataPlacementResult,
} from "./terraformPipelineStrataTypes";

/** Minimum separation between two ports sharing a face (px), before the
 * crowded-face clamp to faceHeight/(n+1). Also the E2.3 gutter-track
 * separation floor. */
export const STRATA_CLIP_PORT_SEPARATION_PX = 12;
/** Corner inset: no port sits closer than this to a face's corners (clamped
 * to a quarter of the face on short faces). */
export const STRATA_CLIP_PORT_INSET_PX = 20;
/** Horizontal tangent stub bounds (px) outside each crossed face. */
export const STRATA_CLIP_STUB_MIN_PX = 24;
export const STRATA_CLIP_STUB_MAX_PX = 48;
/** E2.4: vertical clearance between a lane and the union bounding box it
 * flies over. */
export const STRATA_CLIP_LANE_CLEARANCE_PX = 24;
/** E2.4: vertical separation between stacked lanes (laneIndex step). */
export const STRATA_CLIP_LANE_SEPARATION_PX = 16;
/** E2.4: margin kept between a lane riser/descender and any obstacle box or
 * shared-hull border. */
const STRATA_CLIP_LANE_MARGIN_PX = 4;

export type StrataEdgeClipMeta = {
  /** Eligible cross-cluster edges rewritten to a clip polyline (net-forward
   * mid-gutter edges + E2.4 lane edges + Z-detour fallbacks). */
  clipped: number;
  /** Net-backward edges left unstamped because no clear lane corridor / slot
   * existed (the style-pass orbit keeps them). */
  skippedBackward: number;
  /** Same-column edges left unstamped likewise. */
  skippedSameColumn: number;
  /** Edges whose endpoint is not a placed leaf box (off-grid). */
  skippedOffGrid: number;
  /** Edges already stamped `terraformRoutedPolyline` by an earlier pass. */
  skippedAlreadyRouted: number;
  /** Distinct (frame|hull, side) faces that received ≥1 port. */
  portFaces: number;
  /** Peak ports assigned to any single face. */
  maxPortsOnFace: number;
  /** Σ interior waypoints across all clipped polylines. */
  waypointsTotal: number;
  /** E2.4: edges routed over a lane (above or below). */
  laneEdges: number;
  /** E2.4: lane edges by direction. */
  laneAbove: number;
  laneBelow: number;
  /** E2.4: lane edges that are net-backward (class b). */
  laneBackward: number;
  /** E2.4: lane candidates that could not lane (no clear corridor or no lane
   * slot inside the shared hull). Class (a) fell back to the E2.1 Z-detour,
   * class (b) stayed unstamped (also counted in `skippedBackward`). */
  laneFallback: number;
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

/** leaf clusterId → its ORDERED hull ancestor chain, root-FIRST and root-
 * EXCLUSIVE (the synthetic root has no frame). Local copy of the routers'
 * ancestor helper, but ordered — the unordered Set the others carry cannot
 * express the inner→outer crossing sequence this pass needs. */
export function leafHullChainsOf(
  root: StrataHullNode,
): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  const walk = (hull: StrataHullNode, chain: readonly string[]): void => {
    const next = hull === root ? chain : [...chain, hull.id];
    for (const leaf of hull.leafClusterIds) {
      out.set(leaf, next);
    }
    for (const child of hull.children) {
      walk(child, next);
    }
  };
  walk(root, []);
  return out;
}

/** Stub length for a face given the free horizontal gap to the next obstacle
 * (next face / opposite-side entry): nominally 24–48px, scaling to gap/3 in
 * wide gutters and ALWAYS capped at half the gap so consecutive stubs can
 * never overshoot the next face. Floored at 2px to stay a genuine waypoint. */
const stubFor = (gap: number): number => {
  const g = Math.max(0, gap);
  const nominal = Math.min(
    STRATA_CLIP_STUB_MAX_PX,
    Math.max(STRATA_CLIP_STUB_MIN_PX, g / 3),
  );
  return Math.max(2, Math.min(nominal, g / 2));
};

/** Remove consecutive duplicate and collinear points (endpoints kept). Face
 * crossings need no vertex of their own — a straight run through a face still
 * crosses it perpendicular — so collapsing collinear runs is safe. */
const simplifyPolyline = (pts: Pt[]): Pt[] => {
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
};

/** One face a clipped edge crosses: a vertical border line of a leaf frame or
 * hull frame, addressed as (key, side). */
type FaceRef = {
  /** Leaf cluster address or hull id. */
  key: string;
  side: "left" | "right";
  /** The face's vertical line x. */
  x: number;
  /** Face Y-extent (the frame/hull box's Y range). */
  y0: number;
  y1: number;
};

const faceKeyOf = (f: Pick<FaceRef, "key" | "side">): string =>
  `${f.side}:${f.key}`;

/** Deterministic string compare (no locale). */
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Assign port Y positions on one face. Entries are sorted by (desiredY, edge
 * id); positions start at each entry's clamped desired y and are smoothed to a
 * monotone sequence with ≥`sep` separation inside the inset interval
 * (forward pass, then a backward clamp against the top, then a final forward
 * clamp against the bottom — the standard 1-D label-spread). The E2.3 gutter
 * tracks reuse this verbatim with the gutter's Y-bounds as the "face".
 *
 * Exported for unit tests (crowded-face containment/order): on a face that
 * cannot hold `n` ports at the ideal `sep`, the separation degrades to the
 * feasibility bound `(hi-lo)/(n-1)` and every port still stays inside the inset
 * interval `[lo, hi]` — the ports never escape the face extent.
 */
export const assignFacePorts = (
  face: { y0: number; y1: number },
  entries: ReadonlyArray<{ edgeId: string; desiredY: number }>,
): Map<string, number> => {
  const H = Math.max(0, face.y1 - face.y0);
  const inset = Math.min(STRATA_CLIP_PORT_INSET_PX, H / 4);
  let lo = face.y0 + inset;
  let hi = face.y1 - inset;
  if (lo > hi) {
    lo = hi = face.y0 + H / 2;
  }
  const n = entries.length;
  // Separation: ≥12px, clamped to faceHeight/(n+1) on crowded faces, and
  // further to the usable (inset) interval so the monotone spread below is
  // always feasible (every port stays inside [lo, hi]).
  const sep = Math.min(
    STRATA_CLIP_PORT_SEPARATION_PX,
    H / (n + 1),
    (hi - lo) / Math.max(1, n - 1),
  );
  const ordered = [...entries].sort((a, b) =>
    a.desiredY !== b.desiredY
      ? a.desiredY - b.desiredY
      : cmpStr(a.edgeId, b.edgeId),
  );
  const ys = ordered.map((e) => Math.min(hi, Math.max(lo, e.desiredY)));
  for (let i = 1; i < n; i++) {
    ys[i] = Math.max(ys[i]!, ys[i - 1]! + sep);
  }
  for (let i = n - 1; i >= 0; i--) {
    const cap = hi - (n - 1 - i) * sep;
    if (ys[i]! > cap) {
      ys[i] = cap;
    }
    if (i + 1 < n) {
      ys[i] = Math.min(ys[i]!, ys[i + 1]! - sep);
    }
  }
  for (let i = 0; i < n; i++) {
    ys[i] = Math.max(ys[i]!, lo + i * sep);
  }
  const out = new Map<string, number>();
  ordered.forEach((e, i) => out.set(e.edgeId, ys[i]!));
  return out;
};

/** E2.4: an X-interval a lane riser/descender may not enter. */
type XInterval = { x0: number; x1: number };

/**
 * E2.4: nearest clear corridor X for a lane riser (dir=+1, rightward of
 * `startX`) or descender (dir=−1, leftward). `blockers` are the X-intervals of
 * every obstacle the vertical run could hit; `limitX` is the hard wall the
 * corridor may not reach (the first exit-level obstacle, or the shared hull's
 * own border). Walks away from `startX` jumping past blocker intervals;
 * returns null when no clear X exists before the wall (the caller falls
 * back). Deterministic: blockers are scanned as given, the walk is monotone.
 */
const chooseCorridorX = (
  startX: number,
  desired: number,
  dir: 1 | -1,
  blockers: readonly XInterval[],
  limitX: number,
): number | null => {
  const M = STRATA_CLIP_LANE_MARGIN_PX;
  if (dir === 1) {
    const hi = limitX - M;
    let c = Math.min(startX + Math.max(2, desired), hi);
    if (!(c > startX + 1)) {
      return null;
    }
    for (let guard = 0; guard < 64; guard++) {
      const hit = blockers.find((b) => c > b.x0 - M && c < b.x1 + M);
      if (!hit) {
        return c;
      }
      c = hit.x1 + M;
      if (c > hi) {
        return null;
      }
    }
    return null;
  }
  const lo = limitX + M;
  let c = Math.max(startX - Math.max(2, desired), lo);
  if (!(c < startX - 1)) {
    return null;
  }
  for (let guard = 0; guard < 64; guard++) {
    const hit = blockers.find((b) => c > b.x0 - M && c < b.x1 + M);
    if (!hit) {
      return c;
    }
    c = hit.x0 - M;
    if (c < lo) {
      return null;
    }
  }
  return null;
};

/** E2.4: the obstacle context a lane must clear — the child unit boxes of the
 * deepest SHARED ancestor hull (every nested hull/leaf lies inside one), plus
 * that hull's own box as the outer bound the lane must stay inside (null when
 * the shared ancestor is the synthetic root). */
type LaneContext = {
  obstacles: readonly StrataBox[];
  bounds: StrataBox | null;
};

const sameBox = (a: StrataBox, b: StrataBox): boolean =>
  a === b ||
  (a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

/**
 * Scene-level pass: rewrite, IN PLACE in the skeleton array, every eligible
 * cross-cluster TFD arrow into a container-clip polyline
 * [sourceFrame R-face port, source-side hull R-ports inner→outer (E2.3
 * nudged gutter runs between), mid travel (nudged gutter / E2.4 lane),
 * target-side hull L-ports outer→inner, targetFrame L-face port].
 * `points`/`x`/`y`/`width`/`height`/`customData` change — `roundness` and
 * card skeletons are untouched. Endpoints sit ON the frame borders (the
 * clip): `el.x`/`el.y` re-origin at the source port so `points[0] === [0,0]`
 * survives `convertToExcalidrawElements`'s re-normalization (the E1.2/E1.5
 * write-back pattern).
 */
export function routeStrataEdgeClip(
  skeleton: ExcalidrawElementSkeleton[],
  model: StrataModel,
  placement: StrataPlacementResult,
): StrataEdgeClipMeta {
  const meta: StrataEdgeClipMeta = {
    clipped: 0,
    skippedBackward: 0,
    skippedSameColumn: 0,
    skippedOffGrid: 0,
    skippedAlreadyRouted: 0,
    portFaces: 0,
    maxPortsOnFace: 0,
    waypointsTotal: 0,
    laneEdges: 0,
    laneAbove: 0,
    laneBelow: 0,
    laneBackward: 0,
    laneFallback: 0,
  };

  const chains = leafHullChainsOf(model.hullRoot);
  const { columnOf } = deriveStrataColumns(placement);

  type LaneClass = "cross" | "backward";
  type Plan = {
    index: number;
    el: ArrowSkeleton;
    edgeId: string;
    rel: { source: string; target: string };
    srcBox: StrataBox;
    tgtBox: StrataBox;
    /** Leaf clip faces (source RIGHT / target LEFT). */
    srcLeafFace: FaceRef;
    tgtLeafFace: FaceRef;
    /** Source-side unshared hull faces, inner→outer (RIGHT faces),
     * monotone-filtered (each strictly rightward of the previous crossing). */
    srcFaces: FaceRef[];
    /** Target-side unshared hull faces, outer→inner (LEFT faces),
     * monotone-filtered. */
    tgtFaces: FaceRef[];
    /** Outermost boxes (for the lane union / Z-detour clearance). */
    srcOuterBox: StrataBox;
    tgtOuterBox: StrataBox;
    /** Deepest shared ancestor hull id (null = synthetic root). */
    sharedId: string | null;
    /** Top-level (child-of-root) ancestor hull containing BOTH endpoints —
     * the orbit box for lanes that cannot run in place (null when the
     * endpoints sit under different top-level units or bare root leaves). */
    topAncestorId: string | null;
    /** E2.4 lane class, when the plain forward mid-gutter cannot run. */
    laneClass: LaneClass | null;
    /** X-overlapping outer containers (no forward gutter at all) — the E2.1
     * Z-detour subclass the lanes explicitly replace (never kept as Z). */
    xOverlap: boolean;
    /** Class-cross edge whose Z-detour is measurably obstacle-free — kept as
     * the Z shape, no lane needed. */
    zClean?: boolean;
    /** Departure stub for the Z-detour fallback / degenerate straight guard. */
    outStub: number;
    lane?: {
      dir: "above" | "below";
      riserX: number;
      descX: number;
      uTop: number;
      uBot: number;
      laneIndex: number;
      laneY: number;
    };
  };
  const plans: Plan[] = [];
  // faceKey → face extent + registered edges (desired port y each).
  const faces = new Map<
    string,
    {
      y0: number;
      y1: number;
      entries: Array<{ edgeId: string; desiredY: number }>;
    }
  >();

  const registerPort = (
    face: FaceRef,
    edgeId: string,
    desiredY: number,
  ): void => {
    const key = faceKeyOf(face);
    let rec = faces.get(key);
    if (!rec) {
      rec = { y0: face.y0, y1: face.y1, entries: [] };
      faces.set(key, rec);
    }
    rec.entries.push({ edgeId, desiredY });
  };

  for (let i = 0; i < skeleton.length; i++) {
    const el = skeleton[i] as ArrowSkeleton;
    if (el.type !== "arrow") {
      continue;
    }
    const rel = relationshipOf(el);
    if (!rel) {
      continue;
    }
    // First-stamper-wins: an already-routed arrow keeps its geometry. (Clip
    // runs first, so this only fires if a future pass is reordered ahead.)
    if (el.customData?.terraformRoutedPolyline === true) {
      meta.skippedAlreadyRouted += 1;
      continue;
    }
    const srcBox = placement.leafBoxes.get(rel.source);
    const tgtBox = placement.leafBoxes.get(rel.target);
    const srcCol = columnOf.get(rel.source);
    const tgtCol = columnOf.get(rel.target);
    if (!srcBox || !tgtBox || srcCol === undefined || tgtCol === undefined) {
      meta.skippedOffGrid += 1;
      continue;
    }
    if (srcCol === tgtCol) {
      meta.skippedSameColumn += 1; // same-column — style pass keeps it
      continue;
    }
    const isBackward = srcCol > tgtCol; // E2.4 class (b) — lane candidate

    // Unshared ancestor hulls: the containers this edge genuinely crosses.
    const srcChain = chains.get(rel.source) ?? [];
    const tgtChain = chains.get(rel.target) ?? [];
    const tgtSet = new Set(tgtChain);
    const srcSet = new Set(srcChain);
    // Source side: root-first chain filtered → reversed = inner→outer.
    const srcUnshared = srcChain.filter((h) => !tgtSet.has(h)).reverse();
    // Target side: root-first chain filtered = outer→inner.
    const tgtUnshared = tgtChain.filter((h) => !srcSet.has(h));
    // Deepest SHARED ancestor (root-first common prefix), for the lane
    // obstacle context.
    let shared = 0;
    while (
      shared < srcChain.length &&
      shared < tgtChain.length &&
      srcChain[shared] === tgtChain[shared]
    ) {
      shared += 1;
    }
    const sharedId = shared > 0 ? srcChain[shared - 1]! : null;

    const hullFace = (
      hullId: string,
      side: "left" | "right",
    ): FaceRef | null => {
      const boxed = placement.boxedHulls.get(hullId);
      if (!boxed) {
        return null;
      }
      const b = boxed.box;
      return {
        key: hullId,
        side,
        x: side === "left" ? b.x : b.x + b.width,
        y0: b.y,
        y1: b.y + b.height,
      };
    };
    const srcLeafFace: FaceRef = {
      key: rel.source,
      side: "right",
      x: srcBox.x + srcBox.width,
      y0: srcBox.y,
      y1: srcBox.y + srcBox.height,
    };
    const tgtLeafFace: FaceRef = {
      key: rel.target,
      side: "left",
      x: tgtBox.x,
      y0: tgtBox.y,
      y1: tgtBox.y + tgtBox.height,
    };
    // Monotone filtering (moved from emission to plan time so lane detection
    // sees the effective outermost faces): a degenerate hull face that does
    // not lie strictly beyond the previous crossing cannot be crossed
    // perpendicular and is dropped defensively.
    const srcFaces: FaceRef[] = [];
    let runR = srcLeafFace.x;
    for (const h of srcUnshared) {
      const f = hullFace(h, "right");
      if (f && f.x > runR + 1) {
        srcFaces.push(f);
        runR = f.x;
      }
    }
    const tgtFaces: FaceRef[] = [];
    let runL = tgtLeafFace.x;
    for (let k = tgtUnshared.length - 1; k >= 0; k--) {
      const f = hullFace(tgtUnshared[k]!, "left");
      if (f && f.x < runL - 1) {
        tgtFaces.unshift(f);
        runL = f.x;
      }
    }

    const srcCenterY = srcBox.y + srcBox.height / 2;
    const tgtCenterY = tgtBox.y + tgtBox.height / 2;
    const edgeId = String((el as { id?: unknown }).id ?? `edge-${i}`);

    const srcOuterBox =
      srcFaces.length > 0
        ? placement.boxedHulls.get(srcFaces[srcFaces.length - 1]!.key)!.box
        : srcBox;
    const tgtOuterBox =
      tgtFaces.length > 0
        ? placement.boxedHulls.get(tgtFaces[0]!.key)!.box
        : tgtBox;

    // Lane class detection: net-backward is class (b); a net-forward edge is
    // class (a) when its outermost containers are CROSS-BAND (Y-disjoint —
    // the mid-gutter travel would transit sibling bands; the X-overlap case
    // that Z-detoured in E2.1 is a subset) or leave no forward gutter at all.
    const lastSrcX = srcFaces.length
      ? srcFaces[srcFaces.length - 1]!.x
      : srcLeafFace.x;
    const firstTgtX = tgtFaces.length ? tgtFaces[0]!.x : tgtLeafFace.x;
    const midGap = firstTgtX - lastSrcX;
    const outStub = stubFor(midGap > 0 ? midGap : STRATA_CLIP_STUB_MIN_PX * 3);
    const crossBand =
      tgtOuterBox.y >= srcOuterBox.y + srcOuterBox.height - 0.5 ||
      srcOuterBox.y >= tgtOuterBox.y + tgtOuterBox.height - 0.5;
    const xOverlap = firstTgtX - outStub < lastSrcX + outStub;
    const laneClass: LaneClass | null = isBackward
      ? "backward"
      : crossBand || xOverlap
      ? "cross"
      : null;

    // Register ports: barycenter of the OPPOSITE endpoint's y, per face.
    registerPort(srcLeafFace, edgeId, tgtCenterY);
    for (const f of srcFaces) {
      registerPort(f, edgeId, tgtCenterY);
    }
    for (const f of tgtFaces) {
      registerPort(f, edgeId, srcCenterY);
    }
    registerPort(tgtLeafFace, edgeId, srcCenterY);

    // Top-level ancestor unit (child of the synthetic root) CONTAINING both
    // endpoints — the box an infeasible-in-place lane ORBITS around.
    const topAncestorId =
      srcChain.length > 0 && srcChain[0] === tgtChain[0] ? srcChain[0]! : null;

    plans.push({
      index: i,
      el,
      edgeId,
      rel,
      srcBox,
      tgtBox,
      srcLeafFace,
      tgtLeafFace,
      srcFaces,
      tgtFaces,
      srcOuterBox,
      tgtOuterBox,
      sharedId,
      topAncestorId,
      laneClass,
      xOverlap,
      outStub,
    });
  }

  // ── Port assignment per face (across ALL edges sharing the face). ──
  const portYByFaceEdge = new Map<string, Map<string, number>>();
  for (const [key, rec] of faces) {
    const assigned = assignFacePorts(rec, rec.entries);
    portYByFaceEdge.set(key, assigned);
    meta.maxPortsOnFace = Math.max(meta.maxPortsOnFace, rec.entries.length);
  }
  meta.portFaces = faces.size;

  const portY = (
    face: Pick<FaceRef, "key" | "side">,
    edgeId: string,
    fallback: number,
  ): number => portYByFaceEdge.get(faceKeyOf(face))?.get(edgeId) ?? fallback;

  // ── E2.4 lane planning: corridors + direction + union, per lane candidate. ──
  const laneContexts = new Map<string | null, LaneContext>();
  const laneContextOf = (sharedId: string | null): LaneContext => {
    const cached = laneContexts.get(sharedId);
    if (cached) {
      return cached;
    }
    let node: StrataHullNode | null = null;
    let bounds: StrataBox | null = null;
    if (sharedId === null) {
      node = model.hullRoot;
    } else {
      const boxed = placement.boxedHulls.get(sharedId);
      node = boxed?.hull ?? null;
      bounds = boxed?.box ?? null;
    }
    // Obstacle EXTENTS are the RENDERED frame extents already: sceneBuild emits
    // every hull frame DIRECTLY at its `placement.boxedHulls` box and every
    // leaf-cluster frame at its `placement.leafBoxes` box (byte-identical
    // emission — terraformPipelineStrataSceneBuild.ts header; verified: the
    // emitted+converted frame rect equals the placement box to the pixel for
    // every leaf on the owner preset). So there is NO placement-vs-rendered inset
    // to correct here. A lane that grazes a foreign frame's INTERIOR is therefore
    // never an obstacle-extent problem — it is an obstacle-SELECTION problem:
    // the grazed frame was not in the deepest-shared-ancestor obstacle set this
    // lane's `settleLaneY` cleared against (a wide horizontal lane segment can
    // span X past frames outside its shared-ancestor context). Widening lane
    // strip selection to those frames is loop-3 scope — deliberately NOT done
    // here.
    const obstacles: StrataBox[] = [];
    if (node) {
      for (const child of node.children) {
        const b = placement.boxedHulls.get(child.id);
        if (b) {
          obstacles.push(b.box);
        }
      }
      for (const leafId of node.leafClusterIds) {
        const b = placement.leafBoxes.get(leafId);
        if (b) {
          obstacles.push(b);
        }
      }
    }
    const ctx: LaneContext = { obstacles, bounds };
    laneContexts.set(sharedId, ctx);
    return ctx;
  };

  /**
   * Settle a lane Y by clearance FIXPOINT: seed the union from the two
   * endpoints' outer boxes plus every obstacle the Z-detour's vertical travel
   * would transit (Y-intersecting the open exit↔entry interval), place the
   * lane CLEARANCE + SEPARATION·k past the union's top (above) / bottom
   * (below), then, while the candidate Y still cuts ANY obstacle's open
   * Y-interval, absorb that obstacle into the union and re-place. X is
   * deliberately ignored (bands are effectively full-width; the conservatism
   * costs nothing there and guarantees the lane segment cannot cut a hull no
   * matter the final span). Converges in ≤ |obstacles| steps — each
   * absorption strictly grows the union. The result lands in the nearest
   * clear horizontal strip: an inter-band gap when one fits, else past the
   * whole stack.
   */
  const settleLaneY = (
    dir: "above" | "below",
    laneIndex: number,
    seedTop: number,
    seedBot: number,
    obstacles: readonly StrataBox[],
  ): number => {
    let top = seedTop;
    let bot = seedBot;
    const offset =
      STRATA_CLIP_LANE_CLEARANCE_PX +
      STRATA_CLIP_LANE_SEPARATION_PX * laneIndex;
    let laneY = dir === "above" ? top - offset : bot + offset;
    for (let guard = 0; guard <= obstacles.length; guard++) {
      const hit = obstacles.find(
        (b) => b.y + 0.5 < laneY && laneY < b.y + b.height - 0.5,
      );
      if (!hit) {
        return laneY;
      }
      top = Math.min(top, hit.y);
      bot = Math.max(bot, hit.y + hit.height);
      laneY = dir === "above" ? top - offset : bot + offset;
    }
    return laneY;
  };

  /** Clear corridor X beside one endpoint's outermost face: vertical blockers
   * are the obstacles the riser's ACTUAL Y-span (laneY ↔ exit level) would
   * hit; the wall is the first obstacle strictly containing the exit level in
   * the walk direction (the horizontal approach at exitY cannot pass it),
   * capped by the shared hull's own border. */
  const laneCorridorX = (
    startX: number,
    exitY: number,
    laneY: number,
    dir: 1 | -1,
    ctx: LaneContext,
    ownBox: StrataBox,
    desired: number,
  ): number | null => {
    const yLo = Math.min(exitY, laneY);
    const yHi = Math.max(exitY, laneY);
    const blockers: XInterval[] = [];
    let wall = dir === 1 ? Infinity : -Infinity;
    for (const b of ctx.obstacles) {
      if (sameBox(b, ownBox)) {
        continue;
      }
      if (b.y < yHi - 0.5 && b.y + b.height > yLo + 0.5) {
        blockers.push({ x0: b.x, x1: b.x + b.width });
      }
      const containsExitLevel =
        b.y < exitY - 0.5 && b.y + b.height > exitY + 0.5;
      if (containsExitLevel) {
        if (dir === 1 && b.x >= startX - 0.5) {
          wall = Math.min(wall, b.x);
        } else if (dir === -1 && b.x + b.width <= startX + 0.5) {
          wall = Math.max(wall, b.x + b.width);
        }
      }
    }
    const limit =
      dir === 1
        ? Math.min(
            wall,
            ctx.bounds ? ctx.bounds.x + ctx.bounds.width : Infinity,
          )
        : Math.max(wall, ctx.bounds ? ctx.bounds.x : -Infinity);
    return chooseCorridorX(startX, desired, dir, blockers, limit);
  };

  /** Lane must stay INSIDE the shared hull's own box (when the shared
   * ancestor is a real hull) — a lane past its border would cross a face the
   * edge owns no port on. Border-hugging is fine (only crossing is not). */
  const laneFits = (
    laneY: number,
    dir: "above" | "below",
    bounds: StrataBox | null,
  ): boolean =>
    !bounds ||
    (dir === "above"
      ? laneY > bounds.y + 0.5
      : laneY < bounds.y + bounds.height - 0.5);

  /** Strict-interior intersection of an AXIS-ALIGNED segment with a box. */
  const axisSegEntersBox = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    b: StrataBox,
  ): boolean => {
    const ix0 = Math.max(Math.min(x0, x1), b.x);
    const ix1 = Math.min(Math.max(x0, x1), b.x + b.width);
    const iy0 = Math.max(Math.min(y0, y1), b.y);
    const iy1 = Math.min(Math.max(y0, y1), b.y + b.height);
    if (ix0 > ix1 || iy0 > iy1) {
      return false;
    }
    const mx = (ix0 + ix1) / 2;
    const my = (iy0 + iy1) / 2;
    return (
      mx > b.x + 0.5 &&
      mx < b.x + b.width - 0.5 &&
      my > b.y + 0.5 &&
      my < b.y + b.height - 0.5 &&
      (ix1 - ix0 > 0.5 || iy1 - iy0 > 0.5)
    );
  };

  // Global per-edge stagger rank: distinct clip edges that end up in the SAME
  // physical corridor column (a shared face stub / a shared blocker pushes
  // several runs' verticals to one x) get slightly different columns, so one
  // edge's horizontal never ENDS exactly ON another's vertical (an
  // endpoint-touch the crossing metric counts as a full crossing).
  // Deterministic: rank = position in the sorted edge-id list.
  const globalStagger = new Map<string, number>();
  {
    const ids = plans.map((p) => p.edgeId).sort(cmpStr);
    ids.forEach((id, i) => globalStagger.set(id, (i % 4) * 3));
  }

  /** The Z-detour's geometry for a class-cross edge (the E2.1 shape, with
   * the per-edge column stagger). */
  const zShapeOf = (
    plan: Plan,
    lastSrcFace: FaceRef,
    firstTgtFace: FaceRef,
    exitY: number,
    entryY: number,
  ): { ax: number; bx: number; my: number } => {
    const stagger = globalStagger.get(plan.edgeId) ?? 0;
    const ax = lastSrcFace.x + plan.outStub + stagger;
    const bx = firstTgtFace.x - plan.outStub - stagger;
    const s = plan.srcOuterBox;
    const t = plan.tgtOuterBox;
    let my = (exitY + entryY) / 2;
    if (t.y >= s.y + s.height) {
      my = (s.y + s.height + t.y) / 2; // target below source: between bands
    } else if (s.y >= t.y + t.height) {
      my = (t.y + t.height + s.y) / 2; // target above source
    }
    return { ax, bx, my };
  };

  /** A class-cross edge KEEPS its Z-detour when the Z's five runs are
   * measurably clear of every sibling obstacle (variable-width bands make
   * "just past the face" verticals land inside WIDER siblings — this test is
   * the arbiter, not the face offsets). */
  const zIsClean = (
    plan: Plan,
    lastSrcFace: FaceRef,
    firstTgtFace: FaceRef,
    exitY: number,
    entryY: number,
  ): boolean => {
    const { ax, bx, my } = zShapeOf(
      plan,
      lastSrcFace,
      firstTgtFace,
      exitY,
      entryY,
    );
    const ctx = laneContextOf(plan.sharedId);
    for (const b of ctx.obstacles) {
      if (sameBox(b, plan.srcOuterBox) || sameBox(b, plan.tgtOuterBox)) {
        continue;
      }
      if (
        axisSegEntersBox(ax, exitY, ax, my, b) ||
        axisSegEntersBox(Math.min(ax, bx), my, Math.max(ax, bx), my, b) ||
        axisSegEntersBox(bx, my, bx, entryY, b) ||
        axisSegEntersBox(lastSrcFace.x, exitY, ax, exitY, b) ||
        axisSegEntersBox(bx, entryY, firstTgtFace.x, entryY, b)
      ) {
        return false;
      }
    }
    return true;
  };

  type LaneDraft = {
    plan: Plan;
    dir: "above" | "below";
    lastSrcFace: FaceRef;
    firstTgtFace: FaceRef;
    exitY: number;
    entryY: number;
    seedTop: number;
    seedBot: number;
    spanLo: number;
    spanHi: number;
  };
  const laneDrafts: LaneDraft[] = [];
  type OrbitDraft = {
    plan: Plan;
    dir: "above" | "below";
    lastSrcFace: FaceRef;
    firstTgtFace: FaceRef;
    exitY: number;
    entryY: number;
    orbit: StrataBox;
    orbitKey: string;
    /** Try the in-place machinery when this orbit is blocked (first-choice
     * orbits only — an edge whose in-place attempt already failed retries
     * nothing). */
    retryInPlace: boolean;
  };
  const orbitDrafts: OrbitDraft[] = [];

  /** Queue an ORBIT attempt around the top-level ancestor unit; false when
   * the endpoints share no top-level unit (bare root leaves / cross-unit). */
  const enqueueOrbit = (
    plan: Plan,
    lastSrcFace: FaceRef,
    firstTgtFace: FaceRef,
    exitY: number,
    entryY: number,
    retryInPlace: boolean,
  ): boolean => {
    const orbitBoxed = plan.topAncestorId
      ? placement.boxedHulls.get(plan.topAncestorId)
      : undefined;
    if (!orbitBoxed) {
      return false;
    }
    const O = orbitBoxed.box;
    const below =
      O.y + O.height - exitY < exitY - O.y &&
      O.y + O.height - entryY < entryY - O.y;
    orbitDrafts.push({
      plan,
      dir: below ? "below" : "above",
      lastSrcFace,
      firstTgtFace,
      exitY,
      entryY,
      orbit: O,
      orbitKey: plan.topAncestorId!,
      retryInPlace,
    });
    return true;
  };

  /** Draft the IN-PLACE lane (nearest-gutter, inside the shared hull); false
   * when no direction fits inside the shared hull or no clear riser/descender
   * corridor exists at index 0. */
  const draftInPlace = (
    plan: Plan,
    lastSrcFace: FaceRef,
    firstTgtFace: FaceRef,
    exitY: number,
    entryY: number,
  ): boolean => {
    const ctx = laneContextOf(plan.sharedId);
    const s = plan.srcOuterBox;
    const t = plan.tgtOuterBox;
    // Union seed: the two outer boxes + every obstacle the Z-detour's
    // vertical travel would transit (Y-intersecting the open exit↔entry
    // interval — "every hull the edge would otherwise transit").
    let seedTop = Math.min(s.y, t.y);
    let seedBot = Math.max(s.y + s.height, t.y + t.height);
    const tLo = Math.min(exitY, entryY);
    const tHi = Math.max(exitY, entryY);
    for (const b of ctx.obstacles) {
      if (b.y < tHi - 0.5 && b.y + b.height > tLo + 0.5) {
        seedTop = Math.min(seedTop, b.y);
        seedBot = Math.max(seedBot, b.y + b.height);
      }
    }
    // Below-the-union lane iff the union's bottom is closer to BOTH endpoints
    // (deterministic per edge); above otherwise. When the preferred direction
    // cannot fit inside the shared hull, try the other before giving up.
    const below =
      seedBot - exitY < exitY - seedTop && seedBot - entryY < entryY - seedTop;
    let dir: "above" | "below" = below ? "below" : "above";
    let laneY0 = settleLaneY(dir, 0, seedTop, seedBot, ctx.obstacles);
    if (!laneFits(laneY0, dir, ctx.bounds)) {
      const flipped: "above" | "below" = dir === "above" ? "below" : "above";
      const flippedY0 = settleLaneY(
        flipped,
        0,
        seedTop,
        seedBot,
        ctx.obstacles,
      );
      if (!laneFits(flippedY0, flipped, ctx.bounds)) {
        return false;
      }
      dir = flipped;
      laneY0 = flippedY0;
    }
    const riserX = laneCorridorX(
      lastSrcFace.x,
      exitY,
      laneY0,
      1,
      ctx,
      plan.srcOuterBox,
      plan.outStub,
    );
    const descX =
      riserX !== null
        ? laneCorridorX(
            firstTgtFace.x,
            entryY,
            laneY0,
            -1,
            ctx,
            plan.tgtOuterBox,
            plan.outStub,
          )
        : null;
    if (riserX === null || descX === null) {
      return false;
    }
    laneDrafts.push({
      plan,
      dir,
      lastSrcFace,
      firstTgtFace,
      exitY,
      entryY,
      seedTop,
      seedBot,
      spanLo: Math.min(riserX, descX),
      spanHi: Math.max(riserX, descX),
    });
    return true;
  };

  for (const plan of plans) {
    if (!plan.laneClass) {
      continue;
    }
    const lastSrcFace = plan.srcFaces.length
      ? plan.srcFaces[plan.srcFaces.length - 1]!
      : plan.srcLeafFace;
    const firstTgtFace = plan.tgtFaces.length
      ? plan.tgtFaces[0]!
      : plan.tgtLeafFace;
    const exitY = portY(
      lastSrcFace,
      plan.edgeId,
      plan.tgtBox.y + plan.tgtBox.height / 2,
    );
    const entryY = portY(
      firstTgtFace,
      plan.edgeId,
      plan.srcBox.y + plan.srcBox.height / 2,
    );
    // A class-cross edge whose Z-detour is obstacle-free needs no lane at all
    // (e.g. adjacent-band hops through a clean band gap). X-OVERLAP edges are
    // exempt: their Z is the E2.1 mid-gutter detour the lanes exist to
    // replace (its long backward mid-run must become sanctioned lane travel).
    if (
      plan.laneClass === "cross" &&
      !plan.xOverlap &&
      zIsClean(plan, lastSrcFace, firstTgtFace, exitY, entryY)
    ) {
      plan.zClean = true;
      continue;
    }
    // X-OVERLAP edges are canvas-scale detours — the ORBIT's nested
    // staircases are crossing-free, so it goes first (a blocked orbit retries
    // in place). Everything else prefers the nearest-gutter in-place lane.
    if (
      plan.xOverlap &&
      enqueueOrbit(plan, lastSrcFace, firstTgtFace, exitY, entryY, true)
    ) {
      continue;
    }
    if (!draftInPlace(plan, lastSrcFace, firstTgtFace, exitY, entryY)) {
      if (
        !enqueueOrbit(plan, lastSrcFace, firstTgtFace, exitY, entryY, false)
      ) {
        meta.laneFallback += 1; // class (a) → Z-detour; class (b) → skip
      }
    }
  }

  // ── Orbit allocation machinery: per (orbit unit, direction), stable by
  // edge id. The k-th orbit sits CLEARANCE + SEPARATION·k outside the unit
  // box on ALL sides it touches — nested staircases, no mutual crossings —
  // with riser/descender corridors walked further out past any OTHER
  // top-level unit their vertical span would hit. Every orbit piece is
  // verified clear: exit/entry runs against the shared context's sibling
  // obstacles (skipping the endpoint's own ancestor stack) and every outside
  // piece against the other top-level units. ──
  const orbitCounts = new Map<string, number>();
  const allocateOrbit = (d: OrbitDraft): boolean => {
    const key = `${d.orbitKey}|${d.dir}`;
    const k = orbitCounts.get(key) ?? 0;
    const O = d.orbit;
    const off =
      STRATA_CLIP_LANE_CLEARANCE_PX + STRATA_CLIP_LANE_SEPARATION_PX * k;
    const laneY = d.dir === "above" ? O.y - off : O.y + O.height + off;
    const rootObstacles = laneContextOf(null).obstacles;
    const riserBlockers: XInterval[] = [];
    const descBlockers: XInterval[] = [];
    for (const b of rootObstacles) {
      if (sameBox(b, O)) {
        continue;
      }
      if (
        b.y < Math.max(laneY, d.exitY) - 0.5 &&
        b.y + b.height > Math.min(laneY, d.exitY) + 0.5
      ) {
        riserBlockers.push({ x0: b.x, x1: b.x + b.width });
      }
      if (
        b.y < Math.max(laneY, d.entryY) - 0.5 &&
        b.y + b.height > Math.min(laneY, d.entryY) + 0.5
      ) {
        descBlockers.push({ x0: b.x, x1: b.x + b.width });
      }
    }
    const riserX = chooseCorridorX(
      O.x + O.width,
      off,
      1,
      riserBlockers,
      Infinity,
    );
    const descX = chooseCorridorX(O.x, off, -1, descBlockers, -Infinity);
    if (riserX === null || descX === null) {
      return false;
    }
    const containsPoint = (b: StrataBox, px: number, py: number): boolean =>
      px >= b.x - 0.5 &&
      px <= b.x + b.width + 0.5 &&
      py >= b.y - 0.5 &&
      py <= b.y + b.height + 0.5;
    // Exit/entry runs vs sibling obstacles inside the shared + orbit
    // contexts (an obstacle CONTAINING the run's own anchor point is the
    // endpoint's ancestor stack — not an obstacle).
    for (const ctxId of new Set([d.plan.sharedId, d.plan.topAncestorId])) {
      for (const b of laneContextOf(ctxId).obstacles) {
        const exitRun =
          !containsPoint(b, d.lastSrcFace.x, d.exitY) &&
          axisSegEntersBox(d.lastSrcFace.x, d.exitY, riserX, d.exitY, b);
        const entryRun =
          !containsPoint(b, d.firstTgtFace.x, d.entryY) &&
          axisSegEntersBox(descX, d.entryY, d.firstTgtFace.x, d.entryY, b);
        if (exitRun || entryRun) {
          return false;
        }
      }
    }
    // Outside pieces vs the OTHER top-level units.
    for (const b of rootObstacles) {
      if (sameBox(b, O)) {
        continue;
      }
      if (
        axisSegEntersBox(riserX, laneY, riserX, d.exitY, b) ||
        axisSegEntersBox(descX, laneY, descX, d.entryY, b) ||
        axisSegEntersBox(descX, laneY, riserX, laneY, b) ||
        axisSegEntersBox(d.lastSrcFace.x, d.exitY, riserX, d.exitY, b) ||
        axisSegEntersBox(descX, d.entryY, d.firstTgtFace.x, d.entryY, b)
      ) {
        return false;
      }
    }
    orbitCounts.set(key, k + 1);
    d.plan.lane = {
      dir: d.dir,
      riserX,
      descX,
      uTop: O.y,
      uBot: O.y + O.height,
      laneIndex: k,
      laneY,
    };
    return true;
  };

  // ── Phase 1: first-choice orbits (X-overlap canvas detours). A blocked
  // orbit retries the in-place machinery. ──
  const firstOrbits = [...orbitDrafts].sort((a, b) =>
    cmpStr(a.plan.edgeId, b.plan.edgeId),
  );
  orbitDrafts.length = 0; // phase-2 misses re-fill the queue for phase 3
  for (const d of firstOrbits) {
    if (allocateOrbit(d)) {
      continue;
    }
    if (
      !d.retryInPlace ||
      !draftInPlace(d.plan, d.lastSrcFace, d.firstTgtFace, d.exitY, d.entryY)
    ) {
      meta.laneFallback += 1;
    }
  }

  // ── Phase 2: in-place lane allocation (the spec's "nearest gutter"
  // default): greedy interval coloring over X-overlapping lane edges of the
  // same direction, stable by edge id; then settle each lane's FINAL Y at
  // its allocated index (the fixpoint may cross further bands at deeper
  // indexes) and re-derive the corridors against the final riser spans. A
  // final-stage miss retries as a phase-3 ORBIT. ──
  const drafted = [...laneDrafts].sort((a, b) =>
    cmpStr(a.plan.edgeId, b.plan.edgeId),
  );
  const allocated: Array<{
    draft: LaneDraft;
    dir: "above" | "below";
    laneIndex: number;
  }> = [];
  const tryPlaceInPlace = (
    d: LaneDraft,
    dir: "above" | "below",
  ): {
    laneIndex: number;
    laneY: number;
    riserX: number;
    descX: number;
  } | null => {
    const used = new Set<number>();
    for (const prev of allocated) {
      if (
        prev.dir === dir &&
        prev.draft.plan.sharedId === d.plan.sharedId &&
        prev.draft.spanLo < d.spanHi &&
        d.spanLo < prev.draft.spanHi
      ) {
        used.add(prev.laneIndex);
      }
    }
    let laneIndex = 0;
    while (used.has(laneIndex)) {
      laneIndex += 1;
    }
    const ctx = laneContextOf(d.plan.sharedId);
    const laneY = settleLaneY(
      dir,
      laneIndex,
      d.seedTop,
      d.seedBot,
      ctx.obstacles,
    );
    const riserX = laneFits(laneY, dir, ctx.bounds)
      ? laneCorridorX(
          d.lastSrcFace.x,
          d.exitY,
          laneY,
          1,
          ctx,
          d.plan.srcOuterBox,
          d.plan.outStub,
        )
      : null;
    const descX =
      riserX !== null
        ? laneCorridorX(
            d.firstTgtFace.x,
            d.entryY,
            laneY,
            -1,
            ctx,
            d.plan.tgtOuterBox,
            d.plan.outStub,
          )
        : null;
    if (riserX === null || descX === null) {
      return null;
    }
    return { laneIndex, laneY, riserX, descX };
  };
  for (const d of drafted) {
    // Preferred direction first; when its slots/corridors are exhausted (a
    // full top pad), overflow to the opposite side before giving up.
    const flipped: "above" | "below" = d.dir === "above" ? "below" : "above";
    let dir = d.dir;
    let placed = tryPlaceInPlace(d, dir);
    if (!placed) {
      const alt = tryPlaceInPlace(d, flipped);
      if (alt) {
        dir = flipped;
        placed = alt;
      }
    }
    if (!placed) {
      if (
        !enqueueOrbit(
          d.plan,
          d.lastSrcFace,
          d.firstTgtFace,
          d.exitY,
          d.entryY,
          false,
        )
      ) {
        meta.laneFallback += 1;
      }
      continue;
    }
    allocated.push({ draft: d, dir, laneIndex: placed.laneIndex });
    d.plan.lane = {
      dir,
      riserX: placed.riserX,
      descX: placed.descX,
      uTop: d.seedTop,
      uBot: d.seedBot,
      laneIndex: placed.laneIndex,
      laneY: placed.laneY,
    };
  }

  // ── Phase 3: second-chance orbits (in-place allocation misses). ──
  const secondOrbits = [...orbitDrafts].sort((a, b) =>
    cmpStr(a.plan.edgeId, b.plan.edgeId),
  );
  for (const d of secondOrbits) {
    if (!allocateOrbit(d)) {
      meta.laneFallback += 1;
    }
  }

  // ── E2.3 gutter registry: every between-faces run, keyed by its face pair.
  // The 25%/75% waypoint-column pattern (with per-gutter nudged tracks) only
  // applies where the run's strip through the gutter is CLEAR of foreign
  // boxes — a wide "gutter" between an inner and an outer chain face is
  // hull-interior space that can hold sibling hulls/leaves, and a waypoint
  // column landing inside one would cross its border on the wrong face. A
  // DIRTY run keeps the E2.1 stub-hug shape (vertical adjustment immediately
  // past the exited face / at mid-gutter). Tracks are then spread per gutter
  // like face ports, clamped to each edge's verified-clear strip. ──
  // Gutter-clearance obstacle set. As with `laneContextOf`, these placement
  // boxes ARE the rendered frame extents (byte-identical emission — see that
  // helper's note), so no inset correction is needed.
  const allBoxes: StrataBox[] = [
    ...[...placement.boxedHulls.values()].map((b) => b.box),
    ...placement.leafBoxes.values(),
  ];
  /** Half-height of the strip a clear gutter run may occupy (and the track
   * clamp range): the run's own y-extent padded by this. */
  const GUTTER_STRIP_PAD_PX = 24;
  const gutterRunIsClear = (
    from: FaceRef,
    to: FaceRef,
    yIn: number,
    yOut: number,
  ): boolean => {
    const x0 = Math.min(from.x, to.x);
    const x1 = Math.max(from.x, to.x);
    const yLo = Math.min(yIn, yOut) - GUTTER_STRIP_PAD_PX;
    const yHi = Math.max(yIn, yOut) + GUTTER_STRIP_PAD_PX;
    for (const b of allBoxes) {
      const bx1 = b.x + b.width;
      const by1 = b.y + b.height;
      if (bx1 <= x0 + 0.5 || b.x >= x1 - 0.5) {
        continue; // outside the gutter's X-interval
      }
      if (by1 <= yLo || b.y >= yHi) {
        continue; // outside the strip
      }
      // An ANCESTOR box contains the whole run (spans the gutter in X and the
      // strip in Y) — the run is inside it by construction, not blocked.
      if (b.x <= x0 + 0.5 && bx1 >= x1 - 0.5 && b.y <= yLo && by1 >= yHi) {
        continue;
      }
      return false;
    }
    return true;
  };
  const gutters = new Map<
    string,
    {
      y0: number;
      y1: number;
      entries: Array<{ edgeId: string; desiredY: number }>;
    }
  >();
  const gutterKeyOf = (from: FaceRef, to: FaceRef): string =>
    `${faceKeyOf(from)}→${faceKeyOf(to)}`;
  const registerGutter = (
    from: FaceRef,
    to: FaceRef,
    edgeId: string,
    yIn: number,
    yOut: number,
  ): void => {
    if (!gutterRunIsClear(from, to, yIn, yOut)) {
      return; // dirty run — E2.1 shape, no track (unregistered)
    }
    const key = gutterKeyOf(from, to);
    let rec = gutters.get(key);
    if (!rec) {
      rec = {
        y0: Math.min(from.y0, to.y0),
        y1: Math.max(from.y1, to.y1),
        entries: [],
      };
      gutters.set(key, rec);
    }
    rec.entries.push({ edgeId, desiredY: (yIn + yOut) / 2 });
  };

  /** The edge's full crossing sequence on each side (leaf face included). */
  const sideCrossings = (
    plan: Plan,
  ): {
    src: Array<{ face: FaceRef; y: number }>;
    tgt: Array<{ face: FaceRef; y: number }>;
  } => {
    const srcCenterY = plan.srcBox.y + plan.srcBox.height / 2;
    const tgtCenterY = plan.tgtBox.y + plan.tgtBox.height / 2;
    const src = [plan.srcLeafFace, ...plan.srcFaces].map((face) => ({
      face,
      y: portY(face, plan.edgeId, tgtCenterY),
    }));
    const tgt = [...plan.tgtFaces, plan.tgtLeafFace].map((face) => ({
      face,
      y: portY(face, plan.edgeId, srcCenterY),
    }));
    return { src, tgt };
  };

  const emittable = plans.filter(
    (plan) => !(plan.laneClass === "backward" && !plan.lane),
  );
  for (const plan of plans) {
    if (plan.laneClass === "backward" && !plan.lane) {
      meta.skippedBackward += 1; // no lane — the style-pass orbit keeps it
    }
  }

  for (const plan of emittable) {
    const { src, tgt } = sideCrossings(plan);
    for (let i = 0; i + 1 < src.length; i++) {
      registerGutter(
        src[i]!.face,
        src[i + 1]!.face,
        plan.edgeId,
        src[i]!.y,
        src[i + 1]!.y,
      );
    }
    for (let i = 0; i + 1 < tgt.length; i++) {
      registerGutter(
        tgt[i]!.face,
        tgt[i + 1]!.face,
        plan.edgeId,
        tgt[i]!.y,
        tgt[i + 1]!.y,
      );
    }
    if (!plan.lane && plan.laneClass !== "cross") {
      // Plain forward mid-gutter (lane edges + Z-detours route it themselves).
      const from = src[src.length - 1]!;
      const to = tgt[0]!;
      registerGutter(from.face, to.face, plan.edgeId, from.y, to.y);
    }
  }

  const trackByGutterEdge = new Map<string, Map<string, number>>();
  // Per-gutter waypoint-column STAGGER rank: edges ordered by (mean y, edge
  // id). Each edge's two vertical columns sit rank·SEPARATION past the
  // 25%/75% marks (nested staircases): two edges whose ports invert then
  // cross ONCE, properly, instead of twice by endpoint-on-interior touches
  // at a shared column.
  const rankByGutterEdge = new Map<string, Map<string, number>>();
  for (const [key, rec] of gutters) {
    trackByGutterEdge.set(key, assignFacePorts(rec, rec.entries));
    const ordered = [...rec.entries].sort((a, b) =>
      a.desiredY !== b.desiredY
        ? a.desiredY - b.desiredY
        : cmpStr(a.edgeId, b.edgeId),
    );
    const ranks = new Map<string, number>();
    ordered.forEach((e, i) => ranks.set(e.edgeId, i));
    rankByGutterEdge.set(key, ranks);
  }
  const gutterTrack = (
    from: FaceRef,
    to: FaceRef,
    edgeId: string,
    fallback: number,
  ): number =>
    trackByGutterEdge.get(gutterKeyOf(from, to))?.get(edgeId) ?? fallback;
  const gutterRank = (from: FaceRef, to: FaceRef, edgeId: string): number =>
    rankByGutterEdge.get(gutterKeyOf(from, to))?.get(edgeId) ?? 0;

  // ── Build each polyline. ──
  for (const plan of emittable) {
    const { rel } = plan;
    const edgeId = plan.edgeId;
    const { src, tgt } = sideCrossings(plan);
    const sx = plan.srcLeafFace.x; // source R face (the clip origin)
    const ex = plan.tgtLeafFace.x; // target L face (the clip terminus)
    const sy = src[0]!.y;
    const ey = tgt[tgt.length - 1]!.y;

    // E2.3: a CLEAR between-faces run routes through waypoint columns at
    // 25% / 75% of the gutter width; the vertical adjustment sits on the
    // edge's nudged TRACK between them (clamped to the verified-clear strip).
    // A DIRTY run (foreign boxes inside the gutter) keeps the E2.1 stub-hug
    // shape. Collinear columns collapse in simplifyPolyline.
    const pts: Pt[] = [];
    /** Vertical-adjustment X for a DIRTY gutter run: the E2.1 stub-hug X
     * (chain) / mid-gutter X (mid) when its vertical span already clears
     * every foreign box, else the nearest clear column rightward of it
     * (variable-width siblings make the naive X land INSIDE a wider box —
     * the corridor walk jumps past it). Best-effort: the naive X when no
     * column in the gutter clears. */
    const dirtyGutterVX = (
      from: FaceRef,
      to: FaceRef,
      yIn: number,
      yOut: number,
      kind: "chain" | "mid",
    ): number => {
      const w = to.x - from.x;
      const base =
        (kind === "chain" ? from.x + stubFor(w) : from.x + w / 2) +
        (globalStagger.get(edgeId) ?? 0);
      const yLo = Math.min(yIn, yOut);
      const yHi = Math.max(yIn, yOut);
      const blockers: XInterval[] = [];
      for (const b of allBoxes) {
        const bx1 = b.x + b.width;
        const by1 = b.y + b.height;
        if (bx1 <= from.x + 0.5 || b.x >= to.x - 0.5) {
          continue;
        }
        if (by1 <= yLo + 0.5 || b.y >= yHi - 0.5) {
          continue;
        }
        // Ancestor containing the whole vertical span — not a blocker.
        if (
          b.x <= from.x + 0.5 &&
          bx1 >= to.x - 0.5 &&
          b.y <= yLo &&
          by1 >= yHi
        ) {
          continue;
        }
        blockers.push({ x0: b.x, x1: bx1 });
      }
      return chooseCorridorX(from.x, base - from.x, 1, blockers, to.x) ?? base;
    };
    const pushGutterRun = (
      from: { face: FaceRef; y: number },
      to: { face: FaceRef; y: number },
      kind: "chain" | "mid",
    ): void => {
      const w = to.face.x - from.face.x;
      if (!gutterRunIsClear(from.face, to.face, from.y, to.y)) {
        const vx = dirtyGutterVX(from.face, to.face, from.y, to.y, kind);
        pts.push([vx, from.y], [vx, to.y]);
        return;
      }
      const raw = gutterTrack(from.face, to.face, edgeId, (from.y + to.y) / 2);
      const lo = Math.min(from.y, to.y) - GUTTER_STRIP_PAD_PX;
      const hi = Math.max(from.y, to.y) + GUTTER_STRIP_PAD_PX;
      const track = Math.min(hi, Math.max(lo, raw));
      // Waypoint columns: rank·separation past the 25%/75% marks (mean-y
      // order, nested), clamped to stay inside the middle half of the gutter
      // on crowded/narrow gutters.
      const rank = gutterRank(from.face, to.face, edgeId);
      const stagger = Math.min(
        rank * STRATA_CLIP_PORT_SEPARATION_PX,
        Math.max(0, 0.2 * w),
      );
      const gxA = from.face.x + 0.25 * w + stagger;
      const gxB = from.face.x + 0.75 * w - stagger;
      if (gxB <= gxA) {
        const mid = from.face.x + 0.5 * w;
        pts.push([mid, from.y], [mid, to.y]);
        return;
      }
      pts.push([gxA, from.y], [gxA, track], [gxB, track], [gxB, to.y]);
    };
    const emitSide = (crossings: Array<{ face: FaceRef; y: number }>): void => {
      for (let i = 0; i < crossings.length; i++) {
        const cur = crossings[i]!;
        pts.push([cur.face.x, cur.y]);
        const next = crossings[i + 1];
        if (next) {
          pushGutterRun(cur, next, "chain");
        }
      }
    };

    emitSide(src);
    const lastSrc = src[src.length - 1]!;
    const firstTgt = tgt[0]!;
    if (plan.lane) {
      // E2.4 lane: rise in the clear corridor beside the source's outermost
      // face, travel the lane, descend beside the target's outermost face.
      const { riserX, descX, laneY } = plan.lane;
      pts.push([riserX, lastSrc.y]);
      pts.push([riserX, laneY]);
      pts.push([descX, laneY]);
      pts.push([descX, firstTgt.y]);
    } else if (plan.laneClass === "cross") {
      // Clean-Z cross edge (or lane fallback): the E2.1 Z-detour — a vertical
      // run right of every source-side face, a horizontal run at a Y BETWEEN
      // the two outer boxes when a gap exists, then a vertical run left of
      // every target-side face.
      const { ax, bx, my } = zShapeOf(
        plan,
        lastSrc.face,
        firstTgt.face,
        lastSrc.y,
        firstTgt.y,
      );
      pts.push([ax, lastSrc.y]);
      pts.push([ax, my]);
      pts.push([bx, my]);
      pts.push([bx, firstTgt.y]);
    } else {
      pushGutterRun(lastSrc, firstTgt, "mid");
    }
    emitSide(tgt);

    let simplified = simplifyPolyline(pts);
    if (simplified.length < 3) {
      // Degenerate exactly-straight clip (same port y throughout): keep the
      // exit stub as an explicit collinear interior waypoint so the stamped
      // polyline stays >2 points (repair's `points.length > 2` gate) — the
      // E1.2 channel-router pattern; rendered geometry is unchanged.
      const span = Math.abs(ex - sx);
      const stubX = sx + Math.min(plan.outStub, span / 2);
      simplified = [
        [sx, sy],
        [stubX, sy],
        [ex, ey],
      ];
    }

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

    // Write-back re-origin (E1.2/E1.5 pattern): el.x/el.y = the polyline's
    // FIRST point (the source-frame R-face port), points[0] = [0,0] — so
    // `convertToExcalidrawElements`' points[0]→[0,0] re-normalization anchored
    // at el.x/el.y cannot drag the clip endpoint back to the old chord origin.
    skeleton[plan.index] = {
      ...plan.el,
      x: sx,
      y: sy,
      points: simplified.map(([px, py]) =>
        pointFrom<LocalPoint>(px - sx, py - sy),
      ),
      width: maxX - minX,
      height: maxY - minY,
      customData: {
        ...(plan.el.customData ?? {}),
        terraformRoutedPolyline: true,
        terraformRoutedBy: "clip",
        // E2.4 lane attribution: sanctioned lane travel (backwardXPx on these
        // edges is the lane, not a goofy detour).
        ...(plan.lane ? { terraformClipLane: plan.lane.dir } : {}),
        // Typed repair-gate anchors: frameKey = the endpoint's cluster address
        // (=== relationship source/target === `terraformPrimaryAddress` on the
        // leaf cluster frame element), side = the declared clip face. Repair
        // resolves the LIVE frame rect from this key and validates the
        // endpoint ON that face — fail-closed (terraformVisibility.ts).
        terraformClipAnchor: {
          start: { frameKey: rel.source, side: "right" },
          end: { frameKey: rel.target, side: "left" },
        },
      },
    } as ExcalidrawElementSkeleton;
    meta.clipped += 1;
    meta.waypointsTotal += simplified.length - 2;
    if (plan.lane) {
      meta.laneEdges += 1;
      if (plan.lane.dir === "above") {
        meta.laneAbove += 1;
      } else {
        meta.laneBelow += 1;
      }
      if (plan.laneClass === "backward") {
        meta.laneBackward += 1;
      }
    }
  }

  return meta;
}
