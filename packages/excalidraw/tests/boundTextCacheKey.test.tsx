import rough from "roughjs/bin/rough";

import {
  elementCanvasRegenStats,
  resetElementCanvasRegenStats,
  elementWithCanvasCache,
  getBoundTextContentSignature,
} from "@excalidraw/element";

import { arrayToMap } from "@excalidraw/common";

import type {
  ExcalidrawElement,
  ExcalidrawTextElementWithContainer,
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { renderStaticScene } from "../renderer/staticScene";
import { getDefaultAppState } from "../appState";

import { API } from "./helpers/api";

import type { StaticCanvasAppState } from "../types";
import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "../scene/types";

/**
 * E03 (perf loop, canvas track): the container-canvas regeneration key uses a
 * bound-text *content signature* instead of the label's raw `version`, so a
 * label co-moved with its container during a drag (version bumps, geometry
 * unchanged relative to the container) does not re-rasterize the container.
 *
 * These are deterministic unit tests over the real render path
 * (`renderStaticScene`, `isExporting: false`) and the pure signature function.
 * The canvas is the vitest-canvas-mock, so bitmap pixels are not real; "pixel
 * identity" is proven by cache-entry *identity* reuse — reusing the exact same
 * cached `ExcalidrawElementWithCanvas` is, by construction, the same bitmap.
 */

const buildAppState = (): StaticCanvasAppState =>
  ({
    ...getDefaultAppState(),
    width: 400,
    height: 400,
    offsetLeft: 0,
    offsetTop: 0,
    scrollX: 0,
    scrollY: 0,
    theme: "light",
    viewBackgroundColor: "#ffffff",
    shouldCacheIgnoreZoom: false,
  } as unknown as StaticCanvasAppState);

const buildRenderConfig = (): StaticCanvasRenderConfig => ({
  canvasBackgroundColor: "#ffffff",
  imageCache: new Map(),
  renderGrid: false,
  isExporting: false,
  embedsValidationStatus: new Map(),
  elementsPendingErasure: new Set(),
  pendingFlowchartNodes: null,
  theme: "light",
});

const renderScene = (elements: readonly NonDeletedExcalidrawElement[]) => {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 400;
  const elementsMap = arrayToMap(elements) as RenderableElementsMap;
  renderStaticScene({
    canvas,
    rc: rough.canvas(canvas),
    elementsMap,
    allElementsMap: elementsMap as unknown as NonDeletedSceneElementsMap,
    visibleElements: elements,
    scale: 1,
    appState: buildAppState(),
    renderConfig: buildRenderConfig(),
  });
};

/** Emulate `dragSelectedElements` co-moving a container + its label: same
 * translation applied to both, with the version/versionNonce bumped (which is
 * what `mutateElement` does even when only x/y change). */
const coMove = (
  container: ExcalidrawElement,
  label: ExcalidrawElement,
  dx: number,
  dy: number,
) => {
  for (const el of [container, label]) {
    const mutable = el as {
      x: number;
      y: number;
      version: number;
      versionNonce: number;
    };
    mutable.x += dx;
    mutable.y += dy;
    mutable.version += 1;
    mutable.versionNonce = mutable.versionNonce + 1;
  }
};

const bumpLabel = (
  label: ExcalidrawElement,
  patch: Record<string, unknown>,
) => {
  Object.assign(label, patch);
  const mutable = label as { version: number; versionNonce: number };
  mutable.version += 1;
  mutable.versionNonce += 1;
};

const makeLabeledRectangle = () => {
  const rectangle = API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 200,
    height: 120,
  });
  const label = API.createElement({
    type: "text",
    x: 130,
    y: 145,
    width: 140,
    height: 25,
    text: "hello",
    containerId: rectangle.id,
  });
  (rectangle as any).boundElements = [{ type: "text", id: label.id }];
  return { rectangle, label };
};

