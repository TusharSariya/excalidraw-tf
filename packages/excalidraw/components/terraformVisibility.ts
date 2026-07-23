import {
  boundsContainBounds,
  doBoundsIntersect,
  getNonDeletedElements,
  getFrameDescendants,
  getElementBounds,
  isFrameLikeElement,
  isBindableElement,
  isLinearElement,
  newElementWith,
} from "@excalidraw/element";

import { pointFrom } from "@excalidraw/math";

import type { Scene } from "@excalidraw/element";

import type {
  ExcalidrawBindableElement,
  ExcalidrawElement,
  NonDeletedExcalidrawElement,
} from "@excalidraw/element/types";

import type { LocalPoint } from "@excalidraw/math";

import {
  getTerraformGraphAddressForElement,
  isTerraformSemanticOverviewScene,
} from "./terraformElementMetadata";
import {
  isTerraformEdgeTripwireEnabled,
  tripwireCheckConnectorPointFinite,
  tripwireCheckEdgeSpan,
} from "./terraformEdgeTripwire";
import {
  computeTerraformChordAnchors,
  fixedPointForAbsolutePoint,
  getCenterClippedBindingPoints,
} from "./terraformEdgeAnchors";

import type { PointerDownState } from "../types";

/**
 * Terraform-import scene helpers: soft-hide (`isDeleted`) for filtered views, explode
 * expand/collapse for dependency neighborhoods, and edge rebind after layout changes.
 * Element `customData` is written during browser-side layout (`terraformElkLayout`, `terraformTopologyLayout`).
 */

export type TerraformEdgeLayerPins = {
  dependency: boolean;
  dataFlow: boolean;
  declaredDataFlow: boolean;
  networking: boolean;
  topologyFrameFlow: boolean;
};

/** Default after ELK / topology layout: all edge layers off until pins or hover reveal. */
export const TERRAFORM_IMPORT_EDGE_LAYER_PINS: TerraformEdgeLayerPins = {
  dependency: false,
  dataFlow: false,
  declaredDataFlow: false,
  networking: false,
  topologyFrameFlow: false,
};

export type TerraformVisibilityReconcileOverrides = {
  dependencyLayerEnabled?: boolean;
  dataFlowLayerEnabled?: boolean;
  declaredDataFlowLayerEnabled?: boolean;
  networkingLayerEnabled?: boolean;
  topologyFrameFlowLayerEnabled?: boolean;
  pins?: TerraformEdgeLayerPins;
  hoverPeekKey?: string | null;
};

/** Build reconcile overrides from editor appState (legacy when `pins` is null). */
export const buildTerraformReconcileOptionsForAppState = (
  pins: TerraformEdgeLayerPins | null,
  hoverPeekKey: string | null | undefined,
): TerraformVisibilityReconcileOverrides | undefined =>
  pins != null
    ? {
        pins,
        hoverPeekKey: hoverPeekKey ?? null,
      }
    : undefined;

const getCustomData = (element: ExcalidrawElement) => element.customData ?? {};

/**
 * Max px a legitimate routed polyline endpoint sits outside its bound card.
 * The strata router attaches detour endpoints a fixed pad off the card
 * (measured ~38.5 px across 322 edges on both W9 presets); a re-anchored or
 * foreign endpoint lands far further out. Sized well above the pad and well
 * below any genuine re-anchor displacement (the stale-arrow repro moves 200 px).
 */
// Legit routed endpoints attach ~38.5px off their card (W9, 322 edges);
// 48 gives ~10px slack above that while capping retained stale geometry far
// below any real re-anchor (codex probe: 100px retained a visibly stale route).
const ROUTED_ANCHOR_TOLERANCE = 48;

/** Chebyshev distance a point lies OUTSIDE an axis-aligned rect (0 if inside/on). */
const chebyshevDistanceOutsideRect = (
  px: number,
  py: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): number => Math.max(0, rx - px, px - (rx + rw), ry - py, py - (ry + rh));

/** Drop a stale `terraformRoutedPolyline` marker AND its `terraformRoutedBy`
 * provenance (written by whichever pass stamped the polyline) AND any
 * `terraformClipAnchor` / `terraformClipLane` the clip pass stamped alongside —
 * a flattened edge must fully self-heal, or the stale anchors could revalidate a
 * later re-stamp against the wrong frame and the stale lane tag would inflate the
 * lane census on an edge that is no longer a lane. All other customData is
 * preserved. */
const stripRoutedPolylineMarker = (
  customData: ExcalidrawElement["customData"],
): ExcalidrawElement["customData"] => {
  if (
    !customData ||
    (customData.terraformRoutedPolyline === undefined &&
      customData.terraformRoutedBy === undefined &&
      customData.terraformClipAnchor === undefined &&
      customData.terraformClipLane === undefined)
  ) {
    return customData;
  }
  const {
    terraformRoutedPolyline: _drop,
    terraformRoutedBy: _dropBy,
    terraformClipAnchor: _dropClip,
    terraformClipLane: _dropLane,
    ...rest
  } = customData;
  return rest;
};

const isTerraformResourceRectangle = (
  element: ExcalidrawElement | null | undefined,
): element is NonDeletedExcalidrawElement => {
  if (!element || element.isDeleted || element.type !== "rectangle") {
    return false;
  }
  const cd = getCustomData(element);
  return cd.terraform === true && cd.terraformVisibilityRole === "resource";
};

const isTerraformDraggableNode = (
  element: ExcalidrawElement | null | undefined,
): element is NonDeletedExcalidrawElement => {
  if (!element || element.isDeleted) {
    return false;
  }
  const cd = getCustomData(element);
  if (cd.terraform !== true || getTerraformEdgeLayer(element)) {
    return false;
  }
  if (isFrameLikeElement(element)) {
    return true;
  }
  return (
    cd.terraformVisibilityRole === "resource" ||
    cd.terraformVisibilityRole === "group"
  );
};

const isTerraformConstraintBox = (
  element: ExcalidrawElement | null | undefined,
): element is NonDeletedExcalidrawElement => {
  if (!element || element.isDeleted) {
    return false;
  }
  const cd = getCustomData(element);
  if (cd.terraform !== true || getTerraformEdgeLayer(element)) {
    return false;
  }
  if (isFrameLikeElement(element)) {
    return true;
  }
  return (
    element.type === "rectangle" &&
    (cd.terraformVisibilityRole === "resource" ||
      cd.terraformVisibilityRole === "group")
  );
};

/** Infer pin snapshot from current edge visibility (legacy scenes, first menu interaction). */
export const inferLegacyTerraformEdgePinsFromElements = (
  elements: readonly ExcalidrawElement[],
): TerraformEdgeLayerPins => ({
  dependency: elements.some(
    (e) =>
      getTerraformEdgeLayer(e) === "dependency" &&
      !getCustomData(e).terraformDependencyPreview &&
      !e.isDeleted,
  ),
  dataFlow: elements.some(
    (e) => getTerraformEdgeLayer(e) === "dataFlow" && !e.isDeleted,
  ),
  declaredDataFlow: elements.some(
    (e) => getTerraformEdgeLayer(e) === "declaredDataFlow" && !e.isDeleted,
  ),
  networking: elements.some(
    (e) => getTerraformEdgeLayer(e) === "networking" && !e.isDeleted,
  ),
  topologyFrameFlow: elements.some(
    (e) => getTerraformEdgeLayer(e) === "topologyFrameFlow" && !e.isDeleted,
  ),
});

/** Graph peek key from hovered element ids (first matching Terraform address). */
export const getTerraformEdgeHoverPeekKeyFromHoveredIds = (
  elements: readonly ExcalidrawElement[],
  hoveredElementIds: Readonly<{ [id: string]: true }>,
): string | null => {
  for (const el of elements) {
    if (!hoveredElementIds[el.id] || el.isDeleted) {
      continue;
    }
    const cd = el.customData ?? {};
    if (
      typeof cd.terraformLayoutEdgeFocusKey === "string" &&
      cd.terraformLayoutEdgeFocusKey.length > 0
    ) {
      return cd.terraformLayoutEdgeFocusKey;
    }
    const addr = getTerraformGraphAddressForElement(el);
    if (addr) {
      return addr;
    }
  }
  return null;
};

