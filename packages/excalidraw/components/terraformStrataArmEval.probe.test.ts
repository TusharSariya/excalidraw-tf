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
 * `options` accepts BOTH vocabularies without silent loss:
 *   - demo-URL strata keys (strataSweeps / strataCoordRefine / strataRankSeparate
 *     / strataDeBandLevel / strataPackedEps / strataSift / …) fold through
 *     `resolveStrataDemoOptions`;
 *   - ENGINE strata keys (strataSiftRelocate / strataCoordinateRefine /
 *     strataPackedScoringEpsilon / strataNetworkSimplexRank / … — the names every
 *     memory doc, commit, and toggle in this repo uses) are forwarded RAW and,
 *     crucially, spread AFTER the resolver output so they WIN over the resolver's
 *     materialized default instead of being clobbered by it. Each such override
 *     is echoed in the arm record as `rawStrataOverrides` so a treatment arm can
 *     never be silently measured as baseline;
 *   - short URL aliases `compact` / `ancillary` / `privateApiRegional` map to
 *     `pipelineCompact` / `pipelineIncludeAncillary` / `pipelinePrivateApiRegional`
 *     (what `TerraformDemoAutoImport` does before the core seam);
 *   - every remaining key (layoutMode / pipeline* / …) is forwarded RAW.
 * `layoutMode` defaults to `"strata"`; and — mirroring the real app path
 * (`terraformPresetImport.ts:213`) — a strata arm that omits
 * `pipelinePrivateApiRegional` DEFAULTS it ON, so the default arm represents
 * production, not a private-API-off variant.
 *
 * DETERMINISM is VERIFIED, not assumed: every repeat's geometry hash is captured
 * and compared; `deterministic` rides in each ok record and the divergent
 * `repeatHashes` are dumped whenever a repeat disagrees.
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

import { detectEdgeCollapse } from "./terraformEdgeCollapse";
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
  "strataLeafShift",
  "strataDeBandLevel",
]);

// Short demo-URL aliases → the pipeline* option name the REAL app path maps them
// to before calling the core seam (TerraformDemoAutoImport.tsx:182-187). Without
// this, an arm written as `{ compact: true }` / `{ ancillary: 1 }` /
// `{ privateApiRegional: 1 }` — the exact param names the owner's audit URLs use
// — would be forwarded RAW under those aliases and silently ignored by the
// engine, which only reads the pipeline* names.
const URL_ALIAS_TO_PIPELINE: Record<string, string> = {
  compact: "pipelineCompact",
  ancillary: "pipelineIncludeAncillary",
  privateApiRegional: "pipelinePrivateApiRegional",
};

type BuiltLayoutOptions = {
  options: Record<string, unknown>;
  /** Raw engine-vocab `strata*` keys (NOT demo keys) that the arm passed and
   * that therefore OVERRIDE a resolver-materialized default. Surfaced in the arm
   * record so an engine-vocab treatment is auditable, never silently baseline. */
  rawStrataOverrides: string[];
};

