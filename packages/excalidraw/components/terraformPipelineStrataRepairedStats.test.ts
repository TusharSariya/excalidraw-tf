/**
 * W5 repaired-statistics battery harness (v3.2 gate-family proposal §3–§4;
 * round-8 R8-F1 follow-up). Report-emitting, Q2-style: this file owns NO
 * layout behavior and NEVER asserts gate outcomes — it re-runs the W3/W4
 * comparison cells with the statistic-repaired bootstrap (CI ON p50 / ON p90,
 * not the legacy mean) and produces the FIRST M-RT (Ware path-cost) numbers
 * via terraformPipelineStrataPathMetrics.
 *
 * Cells: P1/P2 × compact × { A_v2_baseline vs G_strata_k0 / H_strata_k4 /
 * I_strata_k4_a7 / J_strata_k4_a7_rs }. Full mode is deliberately SKIPPED:
 * W3 established the full-mode primary extent pairing voids on
 * slice-classification asymmetry, and full-mode ancillary extraction changes
 * the TFD digraph (satellite appearances), so the path population would not
 * pair cleanly either — a full-mode path battery needs its own design.
 *
 * Per cell:
 *  1. slice-B extent paired CI with statistic "p50" and "p90" (each
 *     bootstrapped ON that statistic) + the legacy mean CI (labelled) +
 *     v3.2 floors via statisticGateEligible.
 *  2. path metrics paired CIs (rtHat p50+p90, con p90, cr p90, tll p50).
 *  3. per-arm scene scalars: global crossings + crossingAngles (sharpShare…).
 *
 * Run:
 *   Q2_REPORT_DIR=/tmp yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataRepairedStats.test.ts \
 *     --exclude "**\/.claude/**"
 * Writes W5_REPAIRED_STATS_REPORT.json to $Q2_REPORT_DIR (default tmpdir).
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import {
  canonicalEdgeKey,
  pairedBootstrapCi,
  statisticGateEligible,
  type BootstrapCiResult,
  type BootstrapStatistic,
} from "./terraformPipelineBootstrapCi";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import {
  computeSliceMetrics,
  type SliceEdgeRow,
} from "./terraformPipelineSliceMetrics";
import {
  computeStrataPathMetrics,
  pairedPathMetricsCi,
  type PathMetricsRow,
  type StrataPathMetrics,
} from "./terraformPipelineStrataPathMetrics";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const PRESET_1 = "staging-extended-localstack-v2";
const PRESET_2 = "staging-localstack";
const REPORT_DIR = process.env.Q2_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ── arms (same option bundles as the extent-gate / Q2 harnesses) ─────────────

const ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  A_v2_baseline: {
    layoutMode: "pipeline",
    pipelineLayoutVariant: "v2",
    pipelineCompact: true,
  },
  /** The SHIPPING default arm — what `view=strata` gives users today. */
  G_strata_k0: { layoutMode: "strata", pipelineCompact: true },
  H_strata_k4: { layoutMode: "strata", pipelineCompact: true, strataSweeps: 4 },
  I_strata_k4_a7: {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
  },
  J_strata_k4_a7_rs: {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
    strataRankSeparate: true,
  },
};

const CANDIDATE_ARMS = [
  "G_strata_k0",
  "H_strata_k4",
  "I_strata_k4_a7",
  "J_strata_k4_a7_rs",
] as const;

// ── per-arm build ────────────────────────────────────────────────────────────

type ArmData = {
  sliceB: Map<string, number>;
  nSliceB: number;
  paths: StrataPathMetrics;
  crossings: number;
  crossingAngles: {
    nCross: number;
    sharpShare: number;
    p10Deg: number;
    minDeg: number;
  };
  elementCount: number;
  rcllV2Degraded: unknown;
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

/** Nearest-rank percentile over path rows for the per-arm absolute table. */
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

async function buildArm(
  sources: TerraformImportPresetSources,
  options: Record<string, unknown>,
): Promise<{ data: ArmData; pathRows: PathMetricsRow[] }> {
  clearTerraformImportPrepCache();
  const body = await layoutTerraformViaWorkers(
    {
      planDotBundles: sources.planDotBundles,
      states: [],
      stateLabels: [],
      tfdTexts: [...sources.tfdTexts],
      tfdLabels: sources.tfdLabels,
    },
    { semanticLayout: false, ...options },
  );
  const elements = (body.elements ?? []) as ExcalidrawElement[];
  const meta = (body.meta ?? {}) as Record<string, unknown>;
  const slices = computeSliceMetrics(elements);
  const sliceB = sliceBKeyed(slices.perEdge);
  const paths = computeStrataPathMetrics(elements);
  const diag = diagnosePipelineScene(elements);
  return {
    data: {
      sliceB,
      nSliceB: sliceB.size,
      paths,
      crossings: diag.dataflow.crossings,
      crossingAngles: {
        nCross: diag.crossingAngles.nCross,
        sharpShare: round4(diag.crossingAngles.sharpShare),
        p10Deg: round2(diag.crossingAngles.p10Deg),
        minDeg: round2(diag.crossingAngles.minDeg),
      },
      elementCount: elements.filter((e) => !e.isDeleted).length,
      rcllV2Degraded: meta.rcllV2Degraded,
    },
    pathRows: paths.rows,
  };
}

// ── cell computation ─────────────────────────────────────────────────────────

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
    /** Improvement direction: metric decrease ⇒ CI hi < 0. */
    ciExcludesZeroImproving: !ci.voided && ci.hi < 0,
    gateEligible: statisticGateEligible(
      ci.statistic as Exclude<BootstrapStatistic, never>,
      ci.n,
    ),
  };
}