describe("bound-text content-signature cache key (E03)", () => {
  beforeEach(() => {
    // WeakMap is module-global; drop any entries from prior tests by re-creating
    // fresh element identities per test (each makeLabeledRectangle() is fresh).
    elementCanvasRegenStats.enabled = true;
    resetElementCanvasRegenStats();
  });

  afterEach(() => {
    elementCanvasRegenStats.enabled = false;
    resetElementCanvasRegenStats();
  });

  it("reuses the container canvas across a pure co-move drag (regen stays flat)", () => {
    const { rectangle, label } = makeLabeledRectangle();
    const elements = [rectangle, label];

    // Initial rasterization populates the cache.
    renderScene(elements);
    const firstEntry = elementWithCanvasCache.get(rectangle);
    expect(firstEntry).toBeDefined();
    expect(elementCanvasRegenStats.total).toBeGreaterThan(0);

    // Co-move the container + label repeatedly (drag frames).
    resetElementCanvasRegenStats();
    for (let i = 0; i < 20; i++) {
      coMove(rectangle, label, 5, 3);
      renderScene(elements);
    }

    // No container regeneration should occur: same cache entry (identical
    // bitmap), zero regen counted for these frames.
    expect(elementCanvasRegenStats.total).toBe(0);
    expect(elementWithCanvasCache.get(rectangle)).toBe(firstEntry);
  });

  it("regenerates the container canvas when the label text changes", () => {
    const { rectangle, label } = makeLabeledRectangle();
    const elements = [rectangle, label];

    renderScene(elements);
    const firstEntry = elementWithCanvasCache.get(rectangle);
    expect(firstEntry).toBeDefined();

    resetElementCanvasRegenStats();
    bumpLabel(label, { text: "world!!" });
    renderScene(elements);

    expect(elementCanvasRegenStats.total).toBeGreaterThan(0);
    expect(elementWithCanvasCache.get(rectangle)).not.toBe(firstEntry);
  });

  it("regenerates the container canvas when the label fontSize changes", () => {
    const { rectangle, label } = makeLabeledRectangle();
    const elements = [rectangle, label];

    renderScene(elements);
    const firstEntry = elementWithCanvasCache.get(rectangle);

    resetElementCanvasRegenStats();
    bumpLabel(label, { fontSize: 36 });
    renderScene(elements);

    expect(elementCanvasRegenStats.total).toBeGreaterThan(0);
    expect(elementWithCanvasCache.get(rectangle)).not.toBe(firstEntry);
  });

  it("regenerates the container canvas when the label width changes", () => {
    const { rectangle, label } = makeLabeledRectangle();
    const elements = [rectangle, label];

    renderScene(elements);
    const firstEntry = elementWithCanvasCache.get(rectangle);

    resetElementCanvasRegenStats();
    bumpLabel(label, { width: 190 });
    renderScene(elements);

    expect(elementCanvasRegenStats.total).toBeGreaterThan(0);
    expect(elementWithCanvasCache.get(rectangle)).not.toBe(firstEntry);
  });
});

/**
 * Pure-function guard on the signature. This is the completeness contract:
 * the signature must be (a) invariant under a rigid co-move — same delta on
 * container and label — and (b) sensitive to every label property that the
 * container's rasterization can bake in (width/height/relative-position) plus
 * the conservative-superset appearance fields folded in for safety.
 */
/**
 * E05b (perf loop, canvas track): elements that `cappedElementCanvasSize` caps
 * to 0×0 at the current zoom make `generateElementCanvas` return null. Pre-E05b
 * that null was never cached, so every visible frame re-attempted rasterization
 * (the `sameObjectRemiss`/`nullReturns` waste). E05b caches a *null-verdict
 * sentinel* (`canvas: null`) in the same identity-keyed WeakMap, carrying every
 * regeneration-predicate key field, so subsequent frames short-circuit to "draw
 * nothing" without re-rasterizing, while any invalidating change (zoom, theme,
 * identity, …) still forces a regen. Consumers never receive the sentinel —
 * `generateElementWithCanvas` converts a still-valid sentinel back to null.
 *
 * A default rectangle has 20px canvas padding, so a 1×1 rectangle rasterizes to
 * `floor((1 + 40) * scale)` px per side: 0 at scale ≤ 0.02 (null verdict),
 * drawable at scale 1. jsdom's devicePixelRatio is 1 (the E03 tests above rely on
 * the same), so these thresholds are deterministic.
 */
