/**
 * W12 held-out transfer + scale battery — TRANSFER BLOCK (WP2 of the W12
 * plan; the pre-registered analysis record is docs/strata-view-w12-heldout-
 * scale.md, committed BEFORE this file produced any statistic).
 *
 * Report-emitting, W10b/W11-style: this file owns NO layout behavior, changes
 * NO product geometry, and NEVER asserts metric values — hard asserts exist
 * ONLY for harness health (report written, presets exist, scenes/paths
 * non-empty, R2 structural zeros + no rcllV2 degradation on strata arms,
 * mutation health checks, cell recompute determinism, and the P1/P2 SANITY
 * ANCHOR below). Every transfer verdict is a MECHANICAL application of the
 * pre-registered record — adjudication stays with the owner (WP4).
 *
 * CLAIM SCOPING: P3 = `staging-heldout-mesh` is SELF-AUTHORED
 * (scripts/generate-heldout-plan.mjs, seed 20260704, frozen in WP1 commit
 * 8a5f73f9d). Out-of-tuning-distribution transfer evidence, NOT held-out
 * closure — R8-F4 stays formally open.
 *
 * Blocks (single orchestrating test; every arm built ONCE per preset):
 *   1. Transfer block — P1/P2/P3 × {A_v2, I, I_RS} (option bundles byte-equal
 *      to the W11 battery): extent slice-B p50/p90 + rt̂ p50/p90 paired CIs
 *      (frozen helpers verbatim: pairedBootstrapCi / pairedPathMetricsCi /
 *      computeStrataPathMetrics, seed 20260704), global crossings, R2
 *      structural zeros, buildMs (informational).
 *   2. Churn block — the A4 ChurnTriple THREE-mutation fixture
 *      (add-one-resource, add-one-edge, moved{}-rename; mechanics cloned from
 *      terraformPipelineStrataChurnTriple.test.ts per its own duplication
 *      precedent) on ALL THREE presets × {A_v2, I, I_RS}, with the FROZEN
 *      register thresholds (M1_rel ≤ 0.08 / M2_flip ≤ 0.10, rcll-v2-spec-v3.1
 *      §13) echoed as REPORT-only reference values — never re-derived, never
 *      loosened for P3. A mutation that cannot be constructed on a preset is
 *      stamped INCOMPLETE with its reason, never silently dropped.
 *   3. Tracing cells — W11's precision/recall calc (directed/uncapped
 *      production call vs true declared-dependency reachability + the shipped
 *      undirected 3-hop mismatch cell), arm I, all three presets. Labeled
 *      "evidenceClass": "api-seam-validation" — population matching, NOT
 *      task/impact-tracing evidence (W11's own caveat).
 *   4. SANITY ANCHOR (pre-registered §7): no W10B/W11 report JSON artifacts
 *      are committed (verified — docs/strata-baselines/ has none; git history
 *      adds only the .md reports), so the anchor cross-checks this battery's
 *      own deterministic P1/P2 fields against the numbers RECORDED in
 *      docs/strata-view-w11-task-tracing.md (mismatch precision 0.464/0.483,
 *      recall 0.682/0.739; directed 1.0/1.0; anchors 50/36 — requested,
 *      mappable AND zero unmappable; rt̂ p50/p90 per arm; P1 paired rt̂ p50 CI
 *      [-0.48, -0.05]). Any anchor mismatch fails the battery loudly; the
 *      orchestrator is ORDERED so P3 is not even BUILT until the anchor is
 *      green (codex W12 diff-review F3/F4).
 *
 * Codex W12 diff-review semantics (F1/F2, folded 2026-07-13):
 *   - F1: a churn cell with |U| < N_min records the shortfall IN THE CELL and
 *     flows to the pre-registered block-level VOID (record §5) — it is NOT a
 *     harness hard-failure. Hard failures are reserved for genuine harness
 *     breakage (empty scenes, non-deterministic recompute, anchor mismatch).
 *   - F2: a P3 layout THROW (base or mutated build) is captured and stamped
 *     into the report per the pre-registered degradation clause (§5 ⇒
 *     FAILED-TRANSFER) and the report is STILL written. P1/P2 layout throws
 *     remain hard failures (in-sample harness breakage).
 *
 * fullDetailBlock (WP3, additive — same orchestrator, same single report):
 *   F_v2_full_ancillary (baseline) vs H2/I2/J2 full-detail arms on P1 + P2
 *   (P3 as a stretch cell), option objects copied VERBATIM from
 *   terraformPipelineStrataExtentGate.test.ts (L110-147) but EVERY arm —
 *   baseline included — built through the SAME layoutTerraformViaWorkers seam
 *   (plan D4 single-seam rule; NO buildV2). Per pair: extent p50/p90 + rt̂
 *   p50/p90 paired CIs with the frozen pairedBootstrapCi statuses VERBATIM
 *   (voided/status/nUnmatched — voids EXPECTED at full detail, W4 precedent:
 *   the honest outcome, never adjudicated away) plus a slice-classification-
 *   asymmetry DIAGNOSTIC number (never determines status). Content-parity
 *   caveat recorded per cell (F_v2 includes ancillary; strata full arms defer
 *   it via strataAncillaryDeferred — element populations differ by
 *   construction). Cells that exceed the WP1-smoke-derived soft budget or
 *   throw on the full-detail path are stamped TIMEOUT/INCOMPLETE or
 *   LAYOUT-THROW and the matrix is NEVER reshaped (no dropped arms).
 *   Timing split (plan D6): terraformImportProfiler enabled+reset per cell;
 *   partition formula stated in the report meta; NO new spans. Verified on
 *   this branch: vitest has no Worker global and pipeline/strata modes run
 *   runSequential in layoutTerraformViaWorkers, so layout executes IN-PROCESS
 *   and the profiler IS reachable through the worker seam; `pipeline.prep`
 *   exists only on the rcll variant (terraformPipelineLayoutRcll.ts) — the v2
 *   and strata builders emit no nested spans, so its term is expected 0 here
 *   (recorded, not assumed).
 *
 * Determinism: seed 20260704 everywhere; no Date.now/Math.random in any
 * report-affecting path (performance.now feeds ONLY buildMs, which is
 * stripped). Protocol per the pre-registered record §8: the suite is run
 * TWICE and the two report JSONs must deep-equal after stripping wall-clock
 * keys (buildMs) — run externally:
 *   Q12_REPORT_DIR=/tmp/w12a yarn vitest run <this file> --exclude "**\/.claude/**"
 *   Q12_REPORT_DIR=/tmp/w12b yarn vitest run <this file> --exclude "**\/.claude/**"
 *   … then deep-compare the two W12_HELDOUT_SCALE_BATTERY.json sans buildMs.
 * In-test, every paired cell is additionally recomputed once and compared
 * (W10b's recompute-determinism check).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

import { describe, expect, it } from "vitest";

import graphlibDot from "@dagrejs/graphlib-dot";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import {
  BOOTSTRAP_SEED,
  canonicalEdgeKey,
  pairedBootstrapCi,
  statisticGateEligible,
  type BootstrapCiResult,
  type BootstrapStatistic,
} from "./terraformPipelineBootstrapCi";
import { DECLARED_DATAFLOW_ORDERED_KEY } from "./terraformDeclaredDataFlow";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import {
  setTerraformImportProfilerEnabled,
  terraformImportProfilerReset,
  terraformImportProfilerSummary,
  type TerraformImportProfilerSpan,
} from "./terraformImportProfiler";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import { getTerraformRelationshipFocus } from "./terraformRelationshipFocus";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
} from "./terraformPlanParsing";
import {
  computeSliceMetrics,
  type SliceEdgeRow,
} from "./terraformPipelineSliceMetrics";
import {
  computeStrataChurnMetrics,
  type ChurnMetrics,
} from "./terraformPipelineStrataChurnMetrics";
import {
  computeStrataConeMetrics,
  computeStrataPathMetrics,
  pairedPathMetricsCi,
  type PathMetricsRow,
  type StrataConeMetrics,
  type StrataPathMetrics,
} from "./terraformPipelineStrataPathMetrics";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";
import type { TerraformPlanDotBundle } from "./terraformImportMerge";

const PRESETS = {
  P1: "staging-extended-localstack-v2",
  P2: "staging-localstack",
  P3: "staging-heldout-mesh",
} as const;
type PresetLabel = keyof typeof PRESETS;
const PRESET_LABELS: readonly PresetLabel[] = ["P1", "P2", "P3"];

const REPORT_DIR = process.env.Q12_REPORT_DIR ?? tmpdir();
/** WP3: transfer block (36 builds) + full-detail block (12 builds) share the
 * one orchestrating test — plan cap ×60 (WP3 row), up from WP2's ×12. */
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 60;

/**
 * FROZEN A4 register thresholds — copied verbatim from the normative source,
 * rcll-v2-spec-v3.1.md §13 "A4 threshold freeze register" (frozen 2026-07-05,
 * W3): M1_rel ≤ 0.08, M2_flip ≤ 0.10. REPORT-only reference values here (the
 * battery never gates); NEVER re-derived or loosened for P3.
 */
const M1_REL_THRESHOLD = 0.08;
const M2_FLIP_THRESHOLD = 0.1;
/** Frozen v3.1 §12: N_min = 20 (M4/M5 gate precondition; echoed to the
 * metrics module explicitly). */
const N_MIN = 20;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ── arms — option bundles BYTE-EQUAL to the W11 battery
// (terraformPipelineStrataTaskTracingBattery.test.ts ARM_OPTIONS) ─────────────

const BASE_STRATA: Record<string, unknown> = {
  layoutMode: "strata",
  pipelineCompact: true,
  strataSweeps: 4,
  strataCoordinateRefine: true,
};

const ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  A_v2: {
    layoutMode: "pipeline",
    pipelineLayoutVariant: "v2",
    pipelineCompact: true,
  },
  I: { ...BASE_STRATA },
  I_RS: { ...BASE_STRATA, strataRankSeparate: true },
};

const ARM_LABELS = Object.keys(ARM_OPTIONS);
const STRATA_ARMS = new Set(["I", "I_RS"]);
/** Arm pairs that count (pre-registered record §1; baseline always A_v2). */
const CELL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["A_v2", "I"],
  ["A_v2", "I_RS"],
];
/** Tracing cells run on arm I only (pre-registered record §6). */
const TRACING_ARM = "I";

// ── per-arm build (single seam for every arm, baseline included) ─────────────

type ArmData = {
  elements: ExcalidrawElement[];
  sliceB: Map<string, number>;
  nSliceB: number;
  paths: StrataPathMetrics;
  cones: StrataConeMetrics;
  crossings: number;
  buildMs: number;
  elementCount: number;
  rcllV2Degraded: unknown;
  strataStructural: unknown;
};

