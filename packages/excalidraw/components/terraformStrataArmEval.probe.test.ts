/**
 * W0-I3 — THE inner-loop gate tool: a parameterized per-arm eval probe.
 *
 * Pattern & discipline copied verbatim from `terraformStrataDeBandFocused.probe.test.ts`:
 *   - runs ONE arm at a time and WRITES THE ARTIFACT AFTER EVERY ARM (read →
 *     push → write), so partial results always survive a later hang — never
 *     again report "no data" because the last arm timed out,
 *   - hard-caps each arm and records a `status:"timeout"` verdict (elapsedMs)
 *     instead of dying, then CONTINUES to the next arm,
 *   - mirrors the REAL app path (`layoutTerraformFromSources` — the worker /
 *     headless seam the app actually uses), routing the demo-URL option
 *     vocabulary through `resolveStrataDemoOptions` exactly as the deBandFocused
 *     probe does.
 *
 * Unlike the deBandFocused probe (hard-coded arms), THIS probe is fully
 * parameterized by an external JSON spec (env `STRATA_ARM_SPEC`), so a caller /
 * orchestrator can drive any arm battery without touching source — the inner
 * loop of an A/B search.
 *
 * SPEC (env STRATA_ARM_SPEC = absolute path to a JSON file):
 *   {
 *     "presetId": "staging-extended-localstack-v2",   // required
 *     "seed": 20260704,                                // optional, provenance only
 *     "repeats": 1,                                    // optional (median of N runs)
 *     "perArmTimeoutMs": 300000,                       // optional hard cap (deband→900000)
 *     "arms": [ { "label": "…", "options": { … } }, … ],
 *     "outPath": "/abs/path/to/result.json"            // required
 *   }
 *
 * `options` uses the demo-URL option vocabulary. Recognized strata-demo keys
 * (strataSweeps / strataCoordRefine / strataRankSeparate / strataDeBandLevel /
 * strataPackedEps / strataSift / …) are folded through `resolveStrataDemoOptions`;
 * every other key (layoutMode / pipelineCompact / pipelineIncludeAncillary /
 * pipelinePrivateApiRegional / …) is forwarded RAW to `layoutTerraformFromSources`.
 * `layoutMode` defaults to `"strata"` when the arm omits it.
 *
 * METRIC HONESTY (trap #3): pierce is a DENOMINATOR ARTIFACT under de-band
 * (`computePierceMetrics` ranges only over the hull frames de-band deletes), so
 * `topoFrames` + `piercePerTopoFrame` ride alongside raw `pierce` in every arm
 * record and raw pierce must NOT be read as a win. Decisions use RENDERED metrics
 * (`diagnosePipelineScene(...).dataflow.crossings`, `computePierceMetrics`) — never
 * chord proxies.
 *
 * OPTIONAL: `STRATA_ARM_PROFILE=1` enables the terraform import profiler per arm
 * and stores its span summary in the arm record.
 *
 * TIMEOUT SEMANTICS (read before trusting the cap): `layoutTerraformFromSources`
 * is CPU-bound and SYNCHRONOUS between its handful of `await` points, so the
 * `Promise.race([layout, timer])` cap can only WIN at an async yield boundary.
 * The packed-scoring descent (the documented multi-minute blowup this cap exists
 * to survive) yields inside `layout.pipeline`, so the cap does fire there; a
 * fully-synchronous arm that overruns cannot be preempted in-process (no worker
 * thread), and instead completes and is recorded `status:"ok"` with
 * `exceededCap:true`. The OUTER vitest per-test timeout
 * (`perArmTimeoutMs + STAGING…`) is the last-resort backstop: if it fires, only
 * the CURRENT arm loses its record — every prior arm is already on disk
 * (write-after-every-arm), and vitest still runs the remaining arm `it()`s.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import { computePierceMetrics } from "./terraformPipelineStrataPierceMetrics";
import {
  isTerraformImportProfilerEnabled,
  setTerraformImportProfilerEnabled,
  terraformImportProfilerReset,
  terraformImportProfilerSummary,
} from "./terraformImportProfiler";
import { layoutTerraformFromSources } from "./terraformLayoutCore";
import { resolveStrataDemoOptions } from "./terraformStrataDefaults";
import { strataGeometryHash } from "./terraformStrataGeometryHash";

// ── spec plumbing ────────────────────────────────────────────────────────────

type ArmSpec = { label: string; options: Record<string, unknown> };
type Spec = {
  presetId: string;
  seed?: number;
  repeats?: number;
  perArmTimeoutMs?: number;
  arms: ArmSpec[];
  outPath: string;
};

const DEFAULT_ARM_TIMEOUT_MS = 300_000;

const SPEC_PATH = process.env.STRATA_ARM_SPEC;
const PROFILE = process.env.STRATA_ARM_PROFILE === "1";

const loadSpec = (): Spec | null => {
  if (!SPEC_PATH) {
    return null;
  }
  const raw = readFileSync(SPEC_PATH, "utf8");
  const spec = JSON.parse(raw) as Spec;
  if (
    typeof spec.presetId !== "string" ||
    typeof spec.outPath !== "string" ||
    !Array.isArray(spec.arms)
  ) {
    throw new Error(
      `STRATA_ARM_SPEC ${SPEC_PATH} missing required fields (presetId / outPath / arms[])`,
    );
  }
  return spec;
};

// ── option-vocabulary routing (demo-URL params → real app path) ──────────────

// The exact param surface `resolveStrataDemoOptions` accepts. Any arm-option key
// in this set is folded through the resolver (which materializes the SDEC-54
// engine defaults for whatever the arm omits); every other key is forwarded RAW
// to `layoutTerraformFromSources` — the same seam the real worker path uses.
const STRATA_DEMO_KEYS = new Set<string>([
  "strataNsRank",
  "strataSweeps",
  "strataCoordRefine",
  "strataRankSeparate",
  "strataPackedScoring",
  "strataPackedEps",
  "strataEdgeRouting",
  "strataBorderRoute",
  "strataBandCompact",
  "strataBandDepth",
  "strataSift",
  "strataPenW",
  "strataCrossW",
  "strataEdgeCap",
  "strataPackedConverge",
  "strataTransitiveAdopt",
  "strataBlockClamp",
  "strataTranspose",
  "strataHeightGate",
  "strataDeBandLevel",
]);

const buildLayoutOptions = (
  armOptions: Record<string, unknown>,
): Record<string, unknown> => {
  const strataParams: Record<string, unknown> = {};
  const passThrough: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(armOptions)) {
    if (STRATA_DEMO_KEYS.has(k)) {
      strataParams[k] = v;
    } else {
      passThrough[k] = v;
    }
  }
  return {
    layoutMode: "strata",
    ...passThrough,
    ...(resolveStrataDemoOptions(strataParams as never) as Record<
      string,
      unknown
    >),
  };
};

// ── metric extraction (RENDERED, trap #2) ────────────────────────────────────

const TOPO_ROLES = new Set([
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

type Scene = {
  elements: ExcalidrawElement[];
  meta: Record<string, unknown>;
};

const roleOf = (e: ExcalidrawElement): string =>
  String(
    (e.customData as { terraformTopologyRole?: string } | undefined)
      ?.terraformTopologyRole ?? "",
  );

/** Scan the scene meta for any degraded/fallback marker without assuming a
 * single key name (the strata engine surfaces `rcllV2Degraded`, but be liberal).*/
