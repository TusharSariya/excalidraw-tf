/**
 * Draw-time focus wash descriptor (E08 — focus wash overlay experiment).
 *
 * When the opt-in `terraformFocusWashOverlay` runtime toggle is ON, relationship
 * focus no longer re-clones ~6.5k elements to blend their colors toward the
 * background (the click-storm churn driver). Instead the dimming is applied at
 * DRAW TIME: `applyTerraformRelationshipFocus` publishes a descriptor here (a map
 * of per-element target dim levels + the click origin + a start timestamp), and
 * the static-scene renderer reduces each element's blit `globalAlpha` by the
 * corresponding wash factor. Element identities and colors in the data model are
 * untouched, so render caches survive the focus change.
 *
 * The wash animates as a radial sweep out from the clicked element's center over
 * {@link TERRAFORM_FOCUS_WASH_DURATION_MS}; after the sweep completes the wash is
 * static. Because the wash is applied when blitting an already-rasterized element
 * bitmap (never by re-rasterizing), the animation costs one `drawImage` alpha
 * change per element per frame — no `generateElementCanvas` work.
 *
 * Multiple `<Excalidraw/>` instances can be mounted on one page at once (a
 * supported, tested configuration — see `withInternalFallback.test.tsx`), each
 * with its own static canvas. The descriptor store below is therefore keyed
 * per instance by that instance's static canvas element (`app.canvas`, already
 * threaded into every call site that needs the wash: the focus effect has
 * `app`, and the static-scene renderer already receives `canvas` in its render
 * config) via a `WeakMap`, mirroring how `renderer/staticScene.ts` already
 * scopes its own per-canvas caches. This avoids one instance's focus
 * engage/clear overwriting another's wash state, and lets an unmounting
 * instance release its own entry without touching a sibling's.
 */

/** Stable per-`<Excalidraw/>`-instance key for the wash descriptor store. Any
 * object unique to the instance works; callers pass `app.canvas` (the static
 * canvas element), which is already threaded through both the focus effect
 * and the static-scene renderer. */
export type TerraformFocusWashInstanceKey = object;

export type TerraformFocusWashDescriptor = {
  /**
   * Target dim level per element id (0..100; matches the semantic levels in
   * `terraformRelationshipFocus`). Only elements that would be dimmed (level <
   * 100) are present; any element absent from the map renders at full opacity.
   */
  levelByElementId: ReadonlyMap<string, number>;
  /**
   * Scene-space origin of the radial sweep (the clicked element's center), or
   * `null` for a static (non-animated) application — e.g. the ambient overview
   * wash on focus clear, which has no sweep origin.
   */
  clickCenter: { x: number; y: number } | null;
  /** `performance.now()` at publish time; the sweep clock origin. */
  startTs: number;
  /** Sweep duration in ms. */
  durationMs: number;
  /**
   * Max scene-space distance from `clickCenter` to any dimmed element center.
   * Normalizes the sweep so it always finishes covering the dimmed set at t=1.
   */
  maxRadius: number;
  /** Canvas background color (unused by the alpha wash, kept for parity/debug). */
  viewBackgroundColor: string;
};

export const TERRAFORM_FOCUS_WASH_DURATION_MS = 260;

/**
 * Soft leading-edge width of the radial sweep, in scene units. Elements within
 * this band of the advancing front are partially washed, so the sweep reads as a
 * gradient rather than a hard ring.
 */
const TERRAFORM_FOCUS_WASH_EDGE = 420;

const descriptorsByInstance = new WeakMap<
  TerraformFocusWashInstanceKey,
  TerraformFocusWashDescriptor
>();
const subscribersByInstance = new WeakMap<
  TerraformFocusWashInstanceKey,
  Set<() => void>
>();

export const getTerraformFocusWashDescriptor = (
  instanceKey: TerraformFocusWashInstanceKey,
): TerraformFocusWashDescriptor | null =>
  descriptorsByInstance.get(instanceKey) ?? null;

export const publishTerraformFocusWashDescriptor = (
  instanceKey: TerraformFocusWashInstanceKey,
  next: TerraformFocusWashDescriptor | null,
) => {
  if (next === null) {
    descriptorsByInstance.delete(instanceKey);
  } else {
    descriptorsByInstance.set(instanceKey, next);
  }
  const subscribers = subscribersByInstance.get(instanceKey);
  if (subscribers) {
    for (const subscriber of subscribers) {
      subscriber();
    }
  }
};

/** Clear this instance's descriptor (no-op if already clear) so its wash stops
 * rendering. Does not touch any other instance's descriptor. */
export const clearTerraformFocusWashDescriptor = (
  instanceKey: TerraformFocusWashInstanceKey,
) => {
  if (descriptorsByInstance.has(instanceKey)) {
    publishTerraformFocusWashDescriptor(instanceKey, null);
  }
};

export const subscribeTerraformFocusWash = (
  instanceKey: TerraformFocusWashInstanceKey,
  subscriber: () => void,
) => {
  let subscribers = subscribersByInstance.get(instanceKey);
  if (!subscribers) {
    subscribers = new Set();
    subscribersByInstance.set(instanceKey, subscribers);
  }
  subscribers.add(subscriber);
  return () => {
    subscribers!.delete(subscriber);
  };
};

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** True while the descriptor's radial sweep is still animating at `nowTs`. */
export const isTerraformFocusWashAnimating = (
  descriptor: TerraformFocusWashDescriptor | null,
  nowTs: number,
): boolean =>
  descriptor != null &&
  descriptor.clickCenter != null &&
  nowTs - descriptor.startTs < descriptor.durationMs;

/**
 * The draw-time `globalAlpha` multiplier (0..1) for one element under the given
 * descriptor at time `nowTs`. `1` means "no wash" (full opacity); lower values
 * blend the element toward whatever is behind it (the canvas background for the
 * common flat-overview case).
 *
 * The target wash factor is `1 - level/100`. During the sweep the factor ramps
 * from 0 to its target as the advancing front (radius = eased-progress ×
 * (maxRadius + edge)) passes each element's center, giving the staggered radial
 * reveal. With no `clickCenter` (static application) the target factor applies
 * immediately.
 */
export const terraformFocusWashAlphaForElement = (
  descriptor: TerraformFocusWashDescriptor,
  elementId: string,
  elementCenterX: number,
  elementCenterY: number,
  nowTs: number,
): number => {
  const level = descriptor.levelByElementId.get(elementId);
  if (level == null || level >= 100) {
    return 1;
  }
  const targetWashFactor = Math.min(Math.max(1 - level / 100, 0), 1);
  if (targetWashFactor === 0) {
    return 1;
  }

  let localProgress = 1;
  if (descriptor.clickCenter != null) {
    const rawT = Math.min(
      Math.max((nowTs - descriptor.startTs) / descriptor.durationMs, 0),
      1,
    );
    const eased = easeOutCubic(rawT);
    const sweepRadius =
      eased * (descriptor.maxRadius + TERRAFORM_FOCUS_WASH_EDGE);
    const dx = elementCenterX - descriptor.clickCenter.x;
    const dy = elementCenterY - descriptor.clickCenter.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    localProgress = Math.min(
      Math.max((sweepRadius - distance) / TERRAFORM_FOCUS_WASH_EDGE, 0),
      1,
    );
  }

  return 1 - targetWashFactor * localProgress;
};
