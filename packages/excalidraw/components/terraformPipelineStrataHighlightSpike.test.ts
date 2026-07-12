/**
 * W6 highlight-spike battery harness (spec v3.2 §8 task-evidence milestone;
 * round-8 "v2+highlight arm" recommendation). Report-emitting, W5-style: this
 * file owns NO layout behavior and NEVER asserts gate outcomes.
 *
 * Question: does a rendered path highlight substitute for layout-level path
 * readability — is "cheap layout + interaction" (v2+HL) at least at parity
 * with the expensive layout (unaided strata-I)?
 *
 * Model (rtHatAttenuated): the Ware cr/con terms price the VISUAL SEARCH of
 * unaided tracing; a highlight substitutes for that search, scaled by
 * attenuation alpha ∈ {0, 0.25, 0.5, 0.75, 1}. The alpha=0 bound is
 * VACUOUS-FOR-LAYOUT (hops+br are layout-invariant, paired deltas are
 * identically 0) and is reported only as a self-check. The decision input is
 * the CROSSOVER SWEEP — the largest alpha at which v2+HL is still at
 * parity-or-better vs unaided strata-I — plus residual geometry a highlight
 * does NOT erase: tll, slice-B extent, and downstream-cone-internal
 * crossings (impact tracing is one-to-many; highlighting the full cone can
 * re-create highlighted clutter).
 *
 * Cells are REPORT-only per v3.2 §8 (model-based sensitivity analysis, not
 * new empirical data — no PASS/FAIL gate cell may be created from this).
 *
 * Run:
 *   Q6_REPORT_DIR=/tmp yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataHighlightSpike.test.ts \
 *     --exclude "**\/.claude/**"
 * Writes W6_HIGHLIGHT_SPIKE_REPORT.json to $Q6_REPORT_DIR (default tmpdir).
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
import {
  computeSliceMetrics,
  type SliceEdgeRow,
} from "./terraformPipelineSliceMetrics";
import {
  computeStrataConeMetrics,
  computeStrataPathMetrics,
  rtHatAttenuated,
  type ConeMetricsRow,
  type PathMetricsRow,
  type StrataConeMetrics,
  type StrataPathMetrics,
} from "./terraformPipelineStrataPathMetrics";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const PRESET_1 = "staging-extended-localstack-v2";
const PRESET_2 = "staging-localstack";
const REPORT_DIR = process.env.Q6_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8;

const ALPHAS = [0, 0.25, 0.5, 0.75, 1] as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ── arms (same option bundles as the W5 harness) ─────────────────────────────

const ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  A_v2_baseline: {
    layoutMode: "pipeline",
    pipelineLayoutVariant: "v2",
    pipelineCompact: true,
  },
  I_strata_k4_a7: {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
  },
};

// ── per-arm build ────────────────────────────────────────────────────────────

type ArmData = {
  sliceB: Map<string, number>;
  nSliceB: number;
  paths: StrataPathMetrics;
  cones: StrataConeMetrics;
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

function percentile<T>(
  rows: readonly T[],
  pick: (r: T) => number,
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
): Promise<ArmData> {
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
  const sliceB = sliceBKeyed(computeSliceMetrics(elements).perEdge);
  return {
    sliceB,
    nSliceB: sliceB.size,
    paths: computeStrataPathMetrics(elements),
    cones: computeStrataConeMetrics(elements),
    elementCount: elements.filter((e) => !e.isDeleted).length,
    rcllV2Degraded: meta.rcllV2Degraded,
  };
}

// ── cells ────────────────────────────────────────────────────────────────────

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
    /** Δ = candidate − baseline; candidate strictly better ⇒ hi < 0. */
    ciExcludesZeroImproving: !ci.voided && ci.hi < 0,
    /** Parity-or-better: CI not entirely on the worse side. */
    parityOrBetter: !ci.voided && ci.lo <= 0,
    gateEligible: statisticGateEligible(
      ci.statistic as Exclude<BootstrapStatistic, never>,
      ci.n,
    ),
  };
}

function pairedCi(
  baseline: ReadonlyMap<string, number>,
  candidate: ReadonlyMap<string, number>,
  statistic: BootstrapStatistic,
) {
  return ciView(pairedBootstrapCi({ baseline, candidate }, { statistic }));
}

const rtMapOf = (
  rows: readonly PathMetricsRow[],
  alpha: number,
): Map<string, number> => {
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(r.pathKey, round4(rtHatAttenuated(r, alpha)));
  }
  return m;
};

