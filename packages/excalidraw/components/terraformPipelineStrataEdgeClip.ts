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
 * E3.2 LANE STRIP SELECTION (reworking E2.4's `settleLaneY` fixpoint): lane
 * Y placement is now a FULL-SPAN, CROSSING-AWARE strip search —
 *   • the clearance union for a lane candidate includes EVERY rendered
 *     leaf-cluster frame and hull box whose X-interval intersects the lane's
 *     span (not just the deepest-shared-ancestor children — the loop-2
 *     obstacle-SELECTION gap that produced 4 lane-vs-leaf-frame strict-
 *     interior violations). Boxes containing BOTH endpoint ports are the
 *     enclosing shared-ancestor stack, not obstacles;
 *   • candidate laneYs are the feasible horizontal STRIPS, enumerated in two
 *     tiers: TIER 1 = gaps in the Y-interval union of the full obstacle set
 *     over the span (the lane sits outside every frame) plus the two
 *     unbounded gaps past the stack; TIER 2 = leaf-free rows (gaps in the
 *     union of the LEAF frames + every hull's horizontal-border band) — on
 *     band-tiled scenes the only inter-band strips lie INSIDE hulls, and the
 *     lane HORIZONTAL may transit hull interiors through their vertical
 *     faces (it cannot cross a horizontal border, so wrongFace stays 0; the
 *     riser/descender verticals and port-level stubs stay strict against
 *     everything). Tier 2 is taken only when it saves crossings;
 *   • each feasible candidate (strip slot + riser/descender corridors + a
 *     strict-interior verification of all five lane pieces against the full
 *     box set) is scored by PAIR-ONCE crossings against every already-placed
 *     edge (the shared `segmentsCross` kernel over approximate polylines)
 *     with a mild distance tie-break (|laneY−exitY|+|laneY−entryY|, then
 *     laneY) — minimal wins. Deterministic: lane candidates are processed
 *     HEAVIEST-FIRST by X-span (stable by edge id); the 16px multi-lane
 *     stagger within a strip is kept (first conflict-free slot vs the
 *     already-placed lane segments).
 * E3.2 STAIRCASE RELIEF: a non-lane clip route whose emitted polyline exceeds
 * {@link STRATA_CLIP_STAIRCASE_RATIO}× its chord (the api7-class corridor
 * staircases) attempts the same lane machinery and adopts the lane when it
 * lowers the ratio (counted in `staircaseRelieved`). Side discipline and port
 * faces are unchanged in both reworks.
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
 * A lane never enters a LEAF frame, never crosses a horizontal hull border,
 * and its verticals never enter any frame (E3.2: verified against the FULL
 * box set; a tier-2 lane horizontal may transit hull interiors via their
 * vertical faces — see the E3.2 section above). Lane
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
import { segmentsCross } from "./terraformPipelineCollisionDiagnostics";

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
/** E3.2: a non-lane clip polyline whose length exceeds this ratio × its chord
 * is a corridor STAIRCASE — it attempts lane relief (adopted only when the
 * lane's ratio is lower). */
export const STRATA_CLIP_STAIRCASE_RATIO = 2;
/** E3.2: X-pad around the lane's face-to-face extent when estimating the
 * strip obstacle span (corridors sit within a stub + stagger of the faces;
 * the final lane pieces are verified against the full box set regardless). */
const STRATA_CLIP_LANE_SPAN_PAD_PX = 128;

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
  /** E3.2: non-lane clip routes whose polyline exceeded
   * {@link STRATA_CLIP_STAIRCASE_RATIO}× the chord and adopted a lane that
   * lowered the ratio (also counted in `laneEdges`). */
  staircaseRelieved: number;
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
    staircaseRelieved: 0,
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
    // to correct here. Loop-2's obstacle-SELECTION gap (this shared-ancestor
    // child set omitted far-flung frames a lane's X-span crossed) is CLOSED by
    // E3.2: lane STRIP placement clears against the full `allBoxes` set. This
    // context now serves the ORBIT machinery + the shared-hull `bounds` only.
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

  // ── E3.2 full-span obstacle set: EVERY rendered leaf-cluster frame + hull
  // box (placement boxes ARE the rendered extents — see `laneContextOf`).
  // Shared by lane strip placement, the run verifications, and the E2.3
  // gutter clearance below. Hull and leaf boxes are kept distinguishable:
  // LEAF frames are HARD obstacles for every lane piece, while a lane's
  // HORIZONTAL travel may transit hull interiors through their vertical
  // faces (tier-2 strips — on band-tiled scenes the only leaf-free rows lie
  // INSIDE hulls; a horizontal run cannot cross a horizontal border, so
  // wrongFace stays 0 by construction and the crossings drop massively).
  // Vertical pieces stay strict against everything (a vertical entering a
  // hull would cross its top/bottom border). ──
  const hullBoxesAll: StrataBox[] = [...placement.boxedHulls.values()].map(
    (b) => b.box,
  );
  const leafBoxesAll: StrataBox[] = [...placement.leafBoxes.values()];
  const leafBoxSet = new Set<StrataBox>(leafBoxesAll);
  const allBoxes: StrataBox[] = [...hullBoxesAll, ...leafBoxesAll];

  /** Closed containment of a point in a box (±0.5px tolerance — a port ON a
   * face counts as contained by that frame and all its ancestors). */
  const containsPointTol = (b: StrataBox, px: number, py: number): boolean =>
    px >= b.x - 0.5 &&
    px <= b.x + b.width + 0.5 &&
    py >= b.y - 0.5 &&
    py <= b.y + b.height + 0.5;

  /** Closed containment of an axis-aligned segment in a box (±0.5px): the box
   * is an ENCLOSING container of the run, not an obstacle. */
  const boxContainsSeg = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    b: StrataBox,
  ): boolean =>
    Math.min(x0, x1) >= b.x - 0.5 &&
    Math.max(x0, x1) <= b.x + b.width + 0.5 &&
    Math.min(y0, y1) >= b.y - 0.5 &&
    Math.max(y0, y1) <= b.y + b.height + 0.5;

  /** E3.2 corridor X against the FULL box set: vertical blockers are every
   * box the riser's actual Y-span (laneY ↔ anchor level) would hit; boxes
   * containing the anchor point are the endpoint's own ancestor stack (the
   * run starts ON their face) and are exempt. The wall is the first box
   * strictly containing the anchor level in the walk direction (the
   * horizontal approach cannot pass it), capped by the shared hull's border. */
  const corridorXFull = (
    startX: number,
    anchorY: number,
    laneY: number,
    dir: 1 | -1,
    bounds: StrataBox | null,
    desired: number,
  ): number | null => {
    const yLo = Math.min(anchorY, laneY);
    const yHi = Math.max(anchorY, laneY);
    const blockers: XInterval[] = [];
    let wall = dir === 1 ? Infinity : -Infinity;
    for (const b of allBoxes) {
      if (containsPointTol(b, startX, anchorY)) {
        continue;
      }
      if (b.y < yHi - 0.5 && b.y + b.height > yLo + 0.5) {
        blockers.push({ x0: b.x, x1: b.x + b.width });
      }
      const containsAnchorLevel =
        b.y < anchorY - 0.5 && b.y + b.height > anchorY + 0.5;
      if (containsAnchorLevel) {
        if (dir === 1 && b.x >= startX - 0.5) {
          wall = Math.min(wall, b.x);
        } else if (dir === -1 && b.x + b.width <= startX + 0.5) {
          wall = Math.max(wall, b.x + b.width);
        }
      }
    }
    const limit =
      dir === 1
        ? Math.min(wall, bounds ? bounds.x + bounds.width : Infinity)
        : Math.max(wall, bounds ? bounds.x : -Infinity);
    return chooseCorridorX(startX, desired, dir, blockers, limit);
  };

  /** Lane must stay INSIDE the shared hull's own box (when the shared
   * ancestor is a real hull) — a lane past its border would cross a face the
   * edge owns no port on. Border-hugging is fine (only crossing is not). */
  const laneFits = (laneY: number, bounds: StrataBox | null): boolean =>
    !bounds ||
    (laneY > bounds.y + 0.5 && laneY < bounds.y + bounds.height - 0.5);

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
    // E3.2: the Z is measured against the FULL box set (the same
    // obstacle-selection fix the lanes got) — enclosing containers (a box
    // holding the whole run) are exempt, the endpoints' outer boxes likewise.
    const pieces = [
      [lastSrcFace.x, exitY, ax, exitY],
      [ax, exitY, ax, my],
      [Math.min(ax, bx), my, Math.max(ax, bx), my],
      [bx, my, bx, entryY],
      [bx, entryY, firstTgtFace.x, entryY],
    ] as const;
    for (const b of allBoxes) {
      if (sameBox(b, plan.srcOuterBox) || sameBox(b, plan.tgtOuterBox)) {
        continue;
      }
      for (const [x0, y0, x1, y1] of pieces) {
        if (boxContainsSeg(x0, y0, x1, y1, b)) {
          continue;
        }
        if (axisSegEntersBox(x0, y0, x1, y1, b)) {
          return false;
        }
      }
    }
    return true;
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

  // ── E3.2 approximate-geometry registry (crossing-aware scoring): every
  // plan's polyline approximated as its face-crossing chain points plus a mid
  // connection (implicit straight chord / Z-detour / lane). Lane candidates
  // stay PENDING (excluded from scoring) until their placement resolves;
  // failed backward candidates leave the registry (they end unstamped).
  // Deterministic: insertion follows `plans` (skeleton emission) order. ──
  const approxGeom = new Map<string, Pt[]>();
  const pendingLane = new Set<string>();
  const approxPtsOf = (plan: Plan, mid: Pt[] | null): Pt[] => {
    const { src, tgt } = sideCrossings(plan);
    const pts: Pt[] = src.map((c) => [c.face.x, c.y] as const);
    if (mid) {
      pts.push(...mid);
    }
    pts.push(...tgt.map((c) => [c.face.x, c.y] as const));
    return pts;
  };
  const zMidOf = (
    plan: Plan,
    lastSrcFace: FaceRef,
    firstTgtFace: FaceRef,
    exitY: number,
    entryY: number,
  ): Pt[] => {
    const { ax, bx, my } = zShapeOf(
      plan,
      lastSrcFace,
      firstTgtFace,
      exitY,
      entryY,
    );
    return [
      [ax, exitY],
      [ax, my],
      [bx, my],
      [bx, entryY],
    ];
  };
  const laneMidOf = (
    p: { riserX: number; descX: number; laneY: number },
    exitY: number,
    entryY: number,
  ): Pt[] => [
    [p.riserX, exitY],
    [p.riserX, p.laneY],
    [p.descX, p.laneY],
    [p.descX, entryY],
  ];
  for (const plan of plans) {
    approxGeom.set(plan.edgeId, approxPtsOf(plan, null));
    if (plan.laneClass) {
      pendingLane.add(plan.edgeId);
    }
  }
  const resolveApprox = (edgeId: string, pts: Pt[]): void => {
    approxGeom.set(edgeId, pts);
    pendingLane.delete(edgeId);
  };
  const dropApprox = (edgeId: string): void => {
    approxGeom.delete(edgeId);
    pendingLane.delete(edgeId);
  };

  /** Pair-once crossings of a candidate polyline against every RESOLVED edge
   * (the shared `segmentsCross` kernel — endpoint-sharing within 1px is
   * non-crossing, matching the diagnostics' crossing census). */
  const scoreCandidate = (edgeId: string, cand: Pt[]): number => {
    let n = 0;
    for (const [id, geom] of approxGeom) {
      if (id === edgeId || pendingLane.has(id)) {
        continue;
      }
      let crossed = false;
      for (let i = 0; i + 1 < cand.length && !crossed; i++) {
        for (let j = 0; j + 1 < geom.length; j++) {
          if (
            segmentsCross(
              {
                x1: cand[i]![0],
                y1: cand[i]![1],
                x2: cand[i + 1]![0],
                y2: cand[i + 1]![1],
              },
              {
                x1: geom[j]![0],
                y1: geom[j]![1],
                x2: geom[j + 1]![0],
                y2: geom[j + 1]![1],
              },
            )
          ) {
            crossed = true;
            break;
          }
        }
      }
      if (crossed) {
        n += 1;
      }
    }
    return n;
  };

  /** Already-committed lane travel segments (strips + orbits) — the source of
   * the 16px multi-lane stagger within a strip. */
  const placedLaneSegs: Array<{ y: number; x0: number; x1: number }> = [];

  /** E3.2: the four SIDE pieces (port-level stubs + riser/descender
   * verticals) must strictly clear the FULL box set — a vertical entering a
   * hull would cross its horizontal border (wrongFace). A box containing a
   * whole piece is an ENCLOSING container (the shared-ancestor stack —
   * legal); a box containing a piece's anchor point is that endpoint's own
   * ancestor stack (the run starts ON its face — legal). The LANE horizontal
   * itself must strictly avoid every LEAF frame and stay LANE_MARGIN clear
   * of every hull's horizontal border, but MAY transit hull interiors
   * through their vertical faces (tier-2 strips). */
  const laneRunsClear = (
    lastSrcFace: FaceRef,
    firstTgtFace: FaceRef,
    exitY: number,
    entryY: number,
    riserX: number,
    descX: number,
    laneY: number,
  ): boolean => {
    const pieces: Array<{
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      ax: number;
      ay: number;
    }> = [
      {
        x0: lastSrcFace.x,
        y0: exitY,
        x1: riserX,
        y1: exitY,
        ax: lastSrcFace.x,
        ay: exitY,
      },
      {
        x0: riserX,
        y0: exitY,
        x1: riserX,
        y1: laneY,
        ax: lastSrcFace.x,
        ay: exitY,
      },
      {
        x0: descX,
        y0: laneY,
        x1: descX,
        y1: entryY,
        ax: firstTgtFace.x,
        ay: entryY,
      },
      {
        x0: descX,
        y0: entryY,
        x1: firstTgtFace.x,
        y1: entryY,
        ax: firstTgtFace.x,
        ay: entryY,
      },
    ];
    for (const b of allBoxes) {
      for (const p of pieces) {
        if (boxContainsSeg(p.x0, p.y0, p.x1, p.y1, b)) {
          continue;
        }
        if (containsPointTol(b, p.ax, p.ay)) {
          continue;
        }
        if (axisSegEntersBox(p.x0, p.y0, p.x1, p.y1, b)) {
          return false;
        }
      }
    }
    const lx0 = Math.min(riserX, descX);
    const lx1 = Math.max(riserX, descX);
    for (const b of leafBoxesAll) {
      if (axisSegEntersBox(lx0, laneY, lx1, laneY, b)) {
        return false;
      }
    }
    for (const b of hullBoxesAll) {
      if (b.x >= lx1 - 0.5 || b.x + b.width <= lx0 + 0.5) {
        continue;
      }
      if (
        Math.abs(laneY - b.y) < STRATA_CLIP_LANE_MARGIN_PX - 0.5 ||
        Math.abs(laneY - (b.y + b.height)) < STRATA_CLIP_LANE_MARGIN_PX - 0.5
      ) {
        return false; // lane hugging / grazing a hull's horizontal border
      }
    }
    return true;
  };

  /**
   * E3.2 CROSSING-AWARE STRIP SELECTION. Candidate laneYs are the gaps in the
   * Y-interval union of the FULL obstacle set over the lane's estimated
   * X-span (every leaf/hull box whose X-interval intersects it — boxes
   * containing BOTH ports are the enclosing shared-ancestor stack, exempt),
   * plus the two unbounded gaps past the stack. Within a strip, the first
   * conflict-free 16px slot against already-placed lanes is taken (bounded
   * strips alternate around the centre; open strips walk away from the
   * stack). Each feasible candidate — slot, corridors (nested outward by
   * slot), full five-piece verification — is scored by pair-once crossings
   * against every already-placed edge, then |laneY−exitY|+|laneY−entryY|,
   * then laneY (all ascending); minimal wins. Returns null when no strip
   * admits a verified lane.
   */
  const lanePlacementFor = (
    plan: Plan,
    lastSrcFace: FaceRef,
    firstTgtFace: FaceRef,
    exitY: number,
    entryY: number,
  ): { laneY: number; riserX: number; descX: number } | null => {
    const bounds = laneContextOf(plan.sharedId).bounds;
    const estLo =
      Math.min(lastSrcFace.x, firstTgtFace.x) - STRATA_CLIP_LANE_SPAN_PAD_PX;
    const estHi =
      Math.max(lastSrcFace.x, firstTgtFace.x) + STRATA_CLIP_LANE_SPAN_PAD_PX;
    type Gap = { lo: number; hi: number };
    const gapsOf = (intervals: Array<[number, number]>): Gap[] => {
      intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const merged: Array<[number, number]> = [];
      for (const [lo, hi] of intervals) {
        const last = merged[merged.length - 1];
        if (last && lo <= last[1] + 1) {
          last[1] = Math.max(last[1], hi);
        } else {
          merged.push([lo, hi]);
        }
      }
      const gaps: Gap[] = [];
      if (merged.length === 0) {
        gaps.push({ lo: -Infinity, hi: Infinity });
      } else {
        gaps.push({ lo: -Infinity, hi: merged[0]![0] });
        for (let i = 0; i + 1 < merged.length; i++) {
          gaps.push({ lo: merged[i]![1], hi: merged[i + 1]![0] });
        }
        gaps.push({ lo: merged[merged.length - 1]![1], hi: Infinity });
      }
      return gaps;
    };
    const inSpan = (b: StrataBox): boolean =>
      !(b.x + b.width <= estLo + 0.5 || b.x >= estHi - 0.5);
    const containsBothPorts = (b: StrataBox): boolean =>
      containsPointTol(b, lastSrcFace.x, exitY) &&
      containsPointTol(b, firstTgtFace.x, entryY);
    // TIER 1 — strict full-union strips: gaps in the Y-union of EVERY
    // leaf/hull box over the span (both-port containers = the enclosing
    // shared-ancestor stack, exempt). The lane sits OUTSIDE every frame.
    const t1Intervals: Array<[number, number]> = [];
    for (const b of allBoxes) {
      if (!inSpan(b) || containsBothPorts(b)) {
        continue;
      }
      t1Intervals.push([b.y, b.y + b.height]);
    }
    const t1Gaps = gapsOf(t1Intervals);
    // TIER 2 — hull-transit strips: leaf-free rows. Obstacles are the LEAF
    // frames plus every hull's horizontal-BORDER band (±LANE_MARGIN — the
    // lane may transit a hull's interior via its vertical faces but must
    // neither cross nor hug a horizontal border). Preferred only when it
    // saves crossings (the score tuple ranks tier AFTER crossings).
    const t2Intervals: Array<[number, number]> = [];
    for (const b of leafBoxesAll) {
      if (!inSpan(b)) {
        continue;
      }
      t2Intervals.push([b.y, b.y + b.height]);
    }
    for (const b of hullBoxesAll) {
      if (!inSpan(b)) {
        continue;
      }
      t2Intervals.push([
        b.y - STRATA_CLIP_LANE_MARGIN_PX,
        b.y + STRATA_CLIP_LANE_MARGIN_PX,
      ]);
      t2Intervals.push([
        b.y + b.height - STRATA_CLIP_LANE_MARGIN_PX,
        b.y + b.height + STRATA_CLIP_LANE_MARGIN_PX,
      ]);
    }
    const sameEdgeY = (a: number, b: number): boolean =>
      a === b || Math.abs(a - b) < 0.5;
    const t2Gaps = gapsOf(t2Intervals).filter(
      (g) =>
        !t1Gaps.some((t) => sameEdgeY(t.lo, g.lo) && sameEdgeY(t.hi, g.hi)),
    );
    const slotY = (g: Gap, base: number, k: number): number | null => {
      if (g.lo === -Infinity) {
        return base - k * STRATA_CLIP_LANE_SEPARATION_PX;
      }
      if (g.hi === Infinity) {
        return base + k * STRATA_CLIP_LANE_SEPARATION_PX;
      }
      const step = Math.ceil(k / 2) * STRATA_CLIP_LANE_SEPARATION_PX;
      if (step > g.hi - g.lo) {
        return null; // strip exhausted
      }
      return k % 2 === 1 ? base - step : base + step;
    };

    let best: {
      crossings: number;
      tier: number;
      dist: number;
      laneY: number;
      riserX: number;
      descX: number;
    } | null = null;
    const tiers: Array<[number, Gap[]]> = [
      [0, t1Gaps],
      [1, t2Gaps],
    ];
    for (const [tier, gaps] of tiers) {
      for (const g of gaps) {
        const usableLo =
          g.lo === -Infinity ? -Infinity : g.lo + STRATA_CLIP_LANE_MARGIN_PX;
        const usableHi =
          g.hi === Infinity ? Infinity : g.hi - STRATA_CLIP_LANE_MARGIN_PX;
        const base =
          g.lo === -Infinity && g.hi === Infinity
            ? (exitY + entryY) / 2
            : g.lo === -Infinity
            ? g.hi - STRATA_CLIP_LANE_CLEARANCE_PX
            : g.hi === Infinity
            ? g.lo + STRATA_CLIP_LANE_CLEARANCE_PX
            : (g.lo + g.hi) / 2;
        if (base < usableLo || base > usableHi) {
          continue; // strip too thin for a lane
        }
        let laneY: number | null = null;
        let slot = 0;
        for (let k = 0; k < 64; k++) {
          const cand = slotY(g, base, k);
          if (cand === null) {
            break;
          }
          if (cand < usableLo || cand > usableHi) {
            continue;
          }
          const conflict = placedLaneSegs.some(
            (s) =>
              Math.abs(s.y - cand) < STRATA_CLIP_LANE_SEPARATION_PX - 0.5 &&
              s.x0 < estHi &&
              estLo < s.x1,
          );
          if (!conflict) {
            laneY = cand;
            slot = k;
            break;
          }
        }
        if (laneY === null || !laneFits(laneY, bounds)) {
          continue;
        }
        const desired = plan.outStub + slot * STRATA_CLIP_LANE_SEPARATION_PX;
        const riserX = corridorXFull(
          lastSrcFace.x,
          exitY,
          laneY,
          1,
          bounds,
          desired,
        );
        if (riserX === null) {
          continue;
        }
        const descX = corridorXFull(
          firstTgtFace.x,
          entryY,
          laneY,
          -1,
          bounds,
          desired,
        );
        if (descX === null) {
          continue;
        }
        if (
          !laneRunsClear(
            lastSrcFace,
            firstTgtFace,
            exitY,
            entryY,
            riserX,
            descX,
            laneY,
          )
        ) {
          continue;
        }
        const candPts = approxPtsOf(
          plan,
          laneMidOf({ riserX, descX, laneY }, exitY, entryY),
        );
        const crossings = scoreCandidate(plan.edgeId, candPts);
        const dist = Math.abs(laneY - exitY) + Math.abs(laneY - entryY);
        // Lexicographic (crossings, tier, dist, laneY) — crossings dominate;
        // an outside-all-frames tier-1 strip is preferred over a hull-transit
        // tier-2 strip that saves nothing; distance is the mild final term.
        if (
          !best ||
          crossings < best.crossings ||
          (crossings === best.crossings &&
            (tier < best.tier ||
              (tier === best.tier &&
                (dist < best.dist ||
                  (dist === best.dist && laneY < best.laneY)))))
        ) {
          best = { crossings, tier, dist, laneY, riserX, descX };
        }
      }
    }
    return best
      ? { laneY: best.laneY, riserX: best.riserX, descX: best.descX }
      : null;
  };

  /** Commit a strip placement: stamp `plan.lane` (direction attributed by the
   * lane's side of the port midline), record the lane segment for the strip
   * stagger, resolve the edge's scoring geometry. */
  const commitLane = (
    plan: Plan,
    placed: { laneY: number; riserX: number; descX: number },
    exitY: number,
    entryY: number,
  ): void => {
    plan.lane = {
      dir: placed.laneY <= (exitY + entryY) / 2 ? "above" : "below",
      riserX: placed.riserX,
      descX: placed.descX,
      laneY: placed.laneY,
    };
    placedLaneSegs.push({
      y: placed.laneY,
      x0: Math.min(placed.riserX, placed.descX),
      x1: Math.max(placed.riserX, placed.descX),
    });
    resolveApprox(
      plan.edgeId,
      approxPtsOf(plan, laneMidOf(placed, exitY, entryY)),
    );
  };

  type OrbitDraft = {
    plan: Plan;
    dir: "above" | "below";
    lastSrcFace: FaceRef;
    firstTgtFace: FaceRef;
    exitY: number;
    entryY: number;
    orbit: StrataBox;
    orbitKey: string;
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
    });
    return true;
  };

  // ── E3.2 lane candidate flow: clean Zs opt out first; the rest are
  // processed HEAVIEST-FIRST by face-to-face X-span (stable by edge id) so
  // the heavy full-span lanes get first pick of the best strips. A candidate
  // no strip admits falls back to the ORBIT queue, then to the E2.1
  // Z-detour (class a) / unstamped (class b). ──
  type LaneCandidate = {
    plan: Plan;
    lastSrcFace: FaceRef;
    firstTgtFace: FaceRef;
    exitY: number;
    entryY: number;
    spanEst: number;
  };
  const laneCandidates: LaneCandidate[] = [];
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
      resolveApprox(
        plan.edgeId,
        approxPtsOf(
          plan,
          zMidOf(plan, lastSrcFace, firstTgtFace, exitY, entryY),
        ),
      );
      continue;
    }
    laneCandidates.push({
      plan,
      lastSrcFace,
      firstTgtFace,
      exitY,
      entryY,
      spanEst: Math.abs(firstTgtFace.x - lastSrcFace.x),
    });
  }
  laneCandidates.sort(
    (a, b) => b.spanEst - a.spanEst || cmpStr(a.plan.edgeId, b.plan.edgeId),
  );
  for (const c of laneCandidates) {
    const placed = lanePlacementFor(
      c.plan,
      c.lastSrcFace,
      c.firstTgtFace,
      c.exitY,
      c.entryY,
    );
    if (placed) {
      commitLane(c.plan, placed, c.exitY, c.entryY);
      continue;
    }
    if (
      !enqueueOrbit(c.plan, c.lastSrcFace, c.firstTgtFace, c.exitY, c.entryY)
    ) {
      meta.laneFallback += 1; // class (a) → Z-detour; class (b) → skip
      if (c.plan.laneClass === "cross") {
        resolveApprox(
          c.plan.edgeId,
          approxPtsOf(
            c.plan,
            zMidOf(c.plan, c.lastSrcFace, c.firstTgtFace, c.exitY, c.entryY),
          ),
        );
      } else {
        dropApprox(c.plan.edgeId);
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
    // E3.2: ALL five orbit pieces are verified against the FULL box set (the
    // loop-2 hole: only the sharedId/topAncestorId context LEVELS were
    // checked, so a long exit run at port level could cut frames nested at
    // unchecked depths). Enclosing containers + each side's own anchor stack
    // are exempt exactly as for the in-place lanes.
    if (
      !laneRunsClear(
        d.lastSrcFace,
        d.firstTgtFace,
        d.exitY,
        d.entryY,
        riserX,
        descX,
        laneY,
      )
    ) {
      return false;
    }
    orbitCounts.set(key, k + 1);
    d.plan.lane = { dir: d.dir, riserX, descX, laneY };
    return true;
  };

  // ── Orbit fallback (strip-placement misses), stable by edge id. ──
  const orbitQueue = [...orbitDrafts].sort((a, b) =>
    cmpStr(a.plan.edgeId, b.plan.edgeId),
  );
  for (const d of orbitQueue) {
    if (allocateOrbit(d)) {
      const L = d.plan.lane!;
      placedLaneSegs.push({
        y: L.laneY,
        x0: Math.min(L.riserX, L.descX),
        x1: Math.max(L.riserX, L.descX),
      });
      resolveApprox(
        d.plan.edgeId,
        approxPtsOf(d.plan, laneMidOf(L, d.exitY, d.entryY)),
      );
    } else {
      meta.laneFallback += 1;
      if (d.plan.laneClass === "cross") {
        resolveApprox(
          d.plan.edgeId,
          approxPtsOf(
            d.plan,
            zMidOf(d.plan, d.lastSrcFace, d.firstTgtFace, d.exitY, d.entryY),
          ),
        );
      } else {
        dropApprox(d.plan.edgeId);
      }
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
  // (Gutter clearance measures against the shared `allBoxes` full-span set —
  // placement boxes ARE the rendered frame extents; see `laneContextOf`.)
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
    /** Interior route of a DIRTY gutter run: the E2.1 stub-hug column
     * (chain) / mid-gutter column (mid) when its vertical span already clears
     * every foreign box, else the nearest clear column rightward of it
     * (variable-width siblings make the naive X land INSIDE a wider box —
     * the corridor walk jumps past it). When no single column satisfies the
     * port-level constraints, a TWO-COLUMN dodge along a leaf-free row is
     * tried (pass C). Best-effort: the naive single column when everything
     * fails. */
    const dirtyGutterRoute = (
      from: FaceRef,
      to: FaceRef,
      yIn: number,
      yOut: number,
      kind: "chain" | "mid",
    ): Pt[] => {
      const w = to.x - from.x;
      const base =
        (kind === "chain" ? from.x + stubFor(w) : from.x + w / 2) +
        (globalStagger.get(edgeId) ?? 0);
      const yLo = Math.min(yIn, yOut);
      const yHi = Math.max(yIn, yOut);
      const blockers: XInterval[] = [];
      // E3.2: the dirty run is THREE segments — [from.x→vx] at the ENTRY port
      // level yIn, the vertical at vx, and [vx→to.x] at the EXIT level yOut.
      // Both port-level horizontals must clear too (the loop-2 lane-vs-frame
      // deep violations were exactly these runs cutting frames the old walk
      // ignored):
      //   • a box straddling yIn CAPS vx — the entry run must stop short of
      //     it (the old walk hopped past, leaving the entry horizontal
      //     cutting through);
      //   • a box straddling yOut FORCES vx past its right edge (blocker
      //     extended to from.x so the walk cannot settle left of it — the
      //     exit horizontal would cut it there);
      //   • boxes on the open vertical span stay plain column blockers.
      // Two passes: HARD honours the port-level constraints for every box;
      // when infeasible, the LEAF-HARD retry keeps them only for LEAF frames
      // (a port-level run through a hull's interior is a legal vertical-face
      // transit; through a leaf frame it is the gated violation). The
      // vertical's column blockers stay strict in both passes. Only then the
      // naive base (best-effort).
      let vxMaxHard = to.x;
      let vxMaxLeaf = to.x;
      const leafHard: XInterval[] = [];
      for (const b of allBoxes) {
        const isLeaf = leafBoxSet.has(b);
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
        const straddlesIn = b.y < yIn - 0.5 && by1 > yIn + 0.5;
        const straddlesOut = b.y < yOut - 0.5 && by1 > yOut + 0.5;
        if (straddlesIn && b.x > from.x + 0.5) {
          vxMaxHard = Math.min(vxMaxHard, b.x);
          if (isLeaf) {
            vxMaxLeaf = Math.min(vxMaxLeaf, b.x);
          }
        }
        blockers.push(
          straddlesOut ? { x0: from.x, x1: bx1 } : { x0: b.x, x1: bx1 },
        );
        leafHard.push(
          straddlesOut && isLeaf
            ? { x0: from.x, x1: bx1 }
            : { x0: b.x, x1: bx1 },
        );
      }
      // Crossing-scored column selection (E3.2): rather than first-fit, the
      // feasible clear columns (the naive seed + each blocker's right edge,
      // capped at 8) are scored pair-once against the resolved geometry —
      // ties broken by distance from the naive base, then x. Deterministic.
      const scoredColumn = (
        blks: XInterval[],
        limit: number,
      ): number | null => {
        const M = STRATA_CLIP_LANE_MARGIN_PX;
        const hi = Math.min(to.x, limit) - M;
        const cands: number[] = [];
        const pushCand = (c: number): void => {
          if (!(c > from.x + 1) || c > hi) {
            return;
          }
          if (blks.some((b) => c > b.x0 - M && c < b.x1 + M)) {
            return;
          }
          if (!cands.some((x) => Math.abs(x - c) < 0.5)) {
            cands.push(c);
          }
        };
        pushCand(Math.min(from.x + Math.max(2, base - from.x), hi));
        const rightEdges = blks.map((b) => b.x1 + M).sort((a, b) => a - b);
        for (const c of rightEdges) {
          if (cands.length >= 8) {
            break;
          }
          pushCand(c);
        }
        if (cands.length === 0) {
          return null;
        }
        let bestCol: { score: number; d: number; c: number } | null = null;
        for (const c of cands) {
          const score = scoreCandidate(edgeId, [
            [from.x, yIn],
            [c, yIn],
            [c, yOut],
            [to.x, yOut],
          ]);
          const dd = Math.abs(c - base);
          if (
            !bestCol ||
            score < bestCol.score ||
            (score === bestCol.score &&
              (dd < bestCol.d || (dd === bestCol.d && c < bestCol.c)))
          ) {
            bestCol = { score, d: dd, c };
          }
        }
        return bestCol!.c;
      };
      const single =
        scoredColumn(blockers, vxMaxHard) ?? scoredColumn(leafHard, vxMaxLeaf);
      if (single !== null) {
        return [
          [single, yIn],
          [single, yOut],
        ];
      }
      // ── pass C — TWO-COLUMN dodge (E3.2): both port levels are obstructed
      // in incompatible X-ranges (e.g. a leaf frame straddling the exit level
      // forces the column right while one straddling the entry level caps it
      // left). Drop early at vx1, cross the blocked stretch along a LEAF-FREE
      // row yMid (leaf boxes + hull horizontal-border bands leave a gap),
      // rise at vx2 past the exit-level obstruction. Deterministic: rows
      // nearest the port midline first; both column walks are monotone. ──
      const rows: Array<[number, number]> = [];
      for (const b of allBoxes) {
        const bx1 = b.x + b.width;
        if (bx1 <= from.x + 0.5 || b.x >= to.x - 0.5) {
          continue;
        }
        if (leafBoxSet.has(b)) {
          rows.push([b.y, b.y + b.height]);
        } else {
          rows.push([
            b.y - STRATA_CLIP_LANE_MARGIN_PX,
            b.y + STRATA_CLIP_LANE_MARGIN_PX,
          ]);
          rows.push([
            b.y + b.height - STRATA_CLIP_LANE_MARGIN_PX,
            b.y + b.height + STRATA_CLIP_LANE_MARGIN_PX,
          ]);
        }
      }
      rows.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const mergedRows: Array<[number, number]> = [];
      for (const [lo, hi] of rows) {
        const last = mergedRows[mergedRows.length - 1];
        if (last && lo <= last[1] + 1) {
          last[1] = Math.max(last[1], hi);
        } else {
          mergedRows.push([lo, hi]);
        }
      }
      const midLevel = (yIn + yOut) / 2;
      // Candidate rows may OVERSHOOT the port interval by a few clearances —
      // when every row between the ports is packed, a short backtrack to a
      // row just past a port level (e.g. the band gap right below the exit
      // port) still beats cutting a leaf frame. Verticals stay blocker-
      // checked, so an overshoot can never cross a border.
      const overshoot = 3 * STRATA_CLIP_LANE_CLEARANCE_PX;
      const yMids: number[] = [];
      for (let i = 0; i + 1 < mergedRows.length; i++) {
        const gLo = mergedRows[i]![1];
        const gHi = mergedRows[i + 1]![0];
        if (gHi - gLo < 2) {
          continue;
        }
        const c = (gLo + gHi) / 2;
        if (c > yLo - overshoot && c < yHi + overshoot) {
          yMids.push(c);
        }
      }
      yMids.sort(
        (a, b) => Math.abs(a - midLevel) - Math.abs(b - midLevel) || a - b,
      );
      /** One dodge column: clear vertical over (yA↔yB) inside (startX, to.x);
       * leaf boxes straddling `capLeafAt` cap it, leaf boxes straddling
       * `forceLeafAt` force it past their right edge. Hull port-level cuts
       * stay soft (legal vertical-face transits). */
      const dodgeColumn = (
        yA: number,
        yB: number,
        startX: number,
        capLeafAt: number | null,
        forceLeafAt: number | null,
        desired: number,
      ): number | null => {
        const lo2 = Math.min(yA, yB);
        const hi2 = Math.max(yA, yB);
        const blockers2: XInterval[] = [];
        let cap = to.x;
        for (const b of allBoxes) {
          const bx1 = b.x + b.width;
          const by1 = b.y + b.height;
          if (bx1 <= startX + 0.5 || b.x >= to.x - 0.5) {
            continue;
          }
          const isLeaf = leafBoxSet.has(b);
          if (
            isLeaf &&
            capLeafAt !== null &&
            b.y < capLeafAt - 0.5 &&
            by1 > capLeafAt + 0.5 &&
            b.x > startX + 0.5
          ) {
            cap = Math.min(cap, b.x);
          }
          const forced =
            isLeaf &&
            forceLeafAt !== null &&
            b.y < forceLeafAt - 0.5 &&
            by1 > forceLeafAt + 0.5;
          if (by1 <= lo2 + 0.5 || b.y >= hi2 - 0.5) {
            if (forced) {
              blockers2.push({ x0: startX, x1: bx1 });
            }
            continue;
          }
          if (
            b.x <= startX + 0.5 &&
            bx1 >= to.x - 0.5 &&
            b.y <= lo2 &&
            by1 >= hi2
          ) {
            continue; // enclosing ancestor
          }
          blockers2.push(
            forced ? { x0: startX, x1: bx1 } : { x0: b.x, x1: bx1 },
          );
        }
        return chooseCorridorX(
          startX,
          desired,
          1,
          blockers2,
          Math.min(to.x, cap),
        );
      };
      // Crossing-aware dodge selection: every feasible (yMid, vx1, vx2) is
      // scored pair-once against the resolved geometry (same kernel as the
      // lane strips) with |yMid − midline| then yMid as tie-breaks — a dodge
      // that threads a quiet row wins over one crossing a busy column.
      let bestDodge: {
        score: number;
        distMid: number;
        yMid: number;
        route: Pt[];
      } | null = null;
      for (const yMid of yMids) {
        const vx1 = dodgeColumn(yIn, yMid, from.x, yIn, null, base - from.x);
        if (vx1 === null) {
          continue;
        }
        const vx2 = dodgeColumn(
          yMid,
          yOut,
          vx1,
          null,
          yOut,
          stubFor(to.x - vx1),
        );
        if (vx2 === null) {
          continue;
        }
        const route: Pt[] = [
          [vx1, yIn],
          [vx1, yMid],
          [vx2, yMid],
          [vx2, yOut],
        ];
        const score = scoreCandidate(edgeId, [
          [from.x, yIn],
          ...route,
          [to.x, yOut],
        ]);
        const distMid = Math.abs(yMid - midLevel);
        if (
          !bestDodge ||
          score < bestDodge.score ||
          (score === bestDodge.score &&
            (distMid < bestDodge.distMid ||
              (distMid === bestDodge.distMid && yMid < bestDodge.yMid)))
        ) {
          bestDodge = { score, distMid, yMid, route };
        }
      }
      if (bestDodge) {
        return bestDodge.route;
      }
      // ── pass D — vertical-clear column only (the pre-E3.2 semantics): the
      // port-level constraints are unsatisfiable even with a dodge, so keep
      // at least the VERTICAL clear of every box (a vertical through a hull
      // would cross its horizontal border — wrongFace — strictly worse than
      // the residual port-level cut this accepts). ──
      const plain: XInterval[] = [];
      for (const b of allBoxes) {
        const bx1 = b.x + b.width;
        const by1 = b.y + b.height;
        if (bx1 <= from.x + 0.5 || b.x >= to.x - 0.5) {
          continue;
        }
        if (by1 <= yLo + 0.5 || b.y >= yHi - 0.5) {
          continue;
        }
        if (
          b.x <= from.x + 0.5 &&
          bx1 >= to.x - 0.5 &&
          b.y <= yLo &&
          by1 >= yHi
        ) {
          continue;
        }
        plain.push({ x0: b.x, x1: bx1 });
      }
      const vd = scoredColumn(plain, to.x) ?? base;
      return [
        [vd, yIn],
        [vd, yOut],
      ];
    };
    const lastSrc = src[src.length - 1]!;
    const firstTgt = tgt[0]!;
    /** Build the full polyline — the mid section is a lane (when given), the
     * Z-detour (cross class without a lane), or the plain nudged mid-gutter.
     * Parameterized so E3.2 staircase relief can compare both variants. */
    const buildPts = (
      lane: { riserX: number; descX: number; laneY: number } | null,
    ): Pt[] => {
      const pts: Pt[] = [];
      const pushGutterRun = (
        from: { face: FaceRef; y: number },
        to: { face: FaceRef; y: number },
        kind: "chain" | "mid",
      ): void => {
        const w = to.face.x - from.face.x;
        if (!gutterRunIsClear(from.face, to.face, from.y, to.y)) {
          pts.push(...dirtyGutterRoute(from.face, to.face, from.y, to.y, kind));
          return;
        }
        const raw = gutterTrack(
          from.face,
          to.face,
          edgeId,
          (from.y + to.y) / 2,
        );
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
      const emitSide = (
        crossings: Array<{ face: FaceRef; y: number }>,
      ): void => {
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
      if (lane) {
        // E2.4 lane: rise in the clear corridor beside the source's outermost
        // face, travel the lane, descend beside the target's outermost face.
        const { riserX, descX, laneY } = lane;
        pts.push([riserX, lastSrc.y]);
        pts.push([riserX, laneY]);
        pts.push([descX, laneY]);
        pts.push([descX, firstTgt.y]);
      } else if (plan.laneClass === "cross") {
        // Clean-Z cross edge (or lane fallback): the E2.1 Z-detour — a
        // vertical run right of every source-side face, a horizontal run at a
        // Y BETWEEN the two outer boxes when a gap exists, then a vertical
        // run left of every target-side face.
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
      return pts;
    };
    /** polylineLength / chordLength of a built polyline (1 when degenerate). */
    const detourRatioOf = (poly: readonly Pt[]): number => {
      if (poly.length < 2) {
        return 1;
      }
      const first = poly[0]!;
      const last = poly[poly.length - 1]!;
      const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
      if (chord < 1) {
        return 1;
      }
      let len = 0;
      for (let i = 0; i + 1 < poly.length; i++) {
        len += Math.hypot(
          poly[i + 1]![0] - poly[i]![0],
          poly[i + 1]![1] - poly[i]![1],
        );
      }
      return len / chord;
    };

    let simplified = simplifyPolyline(buildPts(plan.lane ?? null));

    // ── E3.2 STAIRCASE RELIEF: a non-lane route (plain mid-gutter or a
    // clean-Z that never attempted a lane) whose polyline exceeds
    // STAIRCASE_RATIO × its chord attempts the same strip machinery; the lane
    // is adopted only when it strictly lowers the ratio. Cross-class edges
    // that already FAILED a lane attempt are not retried. ──
    if (!plan.lane && (plan.laneClass === null || plan.zClean === true)) {
      const ratio = detourRatioOf(simplified);
      if (ratio > STRATA_CLIP_STAIRCASE_RATIO) {
        const placed = lanePlacementFor(
          plan,
          lastSrc.face,
          firstTgt.face,
          lastSrc.y,
          firstTgt.y,
        );
        if (placed) {
          const laneSimplified = simplifyPolyline(buildPts(placed));
          if (detourRatioOf(laneSimplified) < ratio) {
            commitLane(plan, placed, lastSrc.y, firstTgt.y);
            simplified = laneSimplified;
            meta.staircaseRelieved += 1;
          }
        }
      }
    }
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