function sliceBKeyed(perEdge: readonly SliceEdgeRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of perEdge) {
    if (row.slice !== "B") {
      continue;
    }
    const key = canonicalEdgeKey(row.source, row.target, row.relKind);
    if (!map.has(key)) {
      map.set(key, row.extentPx);
    }
  }
  return map;
}

async function buildArmFrom(
  planDotBundles: readonly TerraformPlanDotBundle[],
  tfdTexts: readonly string[],
  tfdLabels: readonly string[],
  options: Record<string, unknown>,
): Promise<ArmData> {
  clearTerraformImportPrepCache();
  const t0 = performance.now();
  const body = await layoutTerraformViaWorkers(
    {
      planDotBundles: [...planDotBundles],
      states: [],
      stateLabels: [],
      tfdTexts: [...tfdTexts],
      tfdLabels: [...tfdLabels],
    },
    { semanticLayout: false, ...options },
  );
  const buildMs = performance.now() - t0;
  const elements = (body.elements ?? []) as ExcalidrawElement[];
  const meta = (body.meta ?? {}) as Record<string, unknown>;
  const sliceB = sliceBKeyed(computeSliceMetrics(elements).perEdge);
  return {
    elements,
    sliceB,
    nSliceB: sliceB.size,
    paths: computeStrataPathMetrics(elements),
    cones: computeStrataConeMetrics(elements),
    crossings: diagnosePipelineScene(elements).dataflow.crossings,
    buildMs: round2(buildMs),
    elementCount: elements.filter((e) => !e.isDeleted).length,
    rcllV2Degraded: meta.rcllV2Degraded,
    strataStructural: meta.strataStructural ?? null,
  };
}

async function buildArm(
  sources: TerraformImportPresetSources,
  options: Record<string, unknown>,
): Promise<ArmData> {
  return buildArmFrom(
    sources.planDotBundles,
    sources.tfdTexts,
    sources.tfdLabels,
    options,
  );
}

function pathPercentile(
  rows: readonly PathMetricsRow[],
  pick: (r: PathMetricsRow) => number,
  q: number,
): number {
  if (rows.length === 0) {
    return 0;
  }
  const vals = rows.map(pick).sort((a, b) => a - b);
  return vals[Math.min(vals.length - 1, Math.floor(vals.length * q))]!;
}

const mean = (vals: readonly number[]): number =>
  vals.length === 0 ? 0 : vals.reduce((s, v) => s + v, 0) / vals.length;

// ── paired-CI cells + pre-registered mechanical classification ───────────────

/** Pre-registered record §4 — mechanical class per paired CI cell. */
type CiClass = "VOID" | "IMPROVING" | "WORSENING" | "NULL";

function classifyCi(ci: BootstrapCiResult): CiClass {
  if (ci.voided) {
    return "VOID";
  }
  if (ci.hi < 0) {
    return "IMPROVING";
  }
  if (ci.lo > 0) {
    return "WORSENING";
  }
  return "NULL";
}

function ciView(ci: BootstrapCiResult) {
  return {
    statistic: ci.statistic,
    n: ci.n,
    nUnmatched: ci.nUnmatched,
    point: round4(ci.point),
    lo: round4(ci.lo),
    hi: round4(ci.hi),
    degenerate: ci.degenerate,
    voided: ci.voided,
    status: ci.status,
    ciExcludesZeroImproving: !ci.voided && ci.hi < 0,
    ciExcludesZeroWorsening: !ci.voided && ci.lo > 0,
    class: classifyCi(ci),
    gateEligible:
      statisticGateEligible(
        ci.statistic as Exclude<BootstrapStatistic, never>,
        ci.n,
      ) &&
      !ci.voided &&
      !(ci.statistic === "p90" && ci.degenerate),
  };
}

type CiCellView = ReturnType<typeof ciView>;

function extentCell(
  base: ReadonlyMap<string, number>,
  cand: ReadonlyMap<string, number>,
) {
  const run = (statistic: BootstrapStatistic) =>
    ciView(
      pairedBootstrapCi({ baseline: base, candidate: cand }, { statistic }),
    );
  return { p50: run("p50"), p90: run("p90") };
}

function pathsCell(
  baseRows: readonly PathMetricsRow[],
  candRows: readonly PathMetricsRow[],
) {
  const ci = pairedPathMetricsCi(baseRows, candRows);
  return {
    rtHatP50: ciView(ci.rtHatP50),
    rtHatP90: ciView(ci.rtHatP90),
    conP90: ciView(ci.conP90),
    crP90: ciView(ci.crP90),
    tllP50: ciView(ci.tllP50),
  };
}

type TransferCell = {
  extent: ReturnType<typeof extentCell>;
  paths: ReturnType<typeof pathsCell>;
};

/** The four HEADLINE statistics per arm pair (pre-registered record §1). */
const HEADLINE_STATS: ReadonlyArray<{
  key: string;
  pick: (cell: TransferCell) => CiCellView;
}> = [
  { key: "extentP50", pick: (c) => c.extent.p50 },
  { key: "extentP90", pick: (c) => c.extent.p90 },
  { key: "rtHatP50", pick: (c) => c.paths.rtHatP50 },
  { key: "rtHatP90", pick: (c) => c.paths.rtHatP90 },
];

/** Pre-registered record §5 — per-headline-cell transfer verdict. */
function transferCellVerdict(
  p1: CiClass,
  p2: CiClass,
  p3: CiClass,
): "SUPPORT" | "FAILED-TRANSFER" | "VOID" | "INCONCLUSIVE" {
  if (p3 === "VOID") {
    return "VOID";
  }
  if (p3 === p1 || p3 === p2) {
    return "SUPPORT";
  }
  if (p3 === "NULL" && p1 !== p2) {
    return "SUPPORT";
  }
  if (p3 === "WORSENING" && p1 !== "WORSENING" && p2 !== "WORSENING") {
    return "FAILED-TRANSFER";
  }
  return "INCONCLUSIVE";
}

// ── arm summary (report) ─────────────────────────────────────────────────────

