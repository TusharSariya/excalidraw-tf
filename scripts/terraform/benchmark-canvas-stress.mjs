#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Canvas stress benchmark harness.
 *
 * Drives the /demo terraform import through a registry of seeded, reproducible
 * interaction workloads (zoom/pan/hover/click/selection/drawing/edit churn)
 * and reports per-workload rAF frame-interval percentiles, dropped-frame %,
 * longtask stats, element-canvas regeneration deltas, replaceAllElements
 * deltas, and JS heap deltas.
 *
 * See scripts/terraform/benchmark-canvas-runtime.mjs for the original
 * (toggle-A/B focused) harness this borrows its measurement patterns from.
 *
 * Usage:
 *   node scripts/terraform/benchmark-canvas-stress.mjs \
 *     --runs 3 --warmup 1 --label mylabel \
 *     --workloads zoom-cycle,pan-4way --seed 42
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined
    ? args[index + 1]
    : fallback;
};
const hasFlag = (name) => args.includes(name);

const PINNED_DEMO_PATH =
  "/demo?preset=staging-extended-localstack-v2&view=strata&compact=0&ancillary=1&privateApiRegional=1&strataSweeps=4&strataCoordRefine=1&strataRankSep=1&strataPackedScoring=0&strataBandDepth=root&strataDeBand=vpc&strataSift=1&strataBlockClamp=1&strataTranspose=1&lodEnabled=1&lodPreset=balanced&minimap=0&layers=declared";

const DEFAULT_OUT =
  "/private/tmp/claude-501/-Users-tusharsariya-Projects-excalidraw-tf/c7c39f5c-073a-4039-b046-685eb395a02e/scratchpad/perf-loop-20260721/canvas";

const baseUrl = getArg("--url", "http://localhost:3001").replace(/\/$/, "");
const targetUrlArg = getArg("--target-url", null);
const runsCount = Number(getArg("--runs", "3"));
const warmupCount = Number(getArg("--warmup", "1"));
const label = getArg("--label", "stress");
const baselinePath = getArg("--baseline", null);
const workloadsArg = getArg("--workloads", null);
const seed = Number(getArg("--seed", "42"));
const viewportArg = getArg("--viewport", "1600x1000");
const dpr = Number(getArg("--dpr", "1"));
const soakMinutes = Number(getArg("--soak-minutes", "0"));
const reusePage = hasFlag("--reuse-page");
const outDir = getArg("--out", DEFAULT_OUT);
const matrixPath = getArg("--matrix", null);

const [vpWidth, vpHeight] = viewportArg
  .split("x")
  .map((value) => Number(value));
if (!vpWidth || !vpHeight) {
  throw new Error(`bad --viewport ${viewportArg}; expected WxH e.g. 1600x1000`);
}

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32). Each workload gets an independent stream keyed by
// seed ^ hash(name) so subsetting --workloads never changes another workload's
// pointer paths.
// ---------------------------------------------------------------------------
const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hashName = (name) => {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  }
  return h >>> 0;
};

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------
const percentile = (values, quantile) => {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))
  ];
};
const median = (values) => percentile(values, 0.5);

// ---------------------------------------------------------------------------
// Measurement plumbing (rAF sampler + longtask observer), adapted from
// benchmark-canvas-runtime.mjs.
// ---------------------------------------------------------------------------
const startMeasurement = async (page) => {
  await page.evaluate(() => {
    window.__stressMeasurement = {
      frames: [],
      longTasks: [],
      stopped: false,
    };
    const measurement = window.__stressMeasurement;
    let previous = performance.now();
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        measurement.longTasks.push(entry.duration);
      }
    });
    try {
      observer.observe({ type: "longtask", buffered: false });
    } catch {}
    measurement.observer = observer;
    const frame = (now) => {
      measurement.frames.push(now - previous);
      previous = now;
      if (!measurement.stopped) {
        requestAnimationFrame(frame);
      }
    };
    requestAnimationFrame(frame);
  });
};

const stopMeasurement = async (page) =>
  page.evaluate(() => {
    const measurement = window.__stressMeasurement;
    measurement.stopped = true;
    measurement.observer?.disconnect();
    return {
      intervals: measurement.frames.slice(1),
      longTasks: measurement.longTasks,
    };
  });

