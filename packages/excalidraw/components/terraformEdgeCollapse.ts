import type { ExcalidrawElement } from "@excalidraw/element/types";

/**
 * Edge-collapse invariant (deband-hash-anomaly.md fix #1).
 *
 * The strata engine nondeterministically produces scenes whose declared
 * dataflow edges leave NO spanning connector geometry — the routed poly-line
 * (~1.18M chars of `points` on the healthy branch) is simply absent — while
 * `renderedCrossings`/`pierce`, which read `customData.relationship` ENDPOINTS
 * (not `element.points`), score IDENTICALLY on the collapsed and healthy scene.
 * Every scalar metric is blind to it.
 *
 * The FIX (why the earlier relationship-keyed span check was a no-op): the
 * declared edges are emitted as 2-point skeletons `points:[[0,0],[dx,dy]]` and,
 * on the headless import path, arrive soft-deleted (edge-layer pins all-false);
 * `repairTerraformEdgeBindings` skips `isDeleted`, so those skeletons are NEVER
 * rewritten and keep spanning `dx,dy` BY CONSTRUCTION. Measuring their span
 * therefore reports 145/145 spanning on a genuinely collapsed scene. The real
 * healthy/collapsed delta lives on the NON-deleted, visible routed linear
 * geometry. So the invariant counts **non-deleted (rendered/visible) spanning
 * linear elements** (arrow OR line) and compares that against the declared-edge
 * population (`pierceEdgeCount`): on a collapsed scene the numerator is 0 (max
 * non-deleted linear span 53px — icon strokes only); on a healthy scene the
 * routed connectors push it toward the declared count.
 */

/**
 * Span threshold, px. Sits just above the 53px max icon-stroke span the anomaly
 * doc measured, so decorative arrowheads / glyph strokes (all <= 53px) can never
 * be miscounted as spanning edge connectors.
 */
export const EDGE_SPAN_MIN_PX = 64;

/**
 * Catastrophic-collapse floor: fire only when < 10% of the declared-edge
 * population has any spanning visible geometry (the observed anomaly is 100%
 * collapse). Conservative so a merely dense-but-valid layout — which still
 * routes most edges across the canvas — never false-positives.
 */
export const EDGE_COLLAPSE_MAX_SPANNING_FRACTION = 0.1;

/**
 * Minimum declared-edge population below which a "collapse" verdict is
 * statistically meaningless. A preset with only a handful of relationships whose
 * connected nodes legitimately sit close together produces short (< 64px)
 * connectors that are NOT a collapse — e.g. a single valid edge whose clipped
 * connector is under 64px must not be classified as collapsed. Below this floor
 * the invariant never fires, eliminating the sparse-scene false-positive.
 */
export const EDGE_COLLAPSE_MIN_POPULATION = 8;

/** Max horizontal/vertical extent of a linear element's local polyline, px. */
const linearSpanPx = (e: ExcalidrawElement): number => {
  const pts = (e as { points?: ReadonlyArray<readonly [number, number]> })
    .points;
  if (!Array.isArray(pts) || pts.length < 2) {
    return 0;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  return Math.max(maxX - minX, maxY - minY);
};

export type EdgeCollapseStats = {
  /** Denominator: the declared-edge population (pass `pierceEdgeCount`). */
  declaredEdgeCount: number;
  /**
   * Numerator: NON-deleted linear elements (arrow OR line) whose local polyline
   * spans >= EDGE_SPAN_MIN_PX. Icon strokes (<= 53px) are excluded by threshold.
   */
  spanningVisibleLinearCount: number;
  /** `spanningVisibleLinearCount / declaredEdgeCount`, 3dp (0 when no edges). */
  edgeSpanningFraction: number;
  /** `true` only above the population floor AND below the spanning fraction. */
  edgeCollapseDetected: boolean;
};

/**
 * @param elements the scene elements (soft-deleted included — they are skipped).
 * @param declaredEdgeCount the declared-edge denominator, i.e. `pierceEdgeCount`.
 */
export const detectEdgeCollapse = (
  elements: ReadonlyArray<ExcalidrawElement>,
  declaredEdgeCount: number,
): EdgeCollapseStats => {
  let spanningVisibleLinearCount = 0;
  for (const e of elements) {
    if (e.isDeleted) {
      continue;
    }
    if (e.type !== "arrow" && e.type !== "line") {
      continue;
    }
    if (linearSpanPx(e) >= EDGE_SPAN_MIN_PX) {
      spanningVisibleLinearCount += 1;
    }
  }
  const edgeSpanningFraction =
    declaredEdgeCount > 0
      ? Number((spanningVisibleLinearCount / declaredEdgeCount).toFixed(3))
      : 0;
  const edgeCollapseDetected =
    declaredEdgeCount >= EDGE_COLLAPSE_MIN_POPULATION &&
    spanningVisibleLinearCount <
      Math.max(1, declaredEdgeCount * EDGE_COLLAPSE_MAX_SPANNING_FRACTION);
  return {
    declaredEdgeCount,
    spanningVisibleLinearCount,
    edgeSpanningFraction,
    edgeCollapseDetected,
  };
};