const LOW_ZOOM = 0.01; // floor((1 + 40) * 0.01) = 0 -> 0-size verdict
const LOW_ZOOM_2 = 0.02; // floor((1 + 40) * 0.02) = 0 -> still 0-size, different zoom

const buildAppStateAt = (
  zoomValue: number,
  theme: "light" | "dark",
): StaticCanvasAppState =>
  ({
    ...getDefaultAppState(),
    width: 400,
    height: 400,
    offsetLeft: 0,
    offsetTop: 0,
    scrollX: 0,
    scrollY: 0,
    theme,
    viewBackgroundColor: "#ffffff",
    shouldCacheIgnoreZoom: false,
    zoom: { value: zoomValue },
  } as unknown as StaticCanvasAppState);

const renderSceneAt = (
  elements: readonly NonDeletedExcalidrawElement[],
  zoomValue: number,
  theme: "light" | "dark" = "light",
) => {
  const canvas = document.createElement("canvas");
  canvas.width = 400;
  canvas.height = 400;
  const elementsMap = arrayToMap(elements) as RenderableElementsMap;
  renderStaticScene({
    canvas,
    rc: rough.canvas(canvas),
    elementsMap,
    allElementsMap: elementsMap as unknown as NonDeletedSceneElementsMap,
    visibleElements: elements,
    scale: 1,
    appState: buildAppStateAt(zoomValue, theme),
    renderConfig: buildRenderConfig(),
  });
};

const makeTinyRectangle = () =>
  API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 1,
    height: 1,
  });

describe("null-verdict sentinel (E05b)", () => {
  beforeEach(() => {
    elementCanvasRegenStats.enabled = true;
    resetElementCanvasRegenStats();
  });

  afterEach(() => {
    elementCanvasRegenStats.enabled = false;
    resetElementCanvasRegenStats();
  });

  it("caches a sentinel for a 0-size element and stops re-rasterizing on later frames", () => {
    const rect = makeTinyRectangle();
    const elements = [rect];

    // First frame: miss -> regen -> 0-size cap -> null return -> sentinel cached.
    renderSceneAt(elements, LOW_ZOOM);
    const entry = elementWithCanvasCache.get(rect);
    expect(entry).toBeDefined();
    expect((entry as { canvas: unknown }).canvas).toBeNull(); // it's a sentinel
    expect(elementCanvasRegenStats.total).toBe(1);
    expect(elementCanvasRegenStats.nullReturns).toBe(1);

    // Subsequent frames at the same zoom must NOT regenerate: the sentinel
    // short-circuits to "draw nothing". regen total stays flat; hits accrue.
    resetElementCanvasRegenStats();
    for (let i = 0; i < 10; i++) {
      renderSceneAt(elements, LOW_ZOOM);
    }
    expect(elementCanvasRegenStats.total).toBe(0);
    expect(elementCanvasRegenStats.nullReturns).toBe(0);
    expect(elementCanvasRegenStats.nullVerdictHits).toBe(10);
    // Same sentinel object is still the cache entry.
    expect(elementWithCanvasCache.get(rect)).toBe(entry);
  });

  it("regenerates exactly once when zooming in makes the element drawable", () => {
    const rect = makeTinyRectangle();
    const elements = [rect];

    renderSceneAt(elements, LOW_ZOOM); // sentinel cached
    expect(
      (elementWithCanvasCache.get(rect) as { canvas: unknown }).canvas,
    ).toBeNull();

    // Zoom in: the zoom key field changed -> exactly one regen, and now the
    // element is drawable so a real canvas replaces the sentinel.
    resetElementCanvasRegenStats();
    renderSceneAt(elements, 1);
    expect(elementCanvasRegenStats.total).toBe(1);
    expect(elementCanvasRegenStats.byCause.zoom).toBe(1);
    expect(elementCanvasRegenStats.nullVerdictHits).toBe(0);
    const drawable = elementWithCanvasCache.get(rect);
    expect((drawable as { canvas: unknown }).canvas).not.toBeNull();

    // Stable at the new zoom: no further regen, and no sentinel hit (real hit).
    resetElementCanvasRegenStats();
    renderSceneAt(elements, 1);
    expect(elementCanvasRegenStats.total).toBe(0);
    expect(elementCanvasRegenStats.nullVerdictHits).toBe(0);
  });

  it.each([
    [
      "theme",
      (els: readonly NonDeletedExcalidrawElement[]) =>
        renderSceneAt(els, LOW_ZOOM, "dark"),
    ],
    [
      "zoomValue",
      (els: readonly NonDeletedExcalidrawElement[]) =>
        renderSceneAt(els, LOW_ZOOM_2, "light"),
    ],
  ])(
    "does not short-circuit a stale sentinel when %s changes",
    (_field, rerender) => {
      const rect = makeTinyRectangle();
      const elements = [rect];

      renderSceneAt(elements, LOW_ZOOM, "light"); // sentinel cached
      expect(
        (elementWithCanvasCache.get(rect) as { canvas: unknown }).canvas,
      ).toBeNull();

      // Changing a sentinel key field must force the predicate to re-evaluate
      // (regen), NOT reuse the sentinel as a silent null-draw.
      resetElementCanvasRegenStats();
      rerender(elements);
      expect(elementCanvasRegenStats.total).toBeGreaterThanOrEqual(1);
      expect(elementCanvasRegenStats.nullVerdictHits).toBe(0);
    },
  );

  it("re-misses (does not reuse a sentinel) when the element identity changes", () => {
    const rect = makeTinyRectangle();
    renderSceneAt([rect], LOW_ZOOM); // sentinel cached under rect's identity

    // A fresh clone with identical geometry is a new object -> the identity-keyed
    // WeakMap cannot hit the prior sentinel; it is a genuine miss.
    resetElementCanvasRegenStats();
    const clone = makeTinyRectangle();
    renderSceneAt([clone], LOW_ZOOM);
    expect(elementCanvasRegenStats.byCause.miss).toBe(1);
    expect(elementCanvasRegenStats.nullVerdictHits).toBe(0);
  });
});

