import { newElementWith } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  getTerraformGraphAddressForElement,
  isTerraformGroupElement,
  isTerraformLayerEdge,
  isTerraformResourceElement,
  isTerraformSemanticOverviewScene,
} from "./terraformElementMetadata";
import {
  dimmedTerraformElementOverrides,
  restoredTerraformElementOverrides,
} from "./terraformColorWash";
import {
  isTerraformExpandAllActive,
  getTerraformVisibilityKey,
  repairTerraformEdgeBindings,
} from "./terraformVisibility";

/**
 * Semantic dim levels (0–100). Identical numeric scale to the legacy `opacity` knobs
 * but applied as a color-wash factor (`1 - level / 100`) by `terraformColorWash`,
 * so dimmed elements still fully cover what's behind them on canvas. `level === 100`
 * means "no dimming" (and triggers a restore of any previously stashed colors).
 */
const TERRAFORM_FOCUS_NODE_LEVEL = 100;
const TERRAFORM_RELATED_LEVEL = 85;
/** Multi-hop focus: nodes two-plus hops out along the dataflow path. */
const TERRAFORM_RELATED_FAR_LEVEL = 55;
/**
 * Extended falloff (only when the effective hop cap exceeds the legacy
 * {@link TERRAFORM_FOCUS_MAX_HOPS}): nodes 3–4 hops out. At hop caps ≤ 3 the
 * far level above stays the terminal tier so legacy output is byte-identical.
 */
const TERRAFORM_RELATED_DEEP_LEVEL = 42;
/**
 * Extended falloff: nodes 5+ hops out. Deliberately above
 * {@link TERRAFORM_DIM_NODE_LEVEL} (25) so in-cone nodes always read brighter
 * than unrelated ones (figure-ground), no matter how deep the cone goes.
 */
const TERRAFORM_RELATED_VERY_DEEP_LEVEL = 34;
const TERRAFORM_CONTAINER_LEVEL = 60;
const TERRAFORM_DIM_NODE_LEVEL = 25;
const TERRAFORM_DIM_EDGE_LEVEL = 15;

/** Hops of dataflow neighborhood revealed on hover focus (degree-of-interest). */
const TERRAFORM_FOCUS_MAX_HOPS = 3;

/** Greyed dependency / data-flow edges when no node is focused. */
const TERRAFORM_AMBIENT_EDGE_LEVEL = 22;
/** Collapsed overview: non-primary resource cards. */
const TERRAFORM_AMBIENT_NON_PRIMARY_NODE_LEVEL = 35;
/** Collapsed overview: primary resource cards (see `terraformInitiallyVisible`). */
const TERRAFORM_AMBIENT_PRIMARY_NODE_LEVEL = 100;
/** Collapsed overview: account/region/VPC/module frame rectangles. */
const TERRAFORM_AMBIENT_GROUP_LEVEL = 68;

const DEFAULT_VIEW_BACKGROUND_COLOR = "#ffffff";

const getRelationship = (element: ExcalidrawElement) =>
  element.customData?.relationship &&
  typeof element.customData.relationship === "object"
    ? element.customData.relationship
    : null;

const getRelationshipEndpoints = (element: ExcalidrawElement) => {
  const relationship = getRelationship(element);
  const source =
    typeof relationship?.source === "string" ? relationship.source : null;
  const target =
    typeof relationship?.target === "string" ? relationship.target : null;

  return source && target ? { source, target } : null;
};

const getDirectionEndpointHints = (element: ExcalidrawElement) => {
  const relationship = getRelationship(element);
  if (!Array.isArray(relationship?.directions)) {
    return [];
  }

  return (relationship.directions as unknown[])
    .map((direction) => {
      if (!direction || typeof direction !== "object") {
        return null;
      }
      const entry = direction as { source?: unknown; target?: unknown };
      const source = typeof entry.source === "string" ? entry.source : null;
      const target = typeof entry.target === "string" ? entry.target : null;
      return source && target ? { source, target } : null;
    })
    .filter((direction): direction is { source: string; target: string } =>
      Boolean(direction),
    );
};

