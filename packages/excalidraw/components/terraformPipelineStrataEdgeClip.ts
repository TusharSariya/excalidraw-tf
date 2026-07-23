/**
 * Strata CONTAINER-CLIP edge pass (loop-2 E2.1+E2.2 — Graphviz lhead/ltail
 * semantics). A post-geometry rewrite alongside the channel / around-boxes /
 * border routers, but with a DIFFERENT endpoint contract: a declared dataflow
 * edge's arrow TERMINATES ON the border of the target's immediate containment
 * box (its leaf cluster frame) and ORIGINATES ON the source's leaf-cluster
 * frame border — a TRUE clip, not a card-to-card chord. Egress is the source
 * frame's RIGHT face ONLY; ingress is the target frame's LEFT face ONLY —
 * never top/bottom (the LR port discipline; wrongFaceCrossings from clipped
 * edges is ≈ 0 by construction).
 *
 * Intermediate hulls between the two clusters (vpc / region / account — the
 * UNSHARED ancestor hulls of each endpoint) get perpendicular port-crossing
 * waypoints: the source side crosses each hull's RIGHT face inner→outer, the
 * target side crosses each hull's LEFT face outer→inner. Every face crossing
 * is a horizontal segment (perpendicular to the vertical face), pinned by a
 * horizontal tangent STUB just outside/inside the face; vertical adjustment
 * between consecutive crossings happens strictly BETWEEN faces.
 *
 * PORT ASSIGNMENT (per face, across ALL clipped edges sharing that face): each
 * edge's desired y = the barycenter of the OPPOSITE endpoint's y (its leaf-box
 * centre). Edges on a face are sorted by desired y (stable tie-break by edge
 * id), then spread with ≥{@link STRATA_CLIP_PORT_SEPARATION_PX} separation —
 * clamped to faceHeight/(n+1) on crowded faces — inside a
 * {@link STRATA_CLIP_PORT_INSET_PX} corner inset (itself clamped on short
 * faces).
 *
 * STUBS: horizontal tangent stubs {@link STRATA_CLIP_STUB_MIN_PX}–
 * {@link STRATA_CLIP_STUB_MAX_PX}px outside each face pin the
 * arrival/departure tangents horizontal; in narrow gutters the stub scales to
 * min(48, gutterWidth/3) and is always capped at half the available gap so a
 * stub can never overshoot the next face.
 *
 * SKIPS (this pass's contract, loop-2): net-BACKWARD edges (target column left
 * of source column) are left UNSTAMPED for the existing style-pass orbit —
 * loop-2's E2.4 lanes own them later. Same-column edges likewise. Both are
 * counted in the meta.
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
 * Bindings REMAIN on the leaf cards exactly as today.
 *
 * ROUNDNESS: the arrow's existing `roundness` (the shared TFD emitter's
 * `{type:2}`) is deliberately KEPT — orthogonal corners get properly smoothed
 * in loop 3; this pass never adds or removes roundness.
 *
 * Determinism (C4′): no RNG, no clock. Edge order = skeleton emission order;
 * port order = (desiredY, edge id); all helpers are pure sorts. Clearances are
 * computed inside functions (SDEC-34 NaN hazard).
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
 * crowded-face clamp to faceHeight/(n+1). */
export const STRATA_CLIP_PORT_SEPARATION_PX = 12;
/** Corner inset: no port sits closer than this to a face's corners (clamped
 * to a quarter of the face on short faces). */
export const STRATA_CLIP_PORT_INSET_PX = 20;
/** Horizontal tangent stub bounds (px) outside each crossed face. */
export const STRATA_CLIP_STUB_MIN_PX = 24;
export const STRATA_CLIP_STUB_MAX_PX = 48;

export type StrataEdgeClipMeta = {
  /** Eligible net-forward cross-cluster edges rewritten to a clip polyline. */
  clipped: number;
  /** Net-backward (target column left of source) edges left unstamped for the
   * style-pass orbit (E2.4 lanes own them later). */
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
 * clamp against the bottom — the standard 1-D label-spread).
 */
