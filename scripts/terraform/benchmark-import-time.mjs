#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Terraform import-time benchmark (Playwright).
 *
 * Measures wall-clock "felt" import time on the /demo auto-import path plus the
 * in-page terraformImportProfiler span breakdown, exposed to the page via the
 * dev-only `window.__terraformImportProfilerSummary` hook
 * (packages/excalidraw/components/TerraformDemoAutoImport.tsx).
 *
 * Usage:
 *   node scripts/terraform/benchmark-import-time.mjs --runs 3 --label baseline
 *   node scripts/terraform/benchmark-import-time.mjs --baseline <prev.json> \
 *     --append-log docs/terraform-import-performance-log.md
 *
 * Stress modes (all off by default):
 *   --reimport N              reload + reimport N extra times in the same
 *                             context, capturing feltMs + heap per cycle (leak
 *                             detection)
 *   --cpu-throttle X          CDP Emulation.setCPUThrottlingRate
 *   --interact-during-import  gentle wheel pan/zoom every 500ms while the
 *                             import runs; reports rAF frames >100ms
 */
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const hasFlag = (name) => args.includes(name);

const DEFAULT_DEMO_PATH =
  "/demo?preset=staging-extended-localstack-v2&view=strata&compact=0&ancillary=1&privateApiRegional=1&strataSweeps=4&strataCoordRefine=1&strataRankSep=1&strataPackedScoring=0&strataBandDepth=root&strataDeBand=vpc&strataSift=1&strataBlockClamp=1&strataTranspose=1&lodEnabled=1&lodPreset=balanced&minimap=0&layers=declared&canvasPerf=focuswash";

