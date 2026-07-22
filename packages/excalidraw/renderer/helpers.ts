import { THEME, applyDarkModeFilter } from "@excalidraw/common";

import type { StaticCanvasRenderConfig } from "../scene/types";
import type { AppState, StaticCanvasAppState } from "../types";

export const fillCircle = (
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  stroke: boolean,
  fill = true,
) => {
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  if (fill) {
    context.fill();
  }
  if (stroke) {
    context.stroke();
  }
};

export const getNormalizedCanvasDimensions = (
  canvas: HTMLCanvasElement,
  scale: number,
): [number, number] => {
  // When doing calculations based on canvas width we should used normalized one
  return [canvas.width / scale, canvas.height / scale];
};

export const bootstrapCanvas = ({
  canvas,
  scale,
  normalizedWidth,
  normalizedHeight,
  theme,
  isExporting,
  viewBackgroundColor,
  requestOpaque = false,
}: {
  canvas: HTMLCanvasElement;
  scale: number;
  normalizedWidth: number;
  normalizedHeight: number;
  theme?: AppState["theme"];
  isExporting?: StaticCanvasRenderConfig["isExporting"];
  viewBackgroundColor?: StaticCanvasAppState["viewBackgroundColor"];
  /**
   * E09.2: request an opaque (`alpha: false`) 2D context. This is granted ONLY
   * when the resolved background is itself opaque — a `viewBackgroundColor`
   * string that is not transparent/translucent. On a transparent background an
   * opaque context would composite the cleared canvas as solid black, so the
   * guard falls back to the default alpha context. Callers pass this only for
   * the STATIC scene layer; the interactive / new-element layers MUST stay
   * transparent so they composite over the static layer beneath.
   *
   * NOTE: 2D context attributes are fixed at the first `getContext` call for a
   * given canvas and ignored thereafter, so a long-lived canvas keeps whatever
   * alpha it was first created with. In practice the static canvas is created
   * with a stable (opaque) Terraform background before its first paint.
   */
  requestOpaque?: boolean;
}): CanvasRenderingContext2D => {
  const hasTransparence =
    typeof viewBackgroundColor === "string"
      ? viewBackgroundColor === "transparent" ||
        viewBackgroundColor.length === 5 || // #RGBA
        viewBackgroundColor.length === 9 || // #RRGGBBA
        /(hsla|rgba)\(/.test(viewBackgroundColor)
      : true;
  const opaque =
    requestOpaque && typeof viewBackgroundColor === "string" && !hasTransparence;

  const context = canvas.getContext(
    "2d",
    opaque ? { alpha: false } : undefined,
  )!;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.scale(scale, scale);

  // Paint background
  if (typeof viewBackgroundColor === "string") {
    if (hasTransparence) {
      context.clearRect(0, 0, normalizedWidth, normalizedHeight);
    }
    context.save();
    context.fillStyle =
      theme === THEME.DARK
        ? applyDarkModeFilter(viewBackgroundColor)
        : viewBackgroundColor;
    context.fillRect(0, 0, normalizedWidth, normalizedHeight);
    context.restore();
  } else {
    context.clearRect(0, 0, normalizedWidth, normalizedHeight);
  }

  return context;
};

export const strokeRectWithRotation_simple = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  cx: number,
  cy: number,
  angle: number,
  fill: boolean = false,
  /** should account for zoom */
  radius: number = 0,
) => {
  context.save();
  context.translate(cx, cy);
  context.rotate(angle);
  if (fill) {
    context.fillRect(x - cx, y - cy, width, height);
  }
  if (radius && context.roundRect) {
    context.beginPath();
    context.roundRect(x - cx, y - cy, width, height, radius);
    context.stroke();
    context.closePath();
  } else {
    context.strokeRect(x - cx, y - cy, width, height);
  }
  context.restore();
};