const degradedFlag = (meta: Record<string, unknown>): unknown => {
  if ("rcllV2Degraded" in meta && meta.rcllV2Degraded != null) {
    return meta.rcllV2Degraded;
  }
  for (const [k, v] of Object.entries(meta)) {
    if (/degrad|fallback/i.test(k) && v != null && v !== false) {
      return v;
    }
  }
  return null;
};

const captureMetrics = (scene: Scene) => {
  const els = scene.elements;
  const diag = diagnosePipelineScene(els) as unknown as {
    dataflow: { crossings: number };
  };
  const pm = computePierceMetrics(els);
  const topoFrames = els.filter(
    (e) => e.type === "frame" && !e.isDeleted && TOPO_ROLES.has(roleOf(e)),
  ).length;

  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const e of els) {
    if (e.isDeleted) {
      continue;
    }
    minY = Math.min(minY, e.y);
    maxY = Math.max(maxY, e.y + e.height);
    minX = Math.min(minX, e.x);
    maxX = Math.max(maxX, e.x + e.width);
  }

  return {
    elementCount: els.length,
    width: Number.isFinite(maxX - minX) ? Math.round(maxX - minX) : 0,
    height: Number.isFinite(maxY - minY) ? Math.round(maxY - minY) : 0,
    renderedCrossings: diag.dataflow.crossings,
    pierce: pm.pierce.total,
    pierceEdgeCount: pm.pierce.edgeCount,
    topoFrames,
    // pierce is a denominator artifact under de-band — always ride alongside.
    piercePerTopoFrame:
      topoFrames > 0 ? Number((pm.pierce.total / topoFrames).toFixed(3)) : 0,
    contiguityViolations: pm.contiguity.totalViolations,
    geometryHash: strataGeometryHash(els),
    degraded: degradedFlag(scene.meta),
    echoedLayoutVariant: scene.meta.pipelineLayoutVariant ?? null,
  };
};