/**
 * Bound label text may omit `nodePath` while its container card has it. Without the
 * same address as the rectangle, related-node reveal leaves the label soft-deleted and
 * it never renders (`getBoundTextElement` only sees non-deleted elements).
 */
const resolveTerraformFocusNodePath = (
  element: ExcalidrawElement,
  elementById: ReadonlyMap<string, ExcalidrawElement>,
): string | null => {
  const own = getTerraformGraphAddressForElement(element);
  if (own) {
    return own;
  }
  if (
    element.type === "text" &&
    "containerId" in element &&
    typeof element.containerId === "string" &&
    element.containerId
  ) {
    return getTerraformGraphAddressForElement(
      elementById.get(element.containerId),
    );
  }
  return null;
};

const isTerraformResourceLikeElement = (
  element: ExcalidrawElement,
  elementById?: ReadonlyMap<string, ExcalidrawElement>,
) => {
  if (
    element.customData?.terraformVisibilityRole === "resource" ||
    isTerraformResourceElement(element)
  ) {
    return true;
  }
  if (
    elementById &&
    element.type === "text" &&
    "containerId" in element &&
    typeof element.containerId === "string" &&
    element.containerId
  ) {
    const container = elementById.get(element.containerId);
    return Boolean(
      container &&
        (container.customData?.terraformVisibilityRole === "resource" ||
          isTerraformResourceElement(container)),
    );
  }
  return false;
};

const isTerraformFocusManagedElement = (
  element: ExcalidrawElement,
  elementById?: ReadonlyMap<string, ExcalidrawElement>,
) =>
  isTerraformLayerEdge(element) ||
  isTerraformResourceLikeElement(element, elementById) ||
  isTerraformGroupElement(element);

const isParentGroupOfFocusedNode = (
  element: ExcalidrawElement,
  focusedNodePaths: Set<string>,
) => {
  const childKeys = element.customData?.terraformGroupChildKeys;
  return Boolean(
    Array.isArray(childKeys) &&
      childKeys.some(
        (key) => typeof key === "string" && focusedNodePaths.has(key),
      ),
  );
};

/**
 * Like {@link isParentGroupOfFocusedNode}, but only counts children within one
 * hop of the focus. Group reveal must obey the same ≤1-hop invariant as edges
 * and resources: with an uncapped hop budget the full `focusedNodePaths` cone
 * can reach arbitrarily far, and revealing a soft-deleted group that deep
 * fights the collapsed-overview visibility reconciler and never settles.
 */
const isParentGroupOfNearFocusedNode = (
  element: ExcalidrawElement,
  nodeDistance: ReadonlyMap<string, number>,
) => {
  const childKeys = element.customData?.terraformGroupChildKeys;
  return Boolean(
    Array.isArray(childKeys) &&
      childKeys.some(
        (key) => typeof key === "string" && (nodeDistance.get(key) ?? 99) <= 1,
      ),
  );
};

type PreviewAction = "set" | "clear" | "leave";

/**
 * Traversal direction over the declared-dependency edge graph
 * (`customData.relationship.source → target` is the declared dependency:
 * source *references* target).
 *
 * - `"both"`         — undirected (legacy behavior; the default).
 * - `"dependencies"` — follow `relationship.source → target` from the anchor:
 *                      what the anchor declares a dependency on (transitively).
 * - `"dependents"`   — follow the reverse (`target → source`): what declares a
 *                      dependency on the anchor (transitively).
 *
 * These names deliberately describe the declared-dependency direction only.
 * Whether readers perceive that axis as "flow" (and in which direction) is the
 * open Q7-AXIS question — no flow semantics are claimed here.
 */
export type TerraformFocusDirection = "both" | "dependencies" | "dependents";