const snapshotCounters = async (page) =>
  page.evaluate(() => ({
    regenTotal: window.__elementCanvasRegenStats?.total ?? 0,
    regenZoom: window.__elementCanvasRegenStats?.zoom ?? 0,
    replaceAll: window.__terraformReplaceAllElementsCount ?? 0,
    heap: performance.memory?.usedJSHeapSize ?? null,
  }));

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------
const waitForImport = async (page) => {
  await page.waitForFunction(
    () => {
      const h = window.h;
      if (!h?.app?.scene) {
        return false;
      }
      if (document.body.innerText.includes("Loading preset")) {
        return false;
      }
      return h.app.scene.getElementsIncludingDeleted().length > 500;
    },
    null,
    { timeout: 360_000, polling: 1000 },
  );
  // Wait for the element count to be stable for 5s (import/layout settled).
  let previous = -1;
  let stableSince = Date.now();
  const cap = Date.now() + 120_000;
  while (Date.now() < cap) {
    const count = await page.evaluate(
      () => window.h.app.scene.getElementsIncludingDeleted().length,
    );
    if (count !== previous) {
      previous = count;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 5000) {
      break;
    }
    await page.waitForTimeout(1000);
  }
  return previous;
};

const instrumentPage = async (page) => {
  await page.evaluate(() => {
    if (window.__elementCanvasRegenStats) {
      window.__elementCanvasRegenStats.enabled = true;
    }
    const scene = window.h.app.scene;
    if (!window.__terraformReplaceAllElementsPatched) {
      const original = scene.replaceAllElements.bind(scene);
      window.__terraformReplaceAllElementsCount = 0;
      scene.replaceAllElements = (...rest) => {
        window.__terraformReplaceAllElementsCount++;
        return original(...rest);
      };
      window.__terraformReplaceAllElementsPatched = true;
    }
  });
};

const getSceneBounds = async (page) =>
  page.evaluate(() => {
    const elements = window.h.app.scene
      .getElementsIncludingDeleted()
      .filter((element) => !element.isDeleted);
    const minX = Math.min(...elements.map((element) => element.x));
    const minY = Math.min(...elements.map((element) => element.y));
    const maxX = Math.max(
      ...elements.map((element) => element.x + element.width),
    );
    const maxY = Math.max(
      ...elements.map((element) => element.y + element.height),
    );
    return { minX, minY, maxX, maxY };
  });

const computeFitViewport = async (page) =>
  page.evaluate(() => {
    const state = window.h.state;
    const elements = window.h.app.scene
      .getElementsIncludingDeleted()
      .filter((element) => !element.isDeleted);
    const minX = Math.min(...elements.map((element) => element.x));
    const minY = Math.min(...elements.map((element) => element.y));
    const maxX = Math.max(
      ...elements.map((element) => element.x + element.width),
    );
    const maxY = Math.max(
      ...elements.map((element) => element.y + element.height),
    );
    const zoom = Math.min(
      1,
      Math.max(
        0.02,
        Math.min(
          state.width / (maxX - minX + 400),
          state.height / (maxY - minY + 400),
        ),
      ),
    );
    return {
      zoom,
      scrollX: state.width / (2 * zoom) - (minX + maxX) / 2,
      scrollY: state.height / (2 * zoom) - (minY + maxY) / 2,
    };
  });

const setViewport = async (page, viewport, settleMs = 200) => {
  await page.evaluate((next) => {
    window.h.setState({
      zoom: { value: next.zoom },
      scrollX: next.scrollX,
      scrollY: next.scrollY,
      hoveredElementIds: {},
      selectedElementIds: {},
    });
  }, viewport);
  await page.waitForTimeout(settleMs);
};

const setZoomCentered = async (page, zoom, settleMs = 60) => {
  await page.evaluate((nextZoom) => {
    const state = window.h.state;
    // keep the scene point currently at the viewport centre fixed
    const centerSceneX = state.width / (2 * state.zoom.value) - state.scrollX;
    const centerSceneY = state.height / (2 * state.zoom.value) - state.scrollY;
    window.h.setState({
      zoom: { value: nextZoom },
      scrollX: state.width / (2 * nextZoom) - centerSceneX,
      scrollY: state.height / (2 * nextZoom) - centerSceneY,
    });
  }, zoom);
  await page.waitForTimeout(settleMs);
};

// Screen-space centres of currently on-screen elements (viewport coords).
const elementScreenCenters = async (page, limit = 400) =>
  page.evaluate((max) => {
    const state = window.h.state;
    const zoom = state.zoom.value;
    const offsetLeft = state.offsetLeft ?? 0;
    const offsetTop = state.offsetTop ?? 0;
    const out = [];
    const elements = window.h.app.scene
      .getElementsIncludingDeleted()
      .filter(
        (element) =>
          !element.isDeleted && element.width > 4 && element.height > 4,
      );
    for (const element of elements) {
      const cx =
        (element.x + element.width / 2 + state.scrollX) * zoom + offsetLeft;
      const cy =
        (element.y + element.height / 2 + state.scrollY) * zoom + offsetTop;
      if (
        cx > 20 &&
        cy > 90 &&
        cx < state.width - 20 &&
        cy < state.height - 90
      ) {
        out.push({ x: cx, y: cy });
        if (out.length >= max) {
          break;
        }
      }
    }
    return out;
  }, limit);