const assignFacePorts = (
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

/**
 * Scene-level pass: rewrite, IN PLACE in the skeleton array, every eligible
 * net-forward cross-cluster TFD arrow into a container-clip polyline
 * [sourceFrame R-face port, stub, source-side hull R-ports inner→outer,
 * gutter travel, target-side hull L-ports outer→inner, stub, targetFrame
 * L-face port]. `points`/`x`/`y`/`width`/`height`/`customData` change —
 * `roundness` and card skeletons are untouched. Endpoints sit ON the frame
 * borders (the clip): `el.x`/`el.y` re-origin at the source port so
 * `points[0] === [0,0]` survives `convertToExcalidrawElements`'s
 * re-normalization (the E1.2/E1.5 write-back pattern).
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
  };

  const chains = leafHullChainsOf(model.hullRoot);
  const { columnOf } = deriveStrataColumns(placement);

  type Plan = {
    index: number;
    el: ArrowSkeleton;
    rel: { source: string; target: string };
    srcBox: StrataBox;
    tgtBox: StrataBox;
    /** Source-side unshared hull faces, inner→outer (RIGHT faces). */
    srcFaces: FaceRef[];
    /** Target-side unshared hull faces, outer→inner (LEFT faces). */
    tgtFaces: FaceRef[];
    /** Outermost boxes for the cross-band mid-gutter clearance. */
    srcOuterBox: StrataBox;
    tgtOuterBox: StrataBox;
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
    if (srcCol > tgtCol) {
      meta.skippedBackward += 1; // net-backward — E2.4 lanes own it later
      continue;
    }

    // Unshared ancestor hulls: the containers this edge genuinely crosses.
    const srcChain = chains.get(rel.source) ?? [];
    const tgtChain = chains.get(rel.target) ?? [];
    const tgtSet = new Set(tgtChain);
    const srcSet = new Set(srcChain);
    // Source side: root-first chain filtered → reversed = inner→outer.
    const srcUnshared = srcChain.filter((h) => !tgtSet.has(h)).reverse();
    // Target side: root-first chain filtered = outer→inner.
    const tgtUnshared = tgtChain.filter((h) => !srcSet.has(h));

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
    const srcFaces = srcUnshared
      .map((h) => hullFace(h, "right"))
      .filter((f): f is FaceRef => f !== null);
    const tgtFaces = tgtUnshared
      .map((h) => hullFace(h, "left"))
      .filter((f): f is FaceRef => f !== null);

    const srcCenterY = srcBox.y + srcBox.height / 2;
    const tgtCenterY = tgtBox.y + tgtBox.height / 2;
    const edgeId = String((el as { id?: unknown }).id ?? `edge-${i}`);

    // Register ports: barycenter of the OPPOSITE endpoint's y, per face.
    registerPort(
      {
        key: rel.source,
        side: "right",
        x: srcBox.x + srcBox.width,
        y0: srcBox.y,
        y1: srcBox.y + srcBox.height,
      },
      edgeId,
      tgtCenterY,
    );
    for (const f of srcFaces) {
      registerPort(f, edgeId, tgtCenterY);
    }
    for (const f of tgtFaces) {
      registerPort(f, edgeId, srcCenterY);
    }
    registerPort(
      {
        key: rel.target,
        side: "left",
        x: tgtBox.x,
        y0: tgtBox.y,
        y1: tgtBox.y + tgtBox.height,
      },
      edgeId,
      srcCenterY,
    );

    const srcOuterBox =
      srcFaces.length > 0
        ? placement.boxedHulls.get(srcFaces[srcFaces.length - 1]!.key)!.box
        : srcBox;
    const tgtOuterBox =
      tgtFaces.length > 0
        ? placement.boxedHulls.get(tgtFaces[0]!.key)!.box
        : tgtBox;

    plans.push({
      index: i,
      el,
      rel,
      srcBox,
      tgtBox,
      srcFaces,
      tgtFaces,
      srcOuterBox,
      tgtOuterBox,
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

  // ── Build each polyline. ──
  for (const plan of plans) {
    const { rel, srcBox, tgtBox, srcFaces, tgtFaces } = plan;
    const edgeId = String(
      (plan.el as { id?: unknown }).id ?? `edge-${plan.index}`,
    );
    const srcCenterY = srcBox.y + srcBox.height / 2;
    const tgtCenterY = tgtBox.y + tgtBox.height / 2;

    const sx = srcBox.x + srcBox.width; // source R face (the clip origin)
    const ex = tgtBox.x; // target L face (the clip terminus)
    const sy = portY({ key: rel.source, side: "right" }, edgeId, srcCenterY);
    const ey = portY({ key: rel.target, side: "left" }, edgeId, tgtCenterY);

    // Source-side crossing sequence: leaf R face, then unshared hull R faces
    // inner→outer. Keep only faces that genuinely lie rightward of the
    // previous crossing — a degenerate (non-monotone) hull face cannot be
    // crossed perpendicular by a rightward run and is dropped defensively.
    const srcSeq: Array<{ x: number; y: number }> = [{ x: sx, y: sy }];
    for (const f of srcFaces) {
      if (f.x > srcSeq[srcSeq.length - 1]!.x + 1) {
        srcSeq.push({ x: f.x, y: portY(f, edgeId, tgtCenterY) });
      }
    }
    // Target-side crossing sequence: unshared hull L faces outer→inner, then
    // the leaf L face — monotone-filtered the same way (each face must lie
    // leftward of the crossing AFTER it).
    const tgtSeq: Array<{ x: number; y: number }> = [{ x: ex, y: ey }];
    for (let i = tgtFaces.length - 1; i >= 0; i--) {
      const f = tgtFaces[i]!;
      if (f.x < tgtSeq[0]!.x - 1) {
        tgtSeq.unshift({ x: f.x, y: portY(f, edgeId, srcCenterY) });
      }
    }

    // Source half: cross each face horizontally at its port y; vertical
    // adjustment happens at the stub X strictly BETWEEN faces.
    const pts: Pt[] = [];
    for (let i = 0; i < srcSeq.length; i++) {
      const cur = srcSeq[i]!;
      pts.push([cur.x, cur.y]);
      const next = srcSeq[i + 1];
      if (next) {
        const stub = stubFor(next.x - cur.x);
        pts.push([cur.x + stub, cur.y]);
        pts.push([cur.x + stub, next.y]);
      }
    }
    const lastSrc = srcSeq[srcSeq.length - 1]!;
    const firstTgt = tgtSeq[0]!;
    // Departure stub past the outermost source face + arrival stub before the
    // outermost target face (horizontal tangents at both).
    const midGap = firstTgt.x - lastSrc.x;
    const outStub = stubFor(midGap > 0 ? midGap : STRATA_CLIP_STUB_MIN_PX * 3);
    const ax = lastSrc.x + outStub;
    const bx = firstTgt.x - outStub;
    pts.push([ax, lastSrc.y]);
    if (bx >= ax) {
      // Normal forward gutter: vertical travel at mid-gutter X.
      const mx = (ax + bx) / 2;
      pts.push([mx, lastSrc.y]);
      pts.push([mx, firstTgt.y]);
    } else {
      // X-overlapping outer containers (e.g. cross-band): clear the overlap
      // with a vertical run at ax (right of every source-side face), a
      // horizontal run at a Y BETWEEN the two outer boxes when a gap exists,
      // then a vertical run at bx (left of every target-side face).
      const s = plan.srcOuterBox;
      const t = plan.tgtOuterBox;
      let my = (lastSrc.y + firstTgt.y) / 2;
      if (t.y >= s.y + s.height) {
        my = (s.y + s.height + t.y) / 2; // target below source: between bands
      } else if (s.y >= t.y + t.height) {
        my = (t.y + t.height + s.y) / 2; // target above source
      }
      pts.push([ax, my]);
      pts.push([bx, my]);
    }
    pts.push([bx, firstTgt.y]);
    // Target half (mirror of the source half).
    for (let i = 0; i < tgtSeq.length; i++) {
      const cur = tgtSeq[i]!;
      pts.push([cur.x, cur.y]);
      const next = tgtSeq[i + 1];
      if (next) {
        const stub = stubFor(next.x - cur.x);
        pts.push([cur.x + stub, cur.y]);
        pts.push([cur.x + stub, next.y]);
      }
    }

    let simplified = simplifyPolyline(pts);
    if (simplified.length < 3) {
      // Degenerate exactly-straight clip (same port y throughout): keep the
      // exit stub as an explicit collinear interior waypoint so the stamped
      // polyline stays >2 points (repair's `points.length > 2` gate) — the
      // E1.2 channel-router pattern; rendered geometry is unchanged.
      const span = Math.abs(ex - sx);
      const stubX = sx + Math.min(outStub, span / 2);
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
  }

  return meta;
}
