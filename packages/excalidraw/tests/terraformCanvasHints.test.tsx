import rough from "roughjs/bin/rough";

import {
  elementCanvasRegenStats,
  resetElementCanvasRegenStats,
  elementWithCanvasCache,
  terraformZoomBucket,
  TERRAFORM_CANVAS_DPR_CAP,
} from "@excalidraw/element";

import { arrayToMap } from "@excalidraw/common";

import type {
  NonDeletedExcalidrawElement,
  NonDeletedSceneElementsMap,
} from "@excalidraw/element/types";

import { renderStaticScene } from "../renderer/staticScene";
import { bootstrapCanvas } from "../renderer/helpers";
import { getDefaultAppState } from "../appState";
import {
  patchTerraformRuntimePerformanceSettings,
  resetTerraformRuntimePerformanceSettings,
} from "../components/terraformRuntimePerformance";

import { API } from "./helpers/api";

import type { StaticCanvasAppState } from "../types";
import type {
  RenderableElementsMap,
  StaticCanvasRenderConfig,
} from "../scene/types";

/**
 * E09 "hint bundle" (perf loop, canvas track): three independent, default-OFF
 * canvas optimizations pushed into the element-package cache by the static scene
 * renderer. These deterministic tests drive the real `renderStaticScene`
 * (`isExporting: false`) path and read the deterministic regen counter.
 *
 * jsdom's devicePixelRatio defaults to 1, so all rasterization thresholds are
 * deterministic (same reliance as the E03/E05b tests in boundTextCacheKey).
 */

const buildRenderConfig = (
  overrides: Partial<StaticCanvasRenderConfig> = {},
): StaticCanvasRenderConfig => ({
  canvasBackgroundColor: "#ffffff",
  imageCache: new Map(),
  renderGrid: false,
  isExporting: false,
  embedsValidationStatus: new Map(),
  elementsPendingErasure: new Set(),
  pendingFlowchartNodes: null,
  theme: "light",
  ...overrides,
});

const buildAppStateAt = (
  zoomValue: number,
  overrides: Partial<StaticCanvasAppState> = {},
): StaticCanvasAppState =>
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
    zoom: { value: zoomValue },
    ...overrides,
  } as unknown as StaticCanvasAppState);

const renderSceneAt = (
  elements: readonly NonDeletedExcalidrawElement[],
  zoomValue: number,
  {
    appStateOverrides,
    renderConfigOverrides,
    canvas = document.createElement("canvas"),
  }: {
    appStateOverrides?: Partial<StaticCanvasAppState>;
    renderConfigOverrides?: Partial<StaticCanvasRenderConfig>;
    canvas?: HTMLCanvasElement;
  } = {},
) => {
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
    appState: buildAppStateAt(zoomValue, appStateOverrides),
    renderConfig: buildRenderConfig(renderConfigOverrides),
  });
  return canvas;
};

const makeRectangle = () =>
  API.createElement({
    type: "rectangle",
    x: 100,
    y: 100,
    width: 200,
    height: 120,
  });

beforeEach(() => {
  resetTerraformRuntimePerformanceSettings();
  elementCanvasRegenStats.enabled = true;
  resetElementCanvasRegenStats();
});

afterEach(() => {
  elementCanvasRegenStats.enabled = false;
  resetElementCanvasRegenStats();
  resetTerraformRuntimePerformanceSettings();
});