// ── per-arm run (repeats → median wall-clock; hard timeout) ──────────────────

const median = (nums: number[]): number => {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0
    ? Math.round((s[mid - 1]! + s[mid]!) / 2)
    : Math.round(s[mid]!);
};

const TIMEOUT = Symbol("arm-timeout");

const runArm = async (
  spec: Spec,
  arm: ArmSpec,
  perArmTimeoutMs: number,
): Promise<Record<string, unknown>> => {
  const repeats = Math.max(1, spec.repeats ?? 1);
  const options = buildLayoutOptions(arm.options ?? {});

  if (PROFILE) {
    terraformImportProfilerReset();
    setTerraformImportProfilerEnabled(true);
  }

  const wallMsRuns: number[] = [];
  let firstScene: Scene | null = null;

  const armStart = Date.now();
  for (let i = 0; i < repeats; i++) {
    // Cold cache each run — otherwise the prep cache masks real build cost and
    // (worse) confounds the determinism guarantee across arms.
    clearTerraformImportPrepCache();
    const sources = getTerraformImportPresetSourcesFromDb(
      spec.presetId,
    ) as never;

    const t0 = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const raced = await Promise.race([
      layoutTerraformFromSources(sources, options as never),
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), perArmTimeoutMs);
      }),
    ]);
    if (timer) {
      clearTimeout(timer);
    }
    const wallMs = performance.now() - t0;

    if (raced === TIMEOUT) {
      if (PROFILE) {
        setTerraformImportProfilerEnabled(false);
      }
      return {
        label: arm.label,
        status: "timeout",
        elapsedMs: Math.round(Date.now() - armStart),
        perArmTimeoutMs,
        options,
      };
    }
    const res = raced as Awaited<
      ReturnType<typeof layoutTerraformFromSources>
    >;
    if (!res.ok) {
      if (PROFILE) {
        setTerraformImportProfilerEnabled(false);
      }
      return {
        label: arm.label,
        status: "error",
        error: String(res.error),
        elapsedMs: Math.round(Date.now() - armStart),
        options,
      };
    }
    wallMsRuns.push(wallMs);
    if (i === 0) {
      firstScene = res.scene as Scene;
    }
  }

  let profileSummary: unknown;
  if (PROFILE) {
    profileSummary = terraformImportProfilerSummary();
    setTerraformImportProfilerEnabled(false);
  }

  // Metrics captured from the FIRST run (deterministic engine — later runs are
  // byte-identical; the determinism guarantee is exactly this).
  const metrics = captureMetrics(firstScene!);

  // Synchronous overrun: the in-process race couldn't preempt this arm, but it
  // still exceeded the cap — surface it honestly so the orchestrator can treat
  // it like a soft timeout without losing the (completed) measurement.
  const exceededCap = wallMsRuns.some((ms) => ms > perArmTimeoutMs);

  return {
    label: arm.label,
    status: "ok",
    ...(exceededCap ? { exceededCap: true } : {}),
    repeats,
    wallMsRuns: wallMsRuns.map((n) => Math.round(n)),
    wallMsMedian: median(wallMsRuns),
    ...metrics,
    options,
    ...(PROFILE ? { profile: profileSummary } : {}),
  };
};