/**
 * Resource cards, detached labels, AWS icon glyphs, and layout-duplicate info
 * glyphs should keep terraform hover focus active. Overlays sit above the card
 * hit target; without this, pointer moves across them clear hover and thrash
 * focus / reconcile / repair every frame.
 */
export const isTerraformResourceHoverTarget = (
  element: ExcalidrawElement | null | undefined,
): boolean => {
  if (!element || element.isDeleted) {
    return false;
  }
  const cd = element.customData ?? {};
  if (cd.terraform !== true) {
    return false;
  }
  if (getTerraformEdgeLayer(element)) {
    return false;
  }
  if (cd.terraformVisibilityRole === "resource") {
    return true;
  }
  return getTerraformGraphAddressForElement(element) != null;
};

/** Keep prior card hover while the pointer is over terraform frames/groups (not empty canvas). */
export const shouldPreserveTerraformResourceHover = (
  element: ExcalidrawElement | null | undefined,
): boolean => {
  if (!element || element.isDeleted) {
    return false;
  }
  const cd = element.customData ?? {};
  if (cd.terraform !== true || getTerraformEdgeLayer(element)) {
    return false;
  }
  return !isTerraformResourceHoverTarget(element);
};

/** Keep soft-hidden terraform edges in localStorage (layer pins use isDeleted). */
export const getTerraformPersistableElements = (
  elements: readonly ExcalidrawElement[],
): readonly ExcalidrawElement[] => {
  if (!isTerraformImportedScene(elements)) {
    return getNonDeletedElements(elements);
  }
  const nonDeleted = getNonDeletedElements(elements);
  const nonDeletedIds = new Set(nonDeleted.map((element) => element.id));
  const softHiddenEdges = elements.filter(
    (element) =>
      element.isDeleted &&
      getTerraformEdgeLayer(element) &&
      !nonDeletedIds.has(element.id),
  );
  return softHiddenEdges.length > 0
    ? [...nonDeleted, ...softHiddenEdges]
    : nonDeleted;
};

export const isTerraformImportedScene = (
  elements: readonly ExcalidrawElement[],
): boolean =>
  elements.some((element) => element.customData?.terraform === true);

/** Terraform edge layer id for edges, or null for non-terraform edges. */
export const getTerraformEdgeLayer = (element: ExcalidrawElement) => {
  const layer = getCustomData(element).terraformEdgeLayer;
  return layer === "dependency" ||
    layer === "dataFlow" ||
    layer === "declaredDataFlow" ||
    layer === "networking" ||
    layer === "topologyFrameFlow"
    ? layer
    : null;
};

/**
 * Stable graph id for a Terraform-backed element (`terraformVisibilityKey`, then fallbacks).
 */
export const getTerraformVisibilityKey = (element: ExcalidrawElement) => {
  const customData = getCustomData(element);
  return (
    customData.terraformVisibilityKey ||
    customData.terraformCategoryId ||
    customData.nodePath ||
    null
  );
};

/**
 * After {@link mirrorAndDetachTerraformResourceLabels}, card titles are plain text with
 * `containerId: null`, so {@link dragSelectedElements} does not move them with the rectangle.
 * Call once per drag step (after `dragSelectedElements`) so labels track the same delta as
 * their card (including snap), using `pointerDownState.originalElements` for baselines.
 */
export const syncTerraformDetachedResourceLabelsWithDraggedCards = (
  scene: Scene,
  pointerDownState: PointerDownState,
  selectedElements: readonly NonDeletedExcalidrawElement[],
): void => {
  const labelByVisibilityKey = new Map<string, NonDeletedExcalidrawElement>();
  for (const el of scene.getNonDeletedElements()) {
    if (el.type !== "text" || el.isDeleted) {
      continue;
    }
    if ("containerId" in el && el.containerId) {
      continue;
    }
    const cd = getCustomData(el);
    if (
      !cd.terraform ||
      cd.terraformVisibilityRole !== "resource" ||
      typeof cd.nodePath !== "string"
    ) {
      continue;
    }
    const key = getTerraformVisibilityKey(el);
    if (!key) {
      continue;
    }
    labelByVisibilityKey.set(key, el);
  }

  for (const element of selectedElements) {
    if (element.isDeleted || element.type !== "rectangle") {
      continue;
    }
    const cd = getCustomData(element);
    if (cd.terraformVisibilityRole !== "resource") {
      continue;
    }
    const key = getTerraformVisibilityKey(element);
    if (!key) {
      continue;
    }
    const origRect = pointerDownState.originalElements.get(element.id);
    if (!origRect) {
      continue;
    }
    const dx = element.x - origRect.x;
    const dy = element.y - origRect.y;
    if (dx === 0 && dy === 0) {
      continue;
    }
    const label = labelByVisibilityKey.get(key);
    if (!label || label.id === element.id) {
      continue;
    }
    const origLabel = pointerDownState.originalElements.get(label.id);
    if (!origLabel) {
      continue;
    }
    scene.mutateElement(label, {
      x: origLabel.x + dx,
      y: origLabel.y + dy,
    });
  }
};

const getMovedTerraformElements = (
  pointerDownState: PointerDownState,
  selectedElements: readonly NonDeletedExcalidrawElement[],
) =>
  selectedElements.filter((element) => {
    if (!isTerraformDraggableNode(element)) {
      return false;
    }
    const orig = pointerDownState.originalElements.get(element.id);
    if (!orig || orig.isDeleted) {
      return false;
    }
    return orig.x !== element.x || orig.y !== element.y;
  });

/**
 * Returns Terraform elements that should snap back because the drop violates:
 * - parent containment (element leaves its original parent frame), or
 * - sibling overlap (resource rectangles overlap siblings in same parent).
 */
export const getInvalidTerraformDraggedElementIds = (
  scene: Scene,
  pointerDownState: PointerDownState,
  selectedElements: readonly NonDeletedExcalidrawElement[],
): Set<string> => {
  const invalidElementIds = new Set<string>();
  const elementsMap = scene.getNonDeletedElementsMap();
  const movedTerraformElements = getMovedTerraformElements(
    pointerDownState,
    selectedElements,
  );

  for (const element of movedTerraformElements) {
    const orig = pointerDownState.originalElements.get(element.id);
    if (!orig || orig.isDeleted) {
      continue;
    }

    // Keep nested Terraform nodes inside the same original parent container.
    if (orig.frameId) {
      const parent = elementsMap.get(orig.frameId);
      if (!parent || parent.isDeleted) {
        continue;
      }

      const elementBounds = getElementBounds(element, elementsMap);
      const parentBounds = getElementBounds(parent, elementsMap);

      const origElementBounds = getElementBounds(
        orig,
        pointerDownState.originalElements,
      );
      const origParent =
        pointerDownState.originalElements.get(orig.frameId) ?? parent;
      const origParentBounds = getElementBounds(
        origParent,
        pointerDownState.originalElements,
      );
      const wasInsideParent = boundsContainBounds(
        origParentBounds,
        origElementBounds,
      );
      const isOutsideParent = !boundsContainBounds(parentBounds, elementBounds);

      if (wasInsideParent && isOutsideParent) {
        invalidElementIds.add(element.id);
        continue;
      }
    }

    // Prevent Terraform boxes/resources from overlapping sibling boxes/resources
    // within the same parent container.
    if (!isTerraformConstraintBox(element)) {
      continue;
    }

    const elementBounds = getElementBounds(element, elementsMap);
    const parentFrameId = orig.frameId ?? null;
    const origElementBounds = getElementBounds(
      orig,
      pointerDownState.originalElements,
    );

    for (const sibling of elementsMap.values()) {
      if (
        sibling.isDeleted ||
        sibling.id === element.id ||
        sibling.frameId !== parentFrameId ||
        !isTerraformConstraintBox(sibling)
      ) {
        continue;
      }

      const siblingBounds = getElementBounds(sibling, elementsMap);
      if (!doBoundsIntersect(elementBounds, siblingBounds)) {
        continue;
      }

      const origSibling =
        pointerDownState.originalElements.get(sibling.id) ?? sibling;
      const origSiblingBounds = getElementBounds(
        origSibling,
        pointerDownState.originalElements,
      );

      if (!doBoundsIntersect(origElementBounds, origSiblingBounds)) {
        invalidElementIds.add(element.id);
        break;
      }
    }
  }

  return invalidElementIds;
};