const activeToolType = async (page) =>
  page.evaluate(() => window.h?.state?.activeTool?.type ?? null);

const selectedCount = async (page) =>
  page.evaluate(
    () => Object.keys(window.h?.state?.selectedElementIds ?? {}).length,
  );

/**
 * Switch tool via keyboard shortcut, verifying via window.h.state.activeTool.
 * Tries candidate keys in order, then falls back to app.setActiveTool.
 * Records which route worked in ctx.notes.toolShortcuts.
 */
const setTool = async (page, ctx, candidates, expected) => {
  for (const key of candidates) {
    await page.keyboard.press(key);
    await page.waitForTimeout(30);
    if ((await activeToolType(page)) === expected) {
      ctx.notes.toolShortcuts[expected] = key;
      return;
    }
  }
  const ok = await page.evaluate((toolType) => {
    try {
      window.h.app.setActiveTool({ type: toolType });
      return window.h.state.activeTool.type === toolType;
    } catch {
      return false;
    }
  }, expected);
  if (ok) {
    ctx.notes.toolShortcuts[expected] = "setActiveTool()";
    return;
  }
  throw new Error(
    `could not activate tool "${expected}" (tried ${candidates.join(",")})`,
  );
};

const resetToSelectionTool = async (page) => {
  await page.keyboard.press("Escape");
  const ok = await page.evaluate(() => {
    try {
      window.h.app.setActiveTool({ type: "selection" });
      return window.h.state.activeTool.type === "selection";
    } catch {
      return false;
    }
  });
  if (!ok) {
    await page.keyboard.press("v");
  }
};

const ctrlWheelZoom = async (page, point, deltaY, steps) => {
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Control");
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, deltaY);
    await page.waitForTimeout(25);
  }
  await page.keyboard.up("Control");
};

// Space-held left drag = canvas pan (falls back to a marquee-style drag if the
// space shortcut ever changes; either way it exercises the interactive canvas).
const dragPan = async (page, from, dx, dy, steps) => {
  await page.keyboard.down("Space");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + dx * i, from.y + dy * i);
  }
  await page.mouse.up();
  await page.keyboard.up("Space");
  await page.keyboard.press("Escape");
};

const dragShape = async (page, from, to, moveSteps = 8) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= moveSteps; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / moveSteps,
      from.y + ((to.y - from.y) * i) / moveSteps,
    );
  }
  await page.mouse.up();
};

const randPoint = (ctx, marginX = 80, marginTop = 120, marginBottom = 100) => ({
  x: marginX + ctx.rand() * (ctx.viewport.width - 2 * marginX),
  y: marginTop + ctx.rand() * (ctx.viewport.height - marginTop - marginBottom),
});

// ---------------------------------------------------------------------------
// LOD threshold probe: sweep zoom levels, watch visibleElements count for the
// largest jump; the midpoint of that jump is the LOD threshold. Cached per
// page load in ctx.state.
// ---------------------------------------------------------------------------
const findLodThreshold = async (page, ctx) => {
  if (ctx.state.lodThreshold) {
    return ctx.state.lodThreshold;
  }
  const zooms = [0.05, 0.08, 0.11, 0.15, 0.2, 0.27, 0.35, 0.45, 0.6, 0.8, 1.0];
  const counts = [];
  for (const zoom of zooms) {
    await setZoomCentered(page, zoom, 90);
    counts.push(
      await page.evaluate(
        () => window.h.app.visibleElements?.length ?? null,
      ),
    );
  }
  let bestIndex = -1;
  let bestJump = 0;
  for (let i = 1; i < counts.length; i++) {
    if (counts[i] == null || counts[i - 1] == null) {
      continue;
    }
    const jump =
      Math.abs(counts[i] - counts[i - 1]) / Math.max(1, counts[i - 1]);
    if (jump > bestJump) {
      bestJump = jump;
      bestIndex = i;
    }
  }
  const threshold =
    bestIndex > 0 ? (zooms[bestIndex - 1] + zooms[bestIndex]) / 2 : 0.25;
  ctx.state.lodThreshold = threshold;
  ctx.notes.lodThreshold = { threshold, zooms, visibleCounts: counts };
  return threshold;
};

