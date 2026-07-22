import {
  VersionedSnapshotStore,
  isProdEnv,
  isShallowEqual,
} from "@excalidraw/common";

import type {
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type { StaticCanvasRenderConfig } from "../scene/types";
import type { StaticCanvasAppState } from "../types";

export const TERRAFORM_RUNTIME_PERFORMANCE_STORAGE_KEY =
  "tfdraw-terraform-canvas-runtime-performance";
export const TERRAFORM_RUNTIME_HOVER_DEBOUNCE_MS = 100;

export type TerraformRuntimePerformanceSettings = {
  hideAwsIconGlyphsBelowZoom: boolean;
  suppressHoverFocusBelowZoom: boolean;
  debounceHoverFocus: boolean;
  suppressFrameClippingBelowZoom: boolean;
  skipBindingRepairDuringFocus: boolean;
  /**
   * E08 — apply relationship-focus dimming as a draw-time radial wash overlay
   * instead of re-cloning ~6.5k elements to blend their colors. Opt-in; default
   * OFF keeps the legacy color-mutation path byte-identical. Not a below-zoom
   * experiment, so deliberately excluded from the "enable all" group and the
   * threshold radios.
   */
  terraformFocusWashOverlay: boolean;
  /** E09.1: bucket the per-element canvas zoom cache key (default OFF). */
  terraformZoomQuantize: boolean;
  lowZoomThreshold: 0.2 | 0.3 | 0.4;
};

export const TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS: TerraformRuntimePerformanceSettings =
  {
    hideAwsIconGlyphsBelowZoom: false,
    suppressHoverFocusBelowZoom: false,
    debounceHoverFocus: false,
    suppressFrameClippingBelowZoom: false,
    skipBindingRepairDuringFocus: false,
    terraformFocusWashOverlay: false,
    terraformZoomQuantize: false,
    lowZoomThreshold: 0.3,
  };

const BOOLEAN_SETTING_KEYS = [
  "hideAwsIconGlyphsBelowZoom",
  "suppressHoverFocusBelowZoom",
  "debounceHoverFocus",
  "suppressFrameClippingBelowZoom",
  "skipBindingRepairDuringFocus",
  "terraformZoomQuantize",
] as const;

const isLowZoomThreshold = (
  value: unknown,
): value is TerraformRuntimePerformanceSettings["lowZoomThreshold"] =>
  value === 0.2 || value === 0.3 || value === 0.4;

export const parseTerraformRuntimePerformanceSettings = (
  value: unknown,
): TerraformRuntimePerformanceSettings => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS };
  }

  const parsed = value as Record<string, unknown>;
  const settings = { ...TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS };
  for (const key of BOOLEAN_SETTING_KEYS) {
    if (typeof parsed[key] === "boolean") {
      settings[key] = parsed[key];
    }
  }
  // Parsed outside BOOLEAN_SETTING_KEYS so it stays out of the "enable all"
  // experiments group (it is an alternate focus render path, not a perf gate).
  if (typeof parsed.terraformFocusWashOverlay === "boolean") {
    settings.terraformFocusWashOverlay = parsed.terraformFocusWashOverlay;
  }
  if (isLowZoomThreshold(parsed.lowZoomThreshold)) {
    settings.lowZoomThreshold = parsed.lowZoomThreshold;
  }
  return settings;
};

const loadPersistedSettings = (): TerraformRuntimePerformanceSettings => {
  if (isProdEnv() || typeof localStorage === "undefined") {
    return { ...TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS };
  }
  try {
    const stored = localStorage.getItem(
      TERRAFORM_RUNTIME_PERFORMANCE_STORAGE_KEY,
    );
    return stored
      ? parseTerraformRuntimePerformanceSettings(JSON.parse(stored))
      : { ...TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS };
  } catch {
    return { ...TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS };
  }
};

const store = new VersionedSnapshotStore<TerraformRuntimePerformanceSettings>(
  loadPersistedSettings(),
  isShallowEqual,
);
let currentSnapshot = store.getSnapshot();
store.subscribe((snapshot) => {
  currentSnapshot = snapshot;
});

const persistSettings = (settings: TerraformRuntimePerformanceSettings) => {
  if (isProdEnv() || typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      TERRAFORM_RUNTIME_PERFORMANCE_STORAGE_KEY,
      JSON.stringify(settings),
    );
  } catch {
    // Experiments continue in memory when storage is unavailable or full.
  }
};