/**
 * Snap invalid Terraform drops to pointer-down coordinates and restore detached labels.
 */
export const restoreInvalidTerraformDraggedElements = (
  scene: Scene,
  pointerDownState: PointerDownState,
  invalidElementIds: ReadonlySet<string>,
  selectedElements: readonly NonDeletedExcalidrawElement[] = [],
): void => {
  if (invalidElementIds.size === 0) {
    return;
  }

  const labelByVisibilityKey = new Map<string, NonDeletedExcalidrawElement>();
  for (const element of scene.getNonDeletedElements()) {
    if (element.type !== "text") {
      continue;
    }
    const cd = getCustomData(element);
    if (
      cd.terraform === true &&
      cd.terraformVisibilityRole === "resource" &&
      typeof cd.nodePath === "string"
    ) {
      const key = getTerraformVisibilityKey(element);
      if (key) {
        labelByVisibilityKey.set(key, element);
      }
    }
  }

  for (const elementId of invalidElementIds) {
    const element = scene.getElement(elementId);
    const orig = pointerDownState.originalElements.get(elementId);
    if (!element || !orig || element.isDeleted || orig.isDeleted) {
      continue;
    }

    const dx = orig.x - element.x;
    const dy = orig.y - element.y;
    scene.mutateElement(element, {
      x: orig.x,
      y: orig.y,
    });

    if (isFrameLikeElement(element)) {
      const descendants = getFrameDescendants(
        scene.getNonDeletedElementsMap(),
        element.id,
      );
      for (const descendant of descendants) {
        scene.mutateElement(descendant, {
          x: descendant.x + dx,
          y: descendant.y + dy,
        });
      }
    }

    if (!isTerraformResourceRectangle(element)) {
      continue;
    }

    const key = getTerraformVisibilityKey(element);
    if (!key) {
      continue;
    }
    const label = labelByVisibilityKey.get(key);
    if (!label || label.id === element.id) {
      continue;
    }
    const origLabel = pointerDownState.originalElements.get(label.id);
    if (!origLabel || origLabel.isDeleted) {
      continue;
    }
    scene.mutateElement(label, { x: origLabel.x, y: origLabel.y });
  }

  // Restore all selected Terraform companion glyphs/text that moved with the card.
  for (const selectedElement of selectedElements) {
    const orig = pointerDownState.originalElements.get(selectedElement.id);
    if (!orig || orig.isDeleted || selectedElement.isDeleted) {
      continue;
    }
    if (selectedElement.customData?.terraform !== true) {
      continue;
    }
    if (
      selectedElement.x === orig.x &&
      selectedElement.y === orig.y &&
      selectedElement.frameId === orig.frameId
    ) {
      continue;
    }
    scene.mutateElement(selectedElement, {
      x: orig.x,
      y: orig.y,
      frameId: orig.frameId ?? null,
    });
  }
};

// --- Element classification (roles written by the backend exporter) ---

const isTerraformGraphElement = (element: ExcalidrawElement) =>
  Boolean(getCustomData(element).terraformVisibilityRole);

const isTerraformGroupElement = (element: ExcalidrawElement) =>
  getCustomData(element).terraformVisibilityRole === "group";

const isExplodableTerraformElement = (element: ExcalidrawElement) =>
  getCustomData(element).terraformNodeKind === "category" ||
  getCustomData(element).terraformNodeKind === "resource";

const isInitiallyVisibleTerraformElement = (element: ExcalidrawElement) =>
  getCustomData(element).terraformInitiallyVisible === true;

const clearPreviewCustomData = (
  customData: ExcalidrawElement["customData"],
) => {
  const nextCustomData = { ...(customData ?? {}) };
  delete nextCustomData.terraformPreview;
  delete nextCustomData.terraformPreviewOwner;
  delete nextCustomData.terraformDependencyPreview;
  return nextCustomData;
};

// --- Explode: parent/child keys for progressive disclosure ---

const getVisibleTerraformKeys = (elements: readonly ExcalidrawElement[]) => {
  const visibleKeys = new Set<string>();
  for (const element of elements) {
    const key = getTerraformVisibilityKey(element);
    if (
      key &&
      !element.isDeleted &&
      isTerraformGraphElement(element) &&
      !isTerraformGroupElement(element)
    ) {
      visibleKeys.add(key);
    }
  }
  return visibleKeys;
};

const getTerraformParentKeys = (element: ExcalidrawElement) => {
  const customData = getCustomData(element);
  const parents = new Set<string>();

  if (typeof customData.terraformExplodeParent === "string") {
    parents.add(customData.terraformExplodeParent);
  }

  if (Array.isArray(customData.terraformExplodeParentKeys)) {
    for (const parent of customData.terraformExplodeParentKeys) {
      if (typeof parent === "string") {
        parents.add(parent);
      }
    }
  }

  return parents;
};

const getDirectChildKeys = (
  elements: readonly ExcalidrawElement[],
  parentKey: string,
) => {
  const childKeys = new Set<string>();
  for (const element of elements) {
    const key = getTerraformVisibilityKey(element);
    if (
      key &&
      isTerraformGraphElement(element) &&
      !isTerraformGroupElement(element) &&
      getTerraformParentKeys(element).has(parentKey)
    ) {
      childKeys.add(key);
    }
  }
  return childKeys;
};

const getDescendantKeys = (
  elements: readonly ExcalidrawElement[],
  parentKey: string,
) => {
  const descendants = new Set<string>();
  let didAdd = true;

  while (didAdd) {
    didAdd = false;
    for (const element of elements) {
      const key = getTerraformVisibilityKey(element);
      const parentKeys = getTerraformParentKeys(element);
      if (
        key &&
        !isTerraformGroupElement(element) &&
        !descendants.has(key) &&
        (parentKeys.has(parentKey) ||
          [...parentKeys].some((parent) => descendants.has(parent)))
      ) {
        descendants.add(key);
        didAdd = true;
      }
    }
  }

  return descendants;
};

// --- Edge visibility (endpoints must exist on screen) ---

const edgeEndpointsAreVisible = (
  element: ExcalidrawElement,
  visibleKeys: Set<string>,
  elementsById: Map<string, ExcalidrawElement>,
) => {
  const relationship = getCustomData(element).relationship;
  if (
    typeof relationship?.source !== "string" ||
    typeof relationship?.target !== "string"
  ) {
    return false;
  }

  if (getTerraformEdgeLayer(element) === "topologyFrameFlow") {
    const frameForTopologyKey = (key: string) => {
      for (const candidate of elementsById.values()) {
        if (
          candidate.isDeleted ||
          candidate.type !== "frame" ||
          getCustomData(candidate).terraformTopologyKey !== key
        ) {
          continue;
        }
        return candidate;
      }
      return undefined;
    };
    return Boolean(
      frameForTopologyKey(relationship.source) &&
        frameForTopologyKey(relationship.target),
    );
  }

  return (
    visibleKeys.has(relationship.source) && visibleKeys.has(relationship.target)
  );
};

const groupHasVisibleChild = (
  element: ExcalidrawElement,
  visibleKeys: Set<string>,
) => {
  const childKeys = getCustomData(element).terraformGroupChildKeys;
  return Boolean(
    Array.isArray(childKeys) &&
      childKeys.some((key) => typeof key === "string" && visibleKeys.has(key)),
  );
};

