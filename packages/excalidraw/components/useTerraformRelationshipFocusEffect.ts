import React from "react";

import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

import {
  getTerraformGraphAddressForElement,
  isTerraformResourceElement,
} from "./terraformElementMetadata";
import {
  applyTerraformRelationshipFocus,
  isValidTerraformFocusHopCount,
} from "./terraformRelationshipFocus";
import {
  getTerraformElementForSelection,
  terraformEdgesVisibilitySig,
  terraformFocusInputsSig,
  terraformFocusSceneSig,
} from "./terraformElementActionsSelection";
import {
  buildTerraformReconcileOptionsForAppState,
  reconcileTerraformVisibility,
  repairTerraformEdgeBindings,
} from "./terraformVisibility";
import {
  getTerraformRuntimePerformanceSnapshot,
  isBelowTerraformRuntimeThreshold,
  subscribeTerraformRuntimePerformance,
  type TerraformRuntimePerformanceSettings,
} from "./terraformRuntimePerformance";
import {
  TERRAFORM_FOCUS_WASH_DURATION_MS,
  clearTerraformFocusWashDescriptor,
  getTerraformFocusWashDescriptor,
  isTerraformFocusWashAnimating,
  publishTerraformFocusWashDescriptor,
  type TerraformFocusWashInstanceKey,
} from "./terraformFocusWash";

import type { AppClassProperties, AppState, UIAppState } from "../types";

/** W11 F4: normalize a possibly-junk AppState focus direction to a valid value. */
const normalizeFocusDirection = (
  focusDirection: AppState["terraformFocusDirection"],
): AppState["terraformFocusDirection"] =>
  focusDirection === "dependencies" || focusDirection === "dependents"
    ? focusDirection
    : "both";

/**
 * W11 F4: normalize a possibly-junk AppState hop cap. `-1`/`Infinity` ⇒ Infinity;
 * `null`/undefined or any invalid value ⇒ null (legacy default); otherwise the
 * validated finite cap.
 */
const normalizeFocusMaxHops = (
  focusMaxHops: AppState["terraformFocusMaxHops"],
): number | null => {
  if (focusMaxHops == null) {
    return null;
  }
  if (focusMaxHops === -1 || focusMaxHops === Infinity) {
    return Infinity;
  }
  return isValidTerraformFocusHopCount(focusMaxHops) ? focusMaxHops : null;
};

/**
 * E08: publish the focus wash descriptor for the current update and, on a
 * genuine focus change with a sweep origin, drive the radial-sweep rAF loop.
 * Extracted from the effect to keep its cognitive complexity in bounds.
 * Returns nothing; mutates the passed rAF ref.
 */
const syncTerraformFocusWash = ({
  instanceKey,
  wash,
  activeFocusNodePath,
  focusChanged,
  viewBackgroundColor,
  requestRender,
  washRafRef,
}: {
  /** E08 bugfix: which `<Excalidraw/>` instance's wash this update targets —
   * always `app.canvas` — so two mounted instances never clobber each other's
   * descriptor. */
  instanceKey: TerraformFocusWashInstanceKey;
  wash: {
    levelByElementId: ReadonlyMap<string, number>;
    maxRadius: number;
    clickCenter: { x: number; y: number } | null;
  };
  activeFocusNodePath: string | null;
  focusChanged: boolean;
  viewBackgroundColor: string;
  requestRender: () => void;
  washRafRef: { current: number };
}) => {
  if (wash.levelByElementId.size === 0 && !activeFocusNodePath) {
    // Nothing dimmed and no focus (e.g. non-overview scene) — clear.
    clearTerraformFocusWashDescriptor(instanceKey);
    return;
  }
  const previous = getTerraformFocusWashDescriptor(instanceKey);
  // Keep the existing clock unless this is a genuine focus change.
  const startTs =
    focusChanged || previous == null ? performance.now() : previous.startTs;
  publishTerraformFocusWashDescriptor(instanceKey, {
    levelByElementId: wash.levelByElementId,
    clickCenter: wash.clickCenter,
    startTs,
    durationMs: TERRAFORM_FOCUS_WASH_DURATION_MS,
    maxRadius: wash.maxRadius,
    viewBackgroundColor,
  });
  if (!wash.clickCenter) {
    return;
  }
  // Drive the radial sweep: re-render each frame until it settles.
  if (washRafRef.current) {
    cancelAnimationFrame(washRafRef.current);
  }
  const tick = () => {
    requestRender();
    if (
      isTerraformFocusWashAnimating(
        getTerraformFocusWashDescriptor(instanceKey),
        performance.now(),
      )
    ) {
      washRafRef.current = requestAnimationFrame(tick);
    } else {
      washRafRef.current = 0;
    }
  };
  washRafRef.current = requestAnimationFrame(tick);
};