export type TerraformFocusOptions = {
  direction?: TerraformFocusDirection;
  maxHops?: number;
};

/**
 * W13 F3 — THE hop-cap domain validator, shared by every boundary that
 * consumes or emits a finite hop cap (AppState ingress in
 * `useTerraformRelationshipFocusEffect`, the menu radio derivation in
 * `DefaultItems.TerraformFocusControls`, the share-URL emit in
 * `terraformCanvasShareUrl`, and the URL parse in `terraformDemoUrlParams`).
 * A finite hop cap is valid iff it is a non-negative SAFE integer —
 * `Number.isInteger` alone admits values like `1e21` that survive no JSON /
 * URL round-trip faithfully. The `-1` "unlimited" sentinel and `Infinity`
 * are handled separately at each boundary and are deliberately NOT part of
 * this predicate.
 */
export const isValidTerraformFocusHopCount = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

/**
 * Builds the wash + opacity + customData patch for one focus update step. Returns
 * `null` when nothing would change so the caller can keep the original reference.
 *
 * - `level >= 100` → restore stashed originals (if any) and ensure `opacity: 100`.
 * - `level < 100`  → blend stroke / background toward `viewBackgroundColor` and
 *   stash the originals under `customData.terraformDimmedOriginals`.
 * - `previewAction` toggles `customData.terraformFocusPreview` independently.
 */
const buildTerraformFocusUpdate = (
  element: ExcalidrawElement,
  level: number,
  nextIsDeleted: boolean,
  previewAction: PreviewAction,
  viewBackgroundColor: string,
): ExcalidrawElement | null => {
  const washPatch =
    level >= 100
      ? restoredTerraformElementOverrides(element)
      : dimmedTerraformElementOverrides(element, level, viewBackgroundColor);

  let nextCustomData: Record<string, any> = washPatch
    ? { ...washPatch.customData }
    : { ...(element.customData ?? {}) };

  if (previewAction === "set") {
    if (nextCustomData.terraformFocusPreview !== true) {
      nextCustomData = {
        ...nextCustomData,
        terraformFocusPreview: true,
      };
    }
  } else if (previewAction === "clear") {
    if (nextCustomData.terraformFocusPreview !== undefined) {
      nextCustomData = { ...nextCustomData };
      delete nextCustomData.terraformFocusPreview;
    }
  }

  const opacityChanged = element.opacity !== 100;
  const isDeletedChanged = element.isDeleted !== nextIsDeleted;
  const colorsChanged = washPatch !== null;
  const prevPreview = element.customData?.terraformFocusPreview === true;
  const nextPreview = nextCustomData.terraformFocusPreview === true;
  const previewChanged = prevPreview !== nextPreview;

  if (
    !opacityChanged &&
    !isDeletedChanged &&
    !colorsChanged &&
    !previewChanged
  ) {
    return null;
  }

  return newElementWith(element, {
    isDeleted: nextIsDeleted,
    opacity: 100,
    customData: nextCustomData,
    ...(washPatch
      ? {
          strokeColor: washPatch.strokeColor,
          backgroundColor: washPatch.backgroundColor,
          fillStyle: washPatch.fillStyle,
        }
      : {}),
  });
};

/**
 * Bounded BFS over the dataflow/dependency edge graph from the focused node,
 * up to {@link TERRAFORM_FOCUS_MAX_HOPS}. Returns the reachable neighborhood
 * (with per-node hop distance for degree-of-interest dimming) and every edge
 * whose endpoints both fall inside that neighborhood, so a multi-hop path
 * (org → account → trunk → API → datastore) lights up on hover, not just one hop.
 */