function armSummary(arm: ArmData): Record<string, unknown> {
  return {
    buildMs: arm.buildMs,
    elementCount: arm.elementCount,
    nSliceB: arm.nSliceB,
    crossings: arm.crossings,
    rcllV2Degraded: arm.rcllV2Degraded ?? null,
    strataStructural: arm.strataStructural,
    paths: {
      populationTotal: arm.paths.populationTotal,
      sampled: arm.paths.sampled,
      edgeCoverage: arm.paths.edgeCoverage,
      unresolvedPathCount: arm.paths.unresolvedPathCount,
      rtHatP50: round2(pathPercentile(arm.paths.rows, (r) => r.rtHat, 0.5)),
      rtHatP90: round2(pathPercentile(arm.paths.rows, (r) => r.rtHat, 0.9)),
    },
    cones: {
      anchorsEligible: arm.cones.anchorsEligible,
      sampled: arm.cones.sampled,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL-DETAIL SCALE BLOCK (WP3) — arms, budget, builder, cells.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full-detail arm option bundles — copied VERBATIM (not imported) from
 * terraformPipelineStrataExtentGate.test.ts ARM_OPTIONS L110-147 (plan D4).
 * EVERY arm, baseline included, builds through the same
 * layoutTerraformViaWorkers seam (single-seam rule; NO buildV2).
 */
const FULL_DETAIL_ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  F_v2_full_ancillary: {
    layoutMode: "pipeline",
    pipelineLayoutVariant: "v2",
    pipelineCompact: false,
    pipelineIncludeAncillary: true,
  },
  H2_strata_k4_full: {
    layoutMode: "strata",
    pipelineCompact: false,
    strataSweeps: 4,
  },
  I2_strata_k4_a7_full: {
    layoutMode: "strata",
    pipelineCompact: false,
    strataSweeps: 4,
    strataCoordinateRefine: true,
  },
  J2_strata_k4_a7_rs_full: {
    layoutMode: "strata",
    pipelineCompact: false,
    strataSweeps: 4,
    strataCoordinateRefine: true,
    strataRankSeparate: true,
  },
};
const FULL_DETAIL_ARM_LABELS = Object.keys(FULL_DETAIL_ARM_OPTIONS);
const FULL_DETAIL_BASELINE = "F_v2_full_ancillary";
const FULL_DETAIL_CANDIDATES = [
  "H2_strata_k4_full",
  "I2_strata_k4_a7_full",
  "J2_strata_k4_a7_rs_full",
];
/** Full-detail block presets: P1 + P2 headline, P3 stretch (cheap per WP1). */
const FULL_DETAIL_PRESETS: readonly PresetLabel[] = ["P1", "P2", "P3"];

/**
 * Soft per-cell time budget, derived from the WP1 smoke wall-clocks frozen in
 * docs/strata-baselines/q12/P3_DISTINCTNESS_PROFILE.json p3Smokes (F_v2_full
 * 205.3ms / I2_full 171.07ms on P3's 396 resources): max smoke ≈ 205.3ms ×
 * ~290 headroom (covers P1's ~3× resource scale with generous margin) ≈ 60s.
 * SOFT: the in-process build cannot be aborted mid-flight; an overrun is
 * detected after completion and STAMPED (TIMEOUT/INCOMPLETE) — the cell stays
 * in the matrix, metrics that completed are still reported (never censored,
 * never reshaped). The overall vitest timeout stays the plan's ×60 cap.
 */
const FULL_DETAIL_CELL_BUDGET_MS = 60_000;

/** Outer (pre-layout) spans — outside `layout.pipeline` per plan D6 /
 * terraformLayoutCore.ts (prep.cache L965, merge.plans L972, parse.nodes
 * L1024, parse.tfd L1032). */
const OUTER_SPAN_NAMES = [
  "prep.cache",
  "merge.plans",
  "parse.nodes",
  "parse.tfd",
];

const TIMING_PARTITION_FORMULA =
  "wallClockMs = outerPrepMergeParseMs (Σ inclusive ms of spans outside layout.pipeline: " +
  `${OUTER_SPAN_NAMES.join("+")}) + layoutPipelineExclNestedPrepMs ` +
  "(ms(layout.pipeline) − ms(pipeline.prep)) + pipelinePrepMs (ms(pipeline.prep), " +
  "nested inside layout.pipeline — fires ONLY on the rcll variant, expected 0 for the " +
  "v2/strata builders on this branch) + remainderMs (wallClockMs − Σ top-level spans; " +
  "seam/metric overhead outside all spans). Inclusive ms used throughout (selfMs is " +
  "unreliable for nested spans); NO new spans added by W12.";

type TimingSplit = {
  status: "ok" | "unavailable-through-worker-seam";
  reason?: string;
  wallClockMs?: number;
  outerPrepMergeParseMs?: number;
  layoutPipelineMs?: number;
  layoutPipelineExclNestedPrepMs?: number;
  pipelinePrepMs?: number;
  remainderMs?: number;
  firedSpans?: Array<{ name: string; ms: number; callCount: number }>;
  unclassifiedSpanNames?: string[];
};

function computeTimingSplit(
  spans: readonly TerraformImportProfilerSpan[],
  wallClockMs: number,
): TimingSplit {
  if (spans.length === 0) {
    return {
      status: "unavailable-through-worker-seam",
      reason:
        "no profiler spans fired through layoutTerraformViaWorkers — layout did not run " +
        "in-process (single-seam rule wins; buildMs only)",
    };
  }
  const ms = (name: string) => spans.find((s) => s.name === name)?.ms ?? 0;
  const outer = OUTER_SPAN_NAMES.reduce((sum, n) => sum + ms(n), 0);
  const layoutPipeline = ms("layout.pipeline");
  const pipelinePrep = ms("pipeline.prep");
  const unclassified = spans
    .map((s) => s.name)
    .filter(
      (n) =>
        !OUTER_SPAN_NAMES.includes(n) &&
        n !== "layout.pipeline" &&
        !n.startsWith("pipeline."),
    )
    .sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
  return {
    status: "ok",
    wallClockMs: round2(wallClockMs),
    outerPrepMergeParseMs: round2(outer),
    layoutPipelineMs: round2(layoutPipeline),
    layoutPipelineExclNestedPrepMs: round2(layoutPipeline - pipelinePrep),
    pipelinePrepMs: round2(pipelinePrep),
    remainderMs: round2(wallClockMs - outer - layoutPipeline),
    firedSpans: spans.map((s) => ({
      name: s.name,
      ms: s.ms,
      callCount: s.callCount,
    })),
    unclassifiedSpanNames: unclassified,
  };
}

function edgesKeyedAll(perEdge: readonly SliceEdgeRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of perEdge) {
    const key = canonicalEdgeKey(row.source, row.target, row.relKind);
    if (!map.has(key)) {
      map.set(key, row.extentPx);
    }
  }
  return map;
}

type FullDetailArmData = ArmData & {
  /** ALL-slice keyed extents — feeds the slice-classification-asymmetry
   * DIAGNOSTIC only (never a status input). */
  allEdges: Map<string, number>;
  /** Wall-clock-derived fields — nested so stripTimings drops them wholesale
   * (budgetStatus depends on wall-clock and MUST not break run-twice
   * determinism; the raw report keeps it). */
  timing: {
    budgetMs: number;
    wallClockMs: number;
    budgetStatus: "OK" | "TIMEOUT/INCOMPLETE";
    timingSplit: TimingSplit;
  };
};

async function buildFullDetailArm(
  sources: TerraformImportPresetSources,
  options: Record<string, unknown>,
): Promise<FullDetailArmData> {
  // Profiler enabled + reset PER CELL (plan D6); restored to auto afterwards
  // so the transfer block's behavior is untouched.
  setTerraformImportProfilerEnabled(true);
  terraformImportProfilerReset();
  let spans: TerraformImportProfilerSpan[] = [];
  let arm: ArmData;
  try {
    arm = await buildArm(sources, options);
    spans = terraformImportProfilerSummary();
  } finally {
    terraformImportProfilerReset();
    setTerraformImportProfilerEnabled(null);
  }
  const wallClockMs = arm.buildMs;
  return {
    ...arm,
    allEdges: edgesKeyedAll(computeSliceMetrics(arm.elements).perEdge),
    timing: {
      budgetMs: FULL_DETAIL_CELL_BUDGET_MS,
      wallClockMs,
      budgetStatus:
        wallClockMs > FULL_DETAIL_CELL_BUDGET_MS ? "TIMEOUT/INCOMPLETE" : "OK",
      timingSplit: computeTimingSplit(spans, wallClockMs),
    },
  };
}

/** Slice-classification-asymmetry DIAGNOSTIC (pre-registered record §1 /
 * plan D4: reported separately, NEVER determines status): of the pairing keys
 * the frozen CI could not match slice-B-to-slice-B, how many exist in the
 * OTHER arm's scene under a different slice (re-classified) vs not at all
 * (population difference — e.g. the ancillary content-parity gap)? */
function sliceAsymmetryDiagnostic(
  base: FullDetailArmData,
  cand: FullDetailArmData,
) {
  let baseSliceBReclassifiedInCandidate = 0;
  let baseSliceBAbsentFromCandidate = 0;
  for (const key of base.sliceB.keys()) {
    if (cand.sliceB.has(key)) {
      continue;
    }
    if (cand.allEdges.has(key)) {
      baseSliceBReclassifiedInCandidate += 1;
    } else {
      baseSliceBAbsentFromCandidate += 1;
    }
  }
  let candSliceBReclassifiedInBaseline = 0;
  let candSliceBAbsentFromBaseline = 0;
  for (const key of cand.sliceB.keys()) {
    if (base.sliceB.has(key)) {
      continue;
    }
    if (base.allEdges.has(key)) {
      candSliceBReclassifiedInBaseline += 1;
    } else {
      candSliceBAbsentFromBaseline += 1;
    }
  }
  return {
    note: "DIAGNOSTIC only — never determines a cell status (frozen pairedBootstrapCi statuses are verbatim)",
    asymmetry:
      baseSliceBReclassifiedInCandidate + candSliceBReclassifiedInBaseline,
    baseSliceBReclassifiedInCandidate,
    baseSliceBAbsentFromCandidate,
    candSliceBReclassifiedInBaseline,
    candSliceBAbsentFromBaseline,
    nSliceBBaseline: base.sliceB.size,
    nSliceBCandidate: cand.sliceB.size,
  };
}

const FULL_DETAIL_CONTENT_PARITY_CAVEAT =
  "content parity differs BY CONSTRUCTION: F_v2_full_ancillary includes ancillary " +
  "(pipelineIncludeAncillary:true); strata full arms defer it (strataAncillaryDeferred, " +
  "unbuilt M3 port) — element populations differ; paired CIs pair only canonical-key-matched " +
  "edges and the frozen void rule reports the mismatch honestly (voids EXPECTED, W4 precedent)";

// ─────────────────────────────────────────────────────────────────────────────
// Churn mutation builders — the A4 ChurnTriple THREE-mutation fixture, cloned
// (minimally) from terraformPipelineStrataChurnTriple.test.ts per that file's
// own non-exported-helpers duplication precedent. Mechanics UNCHANGED; the
// node/bind/edge picks are already programmatic, so no P3-specific adaptation
// is embedded — if a builder throws on a preset, the cell is stamped
// INCOMPLETE with the thrown reason (pre-registered record §2), never dropped.
// ─────────────────────────────────────────────────────────────────────────────

type RawPlan = {
  resource_changes: Array<Record<string, unknown>>;
  prior_state?: { values?: { root_module?: unknown } };
  [k: string]: unknown;
};

type BindEntry = {
  alias: string;
  rhs: string;
  fileIndex: number;
  lineIndex: number;
};

type ParsedAddress = {
  prefix: string;
  type: string;
  name: string;
  indexSuffix: string;
};

type BindCandidate = BindEntry & { bareAddress: string; parsed: ParsedAddress };

type MutationLabel = "addOneResource" | "addOneEdge" | "movedRename";

type MutationPayload = {
  label: MutationLabel;
  planDotBundles: TerraformPlanDotBundle[];
  tfdTexts: string[];
  note: string;
  oldAddress?: string;
  newAddress?: string;
  touchedAddresses?: string[];
};

const isEdgeLine = (line: string): { src: string; tgt: string } | null => {
  const t = line.trim();
  if (!t || t.startsWith("#") || /^bind\s/i.test(t) || t.includes("-->")) {
    return null;
  }
  const m = t.match(/^([^\s#]+)\s*->\s*(.+)$/);
  if (!m) {
    return null;
  }
  const targets = m[2]!.split(",").map((s) => s.trim());
  if (targets.length !== 1) {
    return null;
  }
  return { src: m[1]!, tgt: targets[0]! };
};

const parseBindsMap = (lines: readonly string[]): Map<string, string> => {
  const binds = new Map<string, string>();
  for (const line of lines) {
    const m = line.trim().match(/^bind\s+([A-Za-z_][\w]*)\s*=?\s+(.+)$/i);
    if (m) {
      binds.set(m[1]!, m[2]!.trim());
    }
  }
  return binds;
};

const pickTfdFile = (texts: readonly string[]): number => {
  let best = -1;
  let bestCount = -1;
  texts.forEach((t, i) => {
    const n = (t ?? "")
      .split(/\r?\n/)
      .filter((l) => isEdgeLine(l) != null).length;
    if (n > bestCount) {
      bestCount = n;
      best = i;
    }
  });
  if (bestCount <= 10) {
    throw new Error(
      `pickTfdFile: no tfd file with >10 single-target edge lines (best=${bestCount})`,
    );
  }
  return best;
};

/** add-one-edge — verbatim ChurnTriple mechanics: insert one NEW acyclic,
 * non-duplicate edge mid-file (the mutation R8-F4/C11 came from). */
const mutateAddEdge = (
  texts: readonly string[],
): { texts: string[]; note: string; touchedAddresses: string[] } => {
  const fi = pickTfdFile(texts);
  const lines = texts[fi]!.split(/\r?\n/);
  const binds = parseBindsMap(lines);
  const canon = (a: string) => binds.get(a) ?? a;

  const adj = new Map<string, Set<string>>();
  const edgeSet = new Set<string>();
  const plainEdges: Array<{ src: string; tgt: string; idx: number }> = [];
  lines.forEach((raw, idx) => {
    const t = raw.trim();
    if (!t || t.startsWith("#") || /^bind\s/i.test(t)) {
      return;
    }
    const m = t.match(/^([^\s#]+)\s*-{1,2}>\s*(.+)$/);
    if (!m) {
      return;
    }
    const src = canon(m[1]!);
    for (const tgtRaw of m[2]!.split(",")) {
      const tgt = canon(tgtRaw.trim());
      if (!tgt) {
        continue;
      }
      if (!adj.has(src)) {
        adj.set(src, new Set());
      }
      adj.get(src)!.add(tgt);
      edgeSet.add(`${src} ${tgt}`);
    }
    const plain = isEdgeLine(raw);
    if (plain) {
      plainEdges.push({ src: plain.src, tgt: plain.tgt, idx });
    }
  });

  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>([from]);
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === to) {
        return true;
      }
      for (const nxt of adj.get(cur) ?? []) {
        if (!seen.has(nxt)) {
          seen.add(nxt);
          stack.push(nxt);
        }
      }
    }
    return false;
  };

  let pick: { a: string; c: string } | null = null;
  outer: for (let i = 0; i < Math.floor(plainEdges.length / 3); i++) {
    const a = plainEdges[i]!.src;
    for (
      let j = plainEdges.length - 1;
      j >= Math.floor((plainEdges.length * 2) / 3);
      j--
    ) {
      const c = plainEdges[j]!.tgt;
      const ca = canon(a);
      const cc = canon(c);
      if (ca !== cc && !edgeSet.has(`${ca} ${cc}`) && !reaches(cc, ca)) {
        pick = { a, c };
        break outer;
      }
    }
  }
  if (pick == null) {
    throw new Error("mutateAddEdge: found no safe new edge to insert");
  }
  const midLine = plainEdges[Math.floor(plainEdges.length / 2)]!.idx;
  const newLine = `${pick.a} -> ${pick.c}`;
  const next = [...lines.slice(0, midLine), newLine, ...lines.slice(midLine)];
  const out = [...texts];
  out[fi] = next.join("\n");
  return {
    texts: out,
    note: `inserted "${newLine}" before line ${midLine + 1} of tfd[${fi}]`,
    touchedAddresses: [pick.a, pick.c].map(canon),
  };
};

function parseAllBindEntries(texts: readonly string[]): BindEntry[] {
  const out: BindEntry[] = [];
  texts.forEach((text, fileIndex) => {
    const lines = (text ?? "").split(/\r?\n/);
    lines.forEach((line, lineIndex) => {
      const m = line.trim().match(/^bind\s+([A-Za-z_][\w]*)\s*=?\s+(.+)$/i);
      if (m) {
        out.push({ alias: m[1]!, rhs: m[2]!.trim(), fileIndex, lineIndex });
      }
    });
  });
  return out;
}

const bareAddressOf = (rhs: string): string =>
  rhs.includes("::") ? rhs.slice(rhs.indexOf("::") + 2) : rhs;

function parseResourceAddress(address: string): ParsedAddress | null {
  const m = address.match(
    /^(.*\.)?([A-Za-z_][\w-]*)\.([A-Za-z_][\w-]*)(\[[^\]]*\])?$/,
  );
  if (!m) {
    return null;
  }
  return {
    prefix: m[1] ?? "",
    type: m[2]!,
    name: m[3]!,
    indexSuffix: m[4] ?? "",
  };
}

function pickBindCandidate(
  binds: readonly BindEntry[],
  resourceAddresses: ReadonlySet<string>,
  opts: { requireNoBracket?: boolean } = {},
): BindCandidate {
  for (const b of binds) {
    const bare = bareAddressOf(b.rhs);
    if (!resourceAddresses.has(bare)) {
      continue;
    }
    if (opts.requireNoBracket && bare.includes("[")) {
      continue;
    }
    const parsed = parseResourceAddress(bare);
    if (!parsed) {
      continue;
    }
    return { ...b, bareAddress: bare, parsed };
  }
  throw new Error("pickBindCandidate: no matching bind found");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renameAddressTokenInText(
  text: string,
  oldAddr: string,
  newAddr: string,
): string {
  const re = new RegExp(
    `(?<![\\w.\\]])${escapeRegExp(oldAddr)}(?![\\w.[])`,
    "g",
  );
  return text.replace(re, newAddr);
}

function clonePlan(plan: unknown): RawPlan {
  return JSON.parse(JSON.stringify(plan)) as RawPlan;
}

function resourceChangeAddresses(plan: RawPlan): Set<string> {
  return new Set(
    plan.resource_changes
      .map((rc) => rc.address)
      .filter((a): a is string => typeof a === "string"),
  );
}

function renameAddressEverywhereInPlan(
  plan: RawPlan,
  oldAddr: string,
  newAddr: string,
  newName: string,
): number {
  let count = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (typeof obj.address === "string" && obj.address === oldAddr) {
        obj.address = newAddr;
        count += 1;
        if (typeof obj.name === "string") {
          obj.name = newName;
        }
      }
      if (Array.isArray(obj.depends_on)) {
        obj.depends_on = (obj.depends_on as unknown[]).map((d) =>
          d === oldAddr ? newAddr : d,
        );
      }
      for (const key of Object.keys(obj)) {
        if (key === "address" || key === "depends_on") {
          continue;
        }
        walk(obj[key]);
      }
    }
  };
  walk(plan);
  return count;
}

function buildAddResourceMutation(
  sources: TerraformImportPresetSources,
): MutationPayload {
  const bundle = sources.planDotBundles[0]!;
  const plan = clonePlan(bundle.plan);
  const resourceAddrs = resourceChangeAddresses(plan);
  const binds = parseAllBindEntries(sources.tfdTexts);
  const picked = pickBindCandidate(binds, resourceAddrs, {
    requireNoBracket: true,
  });
  const newName = `${picked.parsed.name}_a4new`;
  const newAddress = `${picked.parsed.prefix}${picked.parsed.type}.${newName}${picked.parsed.indexSuffix}`;
  if (resourceAddrs.has(newAddress)) {
    throw new Error(`addOneResource: new address pre-exists (${newAddress})`);
  }

  const origEntry = plan.resource_changes.find(
    (rc) => rc.address === picked.bareAddress,
  );
  if (!origEntry) {
    throw new Error(
      `addOneResource: resource_changes missing ${picked.bareAddress}`,
    );
  }
  const clonedEntry = JSON.parse(JSON.stringify(origEntry)) as Record<
    string,
    unknown
  >;
  clonedEntry.address = newAddress;
  if (typeof clonedEntry.name === "string") {
    clonedEntry.name = newName;
  }
  plan.resource_changes = [...plan.resource_changes, clonedEntry];

  const newAlias = `${picked.alias}_a4new`;
  const newRhs = picked.rhs.includes("::")
    ? `${picked.rhs.slice(0, picked.rhs.indexOf("::"))}::${newAddress}`
    : newAddress;
  const newBindLine = `bind ${newAlias} = ${newRhs}`;

  const texts = [...sources.tfdTexts];
  const bindFileLines = texts[picked.fileIndex]!.split(/\r?\n/);
  bindFileLines.splice(picked.lineIndex + 1, 0, newBindLine);
  texts[picked.fileIndex] = bindFileLines.join("\n");

  const edgeFileIdx = pickTfdFile(texts);
  const edgeLines = texts[edgeFileIdx]!.split(/\r?\n/);
  const edgeIdx = edgeLines
    .map((l, i) => (isEdgeLine(l) ? i : -1))
    .filter((i) => i >= 0);
  if (edgeIdx.length === 0) {
    throw new Error("addOneResource: no single-target edge line to widen");
  }
  const mid = edgeIdx[Math.floor(edgeIdx.length / 2)]!;
  const parsedEdge = isEdgeLine(edgeLines[mid]!)!;
  edgeLines[mid] = `${parsedEdge.src} -> ${parsedEdge.tgt}, ${newAlias}`;
  texts[edgeFileIdx] = edgeLines.join("\n");

  return {
    label: "addOneResource",
    planDotBundles: [{ ...bundle, plan } as unknown as TerraformPlanDotBundle],
    tfdTexts: texts,
    note:
      `duplicated resource "${picked.bareAddress}" -> "${newAddress}" ` +
      `(new bind ${newAlias}); attached via widening ` +
      `"${parsedEdge.src} -> ${parsedEdge.tgt}" into a 2-target fanout in tfd[${edgeFileIdx}]`,
    oldAddress: picked.bareAddress,
    newAddress,
  };
}

function buildAddEdgeMutation(
  sources: TerraformImportPresetSources,
): MutationPayload {
  const { texts, note, touchedAddresses } = mutateAddEdge(sources.tfdTexts);
  return {
    label: "addOneEdge",
    planDotBundles: [...sources.planDotBundles],
    tfdTexts: texts,
    note,
    touchedAddresses,
  };
}

function buildRenameMutation(
  sources: TerraformImportPresetSources,
): MutationPayload {
  const bundle = sources.planDotBundles[0]!;
  const plan = clonePlan(bundle.plan);
  const resourceAddrs = resourceChangeAddresses(plan);
  const binds = [...parseAllBindEntries(sources.tfdTexts)].reverse();
  const picked = pickBindCandidate(binds, resourceAddrs, {});
  const newName = `${picked.parsed.name}_moved`;
  const newAddress = `${picked.parsed.prefix}${picked.parsed.type}.${newName}${picked.parsed.indexSuffix}`;
  if (resourceAddrs.has(newAddress)) {
    throw new Error(`movedRename: new address pre-exists (${newAddress})`);
  }

  const renameCount = renameAddressEverywhereInPlan(
    plan,
    picked.bareAddress,
    newAddress,
    newName,
  );
  if (renameCount < 1) {
    throw new Error("movedRename: rename hit no plan object");
  }

  const texts = sources.tfdTexts.map((text) =>
    renameAddressTokenInText(text ?? "", picked.bareAddress, newAddress),
  );
  const textsChanged = texts.some((t, i) => t !== sources.tfdTexts[i]);
  if (!textsChanged) {
    throw new Error("movedRename: rename altered no tfd file");
  }

  return {
    label: "movedRename",
    planDotBundles: [{ ...bundle, plan } as unknown as TerraformPlanDotBundle],
    tfdTexts: texts,
    note: `renamed "${picked.bareAddress}" -> "${newAddress}" (bind ${picked.alias}; ${renameCount} plan object(s) updated)`,
    oldAddress: picked.bareAddress,
    newAddress,
  };
}

/** ChurnTriple's tfd-overlay sanity guard: the harness's own text surgery must
 * still resolve >0 declared edges (fails fast, not as an opaque engine error). */
function tfdOverlayEdgeCount(
  bundle: TerraformPlanDotBundle,
  tfdTexts: readonly string[],
  tfdLabels: readonly string[],
): number {
  const graph = graphlibDot.read("digraph G {}\n");
  const nodes = buildTerraformLocalImportNodesMap(bundle.plan, graph, [], {});
  applyTfdOverlayToNodes(nodes, [...tfdTexts], [...tfdLabels]);
  return (
    (nodes[DECLARED_DATAFLOW_ORDERED_KEY] as unknown[] | undefined)?.length ?? 0
  );
}

function collectPrimaryClusterAddresses(
  elements: readonly ExcalidrawElement[],
): Set<string> {
  const out = new Set<string>();
  for (const el of elements) {
    if (el.type !== "frame" || el.isDeleted) {
      continue;
    }
    const cd = el.customData as Record<string, unknown> | undefined;
    if (
      cd?.terraformTopologyRole === "primaryCluster" &&
      typeof cd.terraformPrimaryAddress === "string"
    ) {
      out.add(cd.terraformPrimaryAddress);
    }
  }
  return out;
}

// ── tracing cells (W11's precision/recall calc — minimal inline clone; the
// W11 helpers are file-local, not exported) ──────────────────────────────────

const customDataOf = (el: ExcalidrawElement): Record<string, unknown> =>
  (el.customData as Record<string, unknown> | undefined) ?? {};

const relOf = (el: ExcalidrawElement): Record<string, unknown> | null => {
  const r = customDataOf(el).relationship;
  return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
};

type TfdArrow = { source: string; target: string };

/** Same population as computeStrataConeMetrics (engine-emitted non-aggregated
 * relationship arrows; NOT filtered on isDeleted — TFD arrows are emitted
 * soft-deleted). */
function tfdArrowsOf(elements: readonly ExcalidrawElement[]): TfdArrow[] {
  const out: TfdArrow[] = [];
  for (const el of elements) {
    if (el.type !== "arrow") {
      continue;
    }
    const r = relOf(el);
    if (
      r == null ||
      typeof r.source !== "string" ||
      typeof r.target !== "string" ||
      r.aggregated === true
    ) {
      continue;
    }
    out.push({ source: r.source, target: r.target });
  }
  return out;
}

/** True declared-dependency reachability (computeStrataConeMetrics convention:
 * self-loops skipped, parallel arrows collapsed, source→target =
 * "dependencies"). Cross-checked against row.coneNodes below. */
function trueReachFrom(
  arrows: readonly TfdArrow[],
  anchor: string,
): Set<string> {
  const out = new Map<string, Set<string>>();
  for (const { source, target } of arrows) {
    if (source === target) {
      continue;
    }
    (out.get(source) ?? out.set(source, new Set()).get(source)!).add(target);
  }
  const reach = new Set<string>([anchor]);
  let frontier = [anchor];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const u of frontier) {
      for (const v of out.get(u) ?? []) {
        if (!reach.has(v)) {
          reach.add(v);
          next.push(v);
        }
      }
    }
    frontier = next;
  }
  return reach;
}