export const buildTerraformRuntimeFocusUpdate = ({
  allElements,
  activeFocusNodePath,
  selectedElementIds,
  pins,
  viewBackgroundColor,
  skipBindingRepair,
  lastFocusInputsSig,
  lastFocusSceneSig,
  focusDirection = "both",
  focusMaxHops = null,
  washOverlayMode = false,
  clickCenter = null,
}: {
  allElements: readonly NonDeletedExcalidrawElement[];
  activeFocusNodePath: string | null;
  selectedElementIds: UIAppState["selectedElementIds"];
  pins: UIAppState["terraformEdgeLayerPins"];
  viewBackgroundColor: string;
  skipBindingRepair: boolean;
  lastFocusInputsSig: string | null;
  lastFocusSceneSig: string | null;
  /** W11 WP1: opt-in traversal direction; `"both"` takes the legacy code path. */
  focusDirection?: AppState["terraformFocusDirection"];
  /** W11 WP1: opt-in hop-cap override; `null` = legacy default (3 hops). */
  focusMaxHops?: AppState["terraformFocusMaxHops"];
  /**
   * E08: when true, skip dim color mutations and instead return `wash` data for
   * the draw-time radial wash overlay. Default false = legacy color path.
   */
  washOverlayMode?: boolean;
  /** E08: scene-space center of the clicked element (sweep origin), if any. */
  clickCenter?: { x: number; y: number } | null;
}) => {
  // ── W11 F4: AppState ingress normalization ─────────────────────────────
  // AppState may carry junk in these two fields via the public `updateScene`
  // API or `restore` (the TS types are compile-time promises only). This is
  // the consumption boundary, so normalize BEFORE building the options/sig:
  // - direction: anything but "dependencies"/"dependents" ⇒ "both".
  // - maxHops: `-1` (the JSON-safe stored sentinel) ⇒ Infinity; `null`/
  //   undefined ⇒ legacy default (3 hops); `Infinity` (API misuse) ⇒ tolerated
  //   as Infinity here but never re-stored — storage-side Infinity degrades
  //   safely to `null` through JSON.stringify (accepted); any other
  //   non-finite/NaN/<0 / non-integer / unsafe-integer value ⇒ ignored
  //   (legacy default; W13 F3 — `isValidTerraformFocusHopCount`, so e.g.
  //   `1e21` no longer passes); 0 = focused node only (W13 WP1).
  const normalizedFocusDirection = normalizeFocusDirection(focusDirection);
  const effectiveMaxHops = normalizeFocusMaxHops(focusMaxHops);

  // `washOverlayMode` is folded into the inputs signature so flipping the
  // toggle mid-session re-runs the reducer (otherwise a same-focus early return
  // would leave the color path and the overlay path stale relative to each
  // other).
  const focusInputsSig = `${terraformFocusInputsSig(
    activeFocusNodePath,
    selectedElementIds,
    pins,
    viewBackgroundColor,
    normalizedFocusDirection,
    effectiveMaxHops,
  )}|wash:${washOverlayMode ? 1 : 0}`;
  const currentSceneSig = terraformFocusSceneSig(
    allElements,
    activeFocusNodePath,
  );
  if (
    focusInputsSig === lastFocusInputsSig &&
    currentSceneSig === lastFocusSceneSig
  ) {
    return {
      elements: allElements,
      focusInputsSig,
      focusSceneSig: currentSceneSig,
      shouldReplace: false,
      wash: null as {
        levelByElementId: ReadonlyMap<string, number>;
        maxRadius: number;
        clickCenter: { x: number; y: number } | null;
      } | null,
    };
  }

  // Options are omitted entirely at the (normalized) default ("both" + no hop
  // override) so `applyTerraformRelationshipFocus` takes its byte-identical
  // legacy path. AppState stores the JSON-safe sentinel `-1` for "unlimited";
  // it is mapped to Infinity only above, at this traversal boundary.
  const focusOptions =
    normalizedFocusDirection === "both" && effectiveMaxHops == null
      ? undefined
      : {
          ...(normalizedFocusDirection !== "both"
            ? { direction: normalizedFocusDirection }
            : {}),
          ...(effectiveMaxHops != null ? { maxHops: effectiveMaxHops } : {}),
        };

  const result = applyTerraformRelationshipFocus(
    allElements,
    activeFocusNodePath,
    viewBackgroundColor,
    focusOptions,
    washOverlayMode ? { clickCenter } : undefined,
  );
  const wash =
    washOverlayMode && result.washLevelByElementId != null
      ? {
          levelByElementId: result.washLevelByElementId,
          maxRadius: result.washMaxRadius,
          clickCenter,
        }
      : null;
  const pinReconcile = buildTerraformReconcileOptionsForAppState(
    pins,
    activeFocusNodePath,
  );
  const shouldRepairBindings =
    result.shouldRepairBindings && !skipBindingRepair;
  const repaired = shouldRepairBindings
    ? repairTerraformEdgeBindings(result.elements)
    : result.elements;
  const next = pinReconcile
    ? reconcileTerraformVisibility(repaired, pinReconcile)
    : repaired;
  const referencesStable =
    next.length === allElements.length &&
    next.every((element, index) => element === allElements[index]);
  const visibilityStable =
    pins == null ||
    terraformEdgesVisibilitySig(next) ===
      terraformEdgesVisibilitySig(allElements);

  if (!result.didChange && (referencesStable || visibilityStable)) {
    return {
      elements: next,
      focusInputsSig,
      focusSceneSig: currentSceneSig,
      shouldReplace: false,
      // In overlay mode the wash is published even with no structural change:
      // colors are untouched, but the draw-time levels still need to render.
      wash,
    };
  }

  const nextFocusSceneSig = terraformFocusSceneSig(next, activeFocusNodePath);
  return {
    elements: next,
    focusInputsSig,
    focusSceneSig: nextFocusSceneSig,
    shouldReplace: nextFocusSceneSig !== lastFocusSceneSig,
    wash,
  };
};