const deriveLayerState = (
  elements: readonly ExcalidrawElement[],
  overrides: TerraformVisibilityReconcileOverrides = {},
) => {
  if (overrides.pins != null) {
    return {
      dependencyLayerEnabled: overrides.pins.dependency,
      dataFlowLayerEnabled: overrides.pins.dataFlow,
      declaredDataFlowLayerEnabled: overrides.pins.declaredDataFlow,
      networkingLayerEnabled: overrides.pins.networking,
      topologyFrameFlowLayerEnabled: overrides.pins.topologyFrameFlow,
    };
  }
  return {
    dependencyLayerEnabled:
      overrides.dependencyLayerEnabled ??
      elements.some(
        (element) => getTerraformEdgeLayer(element) === "dependency",
      ),
    dataFlowLayerEnabled:
      overrides.dataFlowLayerEnabled ??
      elements.some((element) => getTerraformEdgeLayer(element) === "dataFlow"),
    declaredDataFlowLayerEnabled:
      overrides.declaredDataFlowLayerEnabled ??
      elements.some(
        (element) => getTerraformEdgeLayer(element) === "declaredDataFlow",
      ),
    networkingLayerEnabled:
      overrides.networkingLayerEnabled ??
      elements.some(
        (element) => getTerraformEdgeLayer(element) === "networking",
      ),
    topologyFrameFlowLayerEnabled:
      overrides.topologyFrameFlowLayerEnabled ??
      elements.some(
        (element) => getTerraformEdgeLayer(element) === "topologyFrameFlow",
      ),
  };
};

const isTerraformNetworkingDependencyEdge = (element: ExcalidrawElement) =>
  getTerraformEdgeLayer(element) === "networking" &&
  getCustomData(element).relationship &&
  typeof getCustomData(element).relationship === "object" &&
  (getCustomData(element).relationship as { type?: string }).type ===
    "networking_dependency";

/**
 * Pure core of {@link collectTerraformStructuralDependencyPairKeys}: reads only
 * `customData`, so it runs on element-time elements AND on skeleton-time
 * skeletons (the strata edge-style pass needs the same pair-key set BEFORE
 * conversion to match repair's 18px structural-dependency offset). Mirrors
 * `getTerraformEdgeLayer` + `isTerraformNetworkingDependencyEdge` inline.
 */
export const collectTerraformStructuralDependencyPairKeysFromItems = (
  items: readonly { customData?: Record<string, unknown> | null }[],
): Set<string> => {
  const keys = new Set<string>();
  for (const item of items) {
    const cd = item.customData ?? {};
    const layer = cd.terraformEdgeLayer;
    const isNetworkingDependency =
      layer === "networking" &&
      typeof cd.relationship === "object" &&
      cd.relationship !== null &&
      (cd.relationship as { type?: string }).type === "networking_dependency";
    if (layer !== "dependency" && !isNetworkingDependency) {
      continue;
    }
    const relationship = cd.relationship as
      | { source?: unknown; target?: unknown }
      | undefined;
    if (
      typeof relationship?.source === "string" &&
      typeof relationship?.target === "string"
    ) {
      keys.add([relationship.source, relationship.target].sort().join("|||"));
    }
  }
  return keys;
};

/** Unordered pairs that have a DOT structural dependency line (generic or networking-primitive subset). */
const collectTerraformStructuralDependencyPairKeys = (
  elements: readonly ExcalidrawElement[],
) => collectTerraformStructuralDependencyPairKeysFromItems(elements);

/**
 * Pure core of {@link collectTerraformResourceRects}: keys resource-role CARD
 * rectangles (skip AWS icon glyphs, skip non-rectangles), last-wins on duplicate
 * keys. Generic over `customData`-bearing items so the strata scene build can
 * key the SKELETON rectangles the same way repair keys the converted elements —
 * the styled polyline then clips to the SAME body rect repair validates against.
 * (The original also gated on `isBindableElement`; every terraform card is a
 * rectangle, and the explicit `type !== "rectangle"` skip below subsumes it, so
 * the resulting map is identical.)
 */
export const collectTerraformResourceRectsByKey = <
  T extends {
    type?: string;
    isDeleted?: boolean;
    customData?: Record<string, unknown> | null;
  },
>(
  items: readonly T[],
): Map<string, T> => {
  const rects = new Map<string, T>();
  for (const item of items) {
    if (item.isDeleted || item.type !== "rectangle") {
      continue;
    }
    const customData = item.customData ?? {};
    if (customData.terraformAwsIconGlyph === true) {
      continue;
    }
    if (customData.terraformVisibilityRole !== "resource") {
      continue;
    }
    const key = getTerraformVisibilityKey(item as unknown as ExcalidrawElement);
    if (key) {
      rects.set(key, item);
    }
  }
  return rects;
};

const collectTerraformResourceRects = (
  elements: readonly ExcalidrawElement[],
): Map<string, ExcalidrawBindableElement> =>
  collectTerraformResourceRectsByKey(elements) as Map<
    string,
    ExcalidrawBindableElement
  >;

// --- Arrow geometry (mirrors backend binding math for client-side updates) ---

/**
 * Recomputes Terraform dependency / data-flow / networking edge geometry and orbit
 * bindings from current resource rectangle positions. Call after visibility toggles
 * so edges stay attached when soft-delete temporarily cleared edge bindings.
 */
const bindingPointsEqual = (
  a: [number, number] | undefined,
  b: [number, number] | undefined,
): boolean => {
  if (!a || !b) {
    return a === b;
  }
  return Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
};

const arrowGeometryEqual = (
  element: ExcalidrawElement,
  patch: {
    x: number;
    y: number;
    width: number;
    height: number;
    points: readonly (readonly [number, number])[];
    startBinding?: { elementId: string; fixedPoint: [number, number] };
    endBinding?: { elementId: string; fixedPoint: [number, number] };
  },
): boolean => {
  if (!isLinearElement(element)) {
    return false;
  }
  if (
    Math.abs(element.x - patch.x) > 0.01 ||
    Math.abs(element.y - patch.y) > 0.01 ||
    Math.abs(element.width - patch.width) > 0.01 ||
    Math.abs(element.height - patch.height) > 0.01
  ) {
    return false;
  }
  if (
    !element.points ||
    element.points.length !== patch.points.length ||
    element.points.some(
      (point, index) =>
        Math.abs(point[0] - patch.points[index][0]) > 0.01 ||
        Math.abs(point[1] - patch.points[index][1]) > 0.01,
    )
  ) {
    return false;
  }
  const start = element.startBinding;
  const end = element.endBinding;
  if (
    start?.elementId !== patch.startBinding?.elementId ||
    end?.elementId !== patch.endBinding?.elementId ||
    !bindingPointsEqual(start?.fixedPoint, patch.startBinding?.fixedPoint) ||
    !bindingPointsEqual(end?.fixedPoint, patch.endBinding?.fixedPoint)
  ) {
    return false;
  }
  return true;
};

/** Provenance of a stamped routed polyline (`customData.terraformRoutedBy`).
 * Live stampers (2026-07-23 edge simplification): the style pass ("style",
 * endpoints on cards) and its box-endpoints mode ("clip", endpoints on
 * leaf-cluster FRAME borders, validated through the typed clip gate below
 * rather than the endpoint-on-card check). "channel"/"route"/"border" have no
 * remaining stamper — the router passes were deleted — but stay in the union
 * so legacy saved scenes carrying those stamps keep validating through the
 * generic endpoint-on-card gate exactly as before the deletion. */
export type TerraformRoutedBy =
  | "style"
  | "channel"
  | "route"
  | "border"
  | "clip";

/** One end of a clip-routed polyline's serialized anchor
 * (`customData.terraformClipAnchor.start` / `.end`), stamped by whichever pass
 * terminates edge endpoints on the leaf-cluster frame border (the box-endpoints
 * pass): `frameKey` is the endpoint's CLUSTER ADDRESS (===
 * `relationship.source`/`.target` === the leaf cluster frame's
 * `terraformPrimaryAddress`), `side` the declared clip face — any of the four
 * frame faces, or `"card"` for the per-end fallback where this endpoint
 * terminates on the resource CARD as usual (mixed edges: one end boxed, the
 * other not). */
export type TerraformClipAnchorEnd = {
  frameKey: string;
  side: "left" | "right" | "top" | "bottom" | "card";
};

type TerraformClipAnchor = {
  start: TerraformClipAnchorEnd;
  end: TerraformClipAnchorEnd;
};