/** Graph addresses of all elements (nodePath, else terraformVisibilityKey) —
 * the focusNodePath identity space (unmappable anchors reported honestly). */
function elementGraphAddresses(
  elements: readonly ExcalidrawElement[],
): Set<string> {
  const out = new Set<string>();
  for (const el of elements) {
    const cd = customDataOf(el);
    if (typeof cd.nodePath === "string" && cd.nodePath.length > 0) {
      out.add(cd.nodePath);
    } else if (
      typeof cd.terraformVisibilityKey === "string" &&
      cd.terraformVisibilityKey.length > 0
    ) {
      out.add(cd.terraformVisibilityKey);
    }
  }
  return out;
}

type TracingCell = {
  mode: Record<string, unknown>;
  anchorsRequested: number;
  anchorsMappable: number;
  unmappableAnchors: string[];
  aggregate: {
    meanPrecision: number;
    meanRecall: number;
    minPrecision: number;
    minRecall: number;
    perfectPrecisionShare: number;
    perfectRecallShare: number;
    totalFocusOnlyNodes: number;
    totalConeOnlyNodes: number;
  };
};

function runTracingCell(
  elements: readonly ExcalidrawElement[],
  anchors: readonly string[],
  tfdArrows: readonly TfdArrow[],
  cones: StrataConeMetrics,
  softFailures: string[],
  context: string,
  variant: "productionDirected" | "shippedBoth",
): TracingCell {
  const mappableSet = elementGraphAddresses(elements);
  const mappable: string[] = [];
  const unmappable: string[] = [];
  for (const anchor of anchors) {
    (mappableSet.has(anchor) ? mappable : unmappable).push(anchor);
  }
  const coneNodesByAnchor = new Map(
    cones.rows.map((r) => [r.anchor, r.coneNodes]),
  );

  const precisions: number[] = [];
  const recalls: number[] = [];
  let totalFocusOnly = 0;
  let totalConeOnly = 0;
  for (const anchor of mappable) {
    const truth = trueReachFrom(tfdArrows, anchor);
    const expectedConeNodes = coneNodesByAnchor.get(anchor);
    if (expectedConeNodes !== undefined && truth.size !== expectedConeNodes) {
      softFailures.push(
        `${context}: local reachability for ${anchor} (${truth.size}) != ` +
          `computeStrataConeMetrics coneNodes (${expectedConeNodes})`,
      );
    }
    const focus =
      variant === "productionDirected"
        ? getTerraformRelationshipFocus(elements, anchor, undefined, {
            direction: "dependencies",
            maxHops: Infinity,
          })
        : getTerraformRelationshipFocus(elements, anchor);
    const reached = new Set(focus.nodeDistance.keys());
    let matched = 0;
    for (const node of reached) {
      if (truth.has(node)) {
        matched += 1;
      } else {
        totalFocusOnly += 1;
      }
    }
    for (const node of truth) {
      if (!reached.has(node)) {
        totalConeOnly += 1;
      }
    }
    precisions.push(reached.size > 0 ? round4(matched / reached.size) : 0);
    recalls.push(truth.size > 0 ? round4(matched / truth.size) : 0);
  }

  return {
    mode:
      variant === "productionDirected"
        ? {
            call:
              "getTerraformRelationshipFocus(elements, anchor, undefined, " +
              '{ direction: "dependencies", maxHops: Infinity })',
            direction: "dependencies",
            maxHops: "all",
            note: "the REAL production call on the full unfiltered element array (W11 decision 9)",
          }
        : {
            call: "getTerraformRelationshipFocus(elements, anchor)",
            direction: "both",
            maxHops: 3,
            note: "shipped default — expected recall<1 (hop cap) and precision<1 (undirected pollution)",
          },
    anchorsRequested: anchors.length,
    anchorsMappable: mappable.length,
    unmappableAnchors: unmappable,
    aggregate: {
      meanPrecision: round4(mean(precisions)),
      meanRecall: round4(mean(recalls)),
      minPrecision: round4(Math.min(...precisions, 1)),
      minRecall: round4(Math.min(...recalls, 1)),
      perfectPrecisionShare: round4(
        precisions.length > 0
          ? precisions.filter((p) => p === 1).length / precisions.length
          : 0,
      ),
      perfectRecallShare: round4(
        recalls.length > 0
          ? recalls.filter((r) => r === 1).length / recalls.length
          : 0,
      ),
      totalFocusOnlyNodes: totalFocusOnly,
      totalConeOnlyNodes: totalConeOnly,
    },
  };
}