describe("getBoundTextContentSignature", () => {
  const build = () => {
    const container = API.createElement({
      type: "rectangle",
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
    const label = API.createElement({
      type: "text",
      x: 30,
      y: 40,
      width: 140,
      height: 25,
      text: "abc",
      containerId: container.id,
    }) as unknown as ExcalidrawTextElementWithContainer;
    return { container, label };
  };

  it("is invariant under a rigid co-move (container + label translate equally)", () => {
    const { container, label } = build();
    const before = getBoundTextContentSignature(container, label);

    (container as any).x += 17;
    (container as any).y -= 9;
    (label as any).x += 17;
    (label as any).y -= 9;

    expect(getBoundTextContentSignature(container, label)).toBe(before);
  });

  it("changes when the label moves relative to the container", () => {
    const { container, label } = build();
    const before = getBoundTextContentSignature(container, label);
    (label as any).x += 3; // container not moved -> relative position changed
    expect(getBoundTextContentSignature(container, label)).not.toBe(before);
  });

  it.each([
    ["text", "different"],
    ["width", 111],
    ["height", 33],
    ["fontSize", 40],
    ["fontFamily", 2],
    ["textAlign", "right"],
    ["verticalAlign", "bottom"],
    ["lineHeight", 1.5],
    ["strokeColor", "#ff0000"],
    ["opacity", 50],
    ["angle", 0.5],
  ])("changes when label.%s changes", (field, value) => {
    const { container, label } = build();
    const before = getBoundTextContentSignature(container, label);
    (label as any)[field] = value;
    expect(getBoundTextContentSignature(container, label)).not.toBe(before);
  });

  it("returns null when there is no bound text", () => {
    const { container } = build();
    expect(getBoundTextContentSignature(container, null)).toBeNull();
  });
});