const baseUrl = getArg("--url", "http://localhost:3001").replace(/\/$/, "");
const targetUrlOverride = getArg("--target-url", null);
const runsCount = Number(getArg("--runs", "3"));
const warmup = Number(getArg("--warmup", "0"));
const label = getArg("--label", "adhoc");
const baselinePath = getArg("--baseline", null);
const outDir = getArg(
  "--out",
  "/private/tmp/claude-501/-Users-tusharsariya-Projects-excalidraw-tf/c7c39f5c-073a-4039-b046-685eb395a02e/scratchpad/perf-loop-20260721/import",
);
const timeoutMs = Number(getArg("--timeout-ms", "300000"));
const appendLogPath = getArg("--append-log", null);
const reimport = Number(getArg("--reimport", "0"));
const cpuThrottle = Number(getArg("--cpu-throttle", "0"));
const interactDuringImport = hasFlag("--interact-during-import");
const matrixPath = getArg("--matrix", null);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return 0;
  }
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Runs inside the page BEFORE any app script (fresh on every navigation):
// - arms the import profiler via localStorage before the import starts
// - a 250ms watcher records when the "Loading preset" overlay first appears and
//   when the auto-import status overlay is fully gone (success) or errored
// - a rAF loop records long frames (>100ms) for --interact-during-import
const pageInitScript = () => {
  try {
    localStorage.setItem("terraformImportProfile", "1");
  } catch {}
  window.__importFeltMs = { start: null, end: null, error: null };
  window.__importLongFrames = [];
  let previous = performance.now();
  const frame = (now) => {
    const dt = now - previous;
    previous = now;
    if (dt > 100) {
      window.__importLongFrames.push({ t: now, dt });
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const timer = setInterval(() => {
    const felt = window.__importFeltMs;
    const text = document.body ? document.body.innerText : "";
    if (felt.start == null) {
      if (text.includes("Loading preset")) {
        felt.start = performance.now();
      }
      return;
    }
    if (felt.end != null) {
      clearInterval(timer);
      return;
    }
    // "Loading preset …" flips to per-phase progress labels mid-import, so the
    // end signal is the status overlay unmounting (success) — not merely the
    // initial text disappearing. The degraded banner is informational and may
    // legitimately persist after a successful import.
    if (text.includes("Loading preset")) {
      return;
    }
    const overlays = [
      ...document.querySelectorAll(".TerraformDemoAutoImport"),
    ].filter(
      (el) => !el.classList.contains("TerraformDemoAutoImport--degraded"),
    );
    const errored = overlays.find((el) =>
      el.classList.contains("TerraformDemoAutoImport--error"),
    );
    if (errored) {
      felt.error = errored.textContent ?? "import error";
      felt.end = performance.now();
      clearInterval(timer);
    } else if (overlays.length === 0) {
      felt.end = performance.now();
      clearInterval(timer);
    }
  }, 250);
};

const waitForImportEnd = async (page) => {
  const deadline = Date.now() + timeoutMs;
  let interactFlip = false;
  for (;;) {
    const felt = await page
      .evaluate(() => window.__importFeltMs)
      .catch(() => null);
    if (felt?.end != null) {
      if (felt.error) {
        throw new Error(`import failed in page: ${felt.error}`);
      }
      return felt;
    }
    if (Date.now() > deadline) {
      throw new Error(`import did not complete within ${timeoutMs}ms`);
    }
    if (interactDuringImport && felt?.start != null) {
      // Gentle pan/zoom while the import runs (alternating wheel / ctrl+wheel).
      await page.mouse.move(400, 300);
      if (interactFlip) {
        await page.keyboard.down("Control");
        await page.mouse.wheel(0, -40);
        await page.keyboard.up("Control");
      } else {
        await page.mouse.wheel(30, 30);
      }
      interactFlip = !interactFlip;
    }
    await page.waitForTimeout(500);
  }
};

const readPostImport = (page) =>
  page.evaluate(() => ({
    profilerSpans: window.__terraformImportProfilerSummary?.() ?? [],
    heapBytes: performance.memory?.usedJSHeapSize ?? null,
    longFrames: window.__importLongFrames ?? [],
  }));

const runImportCycle = async (page) => {
  const navWallStart = Date.now();
  const consoleMarkers = [];
  const onConsole = (msg) => {
    const text = msg.text();
    if (/^\[terraform:/.test(text)) {
      consoleMarkers.push({ tMs: Date.now() - navWallStart, text });
    }
  };
  page.on("console", onConsole);
  try {
    const felt = await waitForImportEnd(page);
    const post = await readPostImport(page);
    // feltMs is nav-relative: performance.now() at overlay-unmount time.
    const feltMs = felt.end;
    // NOTE: rank spans by INCLUSIVE ms — selfMs is broken for nested spans
    // (async spans subtract wall time from parents by name, so selfMs can be
    // double-subtracted / misattributed; see terraformImportProfiler.ts).
    const profilerSpans = [...post.profilerSpans].sort((a, b) => b.ms - a.ms);
    const longFramesOver100DuringImport = post.longFrames.filter(
      (entry) => entry.t >= felt.start && entry.t <= felt.end,
    ).length;
    return {
      feltMs,
      importStartMs: felt.start,
      heapBytes: post.heapBytes,
      consoleMarkers,
      profilerSpans,
      ...(interactDuringImport ? { longFramesOver100DuringImport } : {}),
    };
  } finally {
    page.off("console", onConsole);
  }
};

const runOnce = async (browser, targetUrl) => {
  // Fresh context per run: no cache/localStorage bleed between runs.
  const context = await browser.newContext({ serviceWorkers: "block" });
  try {
    const page = await context.newPage();
    await page.addInitScript(pageInitScript);
    if (cpuThrottle > 0) {
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuThrottle });
    }
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    const result = await runImportCycle(page);

    if (reimport > 0) {
      // Leak detection: reload + reimport in the SAME context; the init script
      // re-runs on every navigation, so each cycle gets a fresh felt watcher.
      const reimportCycles = [];
      for (let cycle = 1; cycle <= reimport; cycle++) {
        await page.reload({
          waitUntil: "domcontentloaded",
          timeout: timeoutMs,
        });
        const cycleResult = await runImportCycle(page);
        reimportCycles.push({
          cycle,
          feltMs: cycleResult.feltMs,
          heapBytes: cycleResult.heapBytes,
        });
      }
      result.reimportCycles = reimportCycles;
    }
    return result;
  } finally {
    await context.close();
  }
};

const summarizeSpansAcrossRuns = (runs) => {
  // Per span name: median inclusive ms across runs, median callCount.
  const byName = new Map();
  for (const run of runs) {
    for (const span of run.profilerSpans) {
      const entry = byName.get(span.name) ?? { ms: [], callCount: [] };
      entry.ms.push(span.ms);
      entry.callCount.push(span.callCount);
      byName.set(span.name, entry);
    }
  }
  return [...byName.entries()]
    .map(([name, entry]) => ({
      name,
      ms: Math.round(median(entry.ms) * 100) / 100,
      callCount: Math.round(median(entry.callCount)),
    }))
    .sort((a, b) => b.ms - a.ms);
};

const measureTarget = async (browser, targetUrl) => {
  const warmupRuns = [];
  const runs = [];
  for (let index = 0; index < warmup + runsCount; index++) {
    const isWarmup = index < warmup;
    const kind = isWarmup ? "warmup" : "run";
    const ordinal = isWarmup ? index + 1 : index - warmup + 1;
    console.log(`  ${kind} ${ordinal} → ${targetUrl}`);
    const result = await runOnce(browser, targetUrl);
    console.log(
      `    feltMs=${result.feltMs.toFixed(0)} spans=${
        result.profilerSpans.length
      } markers=${result.consoleMarkers.length}`,
    );
    (isWarmup ? warmupRuns : runs).push(result);
  }
  const feltValues = runs.map((run) => run.feltMs);
  const medianFeltMs = median(feltValues);
  const minFeltMs = Math.min(...feltValues);
  const maxFeltMs = Math.max(...feltValues);
  return {
    targetUrl,
    warmupRunsDiscarded: warmup,
    runs,
    medianFeltMs,
    minFeltMs,
    maxFeltMs,
    spreadPct:
      medianFeltMs > 0 ? ((maxFeltMs - minFeltMs) / medianFeltMs) * 100 : 0,
    // topSpans: inclusive-ms ranking for perf-hotspot-ranker.mjs ({name, ms,
    // callCount}). selfMs deliberately omitted — broken for nested spans.
    topSpans: summarizeSpansAcrossRuns(runs),
  };
};

const printBaselineComparison = (current, baseline) => {
  const baseMedian = baseline.medianFeltMs;
  const deltaPct =
    baseMedian > 0
      ? ((current.medianFeltMs - baseMedian) / baseMedian) * 100
      : null;
  console.log(
    `\nBaseline: ${baseline.label ?? "?"} (median ${(baseMedian / 1000).toFixed(
      2,
    )}s) → current median ${(current.medianFeltMs / 1000).toFixed(2)}s, Δ ${
      deltaPct == null ? "n/a" : `${deltaPct.toFixed(1)}%`
    }`,
  );
  const baselineSpans = new Map(
    (baseline.topSpans ?? []).map((span) => [span.name, span]),
  );
  console.log("\n| span (inclusive ms) | baseline | current | Δms |");
  console.log("| --- | ---: | ---: | ---: |");
  for (const span of (current.topSpans ?? []).slice(0, 15)) {
    const base = baselineSpans.get(span.name);
    console.log(
      `| ${span.name} | ${base ? base.ms.toFixed(1) : "—"} | ${span.ms.toFixed(
        1,
      )} | ${base ? (span.ms - base.ms).toFixed(1) : "—"} |`,
    );
  }
  return deltaPct;
};

const main = async () => {
  const { chromium } = await import("playwright");
  const { stdout: shaOut } = await execFileAsync("git", [
    "rev-parse",
    "--short",
    "HEAD",
  ]);
  const gitSha = shaOut.trim();
  const timestamp = new Date().toISOString();

  const browser = await chromium.launch({
    headless: true,
    args: ["--enable-precise-memory-info"],
  });

  const report = {
    label,
    gitSha,
    timestamp,
    os: {
      platform: os.platform(),
      loadavg: os.loadavg(),
      cpus: { count: os.cpus().length, model: os.cpus()[0]?.model ?? null },
    },
    settings: {
      runs: runsCount,
      warmup,
      timeoutMs,
      reimport,
      cpuThrottle,
      interactDuringImport,
    },
  };

  try {
    if (matrixPath) {
      const matrix = JSON.parse(await readFile(matrixPath, "utf8"));
      const configs = {};
      for (const config of matrix.configs) {
        console.log(`config: ${config.name}`);
        configs[config.name] = await measureTarget(
          browser,
          `${baseUrl}${config.path}`,
        );
      }
      report.configs = configs;
      // Ranker compat: surface the first config's ranking at top level too.
      const first = Object.values(configs)[0];
      if (first) {
        report.medianFeltMs = first.medianFeltMs;
        report.topSpans = first.topSpans;
      }
    } else {
      const targetUrl = targetUrlOverride ?? `${baseUrl}${DEFAULT_DEMO_PATH}`;
      Object.assign(report, await measureTarget(browser, targetUrl));
    }
  } finally {
    await browser.close();
  }

  await mkdir(outDir, { recursive: true });
  const outPath = `${outDir}/${label}-${Date.now()}.json`;
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote ${outPath}`);

  const summarize = (entry, name) => {
    console.log(
      `${name}: median ${(entry.medianFeltMs / 1000).toFixed(2)}s (min ${(
        entry.minFeltMs / 1000
      ).toFixed(2)}s / max ${(entry.maxFeltMs / 1000).toFixed(
        2,
      )}s, spread ${entry.spreadPct.toFixed(1)}%)`,
    );
  };
  if (report.configs) {
    for (const [name, entry] of Object.entries(report.configs)) {
      summarize(entry, name);
    }
  } else {
    summarize(report, label);
  }

  let deltaPct = null;
  let baselineLabel = null;
  if (baselinePath) {
    const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
    baselineLabel = baseline.label ?? "baseline";
    if (report.configs && baseline.configs) {
      for (const [name, entry] of Object.entries(report.configs)) {
        if (baseline.configs[name]) {
          console.log(`\n== config: ${name} ==`);
          deltaPct = printBaselineComparison(entry, {
            ...baseline.configs[name],
            label: `${baselineLabel}:${name}`,
          });
        }
      }
    } else if (!report.configs && baseline.medianFeltMs != null) {
      deltaPct = printBaselineComparison(report, baseline);
    } else {
      console.warn(
        "baseline/current shape mismatch (matrix vs single) — skipping comparison",
      );
    }
  }

  if (appendLogPath) {
    const medianSeconds = ((report.medianFeltMs ?? 0) / 1000).toFixed(2);
    const deltaCell =
      deltaPct == null || baselineLabel == null
        ? "Δ n/a"
        : `Δ ${deltaPct.toFixed(1)}% vs ${baselineLabel}`;
    await appendFile(
      appendLogPath,
      `| ${timestamp} | ${label} | median ${medianSeconds}s | ${deltaCell} |\n`,
    );
    console.log(`Appended log row to ${appendLogPath}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