/** Max px a clip endpoint may sit off its declared frame face (perpendicular
 * axis) or outside the face's extent (parallel axis) before repair flattens it. Clip
 * endpoints are stamped EXACTLY on the face at skeleton time and the frame is
 * emitted at the identical box, so 2px is pure float slack — any real frame
 * move lands far outside it (the stale-route threat, see
 * `ROUTED_ANCHOR_TOLERANCE`'s header). */
const TERRAFORM_CLIP_FACE_TOLERANCE = 2;

const parseClipAnchorEnd = (v: unknown): TerraformClipAnchorEnd | null => {
  const o = v as { frameKey?: unknown; side?: unknown } | null | undefined;
  if (
    o &&
    typeof o.frameKey === "string" &&
    (o.side === "left" ||
      o.side === "right" ||
      o.side === "top" ||
      o.side === "bottom" ||
      o.side === "card")
  ) {
    return { frameKey: o.frameKey, side: o.side };
  }
  return null;
};

const parseClipAnchor = (v: unknown): TerraformClipAnchor | null => {
  const o = v as { start?: unknown; end?: unknown } | null | undefined;
  const start = o ? parseClipAnchorEnd(o.start) : null;
  const end = o ? parseClipAnchorEnd(o.end) : null;
  return start && end ? { start, end } : null;
};

/**
 * LEAF CLUSTER frame rects by cluster address, for the clip repair gate: every
 * non-deleted `type:"frame"` element whose customData carries
 * `terraformTopologyRole:"primaryCluster"` and a string
 * `terraformPrimaryAddress`, keyed by that address (last-wins, mirroring
 * `collectTerraformResourceRects`' duplicate policy). BOTH cluster builders
 * stamp the pair (compact: terraformTopologyLayout.ts
 * `buildCompactPipelinePrimaryCluster`; full: the RCLL-M5 gate-fix in
 * `buildTopologyPrimaryClusterSkeletonForPipeline`; fallback:
 * `buildFallbackCluster`), and customData survives conversion + the strata
 * finalize's id rewrite — so the address is the ONLY frame key that is stable
 * at element time across both modes (frame element ids are NOT: the finalize
 * re-derives them).
 *
 * SKELETON-SIDE TWIN: `collectStrataPrimaryClusterRectsByAddress`
 * (terraformPipelineStrataSceneBuild.ts) collects the SAME address→rect map
 * from the scene SKELETON for the M6 box-endpoints style pass. The two MUST
 * STAY IN LOCKSTEP (same frame/role/address predicate, same last-wins
 * duplicate policy) — the styler stamps clip endpoints against that map and
 * this gate validates them against this one; any predicate drift flattens
 * every clip-stamped edge. The twin carries ONE deliberate extra exclusion
 * (frames at coordinate exactly 0 on either axis — the conversion falsy-zero
 * trap re-derives that axis from children, so the skeleton rect is not the
 * final rect this gate sees; see the twin's doc comment). Parity is pinned by
 * terraformStrataBoxEndpoints.test.ts.
 */
export const collectTerraformClusterFrameRectsByAddress = (
  elements: readonly ExcalidrawElement[],
): Map<string, { x: number; y: number; width: number; height: number }> => {
  const rects = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  for (const el of elements) {
    if (el.isDeleted || el.type !== "frame") {
      continue;
    }
    const cd = getCustomData(el);
    if (cd.terraformTopologyRole !== "primaryCluster") {
      continue;
    }
    const address = cd.terraformPrimaryAddress;
    if (typeof address !== "string") {
      continue;
    }
    rects.set(address, {
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
    });
  }
  return rects;
};

/**
 * M3 curve-flatten telemetry (opt-in). `repairTerraformEdgeBindings` accepts an
 * optional mutable out-object it accumulates into, so the styled-vs-survived gap
 * is PERMANENTLY observable: the M2 bug shipped invisibly because
 * `strataEdgeStyleStyled` counted styling ATTEMPTS while repair silently
 * flattened 62% of them downstream. This records how many stamped routed
 * polylines repair SAW, KEPT (honoured the detour geometry), or FLATTENED back
 * to a straight chord, plus the stale markers it stripped — each with a
 * per-provenance (`terraformRoutedBy`) breakdown. Passing no object is
 * byte-identical to before (a handful of skipped increments otherwise).
 */
export type TerraformEdgeRepairStats = {
  /** Stamped routed polylines (`terraformRoutedPolyline === true`) repair saw. */
  routedSeen: number;
  /** Routed polylines whose detour geometry repair KEPT (endpoints on cards). */
  routedKept: number;
  /** Routed polylines repair FLATTENED to a straight chord (gate mismatch). */
  routedFlattened: number;
  /** Stale/foreign routed markers repair stripped so an arrow self-heals. */
  staleMarkersStripped: number;
  /** `routedKept` broken down by `terraformRoutedBy` provenance. */
  keptBy: Record<string, number>;
  /** `routedFlattened` broken down by `terraformRoutedBy` provenance. */
  flattenedBy: Record<string, number>;
  /**
   * Stamped routed polylines repair could NOT evaluate (invalid relationship
   * or unresolved source/target rect) — the arrow keeps its stamp untouched
   * but contributes to neither `routedKept` nor `routedFlattened`. Nonzero
   * means the headline pair understates the stamped population.
   */
  routedUnresolved: number;
};

/** A fresh, zeroed {@link TerraformEdgeRepairStats} accumulator. */
export const createTerraformEdgeRepairStats = (): TerraformEdgeRepairStats => ({
  routedSeen: 0,
  routedKept: 0,
  routedFlattened: 0,
  staleMarkersStripped: 0,
  keptBy: {},
  flattenedBy: {},
  routedUnresolved: 0,
});