describe("E09.1 zoom cache-key quantization (terraformZoomQuantize)", () => {
  // base 1.1 → bucket(z) = round(ln z / ln 1.1). bucket 0 spans z ∈ [~0.953,
  // ~1.049); 1.0 and 1.04 share it, 1.2 (bucket 2) does not.
  it("keeps zooms in the same bucket in one bucket and separates bucket edges", () => {
    expect(terraformZoomBucket(1.0)).toBe(terraformZoomBucket(1.04));
    expect(terraformZoomBucket(1.0)).not.toBe(terraformZoomBucket(1.2));
  });

  it("ON: oscillating zoom within a bucket produces 0 regens and reuses the bitmap", () => {
    patchTerraformRuntimePerformanceSettings({ terraformZoomQuantize: true });
    const rect = makeRectangle();
    const elements = [rect];

    renderSceneAt(elements, 1.0); // miss → real canvas cached
    const entry = elementWithCanvasCache.get(rect);
    expect(entry).toBeDefined();
    expect((entry as { canvas: unknown }).canvas).not.toBeNull();
    expect(elementCanvasRegenStats.total).toBeGreaterThan(0);

    resetElementCanvasRegenStats();
    for (const zoom of [1.04, 1.0, 1.03, 0.99, 1.045]) {
      renderSceneAt(elements, zoom); // all in bucket 0
    }
    expect(elementCanvasRegenStats.total).toBe(0);
    // Exact same cached ExcalidrawElementWithCanvas → identical bitmap reused.
    expect(elementWithCanvasCache.get(rect)).toBe(entry);
  });

  it("ON: crossing a bucket boundary regenerates once", () => {
    patchTerraformRuntimePerformanceSettings({ terraformZoomQuantize: true });
    const rect = makeRectangle();
    const elements = [rect];

    renderSceneAt(elements, 1.0);
    const entry = elementWithCanvasCache.get(rect);

    resetElementCanvasRegenStats();
    renderSceneAt(elements, 1.2); // bucket 0 → bucket 2
    expect(elementCanvasRegenStats.total).toBe(1);
    expect(elementCanvasRegenStats.zoom).toBe(1);
    expect(elementWithCanvasCache.get(rect)).not.toBe(entry);
  });

  it("OFF (default): the same in-bucket zoom nudge still regenerates (exact compare)", () => {
    const rect = makeRectangle();
    const elements = [rect];

    renderSceneAt(elements, 1.0);
    resetElementCanvasRegenStats();
    renderSceneAt(elements, 1.04); // same bucket, but quantization is off
    expect(elementCanvasRegenStats.total).toBe(1);
    expect(elementCanvasRegenStats.zoom).toBe(1);
  });
});

/**
 * A canvas whose `getContext` records the options object it was called with, so
 * we can assert whether `{ alpha: false }` was requested. (vitest-canvas-mock
 * does not implement `getContextAttributes`, and its bitmap pixels are not real,
 * so the request options are the deterministic observable for the opaque-context
 * decision — this stands in for the gate's `getContextAttributes`/pixel probe.)
 */
const makeContextSpyCanvas = () => {
  const canvas = document.createElement("canvas");
  const contextOptions: Array<CanvasRenderingContext2DSettings | undefined> =
    [];
  const original = canvas.getContext.bind(canvas) as (
    type: string,
    options?: CanvasRenderingContext2DSettings,
  ) => CanvasRenderingContext2D | null;
  canvas.getContext = ((
    type: string,
    options?: CanvasRenderingContext2DSettings,
  ) => {
    contextOptions.push(options);
    return original(type, options);
  }) as HTMLCanvasElement["getContext"];
  return { canvas, contextOptions };
};