// Cross-tab sync: `loadPersistedSettings()` above only hydrates once at
// module init, so toggling a setting in one tab left an already-open second
// tab's snapshot stale until its next reload. `storage` events fire in every
// OTHER same-origin tab (never the tab that wrote the key) whenever
// `localStorage.setItem`/`removeItem` runs, so re-hydrating from `event.newValue`
// here and pushing it through the existing `store.set` (which already
// dedupes via `isShallowEqual` and notifies subscribers) keeps every open
// tab's snapshot — and anything subscribed via `subscribeTerraformRuntimePerformance`
// (e.g. `useTerraformRelationshipFocusEffect`'s `useSyncExternalStore`) — in
// sync without polling.
if (!isProdEnv() && typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== TERRAFORM_RUNTIME_PERFORMANCE_STORAGE_KEY) {
      return;
    }
    // `newValue` is `null` when the key was removed (e.g. `localStorage.clear()`
    // or `removeItem`) — treat that the same as a reset to defaults.
    let nextSettings: TerraformRuntimePerformanceSettings;
    if (event.newValue == null) {
      nextSettings = { ...TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS };
    } else {
      try {
        nextSettings = parseTerraformRuntimePerformanceSettings(
          JSON.parse(event.newValue),
        );
      } catch {
        return;
      }
    }
    store.set(nextSettings);
  });
}

export const getTerraformRuntimePerformanceSnapshot = () => currentSnapshot;

export const subscribeTerraformRuntimePerformance = (
  subscriber: Parameters<typeof store.subscribe>[0],
) => store.subscribe(subscriber);

export const patchTerraformRuntimePerformanceSettings = (
  patch: Partial<TerraformRuntimePerformanceSettings>,
) => {
  if (isProdEnv()) {
    return false;
  }
  const changed = store.update((prev) =>
    parseTerraformRuntimePerformanceSettings({ ...prev, ...patch }),
  );
  if (changed) {
    persistSettings(store.getSnapshot().value);
  }
  return changed;
};

export const resetTerraformRuntimePerformanceSettings = () => {
  if (isProdEnv()) {
    return false;
  }
  const changed = store.set({ ...TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS });
  persistSettings(store.getSnapshot().value);
  return changed;
};

export const areAllTerraformRuntimeExperimentsEnabled = (
  settings: TerraformRuntimePerformanceSettings,
) => BOOLEAN_SETTING_KEYS.every((key) => settings[key]);

export const setAllTerraformRuntimeExperiments = (enabled: boolean) =>
  patchTerraformRuntimePerformanceSettings(
    Object.fromEntries(BOOLEAN_SETTING_KEYS.map((key) => [key, enabled])),
  );

export const isBelowTerraformRuntimeThreshold = (
  zoom: number,
  settings: TerraformRuntimePerformanceSettings,
) => zoom < settings.lowZoomThreshold;

export const filterTerraformRuntimeVisibleElements = (
  elements: readonly NonDeletedExcalidrawElement[],
  zoom: number,
  settings: TerraformRuntimePerformanceSettings,
): readonly NonDeletedExcalidrawElement[] => {
  if (
    !settings.hideAwsIconGlyphsBelowZoom ||
    !isBelowTerraformRuntimeThreshold(zoom, settings)
  ) {
    return elements;
  }
  return elements.filter(
    (element) => element.customData?.terraformAwsIconGlyph !== true,
  );
};

const isTerraformElement = (element: ExcalidrawElement) =>
  element.customData?.terraform === true ||
  Boolean(element.customData?.terraformEdgeLayer) ||
  Boolean(element.customData?.relationship);

/**
 * This only suppresses nested canvas clip work. Hit-testing and persisted frame
 * settings remain unchanged.
 */
export const shouldSuppressTerraformFrameClip = (
  element: ExcalidrawElement,
  appState: StaticCanvasAppState,
  renderConfig: StaticCanvasRenderConfig,
  settings: TerraformRuntimePerformanceSettings,
) =>
  !renderConfig.isExporting &&
  settings.suppressFrameClippingBelowZoom &&
  isBelowTerraformRuntimeThreshold(appState.zoom.value, settings) &&
  isTerraformElement(element);
