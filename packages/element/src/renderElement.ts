import rough from "roughjs/bin/rough";

import {
  type GlobalPoint,
  isRightAngleRads,
  lineSegment,
  pointFrom,
  pointRotateRads,
  type Radians,
} from "@excalidraw/math";

import {
  BOUND_TEXT_PADDING,
  DEFAULT_REDUCED_GLOBAL_ALPHA,
  ELEMENT_READY_TO_ERASE_OPACITY,
  FRAME_STYLE,
  DARK_THEME_FILTER,
  MIME_TYPES,
  THEME,
  distance,
  getFontString,
  isRTL,
  getVerticalOffset,
  invariant,
  applyDarkModeFilter,
  isSafari,
} from "@excalidraw/common";

import type {
  AppState,
  StaticCanvasAppState,
  Zoom,
  InteractiveCanvasAppState,
  ElementsPendingErasure,
  PendingExcalidrawElements,
  NormalizedZoomValue,
} from "@excalidraw/excalidraw/types";

import type {
  StaticCanvasRenderConfig,
  RenderableElementsMap,
  InteractiveCanvasRenderConfig,
} from "@excalidraw/excalidraw/scene/types";

import { getElementAbsoluteCoords, getElementBounds } from "./bounds";
import { getUncroppedImageElement } from "./cropElement";
import { LinearElementEditor } from "./linearElementEditor";
import {
  getBoundTextElement,
  getContainerCoords,
  getContainerElement,
  getBoundTextMaxHeight,
  getBoundTextMaxWidth,
} from "./textElement";
import { getLineHeightInPx } from "./textMeasurements";
import {
  isTextElement,
  isLinearElement,
  isFreeDrawElement,
  isInitializedImageElement,
  isArrowElement,
  hasBoundTextElement,
  isMagicFrameElement,
  isImageElement,
} from "./typeChecks";
import { getContainingFrame } from "./frame";
import { getCornerRadius } from "./utils";

import { ShapeCache } from "./shape";

import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
  ExcalidrawFreeDrawElement,
  ExcalidrawImageElement,
  ExcalidrawTextElementWithContainer,
  ExcalidrawFrameLikeElement,
  NonDeletedSceneElementsMap,
  ElementsMap,
} from "./types";

import type { RoughCanvas } from "roughjs/bin/canvas";

const isPendingImageElement = (
  element: ExcalidrawElement,
  renderConfig: StaticCanvasRenderConfig,
) =>
  isInitializedImageElement(element) &&
  !renderConfig.imageCache.has(element.fileId);

const getCanvasPadding = (element: ExcalidrawElement) => {
  switch (element.type) {
    case "freedraw":
      return element.strokeWidth * 12;
    case "text":
      return element.fontSize / 2;
    case "arrow":
      if (element.endArrowhead || element.endArrowhead) {
        return 40;
      }
      return 20;
    default:
      return 20;
  }
};

export const getRenderOpacity = (
  element: ExcalidrawElement,
  containingFrame: ExcalidrawFrameLikeElement | null,
  elementsPendingErasure: ElementsPendingErasure,
  pendingNodes: Readonly<PendingExcalidrawElements> | null,
  globalAlpha: number = 1,
) => {
  // multiplying frame opacity with element opacity to combine them
  // (e.g. frame 50% and element 50% opacity should result in 25% opacity)
  let opacity =
    (((containingFrame?.opacity ?? 100) * element.opacity) / 10000) *
    globalAlpha;

  // if pending erasure, multiply again to combine further
  // (so that erasing always results in lower opacity than original)
  if (
    elementsPendingErasure.has(element.id) ||
    (pendingNodes && pendingNodes.some((node) => node.id === element.id)) ||
    (containingFrame && elementsPendingErasure.has(containingFrame.id))
  ) {
    opacity *= ELEMENT_READY_TO_ERASE_OPACITY / 100;
  }

  return opacity;
};

export interface ExcalidrawElementWithCanvas {
  element: ExcalidrawElement | ExcalidrawTextElement;
  canvas: HTMLCanvasElement;
  theme: AppState["theme"];
  scale: number;
  angle: number;
  zoomValue: AppState["zoom"]["value"];
  canvasOffsetX: number;
  canvasOffsetY: number;
  boundTextElementVersion: number | null;
  /**
   * Content signature of the bound-text label (see
   * {@link getBoundTextContentSignature}). Used as the real regeneration key so
   * that a bound label being *co-moved* with its container during a drag — which
   * bumps the label's `version`/`versionNonce` without changing anything the
   * container bitmap depends on — does not needlessly re-rasterize the container.
   */
  boundTextSignature: string | null;
  imageCrop: ExcalidrawImageElement["crop"] | null;
  containingFrameOpacity: number;
  boundTextCanvas: HTMLCanvasElement;
}

/**
 * Content signature of a container's bound-text label, used as the container
 * canvas regeneration key in place of the label's raw `version`.
 *
 * DERIVATION — what a container's cached bitmap actually bakes in from its bound
 * text. `generateElementCanvas` reads `boundTextElement` in exactly one place:
 * the `if (isArrowElement(element) && boundTextElement)` block (the arrow branch
 * ~L264-320). There it, and only there, (a) sizes and `clearRect`s a rectangle
 * from `boundTextElement.width`/`.height`, and (b) positions that clearRect from
 * the label's coordinates taken RELATIVE to the container
 * (`boundTextCx - x1`, `boundTextCy - y1` — invariant under a rigid co-move).
 * The label's text, font, colour, alignment, line-height, opacity, etc. are
 * NEVER painted into the container canvas — the label is rasterized as its own
 * separate `ExcalidrawElement`. So the only container-bitmap-affecting inputs are
 * the label's width, height and position relative to the container.
 *
 * We still fold the full set of label-appearance fields into the signature as a
 * conservative superset: including a field the bitmap does not actually depend on
 * can only ever cause an *extra* regen, never a *stale* one, so pixel-identity is
 * preserved regardless of any code path this enumeration might have missed.
 *
 * Position is encoded RELATIVE to the container (`dx`/`dy`) so that a pure drag
 * co-move — where container and label translate by the same delta — produces an
 * unchanged signature and the cached canvas is reused. Absolute coordinates must
 * NOT be used here, or every drag frame would mint a fresh signature and defeat
 * the optimization.
 */