// ── SANITY ANCHOR (pre-registered record §7) ─────────────────────────────────
// No committed W10B/W11 report JSON artifacts exist (verified:
// docs/strata-baselines/ carries none; git history added only the .md
// reports), so the anchor cross-checks this battery's own deterministic P1/P2
// fields against the numbers RECORDED in docs/strata-view-w11-task-tracing.md.
// A mismatch fails the battery loudly (softFailures → hard assert).

const W11_DOC_ANCHORS: Record<
  "P1" | "P2",
  {
    anchorsMappable: number;
    mismatchMeanPrecision3dp: number;
    mismatchMeanRecall3dp: number;
    rtHat2dp: Record<string, { p50: number; p90: number }>;
  }
> = {
  P1: {
    anchorsMappable: 50,
    mismatchMeanPrecision3dp: 0.464,
    mismatchMeanRecall3dp: 0.682,
    rtHat2dp: {
      A_v2: { p50: 14.77, p90: 22.92 },
      I: { p50: 13.36, p90: 21.39 },
      I_RS: { p50: 14.21, p90: 24.89 },
    },
  },
  P2: {
    anchorsMappable: 36,
    mismatchMeanPrecision3dp: 0.483,
    mismatchMeanRecall3dp: 0.739,
    rtHat2dp: {
      A_v2: { p50: 11.5, p90: 19.32 },
      I: { p50: 12.58, p90: 21.78 },
      I_RS: { p50: 15.08, p90: 23.76 },
    },
  },
};
/** P1 paired rt̂ p50 (A_v2 vs I) CI, 2dp — W11 doc + gate register evidence. */
const W11_P1_PAIRED_RTHAT_P50 = { lo: -0.48, hi: -0.05 };

// ── determinism normalization (wall-clock keys only) ─────────────────────────

/** `timing` (full-detail block) nests EVERY wall-clock-derived field —
 * wallClockMs, budgetStatus (a wall-clock comparison), the timing split and
 * fired spans — so the run-twice determinism diff drops it wholesale. */
const TIMING_KEYS = new Set(["buildMs", "timing"]);

function stripTimings(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripTimings);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (TIMING_KEYS.has(k)) {
        continue;
      }
      out[k] = stripTimings(v);
    }
    return out;
  }
  return value;
}

// ── harness ──────────────────────────────────────────────────────────────────

const MUTATION_LABELS: readonly MutationLabel[] = [
  "addOneResource",
  "addOneEdge",
  "movedRename",
];