export const repairTerraformEdgeBindings = (
  elements: readonly ExcalidrawElement[],
  stats?: TerraformEdgeRepairStats,
): ExcalidrawElement[] => {
  /** Legacy scenes used `line`; Excalidraw binding updates only run for `arrow`. */
  const normalizedElements = elements.map((element) => {
    if (
      getTerraformEdgeLayer(element) &&
      isLinearElement(element) &&
      element.type === "line" &&
      (element.startBinding ?? element.endBinding)
    ) {
      return newElementWith(element, { type: "arrow" });
    }
    return element;
  });

  const resourceRects = collectTerraformResourceRects(normalizedElements);
  const structuralDependencyPairKeys =
    collectTerraformStructuralDependencyPairKeys(normalizedElements);

  // Clip repair gate (loop-2 E2.2): leaf-cluster frame rects by address,
  // built LAZILY on the first "clip"-provenance polyline encountered — a
  // scene with no clip edges (every scene with the flag off) never pays the
  // collection pass and repair is byte-identical to before.
  let clusterFrameRects: ReturnType<
    typeof collectTerraformClusterFrameRectsByAddress
  > | null = null;
  const getClusterFrameRects = () =>
    (clusterFrameRects ??=
      collectTerraformClusterFrameRectsByAddress(normalizedElements));

  const boundEdgeIdsByRect = new Map<string, Set<string>>();

  const addBoundEdge = (rectId: string, edgeId: string) => {
    let set = boundEdgeIdsByRect.get(rectId);
    if (!set) {
      set = new Set();
      boundEdgeIdsByRect.set(rectId, set);
    }
    set.add(edgeId);
  };

  const updated = normalizedElements.map((element) => {
    const layer = getTerraformEdgeLayer(element);
    if (
      !layer ||
      !isLinearElement(element) ||
      element.isDeleted ||
      element.points.length < 2
    ) {
      return element;
    }

    const relationship = getCustomData(element).relationship;
    if (
      typeof relationship?.source !== "string" ||
      typeof relationship?.target !== "string"
    ) {
      if (stats && getCustomData(element).terraformRoutedPolyline === true) {
        stats.routedUnresolved += 1;
      }
      return element;
    }

    const rectA = resourceRects.get(relationship.source);
    const rectB = resourceRects.get(relationship.target);
    if (!rectA || !rectB) {
      if (stats && getCustomData(element).terraformRoutedPolyline === true) {
        stats.routedUnresolved += 1;
      }
      return element;
    }

    const posA = { x: rectA.x, y: rectA.y };
    const posB = { x: rectB.x, y: rectB.y };
    const wA = rectA.width;
    const hA = rectA.height;
    const wB = rectB.width;
    const hB = rectB.height;

    let startPoint: { x: number; y: number };
    let endPoint: { x: number; y: number };
    let startFixed: [number, number];
    let endFixed: [number, number];

    if (
      layer === "dependency" ||
      isTerraformNetworkingDependencyEdge(element)
    ) {
      const pts = getCenterClippedBindingPoints(posA, posB, wA, hA, wB, hB);
      startPoint = pts.startPoint;
      endPoint = pts.endPoint;
      startFixed = pts.startFixed;
      endFixed = pts.endFixed;
    } else {
      const pairKey = [relationship.source, relationship.target]
        .sort()
        .join("|||");
      // Delegates to the SHARED anchor helper the strata edge-style pass also
      // consumes, so a styled polyline's endpoints and repair's re-derived
      // anchors are byte-identical (validate-before-trust gate passes by
      // construction; see terraformEdgeAnchors.ts).
      const shifted = computeTerraformChordAnchors(rectA, rectB, {
        structuralPair: structuralDependencyPairKeys.has(pairKey),
      });
      startPoint = shifted.startPoint;
      endPoint = shifted.endPoint;
      startFixed = fixedPointForAbsolutePoint(rectA, shifted.startPoint);
      endFixed = fixedPointForAbsolutePoint(rectB, shifted.endPoint);
    }

    const startX = startPoint.x;
    const startY = startPoint.y;
    const endX = endPoint.x;
    const endY = endPoint.y;

    addBoundEdge(rectA.id, element.id);
    addBoundEdge(rectB.id, element.id);

    // Strata Package C (W9): a marked routed polyline (stamped by the
    // edge-style pass; legacy scenes may carry the deleted router passes'
    // stamps) keeps its detour geometry — its
    // endpoints attach to the source/target cards, so only the bindings are
    // (re)anchored and the straight-chord flatten below is skipped. Unmarked
    // arrows (every scene today with the flag off) are unaffected.
    //
    // Validate-before-trust: the `terraformRoutedPolyline` marker is serialized,
    // so it survives restore / duplication / paste. A stale, pasted, or foreign
    // arrow can carry the flag while its binding re-anchors to a card that has
    // since moved — trusting it blindly keeps the old detour geometry against a
    // moved target. So the marker is only honoured when BOTH polyline endpoints
    // still sit on their bound cards; a legit routed endpoint attaches within a
    // small strata pad of its card (measured ~38.5 px, W9 battery, 322 edges),
    // whereas a re-anchored/foreign endpoint lands far away. On mismatch the
    // arrow is flattened to the standard chord AND the stale marker is stripped
    // so it self-heals. (Comparing endpoints to the freshly recomputed
    // centre-clipped chord anchors does NOT work: the router's card-attach
    // convention differs from that clip by the same ~38.5 px on every legit
    // arrow, which would flatten all of them.)
    const hasRoutedFlag =
      getCustomData(element).terraformRoutedPolyline === true;
    const hasRoutedMarker = hasRoutedFlag && element.points.length > 2;
    const firstPoint = element.points[0]!;
    const lastPoint = element.points[element.points.length - 1]!;
    // ── Typed CLIP gate (loop-2 E2.2; generalized to 4 faces + per-end card
    // fallback for the box-endpoints pass). A "clip"-provenance polyline
    // terminates ON the leaf-cluster FRAME borders — typically far beyond
    // ROUTED_ANCHOR_TOLERANCE from the card body rects — so the
    // endpoint-on-card check below would flatten every one of them. Instead,
    // when the arrow carries valid `terraformClipAnchor` data, each endpoint
    // is validated against the LIVE frame rect resolved from the anchor's
    // frameKey:
    //   • frameKey must EQUAL the relationship endpoint's cluster address —
    //     the strongest ancestry check serialized data affords: it pins the
    //     frame as the endpoint's IMMEDIATE containment box (the leaf cluster
    //     frame carries `terraformPrimaryAddress` === that address in both
    //     compact and full modes), so a pasted/foreign anchor naming any other
    //     frame fails closed. This holds UNIFORMLY for all sides, including
    //     the "card" fallback below;
    //   • the endpoint must sit ON the declared face of that live rect. The
    //     check is deliberately ASYMMETRIC per face
    //     (`clipEndpointOnDeclaredFace`) — RIGID on the face's perpendicular
    //     axis, FREE along the face's extent:
    //       – left/right: |px − faceX| ≤ TERRAFORM_CLIP_FACE_TOLERANCE (2px),
    //         py free within [rect.y, rect.y+height] (±2px).
    //       – top/bottom: |py − faceY| ≤ TERRAFORM_CLIP_FACE_TOLERANCE (2px),
    //         px free within [rect.x, rect.x+width] (±2px).
    //     The port is stamped EXACTLY on the face at skeleton time and the
    //     frame is emitted at the identical box, so the only legitimate
    //     perpendicular slack is the ≤0.5px layout quantization (half-pixel
    //     band coords) plus ~1.5px float headroom. A frame that MOVED on the
    //     perpendicular axis (the stale-route threat above) misses by far more
    //     than 2px, so the tight bound fails it closed. The free axis is
    //     INTENTIONAL, not laxness — the stamping pass assigns per-face ports
    //     by opposite-endpoint order and re-spreads them across the face
    //     extent, so a legit endpoint's parallel coordinate is NOT pinned to
    //     its skeleton value; the face EXTENT is the invariant we can check.
    //     (This asymmetry is why the gate branches on the declared axis rather
    //     than using a generic perimeter-distance test, which would lose the
    //     face binding at corners.) A frame that moved so far its extent no
    //     longer covers the port's parallel coordinate still fails via the
    //     extent bound.
    //   • side "card" is the per-end FALLBACK: this endpoint terminates on the
    //     resource CARD as usual (mixed edges — one end boxed on a frame face,
    //     the other not), so it validates against its bound CARD rect with the
    //     same ROUTED_ANCHOR_TOLERANCE (48px) chebyshev rule the generic
    //     routed gate uses. The frameKey ancestry equality still applies.
    //   • ANY combination of parsed sides is legal; both ends must
    //     individually pass.
    // On ANY failure — missing/malformed anchors, unresolved frame, moved
    // frame — the arrow is flattened to the standard chord and the marker AND
    // anchors are stripped (fail-closed, self-healing), exactly like a stale
    // card-anchored route.
    //
    // BINDINGS are deliberately UNCHANGED for clip polylines: start/end
    // bindings stay on the leaf CARDS with fixedPoints derived from the
    // freshly recomputed chord anchors above — which lie on the card rects
    // regardless of where the polyline endpoints sit — and
    // `fixedPointForAbsolutePoint` clamps to [0,1], so an endpoint off the
    // card can never produce an out-of-range fixedPoint. The clip endpoints
    // living on the frame borders is purely a `points` geometry fact.
    const isClipProvenance =
      hasRoutedFlag && getCustomData(element).terraformRoutedBy === "clip";
    const clipAnchor = isClipProvenance
      ? parseClipAnchor(getCustomData(element).terraformClipAnchor)
      : null;
    const clipEndpointOnDeclaredFace = (
      px: number,
      py: number,
      anchor: TerraformClipAnchorEnd,
      expectedKey: string,
      card: { x: number; y: number; width: number; height: number },
    ): boolean => {
      if (anchor.frameKey !== expectedKey) {
        return false;
      }
      if (anchor.side === "card") {
        // Per-end card fallback: same 48px chebyshev rule as the generic
        // routed gate, against this endpoint's bound CARD rect.
        return (
          chebyshevDistanceOutsideRect(
            px,
            py,
            card.x,
            card.y,
            card.width,
            card.height,
          ) <= ROUTED_ANCHOR_TOLERANCE
        );
      }
      const rect = getClusterFrameRects().get(anchor.frameKey);
      if (!rect) {
        return false;
      }
      if (anchor.side === "left" || anchor.side === "right") {
        const faceX = anchor.side === "left" ? rect.x : rect.x + rect.width;
        return (
          Math.abs(px - faceX) <= TERRAFORM_CLIP_FACE_TOLERANCE &&
          py >= rect.y - TERRAFORM_CLIP_FACE_TOLERANCE &&
          py <= rect.y + rect.height + TERRAFORM_CLIP_FACE_TOLERANCE
        );
      }
      const faceY = anchor.side === "top" ? rect.y : rect.y + rect.height;
      return (
        Math.abs(py - faceY) <= TERRAFORM_CLIP_FACE_TOLERANCE &&
        px >= rect.x - TERRAFORM_CLIP_FACE_TOLERANCE &&
        px <= rect.x + rect.width + TERRAFORM_CLIP_FACE_TOLERANCE
      );
    };
    const clipEndpointsOnFrames =
      hasRoutedMarker &&
      clipAnchor !== null &&
      clipEndpointOnDeclaredFace(
        element.x + firstPoint[0],
        element.y + firstPoint[1],
        clipAnchor.start,
        relationship.source,
        rectA,
      ) &&
      clipEndpointOnDeclaredFace(
        element.x + lastPoint[0],
        element.y + lastPoint[1],
        clipAnchor.end,
        relationship.target,
        rectB,
      );
    const routedEndpointsOnCards =
      !isClipProvenance &&
      hasRoutedMarker &&
      chebyshevDistanceOutsideRect(
        element.x + firstPoint[0],
        element.y + firstPoint[1],
        posA.x,
        posA.y,
        wA,
        hA,
      ) <= ROUTED_ANCHOR_TOLERANCE &&
      chebyshevDistanceOutsideRect(
        element.x + lastPoint[0],
        element.y + lastPoint[1],
        posB.x,
        posB.y,
        wB,
        hB,
      ) <= ROUTED_ANCHOR_TOLERANCE;
    const isRoutedPolyline =
      hasRoutedMarker &&
      (isClipProvenance ? clipEndpointsOnFrames : routedEndpointsOnCards);
    // Strip the flag from any arrow we flatten — including a marked 2-point
    // arrow (no route to preserve), else the stale flag could resurrect later.
    const stripStaleMarker = hasRoutedFlag && !isRoutedPolyline;

    // M3 curve-flatten telemetry (opt-in): observe repair's keep/flatten/strip
    // verdict on every stamped routed polyline so the styled-vs-survived gap can
    // never go invisible again (the M2 bug: a styling count with no downstream
    // survival count). `stats` is undefined on every call that does not ask for
    // it → this whole block is skipped and the emitted geometry is unchanged.
    if (stats && hasRoutedFlag) {
      const routedBy = getCustomData(element).terraformRoutedBy;
      const provenance = typeof routedBy === "string" ? routedBy : "unknown";
      stats.routedSeen += 1;
      if (isRoutedPolyline) {
        stats.routedKept += 1;
        stats.keptBy[provenance] = (stats.keptBy[provenance] ?? 0) + 1;
      } else {
        stats.routedFlattened += 1;
        stats.flattenedBy[provenance] =
          (stats.flattenedBy[provenance] ?? 0) + 1;
      }
    }
    if (stats && stripStaleMarker) {
      stats.staleMarkersStripped += 1;
    }

    const patch = {
      ...(isRoutedPolyline
        ? {
            x: element.x,
            y: element.y,
            width: element.width,
            height: element.height,
            points: element.points,
          }
        : {
            x: startX,
            y: startY,
            width: Math.abs(endX - startX),
            height: Math.abs(endY - startY),
            points: [
              pointFrom<LocalPoint>(0, 0),
              pointFrom<LocalPoint>(endX - startX, endY - startY),
            ],
          }),
      ...(stripStaleMarker
        ? { customData: stripRoutedPolylineMarker(element.customData) }
        : {}),
      startBinding: {
        elementId: rectA.id,
        fixedPoint: startFixed,
        mode: "orbit" as const,
      },
      endBinding: {
        elementId: rectB.id,
        fixedPoint: endFixed,
        mode: "orbit" as const,
      },
    };

    // TRIPWIRES (owner Q11, LOG-ONLY; see terraformEdgeTripwire.ts). Observe the
    // connector points this declared edge just materialized — never mutate them.
    // Gated OFF by default, so the block below is a single cheap boolean in prod
    // and the emitted `patch` / element is byte-identical either way.
    if (isTerraformEdgeTripwireEnabled()) {
      // (a) SDEC-34 catch: a finite-guard on the center-clipped chord anchors.
      tripwireCheckConnectorPointFinite({
        edgeId: element.id,
        layer,
        guard: "connector-endpoint",
        axis: "startX",
        value: startX,
      });
      tripwireCheckConnectorPointFinite({
        edgeId: element.id,
        layer,
        guard: "connector-endpoint",
        axis: "startY",
        value: startY,
      });
      tripwireCheckConnectorPointFinite({
        edgeId: element.id,
        layer,
        guard: "connector-endpoint",
        axis: "endX",
        value: endX,
      });
      tripwireCheckConnectorPointFinite({
        edgeId: element.id,
        layer,
        guard: "connector-endpoint",
        axis: "endY",
        value: endY,
      });
      if (isRoutedPolyline) {
        element.points.forEach((point, index) => {
          tripwireCheckConnectorPointFinite({
            edgeId: element.id,
            layer,
            guard: "routed-polyline-point",
            axis: `point[${index}].x`,
            value: point[0],
          });
          tripwireCheckConnectorPointFinite({
            edgeId: element.id,
            layer,
            guard: "routed-polyline-point",
            axis: `point[${index}].y`,
            value: point[1],
          });
        });
      }
      // (b) per-edge collapse: the polyline this edge finished materializing.
      tripwireCheckEdgeSpan({
        edgeId: element.id,
        layer,
        points: patch.points as ReadonlyArray<readonly [number, number]>,
      });
    }

    // Never short-circuit past a pending marker strip: a marked 2-point arrow
    // whose flattened geometry already matches would otherwise keep the flag.
    if (!stripStaleMarker && arrowGeometryEqual(element, patch)) {
      return element;
    }

    return newElementWith(element, patch);
  });

  return updated.map((element) => {
    const edgeIds = boundEdgeIdsByRect.get(element.id);
    if (!edgeIds || !isBindableElement(element)) {
      return element;
    }

    let boundElements = element.boundElements?.slice() ?? [];
    for (const edgeId of edgeIds) {
      if (!boundElements.some((entry) => entry.id === edgeId)) {
        boundElements = boundElements.concat({
          id: edgeId,
          type: "arrow",
        });
      }
    }

    if (
      boundElements.length === (element.boundElements?.length ?? 0) &&
      boundElements.every(
        (entry, index) => element.boundElements?.[index]?.id === entry.id,
      )
    ) {
      return element;
    }

    return newElementWith(element, { boundElements });
  });
};