function extentCell(
  base: ReadonlyMap<string, number>,
  cand: ReadonlyMap<string, number>,
) {
  const run = (statistic: BootstrapStatistic) =>
    ciView(pairedBootstrapCi({ baseline: base, candidate: cand }, { statistic }));
  return {
    p50: run("p50"),
    p90: run("p90"),
    meanLegacy: run("mean"),
  };
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

function armSummary(data: ArmData, rows: readonly PathMetricsRow[]) {
  return {
    elementCount: data.elementCount,
    nSliceB: data.nSliceB,
    crossings: data.crossings,
    crossingAngles: data.crossingAngles,
    rcllV2Degraded: data.rcllV2Degraded ?? null,
    paths: {
      populationTotal: data.paths.populationTotal,
      sampled: data.paths.sampled,
      hopHistogram: data.paths.hopHistogram,
      edgeCoverage: data.paths.edgeCoverage,
      unresolvedPathCount: data.paths.unresolvedPathCount,
      rtHatP50: round2(pathPercentile(rows, (r) => r.rtHat, 0.5)),
      rtHatP90: round2(pathPercentile(rows, (r) => r.rtHat, 0.9)),
      conP50: round2(pathPercentile(rows, (r) => r.con, 0.5)),
      conP90: round2(pathPercentile(rows, (r) => r.con, 0.9)),
      crP50: pathPercentile(rows, (r) => r.cr, 0.5),
      crP90: pathPercentile(rows, (r) => r.cr, 0.9),
      tllP50: round2(pathPercentile(rows, (r) => r.tll, 0.5)),
    },
  };
}

// ── harness ──────────────────────────────────────────────────────────────────

describe("W5 repaired-statistics battery (report-emitting; never asserts gates)", () => {
  it(
    "P1 + P2 compact — repaired extent CIs + first M-RT path numbers",
    async () => {
      const softFailures: string[] = [];
      const report: Record<string, unknown> = {
        methodology:
          "v3.2 minimal slice: pairedBootstrapCi ON p50/p90 (R8-F1 repaired), " +
          "first Ware M-RT path battery (terraformPipelineStrataPathMetrics), " +
          "crossing-angle scene scalars. Full mode skipped (slice + digraph " +
          "pairing asymmetry — see header).",
      };

      for (const [presetLabel, preset] of [
        ["P1", PRESET_1],
        ["P2", PRESET_2],
      ] as const) {
        const raw = getTerraformImportPresetSourcesFromDb(preset);
        expect(raw, `preset ${preset} exists`).toBeTruthy();
        const sources = resolveSourcesWithTfdComposition(
          raw! as TerraformImportPresetSources,
        );

        const armData = new Map<string, ArmData>();
        const armRows = new Map<string, PathMetricsRow[]>();
        const arms: Record<string, unknown> = {};
        for (const armLabel of Object.keys(ARM_OPTIONS)) {
          const { data, pathRows } = await buildArm(
            sources,
            ARM_OPTIONS[armLabel]!,
          );
          armData.set(armLabel, data);
          armRows.set(armLabel, pathRows);
          arms[armLabel] = armSummary(data, pathRows);
          if (data.nSliceB === 0) {
            softFailures.push(`${preset}/${armLabel}: slice-B EMPTY`);
          }
          if (data.paths.sampled === 0) {
            softFailures.push(`${preset}/${armLabel}: path population EMPTY`);
          }
          if (
            armLabel !== "A_v2_baseline" &&
            data.rcllV2Degraded !== undefined &&
            data.rcllV2Degraded !== false
          ) {
            softFailures.push(
              `${preset}/${armLabel}: rcllV2Degraded=${JSON.stringify(
                data.rcllV2Degraded,
              )}`,
            );
          }
        }

        const base = armData.get("A_v2_baseline")!;
        const baseRows = armRows.get("A_v2_baseline")!;
        const cells: Record<string, unknown> = {};
        for (const cand of CANDIDATE_ARMS) {
          const c = armData.get(cand)!;
          const cRows = armRows.get(cand)!;
          const cell = {
            extent: extentCell(base.sliceB, c.sliceB),
            paths: pathsCell(baseRows, cRows),
          };
          // determinism: recompute must be byte-identical (pinned bootstrap).
          const again = {
            extent: extentCell(base.sliceB, c.sliceB),
            paths: pathsCell(baseRows, cRows),
          };
          if (JSON.stringify(cell) !== JSON.stringify(again)) {
            softFailures.push(
              `${preset}/${cand}: cell recompute NOT deterministic`,
            );
          }
          cells[`A_v2_baseline__vs__${cand}`] = cell;
        }

        report[presetLabel] = { preset, arms, cells };
      }

      const json = JSON.stringify({ ...report, softFailures }, null, 2);
      writeFileSync(`${REPORT_DIR}/W5_REPAIRED_STATS_REPORT.json`, json);
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        `W5_REPAIRED_STATS_REPORT.json written to ${REPORT_DIR} (${json.length} bytes)`,
      );

      expect(
        softFailures,
        `harness health failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