export const getBoundTextContentSignature = (
  container: ExcalidrawElement,
  boundTextElement: ExcalidrawTextElementWithContainer | null,
): string | null => {
  if (!boundTextElement) {
    return null;
  }
  const dx = boundTextElement.x - container.x;
  const dy = boundTextElement.y - container.y;
  return [
    boundTextElement.width,
    boundTextElement.height,
    dx,
    dy,
    boundTextElement.angle,
    boundTextElement.fontSize,
    boundTextElement.fontFamily,
    boundTextElement.textAlign,
    boundTextElement.verticalAlign,
    boundTextElement.lineHeight,
    boundTextElement.strokeColor,
    boundTextElement.opacity,
    boundTextElement.text,
  ].join(" ");
};

const cappedElementCanvasSize = (
  element: NonDeletedExcalidrawElement,
  elementsMap: ElementsMap,
  zoom: Zoom,
): {
  width: number;
  height: number;
  scale: number;
} => {
  // these limits are ballpark, they depend on specific browsers and device.
  // We've chosen lower limits to be safe. We might want to change these limits
  // based on browser/device type, if we get reports of low quality rendering
  // on zoom.
  //
  // ~ safari mobile canvas area limit
  const AREA_LIMIT = 16777216;
  // ~ safari width/height limit based on developer.mozilla.org.
  const WIDTH_HEIGHT_LIMIT = 32767;

  const padding = getCanvasPadding(element);

  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
  const elementWidth =
    isLinearElement(element) || isFreeDrawElement(element)
      ? distance(x1, x2)
      : element.width;
  const elementHeight =
    isLinearElement(element) || isFreeDrawElement(element)
      ? distance(y1, y2)
      : element.height;

  let width = elementWidth * window.devicePixelRatio + padding * 2;
  let height = elementHeight * window.devicePixelRatio + padding * 2;

  let scale: number = zoom.value;

  // rescale to ensure width and height is within limits
  if (
    width * scale > WIDTH_HEIGHT_LIMIT ||
    height * scale > WIDTH_HEIGHT_LIMIT
  ) {
    scale = Math.min(WIDTH_HEIGHT_LIMIT / width, WIDTH_HEIGHT_LIMIT / height);
  }

  // rescale to ensure canvas area is within limits
  if (width * height * scale * scale > AREA_LIMIT) {
    scale = Math.sqrt(AREA_LIMIT / (width * height));
  }

  width = Math.floor(width * scale);
  height = Math.floor(height * scale);

  return { width, height, scale };
};