/** Applies soft-delete to edges and group wrappers based on visible resource keys and layer flags. */
export const reconcileTerraformVisibility = (
  elements: readonly ExcalidrawElement[],
  overrides: TerraformVisibilityReconcileOverrides = {},
) => {
  const visibleKeys = getVisibleTerraformKeys(elements);
  const elementsById = new Map(
    elements.map((element) => [element.id, element]),
  );
  const layerState = deriveLayerState(elements, overrides);
  const semanticScene = isTerraformSemanticOverviewScene(elements);
  const pinMode = overrides.pins != null;
  const hoverPeekKey =
    pinMode && overrides.hoverPeekKey ? overrides.hoverPeekKey : null;

  return elements.map((element) => {
    if (isTerraformGroupElement(element)) {
      const shouldShow = groupHasVisibleChild(element, visibleKeys);
      if (
        element.isDeleted === !shouldShow &&
        (semanticScene || element.opacity === 100)
      ) {
        return element;
      }
      return newElementWith(element, {
        isDeleted: !shouldShow,
        ...(semanticScene ? {} : { opacity: 100 }),
        customData: clearPreviewCustomData(element.customData),
      });
    }

    const layer = getTerraformEdgeLayer(element);
    if (!layer) {
      return element;
    }

    const layerEnabled =
      layer === "dependency"
        ? layerState.dependencyLayerEnabled
        : layer === "dataFlow"
        ? layerState.dataFlowLayerEnabled
        : layer === "declaredDataFlow"
        ? layerState.declaredDataFlowLayerEnabled
        : layer === "topologyFrameFlow"
        ? layerState.topologyFrameFlowLayerEnabled
        : layerState.networkingLayerEnabled;

    const relationship = getCustomData(element).relationship as
      | { source?: unknown; target?: unknown }
      | undefined;
    const hoverTouches =
      hoverPeekKey &&
      typeof relationship?.source === "string" &&
      typeof relationship?.target === "string" &&
      (relationship.source === hoverPeekKey ||
        relationship.target === hoverPeekKey);

    const shouldShow =
      (layerEnabled || Boolean(hoverTouches)) &&
      edgeEndpointsAreVisible(element, visibleKeys, elementsById);

    if (
      element.isDeleted === !shouldShow &&
      (semanticScene || element.opacity === 100)
    ) {
      return element;
    }

    return newElementWith(element, {
      isDeleted: !shouldShow,
      ...(semanticScene ? {} : { opacity: 100 }),
      customData: clearPreviewCustomData(element.customData),
    });
  });
};