const buildLayoutOptions = (
  armOptions: Record<string, unknown>,
): BuiltLayoutOptions => {
  const strataParams: Record<string, unknown> = {};
  const passThrough: Record<string, unknown> = {};
  const rawStrataOverrides: string[] = [];
  for (const [k, v] of Object.entries(armOptions)) {
    if (STRATA_DEMO_KEYS.has(k)) {
      strataParams[k] = v;
    } else if (k in URL_ALIAS_TO_PIPELINE) {
      // Map short URL aliases to their pipeline* names (finding #4).
      passThrough[URL_ALIAS_TO_PIPELINE[k]!] = v;
    } else {
      // Any `strata*` key that reached here is ENGINE vocabulary the resolver
      // also materializes as a default — record it so the override is loud
      // (finding #1). The reorder below makes it actually take effect.
      if (/^strata/.test(k)) {
        rawStrataOverrides.push(k);
      }
      passThrough[k] = v;
    }
  }

  const resolved = resolveStrataDemoOptions(strataParams as never) as Record<
    string,
    unknown
  >;

  const layoutMode =
    typeof passThrough.layoutMode === "string"
      ? passThrough.layoutMode
      : "strata";

  // Mirror the real app path (finding #4): a bare Strata import defaults
  // `pipelinePrivateApiRegional` ON when the caller omits it
  // (terraformPresetImport.ts:213). An explicit pass-through value still wins.
  const privateApiDefault =
    layoutMode === "strata" && !("pipelinePrivateApiRegional" in passThrough)
      ? { pipelinePrivateApiRegional: true }
      : {};

  return {
    // Merge order is load-bearing (finding #1): the resolver's engine defaults
    // go DOWN FIRST, then `passThrough` on top, so an explicit engine-vocab
    // `strata*` key WINS over the materialized default instead of being
    // clobbered by it. `layoutMode`/`privateApiDefault` sit under both and are
    // overridden by any explicit pass-through of the same key.
    options: {
      layoutMode,
      ...privateApiDefault,
      ...resolved,
      ...passThrough,
    },
    rawStrataOverrides,
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

// ── edge-collapse invariant (deband-hash-anomaly.md §"Recommended fix" #1) ────
//
// The engine nondeterministically produces scenes whose declared dataflow edges
// leave NO spanning connector geometry while crossings/pierce — read off
// `customData.relationship` ENDPOINTS, not `element.points` — score IDENTICALLY.
// The detection logic lives in the shared, unit-tested `terraformEdgeCollapse`
// helper (see terraformEdgeCollapse.test.ts for the deterministic fire path).
//
// Why the numerator is NOT keyed off the relationship arrows: the declared edges
// are emitted as 2-point skeletons and, on this headless path, arrive
// soft-deleted; `repairTerraformEdgeBindings` skips `isDeleted`, so those
// skeletons keep spanning BY CONSTRUCTION and a relationship-keyed span check
// reports 145/145 on a genuinely collapsed scene (the earlier no-op). The real
// signal is the count of NON-deleted, visible spanning linear elements vs the
// declared population (`pierceEdgeCount`).

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
    // Edge-collapse invariant (deband-hash-anomaly.md #1): a scene whose declared
    // dataflow edges left no spanning VISIBLE connector geometry scores
    // IDENTICALLY on crossings/pierce, so these fields + the verdict are the ONLY
    // signal that separates a valid layout from a collapsed one. Numerator =
    // non-deleted spanning linear elements; denominator = pierce.edgeCount (the
    // declared population). `runArm` promotes `edgeCollapseDetected` (on ANY
    // repeat) to a `status:"collapsed"` verdict.
    ...detectEdgeCollapse(els, pm.pierce.edgeCount),
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
  const { options, rawStrataOverrides } = buildLayoutOptions(arm.options ?? {});
  const overrides = rawStrataOverrides.length > 0 ? { rawStrataOverrides } : {};

  if (PROFILE) {
    terraformImportProfilerReset();
    setTerraformImportProfilerEnabled(true);
  }

  // finally guarantees the profiler flag is reset even if a later run throws
  // (finding #3 — a thrown layout / metric-extraction must not leave the shared
  // profiler enabled for the next arm).
  try {
    const wallMsRuns: number[] = [];
    // Hash EVERY repeat, not just the first — the determinism guarantee
    // ("same spec → same geometry") is only *verified* by comparing them
    // (finding #5).
    const repeatHashes: string[] = [];
    // Edge-collapse is checked on EVERY repeat, not just the first (finding: a
    // nondeterministic collapse in repeat 2+ would otherwise stay status:"ok" —
    // the repeat HASH cannot compensate because `strataGeometryHash` excludes
    // soft-deleted edges, and even the visible-geometry delta is only surfaced
    // as a status flip, never a hash assertion).
    const repeatCollapses: boolean[] = [];
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
      // Arm the timeout BEFORE invoking layout (finding #2): the timer's
      // deadline must include the synchronous pre-`await` work
      // (packed-scoring descent). Constructing the timeout promise first starts
      // the timer; the layout call then runs synchronously up to its first
      // yield, at which point an already-elapsed timer resolves TIMEOUT. (An
      // arm that overruns entirely in synchronous CPU still cannot be preempted
      // in-process — that is the documented `exceededCap` path below.)
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), perArmTimeoutMs);
      });
      const layoutPromise = layoutTerraformFromSources(
        sources,
        options as never,
      );
      const raced = await Promise.race([layoutPromise, timeoutPromise]);
      if (timer) {
        clearTimeout(timer);
      }
      const wallMs = performance.now() - t0;

      if (raced === TIMEOUT) {
        // The abandoned layout keeps running (no worker thread to cancel);
        // swallow any eventual rejection so it doesn't surface as an unhandled
        // rejection after we've already returned the timeout verdict.
        void Promise.resolve(layoutPromise).catch(() => {});
        return {
          label: arm.label,
          status: "timeout",
          elapsedMs: Math.round(Date.now() - armStart),
          perArmTimeoutMs,
          repeatOfTimeout: i,
          options,
          ...overrides,
        };
      }
      const res = raced as Awaited<
        ReturnType<typeof layoutTerraformFromSources>
      >;
      if (!res.ok) {
        return {
          label: arm.label,
          status: "error",
          error: String(res.error),
          elapsedMs: Math.round(Date.now() - armStart),
          options,
          ...overrides,
        };
      }
      wallMsRuns.push(wallMs);
      const scene = res.scene as Scene;
      repeatHashes.push(strataGeometryHash(scene.elements));
      // Per-repeat collapse verdict — a collapse that only manifests on repeat
      // 2+ must still flip the arm to "collapsed" (it cannot ride the geometry
      // hash, which omits soft-deleted edges).
      repeatCollapses.push(
        detectEdgeCollapse(
          scene.elements,
          computePierceMetrics(scene.elements).pierce.edgeCount,
        ).edgeCollapseDetected,
      );
      if (i === 0) {
        firstScene = scene;
      }
    }

    let profileSummary: unknown;
    if (PROFILE) {
      profileSummary = terraformImportProfilerSummary();
    }

    // Metrics captured from the FIRST run; determinism is now VERIFIED (not
    // assumed) by comparing every repeat's geometry hash (finding #5).
    const metrics = captureMetrics(firstScene!);
    const deterministic = repeatHashes.every((h) => h === repeatHashes[0]);

    // Synchronous overrun: the in-process race couldn't preempt this arm, but it
    // still exceeded the cap — surface it honestly so the orchestrator can treat
    // it like a soft timeout without losing the (completed) measurement.
    const exceededCap = wallMsRuns.some((ms) => ms > perArmTimeoutMs);

    // Edge-collapse invariant (deband-hash-anomaly.md #1): if the declared
    // dataflow edges left essentially no spanning VISIBLE connector geometry on
    // ANY repeat, the layout is BROKEN even though crossings/pierce/geometryHash
    // all look valid. Fail the arm LOUDLY with a dedicated `collapsed` verdict —
    // an orchestrator must never adopt a collapsed scene as a passing candidate
    // off a hash compare. Keyed on ANY repeat, not just the metrics (first) run.
    const collapsedRepeatCount = repeatCollapses.filter(Boolean).length;
    const status = collapsedRepeatCount > 0 ? "collapsed" : "ok";

    return {
      label: arm.label,
      status,
      ...(collapsedRepeatCount > 0 ? { collapsedRepeatCount } : {}),
      ...(exceededCap ? { exceededCap: true } : {}),
      repeats,
      deterministic,
      // Only bloat the record with per-repeat hashes when they actually
      // disagree — a determinism VIOLATION is the one thing worth the bytes.
      ...(deterministic ? {} : { repeatHashes }),
      wallMsRuns: wallMsRuns.map((n) => Math.round(n)),
      wallMsMedian: median(wallMsRuns),
      ...metrics,
      options,
      ...overrides,
      ...(PROFILE ? { profile: profileSummary } : {}),
    };
  } finally {
    if (PROFILE) {
      setTerraformImportProfilerEnabled(false);
    }
  }
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
          // runArm returns error/timeout records for the paths IT knows about,
          // but a thrown source-load / layout / metric-extraction exception
          // would otherwise skip the write entirely — breaking the "artifact
          // after EVERY arm" guarantee (finding #3). Catch here so every arm,
          // however it fails, lands a record on disk before this `it` resolves.
          let r: Record<string, unknown>;
          try {
            r = await runArm(spec, arm, perArmTimeoutMs);
          } catch (err) {
            r = {
              label: arm.label,
              status: "error",
              error:
                err instanceof Error
                  ? `${err.message}\n${err.stack ?? ""}`
                  : String(err),
              threw: true,
            };
          }
          // WRITE AFTER EVERY ARM — partial data survives a later hang.
          appendArmResult(spec, header, r);
          // eslint-disable-next-line no-console
          console.log(`ARM ${arm.label} ->`, JSON.stringify(r));
          expect(r).toBeTruthy();
          expect(["ok", "collapsed", "timeout", "error"]).toContain(r.status);
          // The arm record is already on disk (above), so failing here still
          // preserves the artifact. A "collapsed" status means the engine
          // silently dropped all visible edge geometry — that is a BROKEN layout,
          // never a valid candidate, so surface it as a test FAILURE (the fire
          // path this probe exists to catch). timeout/error stay tolerated —
          // they are explicit non-results, not a scene masquerading as valid.
          expect(
            r.status,
            `arm ${
              arm.label
            } produced a collapsed scene (edge geometry dropped): ${JSON.stringify(
              r,
            )}`,
          ).not.toBe("collapsed");
        },
        // Per-arm hard cap governs the layout; the vitest test timeout is a
        // generous OUTER guard so the arm's own timeout verdict wins.
        perArmTimeoutMs + STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS,
      );
    }
  });
}
