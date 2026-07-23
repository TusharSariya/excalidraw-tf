/**
 * Pure edge-anchor geometry shared by the repair pass and the strata edge-style
 * pass.
 *
 * Extracted verbatim from `repairTerraformEdgeBindings` (terraformVisibility.ts):
 * the centre-clipped chord anchors + the perpendicular structural-dependency
 * offset. The point is a SINGLE source of truth for "where does a Terraform
 * data-flow chord attach to its two cards" — the style pass stamps the styled
 * polyline on these anchors at SKELETON time, and the repair pass re-derives the
 * SAME anchors at ELEMENT time when it validates the routed-polyline marker
 * (`ROUTED_ANCHOR_TOLERANCE`). Because both sides compute identical endpoints,
 * repair's validate-before-trust gate passes by construction and never flattens
 * a styled curve back to a straight chord.
 *
 * Geometry + types ONLY — no app / scene / element imports. Keeps this a leaf
 * module callable from the skeleton-time style pass and the element-time repair
 * pass alike, and honours the edge-style module's SDEC-34 self-containment rule.
 */

/** Minimal rect shape both a skeleton rectangle and a bound card element satisfy. */
export type EdgeAnchorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ChordAnchorPoints = {
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
};

/**
 * Perpendicular offset (px) applied to a data-flow chord when the same
 * source/target pair ALSO carries a structural dependency line, so the two do
 * not overlap. Mirrors the literal previously inlined in
 * `repairTerraformEdgeBindings`.
 */
export const TERRAFORM_STRUCTURAL_DEP_CHORD_OFFSET_PX = 18;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const getEdgePointTowardTarget = (
  pos: { x: number; y: number },
  w: number,
  h: number,
  target: { x: number; y: number },
) => {
  const cx = pos.x + w / 2;
  const cy = pos.y + h / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;

  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return {
      x: cx,
      y: cy,
      fixedPoint: [0.5, 0.5] as [number, number],
    };
  }

  const halfW = Math.max(w / 2, 1e-6);
  const halfH = Math.max(h / 2, 1e-6);
  const scale = 1 / Math.max(Math.abs(dx) / halfW, Math.abs(dy) / halfH);
  const x = cx + dx * scale;
  const y = cy + dy * scale;

  return {
    x,
    y,
    fixedPoint: [
      clamp((x - pos.x) / w, 0, 1),
      clamp((y - pos.y) / h, 0, 1),
    ] as [number, number],
  };
};

export const getCenterClippedBindingPoints = (
  posA: { x: number; y: number },
  posB: { x: number; y: number },
  wA: number,
  hA: number,
  wB: number,
  hB: number,
) => {
  const centerA = { x: posA.x + wA / 2, y: posA.y + hA / 2 };
  const centerB = { x: posB.x + wB / 2, y: posB.y + hB / 2 };

  const start = getEdgePointTowardTarget(posA, wA, hA, centerB);
  const end = getEdgePointTowardTarget(posB, wB, hB, centerA);

  return {
    startPoint: { x: start.x, y: start.y },
    endPoint: { x: end.x, y: end.y },
    startFixed: [0.5, 0.5] as [number, number],
    endFixed: [0.5, 0.5] as [number, number],
  };
};

export const offsetLineSegment = (
  startPoint: { x: number; y: number },
  endPoint: { x: number; y: number },
  offset: number,
) => {
  if (!offset) {
    return { startPoint, endPoint };
  }

  const dx = endPoint.x - startPoint.x;
  const dy = endPoint.y - startPoint.y;
  const length = Math.hypot(dx, dy) || 1;
  const offsetX = (-dy / length) * offset;
  const offsetY = (dx / length) * offset;

  return {
    startPoint: { x: startPoint.x + offsetX, y: startPoint.y + offsetY },
    endPoint: { x: endPoint.x + offsetX, y: endPoint.y + offsetY },
  };
};

export const fixedPointForAbsolutePoint = (
  rect: EdgeAnchorRect,
  point: { x: number; y: number },
): [number, number] => {
  const w = rect.width || 1;
  const h = rect.height || 1;
  return [
    clamp((point.x - rect.x) / w, 0, 1),
    clamp((point.y - rect.y) / h, 0, 1),
  ];
};

/**
 * The centre-clipped chord endpoints between two cards, with the
 * structural-dependency perpendicular offset applied when the pair carries a
 * structural dependency line. This is the EXACT computation
 * `repairTerraformEdgeBindings` runs for a data-flow / declared-data-flow edge
 * (terraformVisibility.ts ELSE branch): compute the centre-clip anchors, then
 * shift both endpoints by {@link TERRAFORM_STRUCTURAL_DEP_CHORD_OFFSET_PX} when
 * `structuralPair` is set (else 0 ⇒ unchanged).
 *
 * The style pass calls this at skeleton time to place the styled polyline's
 * endpoints; repair re-derives the identical points at element time, so the
 * routed-polyline validate-before-trust gate passes without flattening.
 */
export function computeTerraformChordAnchors(
  rectA: EdgeAnchorRect,
  rectB: EdgeAnchorRect,
  opts: { structuralPair: boolean },
): ChordAnchorPoints {
  const posA = { x: rectA.x, y: rectA.y };
  const posB = { x: rectB.x, y: rectB.y };
  const raw = getCenterClippedBindingPoints(
    posA,
    posB,
    rectA.width,
    rectA.height,
    rectB.width,
    rectB.height,
  );
  const offset = opts.structuralPair
    ? TERRAFORM_STRUCTURAL_DEP_CHORD_OFFSET_PX
    : 0;
  return offsetLineSegment(raw.startPoint, raw.endPoint, offset);
}