// ---------------------------------------------------------------------------
// Workload registry. Order is the canonical execution order: read-only first,
// then selection, then mutating; soak (opt-in) last.
// ---------------------------------------------------------------------------
const WORKLOADS = [
  {
    name: "zoom-cycle",
    tags: ["read-only", "zoom"],
    run: async (page, ctx) => {
      const center = ctx.center;
      await ctrlWheelZoom(page, center, -100, 20);
      await ctrlWheelZoom(page, center, 100, 20);
      await ctrlWheelZoom(page, center, -100, 10);
      await ctrlWheelZoom(page, center, 100, 10);
    },
  },
  {
    name: "zoom-lod-thrash",
    tags: ["read-only", "zoom", "lod"],
    run: async (page, ctx) => {
      const threshold = await findLodThreshold(page, ctx);
      const low = threshold * 0.8;
      const high = threshold * 1.25;
      for (let i = 0; i < 30; i++) {
        await setZoomCentered(page, i % 2 === 0 ? high : low, 60);
      }
    },
  },
  {
    name: "zoom-extremes",
    tags: ["read-only", "zoom"],
    run: async (page, ctx) => {
      for (let cycle = 0; cycle < 2; cycle++) {
        await setViewport(page, ctx.refViewport, 250);
        const centers = await elementScreenCenters(page);
        const target = centers.length
          ? centers[Math.floor(ctx.rand() * centers.length)]
          : ctx.center;
        await ctrlWheelZoom(page, target, -160, 10);
        await page.waitForTimeout(150);
      }
      await setViewport(page, ctx.refViewport, 250);
    },
  },
  {
    name: "pan-4way",
    tags: ["read-only", "pan"],
    run: async (page, ctx) => {
      const center = ctx.center;
      const delta = 9;
      const steps = 30;
      await dragPan(page, center, 0, -delta, steps); // N
      await dragPan(page, center, delta, 0, steps); // E
      await dragPan(page, center, 0, delta, steps); // S
      await dragPan(page, center, -delta, 0, steps); // W
    },
  },
  {
    name: "viewport-thrash",
    tags: ["read-only", "pan"],
    run: async (page, ctx) => {
      const bounds = await getSceneBounds(page);
      const corners = [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
      ];
      const targets = [
        ...corners,
        ...Array.from({ length: 4 }, () => ({
          x: bounds.minX + ctx.rand() * (bounds.maxX - bounds.minX),
          y: bounds.minY + ctx.rand() * (bounds.maxY - bounds.minY),
        })),
      ];
      for (const target of targets) {
        await page.evaluate((sceneTarget) => {
          const state = window.h.state;
          const zoom = state.zoom.value;
          window.h.setState({
            scrollX: state.width / (2 * zoom) - sceneTarget.x,
            scrollY: state.height / (2 * zoom) - sceneTarget.y,
          });
        }, target);
        await page.waitForTimeout(130);
      }
    },
  },
  {
    name: "hover-sweep",
    tags: ["read-only", "hover"],
    run: async (page, ctx) => {
      const { width, height } = ctx.viewport;
      for (let sweep = 0; sweep < 5; sweep++) {
        const y = 140 + ctx.rand() * (height - 280);
        const leftToRight = sweep % 2 === 0;
        for (let step = 0; step < 40; step++) {
          const t = step / 39;
          const x = 60 + (leftToRight ? t : 1 - t) * (width - 120);
          await page.mouse.move(x, y + Math.sin(step / 3) * 12);
        }
      }
    },
  },
  {
    name: "click-storm",
    tags: ["read-only", "click"],
    run: async (page, ctx) => {
      const centers = await elementScreenCenters(page);
      for (let i = 0; i < 40; i++) {
        const point =
          i % 2 === 0 && centers.length
            ? centers[Math.floor(ctx.rand() * centers.length)]
            : randPoint(ctx);
        await page.mouse.click(point.x, point.y);
        // brief settle so the rAF sampler gets frames between click-induced
        // longtasks (otherwise sample counts degenerate)
        await page.waitForTimeout(60);
        if (i % 8 === 7) {
          await page.keyboard.press("Escape");
        }
      }
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "marquee",
    tags: ["selection"],
    run: async (page, ctx) => {
      for (let i = 0; i < 3; i++) {
        const from = randPoint(ctx, 100, 140, 160);
        const to = {
          x: Math.min(
            ctx.viewport.width - 60,
            from.x + (0.4 + ctx.rand() * 0.3) * ctx.viewport.width,
          ),
          y: Math.min(
            ctx.viewport.height - 80,
            from.y + (0.4 + ctx.rand() * 0.3) * ctx.viewport.height,
          ),
        };
        await dragShape(page, from, to, 14);
        await page.keyboard.press("Escape");
      }
    },
  },
  {
    name: "select-all-drag",
    tags: ["selection", "mutating"],
    run: async (page, ctx) => {
      await page.keyboard.press("ControlOrMeta+KeyA");
      await page.waitForTimeout(150);
      ctx.notes.selectAllCount = await selectedCount(page);
      const centers = await elementScreenCenters(page);
      const grip = centers.length
        ? centers[Math.floor(ctx.rand() * centers.length)]
        : ctx.center;
      await page.mouse.move(grip.x, grip.y);
      await page.mouse.down();
      for (let i = 1; i <= 20; i++) {
        await page.mouse.move(grip.x + i * 6, grip.y + i * 4);
      }
      for (let i = 19; i >= 0; i--) {
        await page.mouse.move(grip.x + i * 6, grip.y + i * 4);
      }
      await page.mouse.up();
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "nudge-storm",
    tags: ["selection", "mutating"],
    run: async (page, ctx) => {
      await page.keyboard.press("ControlOrMeta+KeyA");
      await page.waitForTimeout(150);
      const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press(
          arrows[Math.floor(ctx.rand() * arrows.length)],
        );
      }
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "draw-shapes",
    tags: ["mutating", "draw"],
    run: async (page, ctx) => {
      const drawOne = async (toolKeys, toolType) => {
        await setTool(page, ctx, toolKeys, toolType);
        const from = randPoint(ctx);
        const to = {
          x: from.x + 60 + ctx.rand() * 160,
          y: from.y + 40 + ctx.rand() * 120,
        };
        await dragShape(page, from, to);
        await page.keyboard.press("Escape");
      };
      for (let i = 0; i < 3; i++) {
        await drawOne(["r", "2"], "rectangle");
      }
      for (let i = 0; i < 3; i++) {
        await drawOne(["o", "4"], "ellipse");
      }
      for (let i = 0; i < 3; i++) {
        await drawOne(["a", "5"], "arrow");
      }
      // freedraw squiggle x2 (60 seeded points each)
      for (let i = 0; i < 2; i++) {
        await setTool(page, ctx, ["p", "x", "7"], "freedraw");
        const start = randPoint(ctx);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        let { x, y } = start;
        for (let step = 0; step < 60; step++) {
          x += (ctx.rand() - 0.5) * 24;
          y += (ctx.rand() - 0.5) * 24;
          x = Math.max(60, Math.min(ctx.viewport.width - 60, x));
          y = Math.max(120, Math.min(ctx.viewport.height - 100, y));
          await page.mouse.move(x, y);
        }
        await page.mouse.up();
        await page.keyboard.press("Escape");
      }
      await resetToSelectionTool(page);
    },
  },
  {
    name: "text",
    tags: ["mutating", "text"],
    run: async (page, ctx) => {
      for (let i = 0; i < 2; i++) {
        await setTool(page, ctx, ["t", "8"], "text");
        const point = randPoint(ctx);
        await page.mouse.click(point.x, point.y);
        await page.waitForTimeout(120);
        const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        let text = "stress-";
        while (text.length < 20) {
          text += chars[Math.floor(ctx.rand() * chars.length)];
        }
        await page.keyboard.type(text, { delay: 15 });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(80);
      }
      await resetToSelectionTool(page);
    },
  },
  {
    name: "edit-churn",
    tags: ["mutating", "history"],
    run: async (page) => {
      await page.keyboard.press("ControlOrMeta+KeyA");
      await page.waitForTimeout(150);
      await page.keyboard.press("ControlOrMeta+KeyD");
      await page.waitForTimeout(300);
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("ControlOrMeta+KeyZ");
        await page.waitForTimeout(120);
      }
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("Shift+ControlOrMeta+KeyZ");
        await page.waitForTimeout(120);
      }
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "multi-stress",
    tags: ["mutating", "combined"],
    run: async (page, ctx) => {
      const center = ctx.center;
      for (let cycle = 0; cycle < 12; cycle++) {
        // 5 pan steps (wheel-based pan)
        for (let i = 0; i < 5; i++) {
          await page.mouse.wheel(
            (ctx.rand() - 0.5) * 240,
            (ctx.rand() - 0.5) * 240,
          );
          await page.waitForTimeout(15);
        }
        // 3 zoom steps
        await ctrlWheelZoom(
          page,
          center,
          cycle % 2 === 0 ? -100 : 100,
          3,
        );
      }
      // start a rect drag mid-pan momentum
      await page.mouse.wheel(200, 120);
      await setTool(page, ctx, ["r", "2"], "rectangle");
      const from = randPoint(ctx);
      await dragShape(page, from, { x: from.x + 140, y: from.y + 90 });
      await page.keyboard.press("Escape");
      await resetToSelectionTool(page);
    },
  },
  {
    name: "soak",
    tags: ["soak", "mutating"],
    run: async (page, ctx) => {
      const deadline = Date.now() + soakMinutes * 60_000;
      const timeline = [];
      let lastSample = Date.now();
      let frameIndex = 0;
      const actions = [
        async () => {
          await dragPan(page, ctx.center, (ctx.rand() - 0.5) * 16, (ctx.rand() - 0.5) * 16, 15);
        },
        async () => {
          await ctrlWheelZoom(page, ctx.center, ctx.rand() < 0.5 ? -100 : 100, 4);
        },
        async () => {
          const y = 140 + ctx.rand() * (ctx.viewport.height - 280);
          for (let i = 0; i < 20; i++) {
            await page.mouse.move(
              60 + (i / 19) * (ctx.viewport.width - 120),
              y,
            );
          }
        },
        async () => {
          const point = randPoint(ctx);
          await page.mouse.click(point.x, point.y);
          await page.keyboard.press("Escape");
        },
        async () => {
          const from = randPoint(ctx, 120, 160, 180);
          await dragShape(
            page,
            from,
            { x: from.x + 300, y: from.y + 200 },
            10,
          );
          await page.keyboard.press("Escape");
        },
      ];
      while (Date.now() < deadline) {
        await actions[Math.floor(ctx.rand() * actions.length)]();
        if (Date.now() - lastSample >= 30_000) {
          lastSample = Date.now();
          const sample = await page.evaluate((fromIndex) => {
            const frames = window.__stressMeasurement?.frames ?? [];
            return {
              frames: frames.slice(fromIndex),
              length: frames.length,
              heap: performance.memory?.usedJSHeapSize ?? null,
            };
          }, frameIndex);
          frameIndex = sample.length;
          timeline.push({
            elapsedMs: Date.now() - (deadline - soakMinutes * 60_000),
            heapBytes: sample.heap,
            rollingP95: percentile(sample.frames, 0.95),
            rollingSamples: sample.frames.length,
          });
        }
      }
      ctx.notes.soakTimeline = timeline;
    },
  },
];

const CANONICAL_ORDER = WORKLOADS.map((workload) => workload.name);

// ---------------------------------------------------------------------------
// Per-workload measured execution
// ---------------------------------------------------------------------------
const measureWorkload = async (page, workload, ctx) => {
  // restore pristine view state so each workload starts comparably
  await resetToSelectionTool(page);
  await setViewport(page, ctx.refViewport, 250);
  await page.evaluate(() => {
    window.__resetElementCanvasRegenStats?.();
  });

  const before = await snapshotCounters(page);
  await startMeasurement(page);
  const startedAt = Date.now();
  await workload.run(page, ctx);
  await page.waitForTimeout(400);
  const raw = await stopMeasurement(page);
  const after = await snapshotCounters(page);

  const intervals = raw.intervals;
  const dropped = intervals.filter((value) => value > 33.4).length;
  return {
    durationMs: Date.now() - startedAt,
    rafSamples: intervals.length,
    p50: percentile(intervals, 0.5),
    p95: percentile(intervals, 0.95),
    p99: percentile(intervals, 0.99),
    avg: intervals.length
      ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
      : 0,
    worst: Math.max(...intervals, 0),
    droppedPct: intervals.length ? (dropped / intervals.length) * 100 : 0,
    longtask: {
      count: raw.longTasks.length,
      totalMs: raw.longTasks.reduce((sum, value) => sum + value, 0),
      maxMs: Math.max(...raw.longTasks, 0),
    },
    regenDelta: {
      total: after.regenTotal - before.regenTotal,
      zoom: after.regenZoom - before.regenZoom,
    },
    replaceAllDelta: after.replaceAll - before.replaceAll,
    heapDeltaBytes:
      after.heap != null && before.heap != null
        ? after.heap - before.heap
        : null,
  };
};

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------
const AGG_FIELDS = [
  ["p50", (m) => m.p50],
  ["p95", (m) => m.p95],
  ["p99", (m) => m.p99],
  ["avg", (m) => m.avg],
  ["worst", (m) => m.worst],
  ["droppedPct", (m) => m.droppedPct],
  ["rafSamples", (m) => m.rafSamples],
  ["longtaskCount", (m) => m.longtask.count],
  ["longtaskTotalMs", (m) => m.longtask.totalMs],
  ["longtaskMaxMs", (m) => m.longtask.maxMs],
  ["regenTotal", (m) => m.regenDelta.total],
  ["regenZoom", (m) => m.regenDelta.zoom],
  ["replaceAllDelta", (m) => m.replaceAllDelta],
  ["heapDeltaBytes", (m) => m.heapDeltaBytes],
];

const aggregateRuns = (runs, workloadNames) => {
  const aggregate = {};
  const spreadPct = {};
  for (const name of workloadNames) {
    const entries = runs
      .map((run) => run.workloads[name])
      .filter((entry) => entry && !entry.error);
    if (!entries.length) {
      continue;
    }
    const summary = {};
    for (const [field, pick] of AGG_FIELDS) {
      const values = entries
        .map(pick)
        .filter((value) => value != null && Number.isFinite(value));
      summary[field] = values.length ? median(values) : null;
    }
    aggregate[name] = summary;
    const p95Values = entries.map((entry) => entry.p95);
    const p95Median = median(p95Values);
    spreadPct[name] =
      p95Median > 0
        ? ((Math.max(...p95Values) - Math.min(...p95Values)) / p95Median) * 100
        : 0;
  }
  return { aggregate, spreadPct };
};

// ---------------------------------------------------------------------------
// Suite runner (one config = one target URL; whole warmup+runs sequence)
// ---------------------------------------------------------------------------
const runSuiteForConfig = async (browser, config, selectedWorkloads) => {
  const runs = [];
  const notes = { toolShortcuts: {} };
  let context = null;
  let page = null;
  let harnessErrors = 0;

  const newPage = async () => {
    context = await browser.newContext({
      serviceWorkers: "block",
      viewport: { width: vpWidth, height: vpHeight },
      deviceScaleFactor: dpr,
    });
    page = await context.newPage();
    page.on("pageerror", () => {});
    return page;
  };

  const totalRuns = warmupCount + runsCount;
  for (let runIndex = 0; runIndex < totalRuns; runIndex++) {
    const isWarmup = runIndex < warmupCount;
    const tag = isWarmup
      ? `warmup ${runIndex + 1}/${warmupCount}`
      : `run ${runIndex + 1 - warmupCount}/${runsCount}`;
    console.log(`[${config.name}] ${tag}: loading ${config.targetUrl}`);
    if (reusePage && page) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    } else {
      if (context) {
        await context.close();
      }
      await newPage();
      await page.goto(config.targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
    }
    const elementCount = await waitForImport(page);
    console.log(`[${config.name}] ${tag}: import done (${elementCount} elements)`);
    await instrumentPage(page);

    const refViewport = await computeFitViewport(page);
    const canvas = page.locator(".excalidraw__canvas.interactive").first();
    const box = await canvas.boundingBox();
    if (!box) {
      throw new Error("interactive canvas not found");
    }
    // ensure keyboard focus on the editor (click a far-corner, likely-empty
    // point, then clear any accidental selection)
    await setViewport(page, refViewport, 200);
    await page.mouse.click(box.x + box.width - 30, box.y + box.height - 30);
    await page.keyboard.press("Escape");

    const ctxBase = {
      viewport: { width: vpWidth, height: vpHeight },
      center: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      box,
      refViewport,
      notes,
      state: {},
    };

    const runResult = { workloads: {} };
    for (const workload of selectedWorkloads) {
      const ctx = {
        ...ctxBase,
        rand: mulberry32((seed ^ hashName(workload.name)) >>> 0),
      };
      process.stdout.write(`[${config.name}] ${tag}: ${workload.name} ... `);
      try {
        const metrics = await measureWorkload(page, workload, ctx);
        runResult.workloads[workload.name] = metrics;
        console.log(
          `p50=${metrics.p50.toFixed(1)}ms p95=${metrics.p95.toFixed(
            1,
          )}ms samples=${metrics.rafSamples}`,
        );
      } catch (error) {
        harnessErrors++;
        runResult.workloads[workload.name] = { error: String(error) };
        console.log(`ERROR ${error}`);
      }
    }
    if (!isWarmup) {
      runs.push(runResult);
    }
  }
  if (context) {
    await context.close();
  }

  const { aggregate, spreadPct } = aggregateRuns(
    runs,
    selectedWorkloads.map((workload) => workload.name),
  );
  return { runs, aggregate, spreadPct, notes, harnessErrors };
};

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------
const formatMs = (value) => (value == null ? "?" : value.toFixed(1));
const formatMb = (value) =>
  value == null ? "?" : (value / (1024 * 1024)).toFixed(1);

const printSummary = (configName, aggregate, spreadPct) => {
  console.log(`\n== ${configName} — aggregate (median across runs) ==`);
  console.log(
    "| workload | p50 ms | p95 ms | p99 ms | dropped % | longtasks | lt total ms | regenΔ | regenΔzoom | replΔ | heapΔ MB | p95 spread % |",
  );
  console.log(
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const [name, m] of Object.entries(aggregate)) {
    console.log(
      `| ${name} | ${formatMs(m.p50)} | ${formatMs(m.p95)} | ${formatMs(
        m.p99,
      )} | ${formatMs(m.droppedPct)} | ${m.longtaskCount ?? "?"} | ${formatMs(
        m.longtaskTotalMs,
      )} | ${m.regenTotal ?? "?"} | ${m.regenZoom ?? "?"} | ${
        m.replaceAllDelta ?? "?"
      } | ${formatMb(m.heapDeltaBytes)} | ${
        spreadPct[name] == null ? "?" : spreadPct[name].toFixed(1)
      } |`,
    );
  }
};

const printBaselineDelta = (baseline, aggregate) => {
  const baseAggregate =
    baseline.aggregate ?? baseline.configs?.[0]?.aggregate ?? null;
  if (!baseAggregate) {
    console.log("baseline file has no aggregate section; skipping delta");
    return;
  }
  console.log(
    `\n== vs baseline (${baseline.label ?? "?"} @ ${
      baseline.timestamp ?? "?"
    }) ==`,
  );
  console.log(
    "| workload | base p50 | cur p50 | Δp50 % | base p95 | cur p95 | Δp95 % |",
  );
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const [name, current] of Object.entries(aggregate)) {
    const base = baseAggregate[name];
    if (!base) {
      continue;
    }
    const d50 = base.p50 ? ((current.p50 - base.p50) / base.p50) * 100 : null;
    const d95 = base.p95 ? ((current.p95 - base.p95) / base.p95) * 100 : null;
    console.log(
      `| ${name} | ${formatMs(base.p50)} | ${formatMs(current.p50)} | ${
        d50 == null ? "?" : d50.toFixed(1)
      } | ${formatMs(base.p95)} | ${formatMs(current.p95)} | ${
        d95 == null ? "?" : d95.toFixed(1)
      } |`,
    );
  }
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const main = async () => {
  // resolve workload selection (canonical order preserved; soak is opt-in)
  const defaultNames = CANONICAL_ORDER.filter((name) => name !== "soak");
  let selectedNames;
  if (workloadsArg) {
    const requested = workloadsArg.split(",").map((value) => value.trim());
    for (const name of requested) {
      if (!CANONICAL_ORDER.includes(name)) {
        throw new Error(
          `unknown workload "${name}"; known: ${CANONICAL_ORDER.join(", ")}`,
        );
      }
    }
    selectedNames = CANONICAL_ORDER.filter((name) => requested.includes(name));
  } else {
    selectedNames = [...defaultNames];
  }
  if (soakMinutes > 0 && !selectedNames.includes("soak")) {
    selectedNames.push("soak");
  }
  if (soakMinutes <= 0) {
    selectedNames = selectedNames.filter((name) => name !== "soak");
  }
  const selectedWorkloads = CANONICAL_ORDER.filter((name) =>
    selectedNames.includes(name),
  ).map((name) => WORKLOADS.find((workload) => workload.name === name));

  // resolve configs
  let configs;
  if (matrixPath) {
    const matrix = JSON.parse(await readFile(matrixPath, "utf8"));
    configs = matrix.configs.map((entry) => ({
      name: entry.name,
      targetUrl: `${baseUrl}${entry.path}`,
    }));
  } else {
    configs = [
      {
        name: "default",
        targetUrl: targetUrlArg ?? `${baseUrl}${PINNED_DEMO_PATH}`,
      },
    ];
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-precise-memory-info"],
  });

  let gitSha = null;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"]);
    gitSha = stdout.trim();
  } catch {}

  const configResults = [];
  let harnessErrors = 0;
  for (const config of configs) {
    const result = await runSuiteForConfig(browser, config, selectedWorkloads);
    harnessErrors += result.harnessErrors;
    configResults.push({
      configName: config.name,
      targetUrl: config.targetUrl,
      runs: result.runs,
      aggregate: result.aggregate,
      spreadPct: result.spreadPct,
      notes: result.notes,
    });
  }
  await browser.close();

  const report = {
    label,
    gitSha,
    timestamp: new Date().toISOString(),
    seed,
    viewport: { width: vpWidth, height: vpHeight },
    dpr,
    runsRequested: runsCount,
    warmup: warmupCount,
    workloads: selectedNames,
    soakMinutes: soakMinutes > 0 ? soakMinutes : undefined,
    os: {
      platform: os.platform(),
      loadavg: os.loadavg(),
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model ?? null,
    },
    configs: configResults,
    // single-config convenience mirror (spec shape)
    ...(configResults.length === 1
      ? {
          targetUrl: configResults[0].targetUrl,
          configName: configResults[0].configName,
          runs: configResults[0].runs,
          aggregate: configResults[0].aggregate,
          spreadPct: configResults[0].spreadPct,
          notes: configResults[0].notes,
        }
      : {}),
  };

  await mkdir(outDir, { recursive: true });
  const outPath = `${outDir}/${label}-${Date.now()}.json`;
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);

  for (const configResult of configResults) {
    printSummary(
      configResult.configName,
      configResult.aggregate,
      configResult.spreadPct,
    );
  }

  if (baselinePath) {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    printBaselineDelta(
      baseline,
      configResults[0].aggregate,
    );
  }

  console.log(`\nWrote ${outPath}`);
  if (harnessErrors > 0) {
    console.error(`${harnessErrors} workload execution error(s)`);
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