export const getTerraformRelationshipFocus = (
  allElements: readonly ExcalidrawElement[],
  focusNodePath: string | null,
  maxHops: number = TERRAFORM_FOCUS_MAX_HOPS,
  options?: TerraformFocusOptions,
) => {
  // Explicit matching, not a "non-both ⇒ dependents" ternary: AppState can
  // carry junk direction strings via public `updateScene`/`restore` (the type
  // is a compile-time promise only), and anything unrecognized must take the
  // undirected legacy ("both") path rather than silently becoming a directed
  // walk. See `buildTerraformRuntimeFocusUpdate` for the AppState-side
  // normalization; this keeps the traversal safe for direct API callers too.
  const direction: TerraformFocusDirection =
    options?.direction === "dependencies" || options?.direction === "dependents"
      ? options.direction
      : "both";
  // `options.maxHops` wins over the legacy positional param when both are given.
  // `Infinity` means uncapped: the BFS below still terminates because visited
  // nodes (`nodeDistance`) are never re-entered, so cycles cannot loop.
  const effectiveMaxHops = options?.maxHops ?? maxHops;
  const focusedNodePaths = new Set<string>();
  const relatedNodePaths = new Set<string>();
  const focusedEdgeIds = new Set<string>();
  // Edges between the focus and a direct (1-hop) neighbor. Only these gate the
  // reveal of soft-deleted elements; revealing the full multi-hop neighborhood
  // would fight the collapsed-overview visibility reconciler and never settle.
  const nearEdgeIds = new Set<string>();
  const nodeDistance = new Map<string, number>();

  if (!focusNodePath) {
    return {
      focusedNodePaths,
      relatedNodePaths,
      focusedEdgeIds,
      nearEdgeIds,
      nodeDistance,
    };
  }

  const adjacency = new Map<string, Set<string>>();
  if (direction === "both") {
    // Undirected adjacency from layer edges (follow flow both up and downstream).
    // This branch is taken BEFORE any directed adjacency exists so the default
    // ("both" / options omitted) path is byte-identical to the legacy behavior.
    const link = (a: string, b: string) => {
      (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
      (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
    };
    for (const element of allElements) {
      if (!isTerraformLayerEdge(element)) {
        continue;
      }
      const endpoints = getRelationshipEndpoints(element);
      if (endpoints) {
        link(endpoints.source, endpoints.target);
      }
      for (const hint of getDirectionEndpointHints(element)) {
        link(hint.source, hint.target);
      }
    }
  } else {
    // Directed adjacency over the declared-dependency direction
    // (`relationship.source → target`; source references target). "dependencies"
    // walks source→target from the anchor; "dependents" walks the reverse.
    // Coalesced hint edges (`relationship.directions[]`) carry the same
    // declared-dependency orientation and get identical treatment. What this
    // axis semantically reads as on canvas is owned by Q7-AXIS — no claim here.
    const linkDirected = (source: string, target: string) => {
      // Only reachable with a validated direction (see the explicit matching
      // above), so this two-way pick cannot swallow junk values.
      const [from, to] =
        direction === "dependencies" ? [source, target] : [target, source];
      (adjacency.get(from) ?? adjacency.set(from, new Set()).get(from)!).add(
        to,
      );
    };
    for (const element of allElements) {
      if (!isTerraformLayerEdge(element)) {
        continue;
      }
      const endpoints = getRelationshipEndpoints(element);
      if (endpoints) {
        linkDirected(endpoints.source, endpoints.target);
      }
      for (const hint of getDirectionEndpointHints(element)) {
        linkDirected(hint.source, hint.target);
      }
    }
  }

  // BFS to assign hop distances within the budget.
  nodeDistance.set(focusNodePath, 0);
  focusedNodePaths.add(focusNodePath);
  let frontier = [focusNodePath];
  for (let hop = 1; hop <= effectiveMaxHops && frontier.length > 0; hop++) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbor of adjacency.get(node) ?? []) {
        if (nodeDistance.has(neighbor)) {
          continue;
        }
        nodeDistance.set(neighbor, hop);
        focusedNodePaths.add(neighbor);
        relatedNodePaths.add(neighbor);
        next.push(neighbor);
      }
    }
    frontier = next;
  }

  // Light every edge whose endpoints are both inside the focused neighborhood.
  // This keys off `nodeDistance`, so in directed modes it lights exactly the
  // edges within the directed cone — no direction-specific change needed here.
  // `nearEdgeIds` (≤1-hop) stays capped regardless of direction/maxHops: only
  // near edges may reveal soft-deleted elements, because unbounded reveal
  // fights the collapsed-overview visibility reconciler (see the nearEdgeIds
  // comment above) and never settles.
  for (const element of allElements) {
    if (!isTerraformLayerEdge(element)) {
      continue;
    }
    const isNear = (a: string, b: string) =>
      (nodeDistance.get(a) ?? 99) <= 1 && (nodeDistance.get(b) ?? 99) <= 1;
    const endpoints = getRelationshipEndpoints(element);
    if (
      endpoints &&
      nodeDistance.has(endpoints.source) &&
      nodeDistance.has(endpoints.target)
    ) {
      focusedEdgeIds.add(element.id);
      if (isNear(endpoints.source, endpoints.target)) {
        nearEdgeIds.add(element.id);
      }
      continue;
    }
    for (const direction of getDirectionEndpointHints(element)) {
      if (
        nodeDistance.has(direction.source) &&
        nodeDistance.has(direction.target)
      ) {
        focusedEdgeIds.add(element.id);
        if (isNear(direction.source, direction.target)) {
          nearEdgeIds.add(element.id);
        }
        break;
      }
    }
  }

  return {
    focusedNodePaths,
    relatedNodePaths,
    focusedEdgeIds,
    nearEdgeIds,
    nodeDistance,
  };
};