/**
 * Expands or collapses dependency neighbors of a category/resource card: toggles `terraformExploded`,
 * soft-hides non-primary children when collapsing, then reconciles visibility and edge bindings.
 */
export const toggleTerraformExplode = (
  elements: readonly ExcalidrawElement[],
  triggerElement: ExcalidrawElement,
  reconcileOverrides?: TerraformVisibilityReconcileOverrides,
) => {
  if (!isExplodableTerraformElement(triggerElement)) {
    return elements;
  }

  const triggerKey = getTerraformVisibilityKey(triggerElement);
  if (!triggerKey) {
    return elements;
  }

  const directChildren = getDirectChildKeys(elements, triggerKey);
  if (directChildren.size === 0) {
    return elements;
  }

  const isExpanded = elements.some(
    (element) =>
      getTerraformVisibilityKey(element) === triggerKey &&
      getCustomData(element).terraformExploded === true,
  );
  const affectedKeys = isExpanded
    ? getDescendantKeys(elements, triggerKey)
    : directChildren;
  const expandedKeys = new Set(
    elements
      .filter((element) => getCustomData(element).terraformExploded === true)
      .map(getTerraformVisibilityKey)
      .filter((key): key is string => Boolean(key) && key !== triggerKey),
  );

  const nextElements = elements.map((element) => {
    const key = getTerraformVisibilityKey(element);
    const customData = getCustomData(element);
    const isTrigger = key === triggerKey;
    const isAffected = key && affectedKeys.has(key);
    const visibleFromAnotherExpandedParent =
      isExpanded &&
      key &&
      [...getTerraformParentKeys(element)].some(
        (parentKey) =>
          expandedKeys.has(parentKey) && !affectedKeys.has(parentKey),
      );

    if (isTrigger) {
      return newElementWith(element, {
        customData: {
          ...clearPreviewCustomData(element.customData),
          terraformExploded: !isExpanded,
        },
      });
    }

    if (isAffected) {
      return newElementWith(element, {
        isDeleted:
          isExpanded &&
          !isInitiallyVisibleTerraformElement(element) &&
          !visibleFromAnotherExpandedParent,
        opacity: 100,
        customData: {
          ...clearPreviewCustomData(element.customData),
          terraformExploded: isExpanded ? false : customData.terraformExploded,
        },
      });
    }

    return element;
  });

  return repairTerraformEdgeBindings(
    reconcileTerraformVisibility(nextElements, reconcileOverrides),
  );
};

/** Keys that appear as `terraformExplodeParent` on at least one other element (explode triggers). */
const collectTerraformParentKeysWithChildren = (
  elements: readonly ExcalidrawElement[],
) => {
  const keysWithChildren = new Set<string>();
  for (const element of elements) {
    const key = getTerraformVisibilityKey(element);
    if (!key || isTerraformGroupElement(element)) {
      continue;
    }
    for (const parentKey of getTerraformParentKeys(element)) {
      keysWithChildren.add(parentKey);
    }
  }
  return keysWithChildren;
};

/**
 * True when the scene matches the fully-expanded outcome of
 * {@link expandAllTerraformExplode} (semantic overview uses `terraformExpandAllView`;
 * module-style graphs use `terraformExploded` vs {@link collectTerraformParentKeysWithChildren}).
 */
export const isTerraformExpandAllActive = (
  elements: readonly ExcalidrawElement[],
): boolean => {
  if (isTerraformSemanticOverviewScene(elements)) {
    let keyedResourceCount = 0;
    for (const e of elements) {
      const cd = getCustomData(e);
      if (cd.terraformVisibilityRole !== "resource") {
        continue;
      }
      const key = getTerraformVisibilityKey(e);
      if (!key) {
        continue;
      }
      keyedResourceCount++;
      if (cd.terraformExpandAllView !== true) {
        return false;
      }
    }
    return keyedResourceCount > 0;
  }

  const keysWithChildren = collectTerraformParentKeysWithChildren(elements);
  if (keysWithChildren.size === 0) {
    return false;
  }

  const keysOnResources = new Set(
    elements
      .filter((e) => getCustomData(e).terraformVisibilityRole === "resource")
      .map((e) => getTerraformVisibilityKey(e))
      .filter((k): k is string => Boolean(k)),
  );
  if (![...keysWithChildren].some((k) => keysOnResources.has(k))) {
    return false;
  }

  for (const element of elements) {
    const cd = getCustomData(element);
    if (cd.terraformVisibilityRole !== "resource") {
      continue;
    }
    const key = getTerraformVisibilityKey(element);
    if (!key) {
      continue;
    }
    const shouldExplode = keysWithChildren.has(key);
    if (Boolean(cd.terraformExploded) !== shouldExplode) {
      return false;
    }
  }

  return true;
};

/** Show every Terraform resource rectangle and mark explode triggers expanded. */
export const expandAllTerraformExplode = (
  elements: readonly ExcalidrawElement[],
  reconcileOverrides?: TerraformVisibilityReconcileOverrides,
): ExcalidrawElement[] => {
  const semanticScene = isTerraformSemanticOverviewScene(elements);
  const keysWithChildren = collectTerraformParentKeysWithChildren(elements);
  const next = elements.map((element) => {
    const customData = getCustomData(element);
    if (customData.terraformVisibilityRole !== "resource") {
      return element;
    }
    const key = getTerraformVisibilityKey(element);
    if (!key) {
      return element;
    }
    return newElementWith(element, {
      isDeleted: false,
      opacity: 100,
      customData: {
        ...clearPreviewCustomData(element.customData),
        terraformExploded: keysWithChildren.has(key),
        ...(semanticScene ? { terraformExpandAllView: true as const } : {}),
      },
    });
  });
  return repairTerraformEdgeBindings(
    reconcileTerraformVisibility(next, reconcileOverrides),
  );
};

/** Restore default visibility (primary types only) and collapse explode triggers. */
export const collapseAllTerraformExplode = (
  elements: readonly ExcalidrawElement[],
  reconcileOverrides?: TerraformVisibilityReconcileOverrides,
): ExcalidrawElement[] => {
  const semanticScene = isTerraformSemanticOverviewScene(elements);
  const next = elements.map((element) => {
    const customData = getCustomData(element);
    if (customData.terraformVisibilityRole !== "resource") {
      return element;
    }
    const key = getTerraformVisibilityKey(element);
    if (!key) {
      return element;
    }
    const shouldShow = isInitiallyVisibleTerraformElement(element);
    if (semanticScene) {
      return newElementWith(element, {
        isDeleted: false,
        opacity: 100,
        customData: {
          ...clearPreviewCustomData(element.customData),
          terraformExploded: false,
          terraformExpandAllView: false,
        },
      });
    }
    return newElementWith(element, {
      isDeleted: !shouldShow,
      opacity: 100,
      customData: {
        ...clearPreviewCustomData(element.customData),
        terraformExploded: false,
      },
    });
  });
  return repairTerraformEdgeBindings(
    reconcileTerraformVisibility(next, reconcileOverrides),
  );
};