describe("E09.2 opaque static context (terraformStaticCanvasOpaque)", () => {
  it("requests alpha:false only for requestOpaque + an opaque background", () => {
    const { canvas, contextOptions } = makeContextSpyCanvas();
    const context = bootstrapCanvas({
      canvas,
      scale: 1,
      normalizedWidth: 400,
      normalizedHeight: 400,
      theme: "light",
      isExporting: false,
      viewBackgroundColor: "#ffffff",
      requestOpaque: true,
    });
    expect(contextOptions[0]).toEqual({ alpha: false });
    // Background paint still happens (opaque fill covering the canvas).
    const fillSpy = vi.spyOn(context, "fillRect");
    bootstrapCanvas({
      canvas,
      scale: 1,
      normalizedWidth: 400,
      normalizedHeight: 400,
      theme: "light",
      isExporting: false,
      viewBackgroundColor: "#ffffff",
      requestOpaque: true,
    });
    expect(fillSpy).toHaveBeenCalledWith(0, 0, 400, 400);
    fillSpy.mockRestore();
  });

  it("does NOT request alpha:false for a transparent background (export-safe)", () => {
    for (const bg of ["transparent", "#ffffff00", "rgba(0,0,0,0)"]) {
      const { canvas, contextOptions } = makeContextSpyCanvas();
      bootstrapCanvas({
        canvas,
        scale: 1,
        normalizedWidth: 400,
        normalizedHeight: 400,
        theme: "light",
        isExporting: true,
        viewBackgroundColor: bg,
        requestOpaque: true,
      });
      expect(contextOptions[0]).toBeUndefined();
    }
  });

  it("does NOT request alpha:false when requestOpaque is false (interactive/new-element layers)", () => {
    const { canvas, contextOptions } = makeContextSpyCanvas();
    bootstrapCanvas({
      canvas,
      scale: 1,
      normalizedWidth: 400,
      normalizedHeight: 400,
      theme: "light",
      isExporting: false,
      viewBackgroundColor: "#ffffff",
      // requestOpaque omitted → default false
    });
    expect(contextOptions[0]).toBeUndefined();
  });

  it("static scene requests an opaque context when the toggle is ON and bg is opaque", () => {
    patchTerraformRuntimePerformanceSettings({
      terraformStaticCanvasOpaque: true,
    });
    const { canvas, contextOptions } = makeContextSpyCanvas();
    renderSceneAt([makeRectangle()], 1, {
      appStateOverrides: { viewBackgroundColor: "#ffffff" },
      canvas,
    });
    expect(contextOptions).toContainEqual({ alpha: false });
  });

  it("static scene stays transparent when the toggle is OFF (default)", () => {
    const { canvas, contextOptions } = makeContextSpyCanvas();
    renderSceneAt([makeRectangle()], 1, {
      appStateOverrides: { viewBackgroundColor: "#ffffff" },
      canvas,
    });
    expect(contextOptions.every((o) => o === undefined)).toBe(true);
  });
});

describe("E09.3 devicePixelRatio cap (terraformDprCap)", () => {
  let originalDpr: number;

  const setDevicePixelRatio = (value: number) => {
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value,
    });
  };

  beforeEach(() => {
    originalDpr = window.devicePixelRatio;
    setDevicePixelRatio(3); // hi-DPI / super-res, above the 1.5 cap
  });

  afterEach(() => {
    setDevicePixelRatio(originalDpr);
  });

  it("caps the cached canvas dimensions at the capped dpr when ON", () => {
    // canvas.width = floor((elementWidth * effectiveDpr + 2 * padding) * scale),
    // scale 1. Padding cancels between ON/OFF, so the width delta is
    // elementWidth * (rawDpr - cappedDpr) = 200 * (3 - 1.5) = 300.
    const offRect = makeRectangle();
    renderSceneAt([offRect], 1); // cap OFF (default), dpr 3
    const widthOff = (
      elementWithCanvasCache.get(offRect) as { canvas: HTMLCanvasElement }
    ).canvas.width;

    patchTerraformRuntimePerformanceSettings({ terraformDprCap: true });
    const onRect = makeRectangle();
    renderSceneAt([onRect], 1); // cap ON, dpr 3 -> effective 1.5
    const widthOn = (
      elementWithCanvasCache.get(onRect) as { canvas: HTMLCanvasElement }
    ).canvas.width;

    expect(widthOn).toBeLessThan(widthOff);
    expect(widthOff - widthOn).toBe(200 * (3 - TERRAFORM_CANVAS_DPR_CAP));
  });

  it("is inert when dpr is at or below the cap (e.g. the dpr-1 desktop)", () => {
    setDevicePixelRatio(1);
    const offRect = makeRectangle();
    renderSceneAt([offRect], 1);
    const widthOff = (
      elementWithCanvasCache.get(offRect) as { canvas: HTMLCanvasElement }
    ).canvas.width;

    patchTerraformRuntimePerformanceSettings({ terraformDprCap: true });
    const onRect = makeRectangle();
    renderSceneAt([onRect], 1);
    const widthOn = (
      elementWithCanvasCache.get(onRect) as { canvas: HTMLCanvasElement }
    ).canvas.width;

    expect(widthOn).toBe(widthOff); // min(1, 1.5) === 1
  });
});

describe("E09 constants", () => {
  it("exposes the DPR cap constant", () => {
    expect(TERRAFORM_CANVAS_DPR_CAP).toBe(1.5);
  });
});