const pickMapOf = <T extends { [k: string]: unknown }>(
  rows: readonly T[],
  key: (r: T) => string,
  pick: (r: T) => number,
): Map<string, number> => {
  const m = new Map<string, number>();
  for (const r of rows) {
    m.set(key(r), pick(r));
  }
  return m;
};

// ── harness ──────────────────────────────────────────────────────────────────

describe("W6 highlight-spike battery (report-emitting; REPORT-only cells; never asserts gates)", () => {
  it(
    "P1 + P2 compact — crossover sweep + residual geometry (v2+HL vs unaided strata-I)",
    async () => {
      const softFailures: string[] = [];
      const report: Record<string, unknown> = {
        methodology:
          "W6 (v3.2 §8): rtHatAttenuated crossover sweep over alpha ∈ " +
          `{${ALPHAS.join(", ")}} — Δ = v2+HL(alpha) − unaided strata-I, ` +
          "paired by pathKey, CI ON p50/p90; symmetric cell strata-I+HL(alpha) " +
          "vs unaided strata-I; residual geometry (tll, slice-B extent, " +
          "downstream-cone-internal crossings paired by anchor). alpha=0 is " +
          "VACUOUS-FOR-LAYOUT and reported only as a self-check. Model-based " +
          "sensitivity analysis — REPORT-only, no PASS/FAIL cells.",
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

        const v2 = await buildArm(sources, ARM_OPTIONS.A_v2_baseline!);
        const strata = await buildArm(sources, ARM_OPTIONS.I_strata_k4_a7!);
        for (const [label, arm] of [
          ["A_v2_baseline", v2],
          ["I_strata_k4_a7", strata],
        ] as const) {
          if (arm.paths.sampled === 0) {
            softFailures.push(`${preset}/${label}: path population EMPTY`);
          }
          if (arm.cones.sampled === 0) {
            softFailures.push(`${preset}/${label}: cone population EMPTY`);
          }
          if (
            label !== "A_v2_baseline" &&
            arm.rcllV2Degraded !== undefined &&
            arm.rcllV2Degraded !== false
          ) {
            softFailures.push(
              `${preset}/${label}: rcllV2Degraded=${JSON.stringify(
                arm.rcllV2Degraded,
              )}`,
            );
          }
        }

        const strataUnaided = rtMapOf(strata.paths.rows, 1);

        // (a) crossover sweep: v2+HL(alpha) vs unaided strata-I.
        const sweep: Record<string, unknown> = {};
        for (const alpha of ALPHAS) {
          sweep[`alpha_${alpha}`] = {
            p50: pairedCi(strataUnaided, rtMapOf(v2.paths.rows, alpha), "p50"),
            p90: pairedCi(strataUnaided, rtMapOf(v2.paths.rows, alpha), "p90"),
          };
        }
        const maxAlphaParityOrBetter = [...ALPHAS]
          .reverse()
          .find(
            (alpha) =>
              (
                (sweep[`alpha_${alpha}`] as { p50: { parityOrBetter: boolean } })
                  .p50
              ).parityOrBetter,
          );

        // (b) symmetric cell: strata-I+HL(alpha) vs unaided strata-I.
        const symmetric: Record<string, unknown> = {};
        for (const alpha of ALPHAS) {
          symmetric[`alpha_${alpha}`] = {
            p50: pairedCi(
              strataUnaided,
              rtMapOf(strata.paths.rows, alpha),
              "p50",
            ),
            p90: pairedCi(
              strataUnaided,
              rtMapOf(strata.paths.rows, alpha),
              "p90",
            ),
          };
        }

        // (d) alpha=0 self-check: paired Δ across ARMS at alpha=0 must be ≡ 0
        // (hops+br are layout-invariant) — VACUOUS-FOR-LAYOUT bound.
        const v2Zero = rtMapOf(v2.paths.rows, 0);
        const strataZero = rtMapOf(strata.paths.rows, 0);
        let maxAbsZeroDelta = 0;
        let zeroPairs = 0;
        for (const [key, b] of strataZero) {
          const c = v2Zero.get(key);
          if (c !== undefined) {
            zeroPairs += 1;
            maxAbsZeroDelta = Math.max(maxAbsZeroDelta, Math.abs(c - b));
          }
        }
        if (maxAbsZeroDelta > 1e-9) {
          softFailures.push(
            `${preset}: alpha=0 self-check violated (maxAbsDelta=${maxAbsZeroDelta})`,
          );
        }

        // (c) residual geometry a highlight does not erase. Δ = strata − v2
        // (v2 baseline, matching W5's direction): Δ > 0 ⇒ strata worse,
        // i.e. v2+HL better on that residual.
        const tllOf = (rows: readonly PathMetricsRow[]) =>
          pickMapOf(rows, (r) => r.pathKey, (r) => r.tll);
        const coneOf = (rows: readonly ConeMetricsRow[]) =>
          pickMapOf(rows, (r) => r.anchor, (r) => r.coneCrossings);
        const residual = {
          tll: {
            p50: pairedCi(tllOf(v2.paths.rows), tllOf(strata.paths.rows), "p50"),
            p90: pairedCi(tllOf(v2.paths.rows), tllOf(strata.paths.rows), "p90"),
          },
          extentSliceB: {
            p50: pairedCi(v2.sliceB, strata.sliceB, "p50"),
            p90: pairedCi(v2.sliceB, strata.sliceB, "p90"),
          },
          coneCrossings: {
            p50: pairedCi(coneOf(v2.cones.rows), coneOf(strata.cones.rows), "p50"),
            p90: pairedCi(coneOf(v2.cones.rows), coneOf(strata.cones.rows), "p90"),
          },
        };

        const armView = (arm: ArmData) => ({
          elementCount: arm.elementCount,
          nSliceB: arm.nSliceB,
          rcllV2Degraded: arm.rcllV2Degraded ?? null,
          paths: {
            populationTotal: arm.paths.populationTotal,
            sampled: arm.paths.sampled,
            edgeCoverage: arm.paths.edgeCoverage,
            unresolvedPathCount: arm.paths.unresolvedPathCount,
            tllP50: round2(percentile(arm.paths.rows, (r) => r.tll, 0.5)),
            tllP90: round2(percentile(arm.paths.rows, (r) => r.tll, 0.9)),
          },
          cones: {
            anchorsEligible: arm.cones.anchorsEligible,
            sampled: arm.cones.sampled,
            coneNodesP50: percentile(arm.cones.rows, (r) => r.coneNodes, 0.5),
            coneEdgesP50: percentile(arm.cones.rows, (r) => r.coneEdges, 0.5),
            coneArrowsP50: percentile(arm.cones.rows, (r) => r.coneArrows, 0.5),
            coneCrossingsP50: percentile(
              arm.cones.rows,
              (r) => r.coneCrossings,
              0.5,
            ),
            coneCrossingsP90: percentile(
              arm.cones.rows,
              (r) => r.coneCrossings,
              0.9,
            ),
            coneCrossingsMax: percentile(
              arm.cones.rows,
              (r) => r.coneCrossings,
              1,
            ),
          },
        });

        const presetReport = {
          preset,
          arms: {
            A_v2_baseline: armView(v2),
            I_strata_k4_a7: armView(strata),
          },
          crossoverSweep_v2HL_vs_strataI_unaided: sweep,
          maxAlphaParityOrBetter: maxAlphaParityOrBetter ?? null,
          symmetric_strataIHL_vs_strataI_unaided: symmetric,
          alphaZeroSelfCheck: {
            label: "VACUOUS-FOR-LAYOUT",
            pairs: zeroPairs,
            maxAbsPairedDelta: maxAbsZeroDelta,
          },
          residualGeometry_strataI_minus_v2: residual,
        };

        // determinism: recompute the sweep + residual — must be byte-identical.
        const again = {
          sweep: Object.fromEntries(
            ALPHAS.map((alpha) => [
              `alpha_${alpha}`,
              {
                p50: pairedCi(
                  strataUnaided,
                  rtMapOf(v2.paths.rows, alpha),
                  "p50",
                ),
                p90: pairedCi(
                  strataUnaided,
                  rtMapOf(v2.paths.rows, alpha),
                  "p90",
                ),
              },
            ]),
          ),
          residual: {
            coneCrossingsP90: pairedCi(
              coneOf(v2.cones.rows),
              coneOf(strata.cones.rows),
              "p90",
            ),
          },
        };
        if (
          JSON.stringify(again.sweep) !== JSON.stringify(sweep) ||
          JSON.stringify(again.residual.coneCrossingsP90) !==
            JSON.stringify(residual.coneCrossings.p90)
        ) {
          softFailures.push(`${preset}: recompute NOT deterministic`);
        }

        report[presetLabel] = presetReport;
      }

      const json = JSON.stringify({ ...report, softFailures }, null, 2);
      writeFileSync(`${REPORT_DIR}/W6_HIGHLIGHT_SPIKE_REPORT.json`, json);
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        `W6_HIGHLIGHT_SPIKE_REPORT.json written to ${REPORT_DIR} (${json.length} bytes)`,
      );

      expect(
        softFailures,
        `harness health failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