const generateElementCanvas = (
  element: NonDeletedExcalidrawElement,
  elementsMap: NonDeletedSceneElementsMap,
  zoom: Zoom,
  renderConfig: StaticCanvasRenderConfig,
  appState: StaticCanvasAppState | InteractiveCanvasAppState,
): ExcalidrawElementWithCanvas | null => {
  const padding = getCanvasPadding(element);

  // E05a: compute the (possibly 0-size) capped canvas dimensions and take the
  // null path BEFORE allocating any canvas. `cappedElementCanvasSize` can cap an
  // element to 0×0 at the current zoom (returning null below); allocating the
  // throwaway `<canvas>` first wasted ~4,200 canvas allocations/frame during
  // fitted-zoom drags. Reordering is behavior-preserving — neither `padding` nor
  // the size computation touches the canvas.
  const { width, height, scale } = cappedElementCanvasSize(
    element,
    elementsMap,
    zoom,
  );

  if (!width || !height) {
    return null;
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  canvas.width = width;
  canvas.height = height;

  let canvasOffsetX = -100;
  let canvasOffsetY = 0;

  if (isLinearElement(element) || isFreeDrawElement(element)) {
    const [x1, y1] = getElementAbsoluteCoords(element, elementsMap);

    canvasOffsetX =
      element.x > x1
        ? distance(element.x, x1) * window.devicePixelRatio * scale
        : 0;

    canvasOffsetY =
      element.y > y1
        ? distance(element.y, y1) * window.devicePixelRatio * scale
        : 0;

    context.translate(canvasOffsetX, canvasOffsetY);
  }

  context.save();
  context.translate(padding * scale, padding * scale);
  context.scale(
    window.devicePixelRatio * scale,
    window.devicePixelRatio * scale,
  );

  const rc = rough.canvas(canvas);

  drawElementOnCanvas(element, rc, context, renderConfig);

  context.restore();

  const boundTextElement = getBoundTextElement(element, elementsMap);
  const boundTextCanvas = document.createElement("canvas");
  const boundTextCanvasContext = boundTextCanvas.getContext("2d")!;

  if (isArrowElement(element) && boundTextElement) {
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
    // Take max dimensions of arrow canvas so that when canvas is rotated
    // the arrow doesn't get clipped
    const maxDim = Math.max(distance(x1, x2), distance(y1, y2));
    boundTextCanvas.width =
      maxDim * window.devicePixelRatio * scale + padding * scale * 10;
    boundTextCanvas.height =
      maxDim * window.devicePixelRatio * scale + padding * scale * 10;
    boundTextCanvasContext.translate(
      boundTextCanvas.width / 2,
      boundTextCanvas.height / 2,
    );
    boundTextCanvasContext.rotate(element.angle);
    boundTextCanvasContext.drawImage(
      canvas!,
      -canvas.width / 2,
      -canvas.height / 2,
      canvas.width,
      canvas.height,
    );

    const [, , , , boundTextCx, boundTextCy] = getElementAbsoluteCoords(
      boundTextElement,
      elementsMap,
    );

    boundTextCanvasContext.rotate(-element.angle);
    const offsetX = (boundTextCanvas.width - canvas!.width) / 2;
    const offsetY = (boundTextCanvas.height - canvas!.height) / 2;
    const shiftX =
      boundTextCanvas.width / 2 -
      (boundTextCx - x1) * window.devicePixelRatio * scale -
      offsetX -
      padding * scale;

    const shiftY =
      boundTextCanvas.height / 2 -
      (boundTextCy - y1) * window.devicePixelRatio * scale -
      offsetY -
      padding * scale;
    boundTextCanvasContext.translate(-shiftX, -shiftY);
    // Clear the bound text area
    boundTextCanvasContext.clearRect(
      -(boundTextElement.width / 2 + BOUND_TEXT_PADDING) *
        window.devicePixelRatio *
        scale,
      -(boundTextElement.height / 2 + BOUND_TEXT_PADDING) *
        window.devicePixelRatio *
        scale,
      (boundTextElement.width + BOUND_TEXT_PADDING * 2) *
        window.devicePixelRatio *
        scale,
      (boundTextElement.height + BOUND_TEXT_PADDING * 2) *
        window.devicePixelRatio *
        scale,
    );
  }

  return {
    element,
    canvas,
    theme: appState.theme,
    scale,
    zoomValue: zoom.value,
    canvasOffsetX,
    canvasOffsetY,
    boundTextElementVersion:
      getBoundTextElement(element, elementsMap)?.version || null,
    boundTextSignature: getBoundTextContentSignature(element, boundTextElement),
    containingFrameOpacity:
      getContainingFrame(element, elementsMap)?.opacity || 100,
    boundTextCanvas,
    angle: element.angle,
    imageCrop: isImageElement(element) ? element.crop : null,
  };
};

export const DEFAULT_LINK_SIZE = 14;

const IMAGE_PLACEHOLDER_IMG =
  typeof document !== "undefined"
    ? document.createElement("img")
    : ({ src: "" } as HTMLImageElement); // mock image element outside of browser

IMAGE_PLACEHOLDER_IMG.src = `data:${MIME_TYPES.svg},${encodeURIComponent(
  `<svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="image" class="svg-inline--fa fa-image fa-w-16" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path fill="#888" d="M464 448H48c-26.51 0-48-21.49-48-48V112c0-26.51 21.49-48 48-48h416c26.51 0 48 21.49 48 48v288c0 26.51-21.49 48-48 48zM112 120c-30.928 0-56 25.072-56 56s25.072 56 56 56 56-25.072 56-56-25.072-56-56-56zM64 384h384V272l-87.515-87.515c-4.686-4.686-12.284-4.686-16.971 0L208 320l-55.515-55.515c-4.686-4.686-12.284-4.686-16.971 0L64 336v48z"></path></svg>`,
)}`;

const IMAGE_ERROR_PLACEHOLDER_IMG =
  typeof document !== "undefined"
    ? document.createElement("img")
    : ({ src: "" } as HTMLImageElement); // mock image element outside of browser

IMAGE_ERROR_PLACEHOLDER_IMG.src = `data:${MIME_TYPES.svg},${encodeURIComponent(
  `<svg viewBox="0 0 668 668" xmlns="http://www.w3.org/2000/svg" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linejoin:round;stroke-miterlimit:2"><path d="M464 448H48c-26.51 0-48-21.49-48-48V112c0-26.51 21.49-48 48-48h416c26.51 0 48 21.49 48 48v288c0 26.51-21.49 48-48 48ZM112 120c-30.928 0-56 25.072-56 56s25.072 56 56 56 56-25.072 56-56-25.072-56-56-56ZM64 384h384V272l-87.515-87.515c-4.686-4.686-12.284-4.686-16.971 0L208 320l-55.515-55.515c-4.686-4.686-12.284-4.686-16.971 0L64 336v48Z" style="fill:#888;fill-rule:nonzero" transform="matrix(.81709 0 0 .81709 124.825 145.825)"/><path d="M256 8C119.034 8 8 119.033 8 256c0 136.967 111.034 248 248 248s248-111.034 248-248S392.967 8 256 8Zm130.108 117.892c65.448 65.448 70 165.481 20.677 235.637L150.47 105.216c70.204-49.356 170.226-44.735 235.638 20.676ZM125.892 386.108c-65.448-65.448-70-165.481-20.677-235.637L361.53 406.784c-70.203 49.356-170.226 44.736-235.638-20.676Z" style="fill:#888;fill-rule:nonzero" transform="matrix(.30366 0 0 .30366 506.822 60.065)"/></svg>`,
)}`;

const drawImagePlaceholder = (
  element: ExcalidrawImageElement,
  context: CanvasRenderingContext2D,
  theme: StaticCanvasRenderConfig["theme"],
) => {
  context.fillStyle = theme === THEME.DARK ? "#2E2E2E" : "#E7E7E7";
  context.fillRect(0, 0, element.width, element.height);

  const imageMinWidthOrHeight = Math.min(element.width, element.height);

  const size = Math.min(
    imageMinWidthOrHeight,
    Math.min(imageMinWidthOrHeight * 0.4, 100),
  );

  context.drawImage(
    element.status === "error"
      ? IMAGE_ERROR_PLACEHOLDER_IMG
      : IMAGE_PLACEHOLDER_IMG,
    element.width / 2 - size / 2,
    element.height / 2 - size / 2,
    size,
    size,
  );
};

const drawElementOnCanvas = (
  element: NonDeletedExcalidrawElement,
  rc: RoughCanvas,
  context: CanvasRenderingContext2D,
  renderConfig: StaticCanvasRenderConfig,
) => {
  switch (element.type) {
    case "rectangle":
    case "iframe":
    case "embeddable":
    case "diamond":
    case "ellipse": {
      context.lineJoin = "round";
      context.lineCap = "round";

      rc.draw(ShapeCache.generateElementShape(element, renderConfig));
      break;
    }
    case "arrow":
    case "line": {
      context.lineJoin = "round";
      context.lineCap = "round";

      ShapeCache.generateElementShape(element, renderConfig).forEach(
        (shape) => {
          rc.draw(shape);
        },
      );
      break;
    }
    case "freedraw": {
      // Draw directly to canvas
      context.save();

      const shapes = ShapeCache.generateElementShape(element, renderConfig);

      for (const shape of shapes) {
        if (typeof shape === "string") {
          context.fillStyle =
            renderConfig.theme === THEME.DARK
              ? applyDarkModeFilter(element.strokeColor)
              : element.strokeColor;
          context.fill(new Path2D(shape));
        } else {
          rc.draw(shape);
        }
      }

      context.restore();
      break;
    }
    case "image": {
      context.save();
      const cacheEntry =
        element.fileId !== null
          ? renderConfig.imageCache.get(element.fileId)
          : null;
      const img = isInitializedImageElement(element)
        ? cacheEntry?.image
        : undefined;

      if (img != null && !(img instanceof Promise)) {
        if (element.roundness && context.roundRect) {
          context.beginPath();
          context.roundRect(
            0,
            0,
            element.width,
            element.height,
            getCornerRadius(Math.min(element.width, element.height), element),
          );
          context.clip();
        }

        const { x, y, width, height } = element.crop
          ? element.crop
          : {
              x: 0,
              y: 0,
              width: img.naturalWidth,
              height: img.naturalHeight,
            };

        const shouldInvertImage =
          renderConfig.theme === THEME.DARK &&
          cacheEntry?.mimeType === MIME_TYPES.svg;

        if (shouldInvertImage && isSafari) {
          const devicePixelRatio = window.devicePixelRatio || 1;
          const tempCanvas = document.createElement("canvas");
          tempCanvas.width = element.width * devicePixelRatio;
          tempCanvas.height = element.height * devicePixelRatio;
          const tempContext = tempCanvas.getContext("2d");

          if (tempContext) {
            tempContext.scale(devicePixelRatio, devicePixelRatio);
            tempContext.drawImage(
              img,
              x,
              y,
              width,
              height,
              0,
              0,
              element.width,
              element.height,
            );

            const imageData = tempContext.getImageData(
              0,
              0,
              tempCanvas.width,
              tempCanvas.height,
            );

            const data = imageData.data;

            for (let i = 0; i < data.length; i += 4) {
              data[i] = 255 - data[i];
              data[i + 1] = 255 - data[i + 1];
              data[i + 2] = 255 - data[i + 2];
            }

            tempContext.putImageData(imageData, 0, 0);
            context.drawImage(
              tempCanvas,
              0,
              0,
              tempCanvas.width,
              tempCanvas.height,
              0,
              0,
              element.width,
              element.height,
            );
          }
        } else {
          if (shouldInvertImage) {
            context.filter = DARK_THEME_FILTER;
          }

          context.drawImage(
            img,
            x,
            y,
            width,
            height,
            0 /* hardcoded for the selection box*/,
            0,
            element.width,
            element.height,
          );
        }
      } else {
        drawImagePlaceholder(element, context, renderConfig.theme);
      }
      context.restore();
      break;
    }
    default: {
      if (isTextElement(element)) {
        const rtl = isRTL(element.text);
        const shouldTemporarilyAttach = rtl && !context.canvas.isConnected;
        if (shouldTemporarilyAttach) {
          // to correctly render RTL text mixed with LTR, we have to append it
          // to the DOM
          document.body.appendChild(context.canvas);
        }
        context.canvas.setAttribute("dir", rtl ? "rtl" : "ltr");
        context.save();
        context.font = getFontString(element);
        context.fillStyle =
          renderConfig.theme === THEME.DARK
            ? applyDarkModeFilter(element.strokeColor)
            : element.strokeColor;
        context.textAlign = element.textAlign as CanvasTextAlign;

        // Canvas does not support multiline text by default
        const lines = element.text.replace(/\r\n?/g, "\n").split("\n");

        const horizontalOffset =
          element.textAlign === "center"
            ? element.width / 2
            : element.textAlign === "right"
            ? element.width
            : 0;

        const lineHeightPx = getLineHeightInPx(
          element.fontSize,
          element.lineHeight,
        );

        const verticalOffset = getVerticalOffset(
          element.fontFamily,
          element.fontSize,
          lineHeightPx,
        );

        for (let index = 0; index < lines.length; index++) {
          context.fillText(
            lines[index],
            horizontalOffset,
            index * lineHeightPx + verticalOffset,
          );
        }
        context.restore();
        if (shouldTemporarilyAttach) {
          context.canvas.remove();
        }
      } else {
        throw new Error(`Unimplemented type ${element.type}`);
      }
    }
  }
};

/**
 * E05b: null-verdict sentinel cached in place of a canvas for elements that
 * `cappedElementCanvasSize` caps to 0×0 at the current zoom. `generateElementCanvas`
 * returns `null` for such elements; before E05b that `null` was never cached, so
 * every visible frame re-attempted rasterization (~37% of drag regens — the
 * `sameObjectRemiss`/`nullReturns` waste seen in E04 byCause data).
 *
 * The sentinel lives in the SAME identity-keyed `elementWithCanvasCache` WeakMap
 * and carries EVERY field the regeneration predicate in `generateElementWithCanvas`
 * reads, so all existing invalidation terms apply automatically (zoom, theme,
 * bound-text signature/version, imageCrop, containing-frame opacity, arrow angle,
 * plus element identity — a re-clone misses, and `ShapeCache.delete` drops the
 * entry on geometry change). It also carries `devicePixelRatio`: DPR is the one
 * remaining input to the 0-size verdict (see `cappedElementCanvasSize`:
 * `elementWidth * window.devicePixelRatio + padding * 2`) that is NOT already a
 * predicate term, so it must be part of the sentinel key or a DPR change could
 * leave a stale "draw nothing" verdict.
 *
 * `canvas: null` is the discriminator. Consumers NEVER receive a sentinel:
 * `generateElementWithCanvas` converts a still-valid sentinel back to `null` (its
 * pre-existing "draw nothing" contract), so rendering behavior is byte-identical —
 * only the wasted rasterization is removed.
 */
export type ElementCanvasNullVerdict = {
  canvas: null;
  zoomValue: AppState["zoom"]["value"];
  theme: AppState["theme"];
  devicePixelRatio: number;
  angle: number;
  boundTextElementVersion: number | null;
  boundTextSignature: string | null;
  imageCrop: ExcalidrawImageElement["crop"] | null;
  containingFrameOpacity: number;
};

export const elementWithCanvasCache = new WeakMap<
  ExcalidrawElement,
  ExcalidrawElementWithCanvas | ElementCanvasNullVerdict
>();

/**
 * Deterministic instrumentation for the per-element canvas-regeneration path.
 *
 * The dominant cost of zooming a large Terraform scene is not draw count but
 * `generateElementCanvas` re-rasterizing every cached element when the zoom
 * value changes (`shouldRegenerateBecauseZoom`). Wall-clock timing through the
 * benchmark is non-deterministic (RAF coalescing, throttling, WeakMap GC), so
 * the regeneration *count* is the primary, reproducible A/B metric for the
 * LOD-vs-no-LOD comparison (see docs/terraform-canvas-runtime-performance.md).
 *
 * Production builds leave this disabled (a single branch on a boolean flag);
 * the benchmark / tests flip it on, reset, exercise the canvas, then read.
 */
export const elementCanvasRegenStats = {
  enabled: false,
  /** total `generateElementCanvas` calls while enabled */
  total: 0,
  /** subset attributable to a zoom-value change (the LOD-relevant cost) */
  zoom: 0,
  /**
   * Per-cause breakdown of `total`, attributed to the FIRST failing predicate
   * term in the exact source order of the regen `if` (see
   * `generateElementWithCanvas`): miss → zoom → theme → boundText → imageCrop →
   * frameOpacity → arrowAngle. Every regen increments exactly one bucket, so
   * `sum(byCause) === total`. `byCause.zoom === zoom` by construction: a
   * zoom-value change can only be the first failing term when a cache entry
   * already exists (a fresh element is a `miss`), so the two never double-count.
   * Answers "which term trips the 11.2k drag regens?" without wall-clock timing.
   */
  byCause: {
    /** no cache entry — a new element identity (re-clone / first paint) */
    miss: 0,
    /** cached, but the zoom value changed */
    zoom: 0,
    /** cached at same zoom, but the theme changed */
    theme: 0,
    /** cached, but the bound-text content signature changed (E03) */
    boundText: 0,
    /** cached, but the image crop changed */
    imageCrop: 0,
    /** cached, but the containing frame's opacity changed */
    frameOpacity: 0,
    /** cached arrow-with-label, but the arrow angle changed */
    arrowAngle: 0,
  },
  /**
   * Decomposition of `byCause.miss` by *why* the WeakMap had no entry, keyed by
   * element `id` vs object identity (see `elementCanvasRegenLastSeenById`). This
   * disambiguates the three mechanically distinct miss causes that the bare
   * `miss` count conflates:
   *
   * - `firstSeen`: this `id` was never rendered before under this measurement —
   *   a genuine first paint / newly-visible element. Unavoidable.
   * - `identitySwap`: same `id`, but a DIFFERENT object than last seen — the
   *   element was re-cloned (new identity), so the identity-keyed WeakMap can
   *   never hit. This is the re-clone/reconcile smell (the hover-unrender root
   *   cause; see docs/terraform-canvas-hover-unrender-investigation.md).
   * - `sameObjectRemiss`: same `id` AND the same object as last seen, yet it
   *   missed again — the cache entry never persisted. Happens when
   *   `generateElementCanvas` returned null (0-size cap → not cached, see
   *   `nullReturns`) or the WeakMap entry was otherwise dropped.
   *
   * `firstSeen + identitySwap + sameObjectRemiss === byCause.miss`.
   */
  missDetail: {
    firstSeen: 0,
    identitySwap: 0,
    sameObjectRemiss: 0,
  },
  /**
   * Count of `generateElementCanvas` calls that returned null (0-width/height
   * cap) while enabled. A null result is never written to the cache, so such an
   * element re-misses on every visible frame → shows up as `sameObjectRemiss`.
   */
  nullReturns: 0,
  /**
   * E05b: count of frames on which a cached null-verdict sentinel (see
   * {@link ElementCanvasNullVerdict}) still matched the current key fields, so
   * the element short-circuited to "draw nothing" WITHOUT re-rasterizing. This
   * is the engagement counter for the E05b optimization: pre-E05b these frames
   * were `total`/`nullReturns` regens (a `sameObjectRemiss` re-miss every frame);
   * post-E05b they move here and never touch `generateElementCanvas`. Not part of
   * `byCause` — a sentinel hit is the ABSENCE of a regen, so folding it into
   * `byCause` would break the `sum(byCause) === total` invariant.
   */
  nullVerdictHits: 0,
};

/**
 * DEV-only id→last-object map backing `missDetail`. Only written when
 * `elementCanvasRegenStats.enabled`; cleared by `resetElementCanvasRegenStats`.
 * Holds strong refs, but is bounded by element count and lives only for the
 * duration of an instrumented benchmark window.
 */
const elementCanvasRegenLastSeenById = new Map<
  string,
  NonDeletedExcalidrawElement
>();

export const resetElementCanvasRegenStats = () => {
  elementCanvasRegenStats.total = 0;
  elementCanvasRegenStats.zoom = 0;
  const byCause = elementCanvasRegenStats.byCause;
  byCause.miss = 0;
  byCause.zoom = 0;
  byCause.theme = 0;
  byCause.boundText = 0;
  byCause.imageCrop = 0;
  byCause.frameOpacity = 0;
  byCause.arrowAngle = 0;
  const missDetail = elementCanvasRegenStats.missDetail;
  missDetail.firstSeen = 0;
  missDetail.identitySwap = 0;
  missDetail.sameObjectRemiss = 0;
  elementCanvasRegenStats.nullReturns = 0;
  elementCanvasRegenStats.nullVerdictHits = 0;
  elementCanvasRegenLastSeenById.clear();
};

const generateElementWithCanvas = (
  element: NonDeletedExcalidrawElement,
  elementsMap: NonDeletedSceneElementsMap,
  renderConfig: StaticCanvasRenderConfig,
  appState: StaticCanvasAppState | InteractiveCanvasAppState,
) => {
  const zoom: Zoom = renderConfig
    ? appState.zoom
    : {
        value: 1 as NormalizedZoomValue,
      };
  const prevElementWithCanvas = elementWithCanvasCache.get(element);
  const shouldRegenerateBecauseZoom =
    prevElementWithCanvas &&
    prevElementWithCanvas.zoomValue !== zoom.value &&
    !appState?.shouldCacheIgnoreZoom;
  const boundTextElement = getBoundTextElement(element, elementsMap);
  const boundTextElementVersion = boundTextElement?.version || null;
  // Regenerate the container canvas only when the label actually changed the
  // container's bitmap, not merely its version. The version is a fast-path: if
  // it is unchanged the label is byte-identical, so we skip signature work
  // entirely. Only when the version differs do we compute the content signature
  // (see getBoundTextContentSignature) — a pure drag co-move bumps the version
  // but leaves the signature identical, so the cached canvas is reused.
  const boundTextChanged =
    !!prevElementWithCanvas &&
    prevElementWithCanvas.boundTextElementVersion !== boundTextElementVersion &&
    prevElementWithCanvas.boundTextSignature !==
      getBoundTextContentSignature(element, boundTextElement);
  const imageCrop = isImageElement(element) ? element.crop : null;

  const containingFrameOpacity =
    getContainingFrame(element, elementsMap)?.opacity || 100;

  // since we rotate the canvas when copying from cached canvas, we don't
  // regenerate the cached canvas. But we need to in case of labels which are
  // cached alongside the arrow, and we want the labels to remain unrotated
  // with respect to the arrow. (Guarded on `prevElementWithCanvas` so this is a
  // safe standalone boolean — in the OR below a missing cache entry already
  // short-circuits via the leading `!prevElementWithCanvas` term.)
  const arrowAngleChanged =
    !!prevElementWithCanvas &&
    isArrowElement(element) &&
    !!boundTextElement &&
    element.angle !== prevElementWithCanvas.angle;

  // E05b: a cached null-verdict sentinel must additionally re-evaluate when the
  // devicePixelRatio changes, since DPR feeds the 0-size verdict
  // (`cappedElementCanvasSize`) but is not one of the shared predicate terms
  // above. Guarded on `canvas === null` (narrows the union to the sentinel), so
  // real canvas entries — which never store `devicePixelRatio` — are unaffected.
  const nullVerdictDprChanged =
    !!prevElementWithCanvas &&
    prevElementWithCanvas.canvas === null &&
    prevElementWithCanvas.devicePixelRatio !== window.devicePixelRatio;

  if (
    !prevElementWithCanvas ||
    shouldRegenerateBecauseZoom ||
    prevElementWithCanvas.theme !== appState.theme ||
    boundTextChanged ||
    prevElementWithCanvas.imageCrop !== imageCrop ||
    prevElementWithCanvas.containingFrameOpacity !== containingFrameOpacity ||
    arrowAngleChanged ||
    nullVerdictDprChanged
  ) {
    if (elementCanvasRegenStats.enabled) {
      elementCanvasRegenStats.total += 1;
      if (shouldRegenerateBecauseZoom) {
        elementCanvasRegenStats.zoom += 1;
      }
      // Attribute the regen to the FIRST failing term, in the exact predicate
      // order above, so every regen lands in exactly one byCause bucket
      // (sum(byCause) === total). This is a diagnostic breakdown only; the
      // whole block is gated on `enabled` so production pays nothing.
      const byCause = elementCanvasRegenStats.byCause;
      if (!prevElementWithCanvas) {
        byCause.miss += 1;
        // Decompose the miss by id-vs-object identity to name the mechanism.
        const lastSeen = elementCanvasRegenLastSeenById.get(element.id);
        if (lastSeen === undefined) {
          elementCanvasRegenStats.missDetail.firstSeen += 1;
        } else if (lastSeen !== element) {
          // same id, different object = the element was re-cloned
          elementCanvasRegenStats.missDetail.identitySwap += 1;
        } else {
          // same id AND same object, yet uncached = never persisted last time
          elementCanvasRegenStats.missDetail.sameObjectRemiss += 1;
        }
        elementCanvasRegenLastSeenById.set(element.id, element);
      } else if (shouldRegenerateBecauseZoom) {
        byCause.zoom += 1;
      } else if (prevElementWithCanvas.theme !== appState.theme) {
        byCause.theme += 1;
      } else if (boundTextChanged) {
        byCause.boundText += 1;
      } else if (prevElementWithCanvas.imageCrop !== imageCrop) {
        byCause.imageCrop += 1;
      } else if (
        prevElementWithCanvas.containingFrameOpacity !== containingFrameOpacity
      ) {
        byCause.frameOpacity += 1;
      } else if (arrowAngleChanged) {
        byCause.arrowAngle += 1;
      } else {
        // Only remaining term: a null-verdict sentinel re-evaluated after a DPR
        // change (E05b). Rare (never during a fixed-DPR benchmark), so it is
        // folded into `arrowAngle` rather than adding a bucket — the
        // `sum(byCause) === total` invariant is preserved either way.
        byCause.arrowAngle += 1;
      }
    }

    const elementWithCanvas = generateElementCanvas(
      element,
      elementsMap,
      zoom,
      renderConfig,
      appState,
    );

    if (!elementWithCanvas) {
      if (elementCanvasRegenStats.enabled) {
        elementCanvasRegenStats.nullReturns += 1;
      }
      // E05b: cache a null-verdict sentinel instead of leaving the element
      // uncached. It carries every field the regen predicate reads (plus DPR),
      // so subsequent frames short-circuit to "draw nothing" via the fall-through
      // below without re-rasterizing, while any invalidating change (zoom, theme,
      // bound text, imageCrop, frame opacity, arrow angle, DPR, or re-clone /
      // ShapeCache.delete) correctly forces a regen through the predicate above.
      elementWithCanvasCache.set(element, {
        canvas: null,
        zoomValue: zoom.value,
        theme: appState.theme,
        devicePixelRatio: window.devicePixelRatio,
        angle: element.angle,
        boundTextElementVersion,
        boundTextSignature: getBoundTextContentSignature(
          element,
          boundTextElement,
        ),
        imageCrop,
        containingFrameOpacity,
      });
      return null;
    }

    elementWithCanvasCache.set(element, elementWithCanvas);

    return elementWithCanvas;
  }
  // Fall-through: no invalidation term fired. If the cached entry is a
  // null-verdict sentinel (E05b), the element still caps to 0×0 at this zoom, so
  // reproduce today's null return ("draw nothing") WITHOUT re-rasterizing — this
  // is the regen win. Consumers therefore never receive a sentinel object.
  if (prevElementWithCanvas.canvas === null) {
    if (elementCanvasRegenStats.enabled) {
      elementCanvasRegenStats.nullVerdictHits += 1;
    }
    return null;
  }
  return prevElementWithCanvas;
};

const drawElementFromCanvas = (
  elementWithCanvas: ExcalidrawElementWithCanvas,
  context: CanvasRenderingContext2D,
  renderConfig: StaticCanvasRenderConfig,
  appState: StaticCanvasAppState | InteractiveCanvasAppState,
  allElementsMap: NonDeletedSceneElementsMap,
) => {
  const element = elementWithCanvas.element;
  const padding = getCanvasPadding(element);
  const zoom = elementWithCanvas.scale;
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, allElementsMap);
  const cx = ((x1 + x2) / 2 + appState.scrollX) * window.devicePixelRatio;
  const cy = ((y1 + y2) / 2 + appState.scrollY) * window.devicePixelRatio;

  context.save();
  context.scale(1 / window.devicePixelRatio, 1 / window.devicePixelRatio);

  const boundTextElement = getBoundTextElement(element, allElementsMap);

  if (isArrowElement(element) && boundTextElement) {
    const offsetX =
      (elementWithCanvas.boundTextCanvas.width -
        elementWithCanvas.canvas!.width) /
      2;
    const offsetY =
      (elementWithCanvas.boundTextCanvas.height -
        elementWithCanvas.canvas!.height) /
      2;
    context.translate(cx, cy);
    context.drawImage(
      elementWithCanvas.boundTextCanvas,
      (-(x2 - x1) / 2) * window.devicePixelRatio - offsetX / zoom - padding,
      (-(y2 - y1) / 2) * window.devicePixelRatio - offsetY / zoom - padding,
      elementWithCanvas.boundTextCanvas.width / zoom,
      elementWithCanvas.boundTextCanvas.height / zoom,
    );
  } else {
    // we translate context to element center so that rotation and scale
    // originates from the element center
    context.translate(cx, cy);

    context.rotate(element.angle);

    if (
      "scale" in elementWithCanvas.element &&
      !isPendingImageElement(element, renderConfig)
    ) {
      context.scale(
        elementWithCanvas.element.scale[0],
        elementWithCanvas.element.scale[1],
      );
    }

    // revert afterwards we don't have account for it during drawing
    context.translate(-cx, -cy);

    context.drawImage(
      elementWithCanvas.canvas!,
      (x1 + appState.scrollX) * window.devicePixelRatio -
        (padding * elementWithCanvas.scale) / elementWithCanvas.scale,
      (y1 + appState.scrollY) * window.devicePixelRatio -
        (padding * elementWithCanvas.scale) / elementWithCanvas.scale,
      elementWithCanvas.canvas!.width / elementWithCanvas.scale,
      elementWithCanvas.canvas!.height / elementWithCanvas.scale,
    );

    if (
      import.meta.env.VITE_APP_DEBUG_ENABLE_TEXT_CONTAINER_BOUNDING_BOX ===
        "true" &&
      hasBoundTextElement(element)
    ) {
      const textElement = getBoundTextElement(
        element,
        allElementsMap,
      ) as ExcalidrawTextElementWithContainer;
      const coords = getContainerCoords(element);
      context.strokeStyle = "#c92a2a";
      context.lineWidth = 3;
      context.strokeRect(
        (coords.x + appState.scrollX) * window.devicePixelRatio,
        (coords.y + appState.scrollY) * window.devicePixelRatio,
        getBoundTextMaxWidth(element, textElement) * window.devicePixelRatio,
        getBoundTextMaxHeight(element, textElement) * window.devicePixelRatio,
      );
    }
  }
  context.restore();

  // Clear the nested element we appended to the DOM
};

export const renderSelectionElement = (
  element: NonDeletedExcalidrawElement,
  context: CanvasRenderingContext2D,
  appState: InteractiveCanvasAppState,
  selectionColor: InteractiveCanvasRenderConfig["selectionColor"],
) => {
  context.save();
  context.translate(element.x + appState.scrollX, element.y + appState.scrollY);
  context.fillStyle = "rgba(0, 0, 200, 0.04)";

  // render from 0.5px offset  to get 1px wide line
  // https://stackoverflow.com/questions/7530593/html5-canvas-and-line-width/7531540#7531540
  // TODO can be be improved by offseting to the negative when user selects
  // from right to left
  const offset = 0.5 / appState.zoom.value;

  context.fillRect(offset, offset, element.width, element.height);
  context.lineWidth = 1 / appState.zoom.value;
  context.strokeStyle = selectionColor;
  context.strokeRect(offset, offset, element.width, element.height);

  context.restore();
};

export const renderElement = (
  element: NonDeletedExcalidrawElement,
  elementsMap: RenderableElementsMap,
  allElementsMap: NonDeletedSceneElementsMap,
  rc: RoughCanvas,
  context: CanvasRenderingContext2D,
  renderConfig: StaticCanvasRenderConfig,
  appState: StaticCanvasAppState | InteractiveCanvasAppState,
) => {
  const reduceAlphaForSelection =
    appState.openDialog?.name === "elementLinkSelector" &&
    !appState.selectedElementIds[element.id] &&
    !appState.hoveredElementIds[element.id];

  context.globalAlpha = getRenderOpacity(
    element,
    getContainingFrame(element, elementsMap),
    renderConfig.elementsPendingErasure,
    renderConfig.pendingFlowchartNodes,
    reduceAlphaForSelection ? DEFAULT_REDUCED_GLOBAL_ALPHA : 1,
  );

  switch (element.type) {
    case "magicframe":
    case "frame": {
      if (appState.frameRendering.enabled && appState.frameRendering.outline) {
        context.save();
        context.translate(
          element.x + appState.scrollX,
          element.y + appState.scrollY,
        );

        const useElementFrameColors =
          element.backgroundColor && element.backgroundColor !== "transparent";

        context.lineWidth =
          (element.strokeWidth ?? FRAME_STYLE.strokeWidth) /
          appState.zoom.value;
        context.strokeStyle = useElementFrameColors
          ? appState.theme === THEME.DARK
            ? applyDarkModeFilter(element.strokeColor)
            : element.strokeColor
          : appState.theme === THEME.DARK
          ? applyDarkModeFilter(FRAME_STYLE.strokeColor)
          : FRAME_STYLE.strokeColor;

        // TODO change later to only affect AI frames
        if (isMagicFrameElement(element)) {
          context.strokeStyle =
            appState.theme === THEME.LIGHT
              ? "#7affd7"
              : applyDarkModeFilter("#1d8264");
        }

        if (useElementFrameColors) {
          context.fillStyle =
            appState.theme === THEME.DARK
              ? applyDarkModeFilter(element.backgroundColor)
              : element.backgroundColor;
        }

        if (FRAME_STYLE.radius && context.roundRect) {
          context.beginPath();
          context.roundRect(
            0,
            0,
            element.width,
            element.height,
            FRAME_STYLE.radius / appState.zoom.value,
          );
          if (useElementFrameColors) {
            context.fill();
          }
          context.stroke();
          context.closePath();
        } else {
          if (useElementFrameColors) {
            context.fillRect(0, 0, element.width, element.height);
          }
          context.strokeRect(0, 0, element.width, element.height);
        }

        context.restore();
      }
      break;
    }
    case "freedraw": {
      if (renderConfig.isExporting) {
        const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
        const cx = (x1 + x2) / 2 + appState.scrollX;
        const cy = (y1 + y2) / 2 + appState.scrollY;
        const shiftX = (x2 - x1) / 2 - (element.x - x1);
        const shiftY = (y2 - y1) / 2 - (element.y - y1);
        context.save();
        context.translate(cx, cy);
        context.rotate(element.angle);
        context.translate(-shiftX, -shiftY);
        drawElementOnCanvas(element, rc, context, renderConfig);
        context.restore();
      } else {
        const elementWithCanvas = generateElementWithCanvas(
          element,
          allElementsMap,
          renderConfig,
          appState,
        );
        if (!elementWithCanvas) {
          return;
        }

        drawElementFromCanvas(
          elementWithCanvas,
          context,
          renderConfig,
          appState,
          allElementsMap,
        );
      }

      break;
    }
    case "rectangle":
    case "diamond":
    case "ellipse":
    case "line":
    case "arrow":
    case "image":
    case "text":
    case "iframe":
    case "embeddable": {
      if (renderConfig.isExporting) {
        const [x1, y1, x2, y2] = getElementAbsoluteCoords(element, elementsMap);
        const cx = (x1 + x2) / 2 + appState.scrollX;
        const cy = (y1 + y2) / 2 + appState.scrollY;
        let shiftX = (x2 - x1) / 2 - (element.x - x1);
        let shiftY = (y2 - y1) / 2 - (element.y - y1);
        if (isTextElement(element)) {
          const container = getContainerElement(element, elementsMap);
          if (isArrowElement(container)) {
            const boundTextCoords =
              LinearElementEditor.getBoundTextElementPosition(
                container,
                element as ExcalidrawTextElementWithContainer,
                elementsMap,
              );
            shiftX = (x2 - x1) / 2 - (boundTextCoords.x - x1);
            shiftY = (y2 - y1) / 2 - (boundTextCoords.y - y1);
          }
        }
        context.save();
        context.translate(cx, cy);

        const boundTextElement = getBoundTextElement(element, elementsMap);

        if (isArrowElement(element) && boundTextElement) {
          const tempCanvas = document.createElement("canvas");

          const tempCanvasContext = tempCanvas.getContext("2d")!;

          // Take max dimensions of arrow canvas so that when canvas is rotated
          // the arrow doesn't get clipped
          const maxDim = Math.max(distance(x1, x2), distance(y1, y2));
          const padding = getCanvasPadding(element);
          tempCanvas.width =
            maxDim * appState.exportScale + padding * 10 * appState.exportScale;
          tempCanvas.height =
            maxDim * appState.exportScale + padding * 10 * appState.exportScale;

          tempCanvasContext.translate(
            tempCanvas.width / 2,
            tempCanvas.height / 2,
          );
          tempCanvasContext.scale(appState.exportScale, appState.exportScale);

          // Shift the canvas to left most point of the arrow
          shiftX = element.width / 2 - (element.x - x1);
          shiftY = element.height / 2 - (element.y - y1);

          tempCanvasContext.rotate(element.angle);
          const tempRc = rough.canvas(tempCanvas);

          tempCanvasContext.translate(-shiftX, -shiftY);

          drawElementOnCanvas(element, tempRc, tempCanvasContext, renderConfig);

          tempCanvasContext.translate(shiftX, shiftY);

          tempCanvasContext.rotate(-element.angle);

          // Shift the canvas to center of bound text
          const [, , , , boundTextCx, boundTextCy] = getElementAbsoluteCoords(
            boundTextElement,
            elementsMap,
          );
          const boundTextShiftX = (x1 + x2) / 2 - boundTextCx;
          const boundTextShiftY = (y1 + y2) / 2 - boundTextCy;
          tempCanvasContext.translate(-boundTextShiftX, -boundTextShiftY);

          // Clear the bound text area
          tempCanvasContext.clearRect(
            -boundTextElement.width / 2,
            -boundTextElement.height / 2,
            boundTextElement.width,
            boundTextElement.height,
          );
          context.scale(1 / appState.exportScale, 1 / appState.exportScale);
          context.drawImage(
            tempCanvas,
            -tempCanvas.width / 2,
            -tempCanvas.height / 2,
            tempCanvas.width,
            tempCanvas.height,
          );
        } else {
          context.rotate(element.angle);

          if (element.type === "image") {
            // note: scale must be applied *after* rotating
            context.scale(element.scale[0], element.scale[1]);
          }

          context.translate(-shiftX, -shiftY);
          drawElementOnCanvas(element, rc, context, renderConfig);
        }

        context.restore();
        // not exporting → optimized rendering (cache & render from element
        // canvases)
      } else {
        const elementWithCanvas = generateElementWithCanvas(
          element,
          allElementsMap,
          renderConfig,
          appState,
        );

        if (!elementWithCanvas) {
          return;
        }

        const currentImageSmoothingStatus = context.imageSmoothingEnabled;

        if (
          // do not disable smoothing during zoom as blurry shapes look better
          // on low resolution (while still zooming in) than sharp ones
          !appState?.shouldCacheIgnoreZoom &&
          // angle is 0 -> always disable smoothing
          (!element.angle ||
            // or check if angle is a right angle in which case we can still
            // disable smoothing without adversely affecting the result
            // We need less-than comparison because of FP artihmetic
            isRightAngleRads(element.angle))
        ) {
          // Disabling smoothing makes output much sharper, especially for
          // text. Unless for non-right angles, where the aliasing is really
          // terrible on Chromium.
          //
          // Note that `context.imageSmoothingQuality="high"` has almost
          // zero effect.
          //
          context.imageSmoothingEnabled = false;
        }

        if (
          element.id === appState.croppingElementId &&
          isImageElement(elementWithCanvas.element) &&
          elementWithCanvas.element.crop !== null
        ) {
          context.save();
          context.globalAlpha = 0.1;

          const uncroppedElementCanvas = generateElementCanvas(
            getUncroppedImageElement(elementWithCanvas.element, elementsMap),
            allElementsMap,
            appState.zoom,
            renderConfig,
            appState,
          );

          if (uncroppedElementCanvas) {
            drawElementFromCanvas(
              uncroppedElementCanvas,
              context,
              renderConfig,
              appState,
              allElementsMap,
            );
          }

          context.restore();
        }

        drawElementFromCanvas(
          elementWithCanvas,
          context,
          renderConfig,
          appState,
          allElementsMap,
        );

        // reset
        context.imageSmoothingEnabled = currentImageSmoothingStatus;
      }
      break;
    }
    default: {
      // @ts-ignore
      throw new Error(`Unimplemented type ${element.type}`);
    }
  }

  context.globalAlpha = 1;
};

export function getFreedrawOutlineAsSegments(
  element: ExcalidrawFreeDrawElement,
  points: [number, number][],
  elementsMap: ElementsMap,
) {
  const bounds = getElementBounds(
    {
      ...element,
      angle: 0 as Radians,
    },
    elementsMap,
  );
  const center = pointFrom<GlobalPoint>(
    (bounds[0] + bounds[2]) / 2,
    (bounds[1] + bounds[3]) / 2,
  );

  invariant(points.length >= 2, "Freepath outline must have at least 2 points");

  return points.slice(2).reduce(
    (acc, curr) => {
      acc.push(
        lineSegment<GlobalPoint>(
          acc[acc.length - 1][1],
          pointRotateRads(
            pointFrom<GlobalPoint>(curr[0] + element.x, curr[1] + element.y),
            center,
            element.angle,
          ),
        ),
      );
      return acc;
    },
    [
      lineSegment<GlobalPoint>(
        pointRotateRads(
          pointFrom<GlobalPoint>(
            points[0][0] + element.x,
            points[0][1] + element.y,
          ),
          center,
          element.angle,
        ),
        pointRotateRads(
          pointFrom<GlobalPoint>(
            points[1][0] + element.x,
            points[1][1] + element.y,
          ),
          center,
          element.angle,
        ),
      ),
    ],
  );
}