describe("W12 held-out transfer battery (report-emitting; REPORT-only cells; never asserts metrics)", () => {
  it(
    "P1 + P2 + P3 compact — {A_v2, I, I_RS} × transfer/churn/tracing cells + P1/P2 sanity anchor",
    async () => {
      const softFailures: string[] = [];
      const report: Record<string, unknown> = {
        meta: {
          reportOnly: true,
          seed: BOOTSTRAP_SEED,
          presets: PRESETS,
          arms: ARM_OPTIONS,
          preRegistration:
            "docs/strata-view-w12-heldout-scale.md — committed BEFORE this battery produced any statistic; every verdict below is its mechanical application",
          claimScoping:
            "P3 (staging-heldout-mesh) is SELF-AUTHORED (scripts/generate-heldout-plan.mjs, seed 20260704): " +
            "out-of-tuning-distribution transfer evidence, NOT held-out closure — R8-F4 stays formally open",
          frozenChurnThresholds: {
            source:
              "rcll-v2-spec-v3.1.md §13 A4 threshold freeze register (frozen 2026-07-05, W3) — REPORT-only reference values, never re-derived/loosened for P3",
            m1RelThreshold: M1_REL_THRESHOLD,
            m2FlipThreshold: M2_FLIP_THRESHOLD,
            nMin: N_MIN,
          },
          tracingEvidenceClass:
            "api-seam-validation — population matching, NOT task/impact-tracing evidence (W11 caveat)",
          sanityAnchorSource:
            "docs/strata-view-w11-task-tracing.md recorded numbers (NO committed W10B/W11 report JSON artifacts exist — verified in docs/strata-baselines/ + git history); anchor mismatch fails the battery",
          determinismProtocol:
            "run the suite twice (distinct Q12_REPORT_DIR) and deep-equal the two report JSONs after stripping " +
            `wall-clock keys (${[...TIMING_KEYS].join(
              ", ",
            )}); in-test, every paired cell is recomputed once and compared`,
          interpretationNote:
            "interpretation is BLOCKED-ON-Q7 (open W11 exit criterion) — transferAssessment fields are mechanical, not adjudicated",
        },
        // WP3: assigned after the transfer assessment below (key declared
        // here to keep its report position; null only if the block never ran).
        fullDetailBlock: null,
      };

      // ── build all arms once per preset + per-preset fragments ─────────────
      // F3 (codex diff-review): ORDERED orchestration — processPreset (the
      // former loop body) runs for P1/P2 first, the sanity anchor is
      // hard-asserted, and ONLY THEN is P3 built/evaluated and the report
      // written. No P3 computation happens before a green anchor.
      const armsByPreset = new Map<PresetLabel, Map<string, ArmData>>();
      /** Resolved sources retained for the WP3 full-detail block (loaded once
       * per preset; same seam for every consumer). */
      const sourcesByPreset = new Map<
        PresetLabel,
        TerraformImportPresetSources
      >();
      const transferCellsByPreset = new Map<
        PresetLabel,
        Record<string, TransferCell>
      >();
      /** F2: P3 layout throws — reported findings (record §5 degradation
       * clause ⇒ FAILED-TRANSFER), never aborts the report write. */
      const p3LayoutThrows: Array<{ stage: string; error: string }> = [];

      const processPreset = async (presetLabel: PresetLabel): Promise<void> => {
        const preset = PRESETS[presetLabel];
        const raw = getTerraformImportPresetSourcesFromDb(preset);
        expect(raw, `preset ${preset} exists`).toBeTruthy();
        const sources = resolveSourcesWithTfdComposition(
          raw! as TerraformImportPresetSources,
        );
        sourcesByPreset.set(presetLabel, sources);

        const arms = new Map<string, ArmData>();
        const armReports: Record<string, unknown> = {};
        for (const armLabel of ARM_LABELS) {
          let arm: ArmData;
          try {
            arm = await buildArm(sources, ARM_OPTIONS[armLabel]!);
          } catch (err) {
            if (presetLabel !== "P3") {
              // In-sample layout throw = harness breakage: stays HARD (F2).
              throw err;
            }
            // F2: a P3 layout throw is a REPORTED W12 finding (pre-registered
            // record §5 degradation clause ⇒ FAILED-TRANSFER), stamped into
            // the report — which is still written. Remaining P3 cells cannot
            // be computed without base arms, so P3 processing stops here.
            const error = String(err instanceof Error ? err.message : err);
            p3LayoutThrows.push({ stage: `base/${armLabel}`, error });
            report[presetLabel] = {
              preset,
              layoutFailure: {
                stage: `base/${armLabel}`,
                options: ARM_OPTIONS[armLabel],
                error,
              },
              note:
                "P3 base-layout THROW — reported per the pre-registered degradation clause " +
                "(record §5 ⇒ FAILED-TRANSFER), never patched/retuned; remaining P3 cells NOT computed",
            };
            return;
          }
          arms.set(armLabel, arm);
          armReports[armLabel] = {
            options: ARM_OPTIONS[armLabel],
            ...armSummary(arm),
          };
          if (arm.elements.length === 0) {
            softFailures.push(`${preset}/${armLabel}: scene EMPTY`);
          }
          // Slice-B emptiness: the metrics module models `sliceBEmpty` as a
          // legitimate scene property (single-provider scenes have no banded-
          // LCA edges). On the IN-SAMPLE presets (P1/P2, known non-empty from
          // W5/W10b) an empty slice B is a harness failure; on P3 it is a
          // REPORTED preset property — the extent cells then carry the frozen
          // VOID status (n=0 ⇒ voided), exactly per the pre-registered record
          // §4. Arm-inconsistency within a preset is always a failure.
          if (arm.nSliceB === 0 && presetLabel !== "P3") {
            softFailures.push(`${preset}/${armLabel}: slice-B EMPTY`);
          }
          if (arm.paths.sampled === 0) {
            softFailures.push(`${preset}/${armLabel}: path population EMPTY`);
          }
          if (
            STRATA_ARMS.has(armLabel) &&
            arm.rcllV2Degraded !== undefined &&
            arm.rcllV2Degraded !== false
          ) {
            softFailures.push(
              `${preset}/${armLabel}: rcllV2Degraded=${JSON.stringify(
                arm.rcllV2Degraded,
              )}`,
            );
          }
          if (STRATA_ARMS.has(armLabel)) {
            const st = arm.strataStructural as {
              nonAncestorOverlaps?: number;
              titleCollisions?: number;
              contiguityViolations?: number;
            } | null;
            if (
              st &&
              ((st.nonAncestorOverlaps ?? 0) > 0 ||
                (st.titleCollisions ?? 0) > 0 ||
                (st.contiguityViolations ?? 0) > 0)
            ) {
              softFailures.push(
                `${preset}/${armLabel}: R2 structural nonzero ${JSON.stringify(
                  st,
                )}`,
              );
            }
          }
        }
        armsByPreset.set(presetLabel, arms);

        // Slice-B consistency across arms (any mix of empty/non-empty within
        // one preset is a classification harness bug, empty-everywhere on P3
        // is a reported property — see the per-arm check above).
        const sliceBCounts = ARM_LABELS.map((l) => arms.get(l)!.nSliceB);
        const sliceBEmptyEverywhere = sliceBCounts.every((n) => n === 0);
        if (!sliceBEmptyEverywhere && sliceBCounts.some((n) => n === 0)) {
          softFailures.push(
            `${preset}: slice-B empty on SOME arms only (${JSON.stringify(
              sliceBCounts,
            )}) — inconsistent classification`,
          );
        }

        // ── transfer cells (paired CIs, frozen helpers verbatim) ────────────
        const cells: Record<string, TransferCell> = {};
        for (const [baseLabel, candLabel] of CELL_PAIRS) {
          const b = arms.get(baseLabel)!;
          const c = arms.get(candLabel)!;
          const cell: TransferCell = {
            extent: extentCell(b.sliceB, c.sliceB),
            paths: pathsCell(b.paths.rows, c.paths.rows),
          };
          const again: TransferCell = {
            extent: extentCell(b.sliceB, c.sliceB),
            paths: pathsCell(b.paths.rows, c.paths.rows),
          };
          if (JSON.stringify(cell) !== JSON.stringify(again)) {
            softFailures.push(
              `${preset}/${baseLabel}->${candLabel}: cell recompute NOT deterministic`,
            );
          }
          cells[`${baseLabel}__vs__${candLabel}`] = cell;
        }
        transferCellsByPreset.set(presetLabel, cells);

        // ── churn cells (A4 triple, all three mutations) ────────────────────
        expect(
          sources.planDotBundles.length,
          `${preset}: single plan/dot bundle (mutation-builder assumption)`,
        ).toBe(1);
        const bundle = sources.planDotBundles[0]!;
        if (
          tfdOverlayEdgeCount(bundle, sources.tfdTexts, sources.tfdLabels) === 0
        ) {
          softFailures.push(`${preset}: base tfd overlay resolves 0 edges`);
        }

        const mutations: Partial<Record<MutationLabel, MutationPayload>> = {};
        const mutationErrors: Partial<Record<MutationLabel, string>> = {};
        const builders: Record<
          MutationLabel,
          (s: TerraformImportPresetSources) => MutationPayload
        > = {
          addOneResource: buildAddResourceMutation,
          addOneEdge: buildAddEdgeMutation,
          movedRename: buildRenameMutation,
        };
        for (const label of MUTATION_LABELS) {
          try {
            const payload = builders[label](sources);
            if (
              tfdOverlayEdgeCount(
                payload.planDotBundles[0]!,
                payload.tfdTexts,
                sources.tfdLabels,
              ) === 0
            ) {
              throw new Error("mutated tfd overlay resolves 0 declared edges");
            }
            mutations[label] = payload;
          } catch (err) {
            // Pre-registered record §2: construction impossible ⇒ INCOMPLETE
            // with reason, never silently dropped.
            mutationErrors[label] = String(
              err instanceof Error ? err.message : err,
            );
          }
        }

        const churn: Record<string, unknown> = {};
        for (const armLabel of ARM_LABELS) {
          const armCell: Record<string, unknown> = {};
          const base = arms.get(armLabel)!;
          for (const mutLabel of MUTATION_LABELS) {
            const mutation = mutations[mutLabel];
            if (!mutation) {
              armCell[mutLabel] = {
                status: "INCOMPLETE",
                reason: mutationErrors[mutLabel] ?? "mutation not constructed",
              };
              continue;
            }
            let mutated: ArmData;
            try {
              mutated = await buildArmFrom(
                mutation.planDotBundles,
                mutation.tfdTexts,
                sources.tfdLabels,
                ARM_OPTIONS[armLabel]!,
              );
            } catch (err) {
              if (presetLabel !== "P3") {
                // In-sample layout throw = harness breakage: stays HARD (F2).
                throw err;
              }
              // F2: P3 mutated-layout throw — stamped in the cell + report
              // still written (record §5 degradation clause).
              const error = String(err instanceof Error ? err.message : err);
              p3LayoutThrows.push({
                stage: `churn/${armLabel}/${mutLabel}`,
                error,
              });
              armCell[mutLabel] = {
                status: "LAYOUT-THROW",
                error,
                note:
                  "P3 mutated-layout THROW — reported per the pre-registered degradation " +
                  "clause (record §5 ⇒ FAILED-TRANSFER), never patched/retuned",
              };
              continue;
            }
            if (mutated.elements.length === 0) {
              softFailures.push(
                `${preset}/${armLabel}/${mutLabel}: mutated scene EMPTY`,
              );
            }
            if (
              STRATA_ARMS.has(armLabel) &&
              mutated.rcllV2Degraded !== undefined &&
              mutated.rcllV2Degraded !== false
            ) {
              softFailures.push(
                `${preset}/${armLabel}/${mutLabel}: rcllV2Degraded=${JSON.stringify(
                  mutated.rcllV2Degraded,
                )}`,
              );
            }

            // Mutation-bite health checks (ChurnTriple conventions).
            if (mutLabel === "addOneResource") {
              const baseAddrs = collectPrimaryClusterAddresses(base.elements);
              const mutAddrs = collectPrimaryClusterAddresses(mutated.elements);
              if (mutAddrs.size !== baseAddrs.size + 1) {
                softFailures.push(
                  `${preset}/${armLabel}/${mutLabel}: HEALTH FAIL — primaryCluster count base=${baseAddrs.size} mutated=${mutAddrs.size}`,
                );
              }
              if (
                typeof mutation.newAddress !== "string" ||
                !mutAddrs.has(mutation.newAddress) ||
                baseAddrs.has(mutation.newAddress)
              ) {
                softFailures.push(
                  `${preset}/${armLabel}/${mutLabel}: HEALTH FAIL — new address not (only) in mutated cluster set`,
                );
              }
            } else if (mutLabel === "addOneEdge") {
              const baseArrows = diagnosePipelineScene(base.elements).dataflow
                .tfdArrowCount;
              const mutArrows = diagnosePipelineScene(mutated.elements).dataflow
                .tfdArrowCount;
              if (mutArrows !== baseArrows + 1) {
                softFailures.push(
                  `${preset}/${armLabel}/${mutLabel}: HEALTH FAIL — tfdArrowCount base=${baseArrows} mutated=${mutArrows}`,
                );
              }
            } else {
              const mutAddrs = collectPrimaryClusterAddresses(mutated.elements);
              if (
                typeof mutation.oldAddress !== "string" ||
                typeof mutation.newAddress !== "string" ||
                mutAddrs.has(mutation.oldAddress) ||
                !mutAddrs.has(mutation.newAddress)
              ) {
                softFailures.push(
                  `${preset}/${armLabel}/${mutLabel}: HEALTH FAIL — rename addresses not swapped in mutated cluster set`,
                );
              }
            }

            const renames =
              mutLabel === "movedRename" &&
              mutation.oldAddress &&
              mutation.newAddress
                ? { [mutation.oldAddress]: mutation.newAddress }
                : undefined;
            const metrics: ChurnMetrics = computeStrataChurnMetrics(
              base.elements,
              mutated.elements,
              renames ? { renames, nMin: N_MIN } : { nMin: N_MIN },
            );
            // F1 (codex diff-review): a churn cell below the frozen N_min is
            // NOT a harness failure — the shortfall is recorded IN THE CELL
            // (flagged prominently, never loosened) and flows to the
            // pre-registered block-level VOID via the uGatable clause below
            // (record §5: a deciding churn cell with |U| < N_min voids the
            // block). Hard failures stay reserved for harness breakage.
            armCell[mutLabel] = {
              status: "OK",
              ...(!metrics.U.gatable
                ? {
                    belowFrozenNMin:
                      `U.size=${metrics.U.size} < nMin=${metrics.U.nMin} — frozen v3.1 §12 ` +
                      "precondition unmet; recorded in-cell and classified via the " +
                      "pre-registered block-level VOID (record §5), never loosened, " +
                      "never a harness hard-failure (F1)",
                  }
                : {}),
              mutationNote: mutation.note,
              uSize: metrics.U.size,
              uGatable: metrics.U.gatable,
              m1Rel: metrics.m1Rel,
              m2Flip: metrics.m2Flip.value,
              m2FlipInversions: metrics.m2Flip.inversions,
              m2FlipComparedPairs: metrics.m2Flip.comparedPairs,
              m3Disp: metrics.m3Disp,
              m4Status: metrics.m4.status,
              m5Status: metrics.m5.status,
              // Frozen-threshold echoes — meaningful for strata arms; A_v2 is
              // the empirical anchor substrate (reported, not thresholded).
              thresholdsApplicable: STRATA_ARMS.has(armLabel),
              m1RelWithinFrozen: metrics.m1Rel <= M1_REL_THRESHOLD,
              m2FlipWithinFrozen: metrics.m2Flip.value <= M2_FLIP_THRESHOLD,
            };
          }
          churn[armLabel] = armCell;
        }

        // ── tracing cells (arm I; api-seam-validation evidence class) ───────
        const tracingArm = arms.get(TRACING_ARM)!;
        const tfdArrows = tfdArrowsOf(tracingArm.elements);
        const anchors = tracingArm.cones.rows.map((r) => r.anchor);
        const tracing = {
          evidenceClass: "api-seam-validation",
          note:
            "population matching (production traversal vs true declared-dependency reachability), " +
            "NOT task/impact-tracing evidence — W11 caveat; arm I scene",
          arm: TRACING_ARM,
          productionCallValidation: runTracingCell(
            tracingArm.elements,
            anchors,
            tfdArrows,
            tracingArm.cones,
            softFailures,
            `${preset}/${TRACING_ARM}/directed`,
            "productionDirected",
          ),
          taskMismatchShippedDefault: runTracingCell(
            tracingArm.elements,
            anchors,
            tfdArrows,
            tracingArm.cones,
            softFailures,
            `${preset}/${TRACING_ARM}/shippedBoth`,
            "shippedBoth",
          ),
        };

        report[presetLabel] = {
          preset,
          sliceB: {
            countsByArm: Object.fromEntries(
              ARM_LABELS.map((l) => [l, arms.get(l)!.nSliceB]),
            ),
            emptyEverywhere: sliceBEmptyEverywhere,
            note: sliceBEmptyEverywhere
              ? "slice B (banded-LCA / cross-band edges) is EMPTY on this preset — a preset property " +
                "(single-band scene), reported as a W12 finding; extent cells carry the frozen VOID status (n=0)"
              : "slice B non-empty",
          },
          arms: armReports,
          transferCells: cells,
          churn,
          churnMutations: Object.fromEntries(
            MUTATION_LABELS.map((label) => [
              label,
              mutations[label]
                ? { note: mutations[label]!.note }
                : {
                    status: "INCOMPLETE",
                    reason: mutationErrors[label] ?? "not constructed",
                  },
            ]),
          ),
          tracing,
        };
      };

      // In-sample presets FIRST — any throw here is harness breakage (hard).
      for (const presetLabel of ["P1", "P2"] as const) {
        await processPreset(presetLabel);
      }

      // ── SANITY ANCHOR (P1/P2 vs W11-doc recorded numbers) — asserted
      // BEFORE any P3 computation (F3) ──────────────────────────────────────
      const anchorFailures: string[] = [];
      for (const presetLabel of ["P1", "P2"] as const) {
        const anchor = W11_DOC_ANCHORS[presetLabel];
        const preset = PRESETS[presetLabel];
        const arms = armsByPreset.get(presetLabel)!;
        const fragment = report[presetLabel] as {
          tracing: {
            productionCallValidation: TracingCell;
            taskMismatchShippedDefault: TracingCell;
          };
        };
        const directed = fragment.tracing.productionCallValidation;
        const mismatch = fragment.tracing.taskMismatchShippedDefault;

        const fail = (msg: string) =>
          anchorFailures.push(`${preset}: SANITY ANCHOR FAILED — ${msg}`);

        if (directed.anchorsMappable !== anchor.anchorsMappable) {
          fail(
            `anchorsMappable ${directed.anchorsMappable} != ${anchor.anchorsMappable}`,
          );
        }
        // F4: the doc's "50/50 / 36/36" claim means requested == mappable with
        // ZERO unmappable anchors — a 51-requested/50-mappable population must
        // not pass. Assert the requested count and the empty unmappable list
        // on BOTH tracing cells (they share the anchor population).
        if (directed.anchorsRequested !== anchor.anchorsMappable) {
          fail(
            `anchorsRequested ${directed.anchorsRequested} != ${anchor.anchorsMappable}`,
          );
        }
        if (directed.unmappableAnchors.length !== 0) {
          fail(
            `unmappableAnchors not empty: ${JSON.stringify(
              directed.unmappableAnchors,
            )}`,
          );
        }
        if (
          mismatch.anchorsRequested !== anchor.anchorsMappable ||
          mismatch.anchorsMappable !== anchor.anchorsMappable ||
          mismatch.unmappableAnchors.length !== 0
        ) {
          fail(
            `mismatch-cell anchor population requested=${mismatch.anchorsRequested} ` +
              `mappable=${mismatch.anchorsMappable} unmappable=${JSON.stringify(
                mismatch.unmappableAnchors,
              )} != ${anchor.anchorsMappable}/${anchor.anchorsMappable}/[]`,
          );
        }
        if (
          directed.aggregate.meanPrecision !== 1 ||
          directed.aggregate.meanRecall !== 1 ||
          directed.aggregate.minPrecision !== 1 ||
          directed.aggregate.minRecall !== 1
        ) {
          fail(
            `directed precision/recall not 1.0/1.0 on every anchor: ${JSON.stringify(
              directed.aggregate,
            )}`,
          );
        }
        if (
          round3(mismatch.aggregate.meanPrecision) !==
          anchor.mismatchMeanPrecision3dp
        ) {
          fail(
            `mismatch meanPrecision ${mismatch.aggregate.meanPrecision} !~ ${anchor.mismatchMeanPrecision3dp}`,
          );
        }
        if (
          round3(mismatch.aggregate.meanRecall) !== anchor.mismatchMeanRecall3dp
        ) {
          fail(
            `mismatch meanRecall ${mismatch.aggregate.meanRecall} !~ ${anchor.mismatchMeanRecall3dp}`,
          );
        }
        for (const [armLabel, expected] of Object.entries(anchor.rtHat2dp)) {
          const arm = arms.get(armLabel)!;
          const p50 = round2(
            pathPercentile(arm.paths.rows, (r) => r.rtHat, 0.5),
          );
          const p90 = round2(
            pathPercentile(arm.paths.rows, (r) => r.rtHat, 0.9),
          );
          if (p50 !== expected.p50 || p90 !== expected.p90) {
            fail(
              `${armLabel} rtHat p50/p90 ${p50}/${p90} != ${expected.p50}/${expected.p90}`,
            );
          }
        }
      }
      {
        const p1Cells = transferCellsByPreset.get("P1")!;
        const ci = p1Cells.A_v2__vs__I!.paths.rtHatP50;
        if (
          round2(ci.lo) !== W11_P1_PAIRED_RTHAT_P50.lo ||
          round2(ci.hi) !== W11_P1_PAIRED_RTHAT_P50.hi
        ) {
          anchorFailures.push(
            `${PRESETS.P1}: SANITY ANCHOR FAILED — paired rtHat p50 CI ` +
              `[${round2(ci.lo)}, ${round2(ci.hi)}] != [${
                W11_P1_PAIRED_RTHAT_P50.lo
              }, ${W11_P1_PAIRED_RTHAT_P50.hi}]`,
          );
        }
      }
      const anchorGreen = anchorFailures.length === 0;
      report.sanityAnchor = {
        source: "docs/strata-view-w11-task-tracing.md (see meta)",
        anchors: W11_DOC_ANCHORS,
        pairedRtHatP50P1: W11_P1_PAIRED_RTHAT_P50,
        green: anchorGreen,
      };
      // Pre-registered §7 + F3: an anchor mismatch fails the battery LOUDLY,
      // and P3 is never built/read under a red anchor (in-sample harness
      // health, so no report is written either).
      expect(
        anchorFailures,
        `SANITY ANCHOR failures (P3 NOT built):\n${anchorFailures.join("\n")}`,
      ).toEqual([]);

      // ── P3 (out-of-tuning-distribution) — built only under a green anchor.
      // A P3 layout throw inside is captured (F2) and the report still
      // written; any other P3 throw stays hard (harness breakage).
      await processPreset("P3");

      // ── transfer assessment (mechanical application of the record §5/§6) ──
      const headlineVerdicts: Record<string, unknown> = {};
      let anyFailedTransfer = false;
      let anyVoidCell = false;
      let allSupport = true;
      const p3TransferCells = transferCellsByPreset.get("P3");
      for (const [baseLabel, candLabel] of CELL_PAIRS) {
        const pairKey = `${baseLabel}__vs__${candLabel}`;
        const perStat: Record<string, unknown> = {};
        for (const stat of HEADLINE_STATS) {
          if (!p3TransferCells) {
            // F2: P3 base-layout throw — headline cells not computable; the
            // block verdict is FAILED-TRANSFER via the degradation clause.
            allSupport = false;
            perStat[stat.key] = {
              classes: {
                P1: stat.pick(transferCellsByPreset.get("P1")![pairKey]!).class,
                P2: stat.pick(transferCellsByPreset.get("P2")![pairKey]!).class,
                P3: "NOT-EVALUATED",
              },
              verdict:
                "NOT-EVALUATED — P3 layout throw (record §5 degradation clause)",
            };
            continue;
          }
          const cls = Object.fromEntries(
            PRESET_LABELS.map((p) => [
              p,
              stat.pick(transferCellsByPreset.get(p)![pairKey]!).class,
            ]),
          ) as Record<PresetLabel, CiClass>;
          const verdict = transferCellVerdict(cls.P1, cls.P2, cls.P3);
          if (verdict === "FAILED-TRANSFER") {
            anyFailedTransfer = true;
          }
          if (verdict === "VOID") {
            anyVoidCell = true;
          }
          if (verdict !== "SUPPORT") {
            allSupport = false;
          }
          perStat[stat.key] = { classes: cls, verdict };
        }
        headlineVerdicts[pairKey] = perStat;
      }
      // Churn/structural clauses for the block verdict (P3 strata arms).
      const p3Churn = (report.P3 as { churn?: Record<string, unknown> }).churn;
      let p3ChurnAllWithin = true;
      let p3ChurnThresholdExceeded = false;
      let p3ChurnIncompleteOrShort = false;
      if (!p3Churn) {
        // P3 base-layout throw — churn cells not computable.
        p3ChurnAllWithin = false;
        p3ChurnIncompleteOrShort = true;
      }
      for (const armLabel of p3Churn ? STRATA_ARMS : []) {
        const armCell = p3Churn![armLabel] as Record<
          string,
          {
            status: string;
            uGatable?: boolean;
            m1RelWithinFrozen?: boolean;
            m2FlipWithinFrozen?: boolean;
          }
        >;
        for (const mutLabel of MUTATION_LABELS) {
          const cell = armCell[mutLabel]!;
          if (cell.status !== "OK" || cell.uGatable !== true) {
            p3ChurnIncompleteOrShort = true;
            p3ChurnAllWithin = false;
          } else if (
            cell.m1RelWithinFrozen !== true ||
            cell.m2FlipWithinFrozen !== true
          ) {
            p3ChurnThresholdExceeded = true;
            p3ChurnAllWithin = false;
          }
        }
      }
      const p3StructuralClean = !softFailures.some(
        (f) =>
          f.startsWith(PRESETS.P3) &&
          (f.includes("R2 structural nonzero") || f.includes("rcllV2Degraded")),
      );
      const blockVerdict =
        anyFailedTransfer ||
        p3ChurnThresholdExceeded ||
        !p3StructuralClean ||
        p3LayoutThrows.length > 0
          ? "FAILED-TRANSFER"
          : anyVoidCell || p3ChurnIncompleteOrShort
          ? "VOID"
          : allSupport && p3ChurnAllWithin
          ? "SUPPORT"
          : "INCONCLUSIVE";
      report.transferAssessment = {
        note:
          "MECHANICAL application of the pre-registered record " +
          "(docs/strata-view-w12-heldout-scale.md §4-§6) — adjudication stays with the owner (WP4)",
        headlineVerdicts,
        p3Churn: {
          allWithinFrozenThresholds: p3ChurnAllWithin,
          thresholdExceeded: p3ChurnThresholdExceeded,
          incompleteOrBelowNMin: p3ChurnIncompleteOrShort,
        },
        p3StructuralClean,
        // F2: P3 layout throws (base or mutated) — each is a reported W12
        // finding feeding the FAILED-TRANSFER degradation clause.
        p3LayoutThrows,
        blockVerdict,
      };

      // ── FULL-DETAIL SCALE BLOCK (WP3) — additive; single seam; frozen void
      // statuses verbatim; TIMEOUT/INCOMPLETE + LAYOUT-THROW stamping; the
      // matrix is NEVER reshaped (every preset × arm × pair key is present,
      // possibly as a stamped non-result) ───────────────────────────────────
      const fullDetailBlock: Record<string, unknown> = {
        meta: {
          arms: FULL_DETAIL_ARM_OPTIONS,
          armProvenance:
            "option objects copied VERBATIM from terraformPipelineStrataExtentGate.test.ts " +
            "ARM_OPTIONS (F_v2_full_ancillary / H2 / I2 / J2, L110-147); every arm — baseline " +
            "included — built through the SAME getTerraformImportPresetSourcesFromDb → " +
            "resolveSourcesWithTfdComposition → layoutTerraformViaWorkers seam (plan D4; no buildV2)",
          presets: {
            headline: ["P1", "P2"],
            stretch: ["P3"],
          },
          contentParityCaveat: FULL_DETAIL_CONTENT_PARITY_CAVEAT,
          voidExpectation:
            "extent/rt̂ statuses are taken VERBATIM from the frozen pairedBootstrapCi result " +
            "(voided/status/nUnmatched) — expected to often VOID at full detail (W4 precedent); " +
            "that is the honest outcome, not a failure",
          softBudget: {
            budgetMs: FULL_DETAIL_CELL_BUDGET_MS,
            derivation:
              "WP1 smoke wall-clocks (docs/strata-baselines/q12/P3_DISTINCTNESS_PROFILE.json " +
              "p3Smokes: F_v2_full 205.3ms / I2_full 171.07ms on P3) × ~290 headroom ≈ 60s; " +
              "SOFT — the in-process build cannot be aborted, an overrun is stamped " +
              "TIMEOUT/INCOMPLETE after the fact and the cell stays in the matrix",
          },
          timingSplit: {
            partitionFormula: TIMING_PARTITION_FORMULA,
            seamNote:
              "verified on this branch: vitest has no Worker global and pipeline/strata layout " +
              "modes take runSequential inside layoutTerraformViaWorkers, so layout runs " +
              "IN-PROCESS and terraformImportProfiler is reachable through the worker seam; " +
              "per-cell fired span names are recorded in each arm's timing.timingSplit " +
              "(pipeline.prep fires only on the rcll variant — expected 0 for v2/strata arms)",
            noNewSpans: true,
          },
          determinismNote:
            "the per-arm `timing` object (wallClockMs, budgetStatus, split, fired spans) is " +
            "wall-clock-derived and stripped by the run-twice normalization alongside buildMs",
        },
      };
      for (const presetLabel of FULL_DETAIL_PRESETS) {
        const preset = PRESETS[presetLabel];
        const sources = sourcesByPreset.get(presetLabel);
        if (!sources) {
          // Unreachable in practice (sources resolve before any build), kept
          // so a missing preset is a stamped cell, never a reshaped matrix.
          fullDetailBlock[presetLabel] = {
            preset,
            status: "INCOMPLETE",
            reason: "preset sources unavailable (transfer-block load failed)",
          };
          continue;
        }
        const built = new Map<string, FullDetailArmData>();
        const armReports: Record<string, unknown> = {};
        for (const armLabel of FULL_DETAIL_ARM_LABELS) {
          try {
            const arm = await buildFullDetailArm(
              sources,
              FULL_DETAIL_ARM_OPTIONS[armLabel]!,
            );
            built.set(armLabel, arm);
            armReports[armLabel] = {
              status:
                arm.timing.budgetStatus === "OK" ? "OK" : "TIMEOUT/INCOMPLETE",
              options: FULL_DETAIL_ARM_OPTIONS[armLabel],
              ...armSummary(arm),
              nAllEdges: arm.allEdges.size,
              timing: arm.timing,
            };
          } catch (err) {
            // Full-detail path throw (ANY preset) — stamped, never reshaped;
            // scale-block breakage is itself the finding under measure here.
            armReports[armLabel] = {
              status: "LAYOUT-THROW",
              options: FULL_DETAIL_ARM_OPTIONS[armLabel],
              error: String(err instanceof Error ? err.message : err),
            };
          }
        }
        const cells: Record<string, unknown> = {};
        const baseArm = built.get(FULL_DETAIL_BASELINE);
        for (const candLabel of FULL_DETAIL_CANDIDATES) {
          const pairKey = `${FULL_DETAIL_BASELINE}__vs__${candLabel}`;
          const candArm = built.get(candLabel);
          if (!baseArm || !candArm) {
            cells[pairKey] = {
              status: "NOT-EVALUATED",
              reason: `LAYOUT-THROW on ${
                !baseArm ? FULL_DETAIL_BASELINE : candLabel
              } — paired cells not computable; matrix key retained (never reshaped)`,
              contentParityCaveat: FULL_DETAIL_CONTENT_PARITY_CAVEAT,
            };
            continue;
          }
          const cell: TransferCell = {
            extent: extentCell(baseArm.sliceB, candArm.sliceB),
            paths: pathsCell(baseArm.paths.rows, candArm.paths.rows),
          };
          const again: TransferCell = {
            extent: extentCell(baseArm.sliceB, candArm.sliceB),
            paths: pathsCell(baseArm.paths.rows, candArm.paths.rows),
          };
          if (JSON.stringify(cell) !== JSON.stringify(again)) {
            softFailures.push(
              `${preset}/fullDetail/${pairKey}: cell recompute NOT deterministic`,
            );
          }
          cells[pairKey] = {
            status: "OK",
            contentParityCaveat: FULL_DETAIL_CONTENT_PARITY_CAVEAT,
            extent: cell.extent,
            paths: cell.paths,
            sliceClassificationAsymmetry: sliceAsymmetryDiagnostic(
              baseArm,
              candArm,
            ),
          };
        }
        fullDetailBlock[presetLabel] = {
          preset,
          arms: armReports,
          cells,
        };
      }
      report.fullDetailBlock = fullDetailBlock;

      // ── write report ──────────────────────────────────────────────────────
      const json = JSON.stringify({ ...report, softFailures }, null, 2);
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(`${REPORT_DIR}/W12_HELDOUT_SCALE_BATTERY.json`, json);
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        `W12_HELDOUT_SCALE_BATTERY.json written to ${REPORT_DIR} (${json.length} bytes)`,
      );
      // Normalized copy for the external run-twice diff (determinism protocol
      // §8): a second suite run's *.normalized.json must byte-equal this one.
      writeFileSync(
        `${REPORT_DIR}/W12_HELDOUT_SCALE_BATTERY.normalized.json`,
        JSON.stringify(stripTimings(JSON.parse(json)), null, 2),
      );

      expect(
        softFailures,
        `harness health failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