export function useTerraformRelationshipFocusEffect({
  app,
  appState,
  elements,
}: {
  app: AppClassProperties;
  appState: UIAppState;
  elements: readonly NonDeletedExcalidrawElement[];
  setAppState: React.Component<any, AppState>["setState"];
}) {
  const lastTerraformFocusSceneSigRef = React.useRef<string | null>(null);
  const lastTerraformFocusInputsSigRef = React.useRef<string | null>(null);
  // E08: last focus path published to the wash overlay, so a genuine focus
  // change (not a mere scene re-render) restarts the radial sweep clock.
  const lastPublishedWashFocusRef = React.useRef<string | null>(null);
  const washRafRef = React.useRef<number>(0);
  const runtimeSnapshot = React.useSyncExternalStore(
    subscribeTerraformRuntimePerformance,
    getTerraformRuntimePerformanceSnapshot,
    getTerraformRuntimePerformanceSnapshot,
  );
  const washOverlayMode = runtimeSnapshot.value.terraformFocusWashOverlay;
  const allElements = app.scene.getElementsIncludingDeleted();

  React.useEffect(() => {
    const terraformElement = getTerraformElementForSelection(
      elements,
      appState.selectedElementIds,
      appState.selectedGroupIds,
    );
    const selectedGraphKey =
      terraformElement && isTerraformResourceElement(terraformElement)
        ? getTerraformGraphAddressForElement(terraformElement)
        : null;
    // Relationship focus is driven by selection (click), not hover: hovering
    // re-washed ~93% of elements on every pointer move, busting render caches
    // and stalling the canvas during rapid hover + pan. See
    // docs/terraform-canvas-hover-unrender-investigation.md.
    const activeFocusNodePath = selectedGraphKey;
    // Sweep origin = clicked element center (scene coords). Only meaningful on a
    // genuine focus change; a same-focus re-publish keeps the prior clock.
    const focusChanged =
      activeFocusNodePath !== lastPublishedWashFocusRef.current;
    const clickCenter =
      washOverlayMode && activeFocusNodePath && terraformElement && focusChanged
        ? {
            x: terraformElement.x + terraformElement.width / 2,
            y: terraformElement.y + terraformElement.height / 2,
          }
        : null;
    const update = buildTerraformRuntimeFocusUpdate({
      allElements,
      activeFocusNodePath,
      selectedElementIds: appState.selectedElementIds,
      pins: appState.terraformEdgeLayerPins,
      viewBackgroundColor: appState.viewBackgroundColor,
      skipBindingRepair: runtimeSnapshot.value.skipBindingRepairDuringFocus,
      lastFocusInputsSig: lastTerraformFocusInputsSigRef.current,
      lastFocusSceneSig: lastTerraformFocusSceneSigRef.current,
      focusDirection: appState.terraformFocusDirection,
      focusMaxHops: appState.terraformFocusMaxHops,
      washOverlayMode,
      clickCenter,
    });
    lastTerraformFocusInputsSigRef.current = update.focusInputsSig;
    lastTerraformFocusSceneSigRef.current = update.focusSceneSig;
    if (update.shouldReplace) {
      app.scene.replaceAllElements(update.elements);
    }

    if (washOverlayMode) {
      if (update.wash) {
        syncTerraformFocusWash({
          instanceKey: app.canvas,
          wash: update.wash,
          activeFocusNodePath,
          focusChanged,
          viewBackgroundColor: appState.viewBackgroundColor,
          requestRender: () => app.scene.triggerUpdate(),
          washRafRef,
        });
      }
      lastPublishedWashFocusRef.current = activeFocusNodePath;
    } else if (lastPublishedWashFocusRef.current !== null) {
      // Toggle flipped OFF (or first run after being ON): drop any stale wash.
      lastPublishedWashFocusRef.current = null;
      clearTerraformFocusWashDescriptor(app.canvas);
    }
  }, [
    allElements,
    app,
    appState.selectedElementIds,
    appState.selectedGroupIds,
    appState.terraformEdgeLayerPins,
    appState.terraformFocusDirection,
    appState.terraformFocusMaxHops,
    appState.viewBackgroundColor,
    elements,
    runtimeSnapshot.version,
    runtimeSnapshot.value.skipBindingRepairDuringFocus,
    washOverlayMode,
  ]);

  // Mount/unmount-only cleanup (deps intentionally `[]`, matching the prior
  // rAF-only cleanup): captured via ref so it always releases the LATEST
  // instance's canvas without re-running mid-life if `app` happens to change
  // reference across renders.
  const appRef = React.useRef(app);
  appRef.current = app;
  React.useEffect(
    () => () => {
      if (washRafRef.current) {
        cancelAnimationFrame(washRafRef.current);
        washRafRef.current = 0;
      }
      // E08 bugfix: release THIS instance's wash descriptor on unmount so a
      // second instance mounted afterwards (e.g. reusing the same canvas
      // element via a pooled/recycled DOM node) never inherits a stale wash,
      // and so an unmounted-but-still-referenced instance stops contributing
      // to `getTerraformFocusWashDescriptor` reads entirely.
      clearTerraformFocusWashDescriptor(appRef.current.canvas);
    },
    [],
  );
}

export const resolveTerraformEffectiveFocusKey = ({
  hoveredGraphKey,
  selectedGraphKey,
  zoom,
  settings,
}: {
  hoveredGraphKey: string | null;
  selectedGraphKey: string | null;
  zoom: number;
  settings: TerraformRuntimePerformanceSettings;
}) => {
  const effectiveHover =
    settings.suppressHoverFocusBelowZoom &&
    isBelowTerraformRuntimeThreshold(zoom, settings)
      ? null
      : hoveredGraphKey;
  return effectiveHover || selectedGraphKey;
};