/**
 * E08 focus wash overlay mode. When provided, dimming color mutations are
 * SKIPPED — every element keeps its real colors and identity — while the
 * reveal / hide-expired-preview / binding-repair structural changes still run
 * (those are a small set and are what focus needs to stay correct). The dim
 * levels the legacy path *would* have applied are captured into
 * `washLevelByElementId` (only levels < 100) for the draw-time renderer, along
 * with `maxRadius` (the farthest dimmed-element center from `clickCenter`) so
 * the radial sweep can be normalized. `clickCenter` may be null for a static
 * (non-swept) application such as the ambient overview wash on focus clear.
 */
export type TerraformFocusOverlay = {
  clickCenter: { x: number; y: number } | null;
};

export const applyTerraformRelationshipFocus = (
  allElements: readonly ExcalidrawElement[],
  focusNodePath: string | null,
  viewBackgroundColor: string = DEFAULT_VIEW_BACKGROUND_COLOR,
  options?: TerraformFocusOptions,
  overlay?: TerraformFocusOverlay,
) => {
  const {
    focusedNodePaths,
    relatedNodePaths,
    focusedEdgeIds,
    nearEdgeIds,
    nodeDistance,
  } = getTerraformRelationshipFocus(
    allElements,
    focusNodePath,
    TERRAFORM_FOCUS_MAX_HOPS,
    options,
  );
  // Mirror of the traversal's hop cap (`options.maxHops` over the legacy
  // default). The extended dim falloff below gates on this VALUE only — never
  // on whether options were passed — so an explicit `{ maxHops: 3 }` and the
  // no-options legacy path produce byte-identical output.
  const effectiveMaxHops = options?.maxHops ?? TERRAFORM_FOCUS_MAX_HOPS;
  const useExtendedDimFalloff = effectiveMaxHops > TERRAFORM_FOCUS_MAX_HOPS;
  const elementById = new Map(allElements.map((e) => [e.id, e]));
  const duplicateHighlightCanonical = (() => {
    if (!focusNodePath) {
      return null as string | null;
    }
    for (const el of allElements) {
      if (el.isDeleted) {
        continue;
      }
      const cd = el.customData ?? {};
      if (
        getTerraformVisibilityKey(el) === focusNodePath &&
        cd.terraformSemanticLayoutDuplicate === true
      ) {
        return resolveTerraformFocusNodePath(el, elementById);
      }
    }
    return null;
  })();
  let didChange = false;

  const overlayMode = overlay !== undefined;
  const washLevelByElementId = overlayMode ? new Map<string, number>() : null;
  const clickCenter = overlay?.clickCenter ?? null;
  let maxRadius = 0;

  const trackChange = (
    element: ExcalidrawElement,
    updated: ExcalidrawElement | null,
  ) => {
    if (updated) {
      didChange = true;
      return updated;
    }
    return element;
  };

  /**
   * In overlay mode: record the target dim `level` (when < 100) for the
   * draw-time wash, grow `maxRadius`, and build the element update with the
   * dim FORCED to 100 (i.e. restore/undim — no color mutation). Otherwise this
   * is a pass-through to the legacy color-mutation builder.
   */
  const applyFocusUpdate = (
    element: ExcalidrawElement,
    level: number,
    nextIsDeleted: boolean,
    previewAction: PreviewAction,
  ): ExcalidrawElement | null => {
    if (overlayMode && washLevelByElementId) {
      if (level < 100) {
        washLevelByElementId.set(element.id, level);
        if (clickCenter) {
          const cx = element.x + element.width / 2;
          const cy = element.y + element.height / 2;
          const distance = Math.hypot(cx - clickCenter.x, cy - clickCenter.y);
          if (distance > maxRadius) {
            maxRadius = distance;
          }
        }
      }
      return buildTerraformFocusUpdate(
        element,
        TERRAFORM_FOCUS_NODE_LEVEL,
        nextIsDeleted,
        previewAction,
        viewBackgroundColor,
      );
    }
    return buildTerraformFocusUpdate(
      element,
      level,
      nextIsDeleted,
      previewAction,
      viewBackgroundColor,
    );
  };

  const nextElements = allElements.map((element) => {
    const isFocusActive = focusNodePath !== null;
    const isPreview = element.customData?.terraformFocusPreview === true;

    if (!isFocusActive) {
      if (isPreview) {
        return trackChange(
          element,
          applyFocusUpdate(element, TERRAFORM_FOCUS_NODE_LEVEL, true, "clear"),
        );
      }

      if (!isTerraformFocusManagedElement(element, elementById)) {
        return element;
      }

      if (!isTerraformSemanticOverviewScene(allElements)) {
        return trackChange(
          element,
          applyFocusUpdate(
            element,
            TERRAFORM_FOCUS_NODE_LEVEL,
            element.isDeleted,
            "clear",
          ),
        );
      }

      if (element.isDeleted) {
        return element;
      }

      const expandAllView = isTerraformExpandAllActive(allElements);

      if (isTerraformLayerEdge(element)) {
        return trackChange(
          element,
          applyFocusUpdate(
            element,
            TERRAFORM_AMBIENT_EDGE_LEVEL,
            element.isDeleted,
            "clear",
          ),
        );
      }

      if (isTerraformResourceLikeElement(element, elementById)) {
        const isPrimary =
          element.customData?.terraformInitiallyVisible === true;
        const isBoundTerraformLabel =
          element.type === "text" &&
          "containerId" in element &&
          Boolean(element.containerId);
        const nextLevel = isBoundTerraformLabel
          ? TERRAFORM_FOCUS_NODE_LEVEL
          : expandAllView || isPrimary
          ? TERRAFORM_AMBIENT_PRIMARY_NODE_LEVEL
          : TERRAFORM_AMBIENT_NON_PRIMARY_NODE_LEVEL;
        return trackChange(
          element,
          applyFocusUpdate(element, nextLevel, element.isDeleted, "clear"),
        );
      }

      if (isTerraformGroupElement(element)) {
        return trackChange(
          element,
          applyFocusUpdate(
            element,
            TERRAFORM_AMBIENT_GROUP_LEVEL,
            element.isDeleted,
            "clear",
          ),
        );
      }

      return element;
    }

    if (isTerraformLayerEdge(element)) {
      const isFocusedEdge = focusedEdgeIds.has(element.id);
      const nextLevel = isFocusedEdge
        ? TERRAFORM_RELATED_LEVEL
        : TERRAFORM_DIM_EDGE_LEVEL;
      // Reveal only direct (1-hop) edges; deeper neighborhood edges light when
      // already visible but are never un-deleted (keeps collapsed overview stable).
      const shouldReveal = nearEdgeIds.has(element.id) && element.isDeleted;
      const shouldHideExpiredPreview = !isFocusedEdge && isPreview;
      const nextIsDeleted = shouldHideExpiredPreview
        ? true
        : shouldReveal
        ? false
        : element.isDeleted;
      const previewAction: PreviewAction = shouldHideExpiredPreview
        ? "clear"
        : shouldReveal
        ? "set"
        : "leave";

      return trackChange(
        element,
        applyFocusUpdate(element, nextLevel, nextIsDeleted, previewAction),
      );
    }

    if (isTerraformResourceLikeElement(element, elementById)) {
      const nodePath = resolveTerraformFocusNodePath(element, elementById);
      const vis = getTerraformVisibilityKey(element);
      const isFocusLayout = vis === focusNodePath;
      const isCoDuplicate =
        duplicateHighlightCanonical != null &&
        nodePath === duplicateHighlightCanonical &&
        element.customData?.terraformSemanticLayoutDuplicate === true &&
        !isFocusLayout;
      const isFocusNode =
        isFocusLayout ||
        (nodePath === focusNodePath && duplicateHighlightCanonical == null);
      const isRelatedNode = Boolean(nodePath && relatedNodePaths.has(nodePath));
      // Degree-of-interest falloff: 1 hop reads as related, 2+ hops are dimmer
      // but still legible, so a multi-hop path stays traceable without flooding.
      // With an extended hop cap (> 3), distance keeps attenuating past 2 hops
      // (3–4 → deep, 5+ → very deep) so at K=∞ the cone doesn't flatten into a
      // single tier; at caps ≤ 3 the legacy two-tier wash is untouched.
      const hopDistance = nodePath ? nodeDistance.get(nodePath) : undefined;
      const relatedLevel =
        hopDistance != null && hopDistance >= 2
          ? useExtendedDimFalloff && hopDistance >= 5
            ? TERRAFORM_RELATED_VERY_DEEP_LEVEL
            : useExtendedDimFalloff && hopDistance >= 3
            ? TERRAFORM_RELATED_DEEP_LEVEL
            : TERRAFORM_RELATED_FAR_LEVEL
          : TERRAFORM_RELATED_LEVEL;
      const cardLevel = isFocusNode
        ? TERRAFORM_FOCUS_NODE_LEVEL
        : isCoDuplicate
        ? TERRAFORM_RELATED_LEVEL
        : isRelatedNode
        ? relatedLevel
        : TERRAFORM_DIM_NODE_LEVEL;
      // Bound labels share the same dimming as their card and become unreadable when
      // washed toward white. Keep label text at full color so resource names stay
      // visible during hover focus.
      const isBoundTerraformLabel =
        element.type === "text" &&
        "containerId" in element &&
        Boolean(element.containerId);
      const nextLevel = isBoundTerraformLabel
        ? TERRAFORM_FOCUS_NODE_LEVEL
        : cardLevel;
      // Reveal only the focus and its direct (1-hop) neighbors; nodes deeper in
      // the multi-hop neighborhood are dimmed by falloff but never un-deleted.
      const isNearRelated = isRelatedNode && (hopDistance ?? 99) <= 1;
      const shouldReveal =
        (isFocusNode || isCoDuplicate || isNearRelated) && element.isDeleted;
      const shouldHideExpiredPreview =
        !isFocusNode && !isCoDuplicate && !isNearRelated && isPreview;
      const nextIsDeleted = shouldHideExpiredPreview
        ? true
        : shouldReveal
        ? false
        : element.isDeleted;
      const previewAction: PreviewAction = shouldHideExpiredPreview
        ? "clear"
        : shouldReveal
        ? "set"
        : "leave";

      return trackChange(
        element,
        applyFocusUpdate(element, nextLevel, nextIsDeleted, previewAction),
      );
    }

    if (isTerraformGroupElement(element)) {
      const isFocusedParent = isParentGroupOfFocusedNode(
        element,
        focusedNodePaths,
      );
      // Reveal only groups containing the focus or a direct (1-hop) neighbor;
      // parents of deeper cone nodes are highlighted (via `nextLevel`) when
      // already visible but never un-deleted — mirrors the edge/resource
      // ≤1-hop reveal gating above.
      const isNearParent =
        isFocusedParent &&
        isParentGroupOfNearFocusedNode(element, nodeDistance);
      const nextLevel = isFocusedParent
        ? TERRAFORM_CONTAINER_LEVEL
        : TERRAFORM_DIM_NODE_LEVEL;
      const shouldReveal = isNearParent && element.isDeleted;
      const shouldHideExpiredPreview = !isNearParent && isPreview;
      const nextIsDeleted = shouldHideExpiredPreview
        ? true
        : shouldReveal
        ? false
        : element.isDeleted;
      const previewAction: PreviewAction = shouldHideExpiredPreview
        ? "clear"
        : shouldReveal
        ? "set"
        : "leave";

      return trackChange(
        element,
        applyFocusUpdate(element, nextLevel, nextIsDeleted, previewAction),
      );
    }

    return element;
  });

  // In overlay mode `didChange` alone under-reports whether binding repair is
  // needed: overlay mode never mutates element colors (levels are captured
  // into `washLevelByElementId` instead, forcing every `buildTerraformFocusUpdate`
  // call to a byte-identical "no dim" level), so a focus change that only
  // re-levels already-visible dimmed elements — no reveal/hide, no preview
  // change — leaves `didChange` false even though this recompute is a genuine
  // focus change (the caller only reaches this function on a real
  // focus/scene-signature change; see `buildTerraformRuntimeFocusUpdate`'s
  // early-return dedup). The legacy (non-overlay) path always ran repair on
  // every such change regardless of whether colors changed; overlay mode must
  // match that, not silently skip it. `washLevelByElementId.size > 0` is the
  // overlay-mode analog of "colors changed" — it's set whenever ANY element
  // has an active (< 100) target dim level for this recompute — so OR it in
  // for overlay mode only; the non-overlay path stays byte-identical.
  const shouldRepairBindings = overlayMode
    ? didChange || (washLevelByElementId?.size ?? 0) > 0
    : didChange;

  return {
    elements: nextElements,
    didChange,
    shouldRepairBindings,
    // Overlay mode only (null otherwise): per-element target dim levels (< 100)
    // for the draw-time wash, plus the farthest dimmed-element center from the
    // click origin for radial-sweep normalization.
    washLevelByElementId: washLevelByElementId as ReadonlyMap<
      string,
      number
    > | null,
    washMaxRadius: maxRadius,
  };
};

/** Clear transient focus wash / preview flags and rebind edges after reload. */
export const stabilizeTerraformSceneAfterPersistence = (
  elements: readonly ExcalidrawElement[],
  viewBackgroundColor = "#ffffff",
): ExcalidrawElement[] => {
  const { elements: cleared } = applyTerraformRelationshipFocus(
    elements,
    null,
    viewBackgroundColor,
  );
  return repairTerraformEdgeBindings(cleared);
};