// ── incremental writer (read → push → write, after EVERY arm) ────────────────

const appendArmResult = (
  spec: Spec,
  header: Record<string, unknown>,
  armResult: Record<string, unknown>,
): void => {
  const outPath = path.isAbsolute(spec.outPath)
    ? spec.outPath
    : path.resolve(spec.outPath);
  mkdirSync(path.dirname(outPath), { recursive: true });

  let doc: { header: Record<string, unknown>; results: unknown[] };
  try {
    const existing = JSON.parse(readFileSync(outPath, "utf8")) as {
      header?: Record<string, unknown>;
      results?: unknown[];
    };
    doc = {
      header: existing.header ?? header,
      results: Array.isArray(existing.results) ? existing.results : [],
    };
  } catch {
    doc = { header, results: [] };
  }
  doc.results.push(armResult);
  writeFileSync(outPath, `${JSON.stringify(doc, null, 2)}\n`);
};

// ── the test ─────────────────────────────────────────────────────────────────

const spec = loadSpec();

if (!spec) {
  describe.skip("W0-I3 strata arm-eval probe (no STRATA_ARM_SPEC)", () => {
    it("is skipped without a spec", () => {
      expect(true).toBe(true);
    });
  });
} else {
  const perArmTimeoutMs = spec.perArmTimeoutMs ?? DEFAULT_ARM_TIMEOUT_MS;
  const header: Record<string, unknown> = {
    tool: "terraformStrataArmEval.probe",
    presetId: spec.presetId,
    seed: spec.seed ?? null,
    repeats: Math.max(1, spec.repeats ?? 1),
    perArmTimeoutMs,
    profile: PROFILE,
    profilerWasEnabled: isTerraformImportProfilerEnabled(),
    generatedAt: new Date().toISOString(),
    armCount: spec.arms.length,
  };

  describe(`W0-I3 strata arm-eval probe (${spec.presetId}, ${spec.arms.length} arms)`, () => {
    // Fresh artifact per full run: seed the header + empty results once, before
    // any arm, so a resumed/partial file from a prior run never bleeds in.
    it("initializes the artifact", () => {
      const outPath = path.isAbsolute(spec.outPath)
        ? spec.outPath
        : path.resolve(spec.outPath);
      mkdirSync(path.dirname(outPath), { recursive: true });
      writeFileSync(
        outPath,
        `${JSON.stringify({ header, results: [] }, null, 2)}\n`,
      );
      expect(true).toBe(true);
    });

    for (const arm of spec.arms) {
      it(
        `measures ${arm.label}`,
        async () => {
          const r = await runArm(spec, arm, perArmTimeoutMs);
          // WRITE AFTER EVERY ARM — partial data survives a later hang.
          appendArmResult(spec, header, r);
          // eslint-disable-next-line no-console
          console.log(`ARM ${arm.label} ->`, JSON.stringify(r));
          expect(r).toBeTruthy();
          expect(["ok", "timeout", "error"]).toContain(r.status);
        },
        // Per-arm hard cap governs the layout; the vitest test timeout is a
        // generous OUTER guard so the arm's own timeout verdict wins.
        perArmTimeoutMs + STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS,
      );
    }
  });
}
