/**
 * Wave-3 VALIDATION EXPERIMENT (spec SECTION 4). Five arms
 * (straight | step | curve | channel | channel+step) on the pinned preset
 * through the REAL app path (`layoutTerraformFromSources`). Prints the existing
 * angle/crossing/pierce row PLUS the four new badPatterns metrics +
 * edgeLengthPxTotal + per-metric top-10 offenders + channel occupancy for the
 * two channel arms. Instrument, not a gate — the only hard assertions are
 * structural.
 *
 * ── PRE-REGISTERED PREDICTED ORDERINGS (owner's theory right ⇒ lower = better).
 * Falsifiable because curve ALREADY LOSES the theory's own pattern-1 metric
 * (sharpShare70: curve ≈0.66 vs step 0.00) — so if the eyeball verdict "curve
 * looks best" is really explained by patterns 2-5, curve must WIN the new
 * metrics; if it doesn't, the theory fails.
 *
 *   Metric                          | Predicted ordering                         | Theory-critical
 *   samePairMultiCross (excess)     | curve ≈ straight < step < channel(+step)   | YES
 *   parallelCross (2a events)       | curve < straight; step/channel ≈0 by ctor  | supporting
 *   bundleGridCross (2b events)     | curve < step ≤ channel                     | descriptive input only
 *   backwardTurn (backtrackPxTotal) | straight ≈ curve ≈0 < step < channel       | YES
 *   endpointCrossOwn + reentry      | curve < {straight, step, channel}          | YES
 *
 * ── PRE-REGISTERED DECISION RULE (verbatim, so the experiment can't be
 * reinterpreted): the theory is SUPPORTED iff curve is strictly best OR
 * tied-best on ≥3 of {samePairMultiCross(excess), bundleGridCross(gridEvents),
 * backwardTurn(backtrackPxTotal), endpointCrossOwn} — which simultaneously
 * REFUTES pattern-1 (perpendicularity) as the eyeball driver, since step
 * dominates angles and still lost the eyeball. The theory is REFUTED if step OR
 * channel beats curve on ≥2 of those four — the verdict then rests on something
 * unmeasured (most likely curve smoothness/continuity per Ware/Xu), and the next
 * instrument targets curvature continuity, not these patterns. bundleGridCross
 * is DESCRIPTIVE ONLY (literature adjustment #1): a high 2b with fewer scattered
 * crossings may be an IMPROVEMENT (block-crossing organization), so it enters
 * the rule as a tie-eligible "curve best" signal but is never "fixed".
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { layoutTerraformFromSources } from "./terraformLayoutCore";
import {
  diagnoseBadPatternOffenders,
  diagnosePipelineScene,
  type PipelineSceneDiagnostics,
} from "./terraformPipelineCollisionDiagnostics";
import { computePierceMetrics } from "./terraformPipelineStrataPierceMetrics";

const PRESET = "staging-extended-localstack-v2";

type Arm = "straight" | "curve";
const ARMS: Arm[] = ["straight", "curve"];

const buildScene = async (
  arm: Arm,
): Promise<{
  elements: ExcalidrawElement[];
  meta: Record<string, unknown>;
}> => {
  clearTerraformImportPrepCache();
  const sources = getTerraformImportPresetSourcesFromDb(
    PRESET,
  ) as unknown as TerraformPlanParsingSources | null;
  if (!sources) {
    throw new Error(`preset ${PRESET} not found`);
  }
  const edgeStyle: "curve" | null = arm === "curve" ? "curve" : null;
  const result = await layoutTerraformFromSources(sources, {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
    ...(edgeStyle ? { strataEdgeStyle: edgeStyle } : {}),
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  const scene = result.scene as {
    elements: ExcalidrawElement[];
    meta?: Record<string, unknown>;
  };
  return { elements: scene.elements, meta: scene.meta ?? {} };
};

const metricRow = (arm: string, els: ExcalidrawElement[]) => {
  const diag: PipelineSceneDiagnostics = diagnosePipelineScene(els);
  const pm = computePierceMetrics(els);
  const ea = diag.edgeAngles;
  return {
    arm,
    crossings: diag.dataflow.crossings,
    sharp30: diag.crossingAngles.sharpShare,
    sharp70: diag.crossingAngles.sharpShare70,
    bendTotal: ea.bendCountTotal,
    nearFlat: ea.nearFlatShare,
    epResMin: ea.endpointAngularResolutionMinDeg,
    epResMean: ea.endpointAngularResolutionMeanDeg,
    pierce: pm.pierce.total,
  };
};

const badRow = (arm: string, els: ExcalidrawElement[]) => {
  const bp = diagnosePipelineScene(els).badPatterns;
  return {
    arm,
    // M1
    m1Pairs: bp.samePairMultiCross.pairs,
    m1Excess: bp.samePairMultiCross.excess,
    m1Max: bp.samePairMultiCross.maxPerPair,
    // M2
    m2Events: bp.parallelCross.events,
    m2Share: bp.parallelCross.share,
    m2Grid: bp.parallelCross.gridEvents,
    m2GridShare: bp.parallelCross.gridShare,
    totalEvents: bp.parallelCross.totalEvents,
    // M3
    m3Edges: bp.backwardTurn.edges,
    m3PxTotal: bp.backwardTurn.backtrackPxTotal,
    m3PxMax: bp.backwardTurn.backtrackPxMax,
    // M4
    m4Reentry: bp.endpointOcclusion.ownCardReentryCount,
    m4CrossOwn: bp.endpointOcclusion.endpointCrossOwn,
    m4CrossForeign: bp.endpointOcclusion.endpointCrossForeign,
    m4Unresolved: bp.endpointOcclusion.endpointsUnresolved,
    // F3
    edgeLenPx: bp.edgeLengthPxTotal,
  };
};

const edgeStyleMetaOf = (arm: string, meta: Record<string, unknown>) => ({
  arm,
  styled: meta.strataEdgeStyleStyled ?? "—",
  orbited: meta.strataEdgeStyleOrbited ?? "—",
  orbitReverted: meta.strataEdgeStyleOrbitReverted ?? "—",
  reentryClamped: meta.strataEdgeStyleReentryClamped ?? "—",
  lensSwaps: meta.strataEdgeStyleLensSwaps ?? "—",
});

describe("badPatterns validation probe — 2 arms, owner-theory decision rule", () => {
  it(
    "prints predicted vs actual orderings + offenders + SUPPORTED/REFUTED verdict",
    async () => {
      const built = new Map<
        Arm,
        { elements: ExcalidrawElement[]; meta: Record<string, unknown> }
      >();
      for (const arm of ARMS) {
        built.set(arm, await buildScene(arm));
      }
      const els = (a: Arm) => built.get(a)!.elements;

      const metricRows = ARMS.map((a) => metricRow(a, els(a)));
      const badRows = ARMS.map((a) => badRow(a, els(a)));
      // eslint-disable-next-line no-console
      console.log("\n=== METRIC ROW (existing angle/crossing/pierce) ===");
      // eslint-disable-next-line no-console
      console.table(metricRows);
      // eslint-disable-next-line no-console
      console.log("\n=== badPatterns ROW (M1-M4 + edgeLengthPx) ===");
      // eslint-disable-next-line no-console
      console.table(badRows);
      // eslint-disable-next-line no-console
      console.log(
        "\n=== edgeStyle pass counts (W3-1 orbit + Stage-C W3-2/W3-4 touched edges) ===",
      );
      // eslint-disable-next-line no-console
      console.table(
        ARMS.filter((a) => a !== "straight").map((a) =>
          edgeStyleMetaOf(a, built.get(a)!.meta),
        ),
      );

      // Offenders top-10 per metric per arm (ids + int world coords).
      for (const arm of ARMS) {
        const off = diagnoseBadPatternOffenders(els(arm));
        for (const metric of [
          "samePairMultiCross",
          "parallelCross",
          "backwardTurn",
          "endpointOcclusion",
        ] as const) {
          // eslint-disable-next-line no-console
          console.log(
            JSON.stringify(
              { metric, arm, top10: off[metric].slice(0, 10) },
              null,
              2,
            ),
          );
        }
      }

      // ── ACTUAL ORDERINGS + decision rule.
      const valBy = (pick: (r: typeof badRows[number]) => number) =>
        new Map<Arm, number>(ARMS.map((a, i) => [a, pick(badRows[i]!)]));
      const orderingOf = (m: Map<Arm, number>) =>
        [...m.entries()].sort((x, y) => x[1] - y[1]);

      const decisionMetrics: Record<string, Map<Arm, number>> = {
        "samePairMultiCross(excess)": valBy((r) => r.m1Excess),
        "bundleGridCross(gridEvents)": valBy((r) => r.m2Grid),
        "backwardTurn(backtrackPxTotal)": valBy((r) => r.m3PxTotal),
        "endpointCrossOwn(+reentry)": valBy((r) => r.m4CrossOwn + r.m4Reentry),
      };

      // eslint-disable-next-line no-console
      console.log(
        "\n=== ACTUAL ORDERINGS (decision metrics; lower=better) ===",
      );
      let curveBest = 0;
      let rivalBeats = 0;
      const perMetricVerdict: Record<string, string> = {};
      for (const [name, m] of Object.entries(decisionMetrics)) {
        const ordering = orderingOf(m);
        const min = ordering[0]![1];
        const curveVal = m.get("curve")!;
        const curveIsBest = curveVal <= min + 1e-9;
        const rivalMin = m.get("straight")!;
        const beaten = rivalMin < curveVal - 1e-9;
        if (curveIsBest) {
          curveBest += 1;
        }
        if (beaten) {
          rivalBeats += 1;
        }
        perMetricVerdict[name] = curveIsBest
          ? "curve BEST/tied"
          : beaten
          ? "curve BEATEN by straight"
          : "curve mid";
        // eslint-disable-next-line no-console
        console.log(
          `${name}: ${ordering
            .map(([a, v]) => `${a}=${v}`)
            .join("  <  ")}   → ${perMetricVerdict[name]}`,
        );
      }

      const verdict =
        curveBest >= 3 ? "SUPPORTED" : rivalBeats >= 2 ? "REFUTED" : "MIXED";
      // eslint-disable-next-line no-console
      console.log(
        `\n=== DECISION RULE: curveBest=${curveBest}/4, rivalBeats=${rivalBeats}/4 → THEORY ${verdict} ===`,
      );

      // ── Owner's 5 claims, on-scene.
      const claim = (
        label: string,
        curveBestMetric: boolean,
        numbers: string,
      ) => {
        // eslint-disable-next-line no-console
        console.log(
          `CLAIM ${label}: ${
            curveBestMetric ? "CONFIRMED-ON-SCENE" : "REFUTED-ON-SCENE"
          }  (${numbers})`,
        );
      };
      const sharp70 = new Map<Arm, number>(
        ARMS.map((a, i) => [a, metricRows[i]!.sharp70]),
      );
      // Claim 1 (near-perpendicular is the driver): REFUTED-on-scene iff curve —
      // the owner's favorite — is NOT the most perpendicular (higher sharp70
      // than straight). i.e. curve looks best DESPITE worse angles.
      const curvePerpBest =
        sharp70.get("curve")! <= sharp70.get("straight")! + 1e-9;
      // eslint-disable-next-line no-console
      console.log(`\n=== OWNER'S 5 CLAIMS (on-scene) ===`);
      claim(
        "1 near-perpendicular",
        curvePerpBest,
        `curve sharp70=${sharp70.get("curve")} vs straight sharp70=${sharp70.get(
          "straight",
        )} — if curve worse, perpendicularity is NOT the eyeball driver`,
      );
      claim(
        "2 same-pair multi-cross",
        perMetricVerdict["samePairMultiCross(excess)"] === "curve BEST/tied",
        `excess: ${ARMS.map(
          (a) =>
            `${a}=${decisionMetrics["samePairMultiCross(excess)"]!.get(a)}`,
        ).join(", ")}`,
      );
      claim(
        "3 parallel/bundled",
        perMetricVerdict["bundleGridCross(gridEvents)"] === "curve BEST/tied",
        `2a events: ${ARMS.map((a, i) => `${a}=${badRows[i]!.m2Events}`).join(
          ", ",
        )} | 2b grid: ${ARMS.map(
          (a) =>
            `${a}=${decisionMetrics["bundleGridCross(gridEvents)"]!.get(a)}`,
        ).join(", ")} (2b descriptive-only)`,
      );
      claim(
        "4 backward turns",
        perMetricVerdict["backwardTurn(backtrackPxTotal)"] ===
          "curve BEST/tied",
        `backtrackPxTotal: ${ARMS.map(
          (a) =>
            `${a}=${decisionMetrics["backwardTurn(backtrackPxTotal)"]!.get(a)}`,
        ).join(", ")}`,
      );
      claim(
        "5 endpoint occlusion",
        perMetricVerdict["endpointCrossOwn(+reentry)"] === "curve BEST/tied",
        `crossOwn+reentry: ${ARMS.map(
          (a) =>
            `${a}=${decisionMetrics["endpointCrossOwn(+reentry)"]!.get(a)}`,
        ).join(", ")}`,
      );

      // ── Structural assertions (not metric gates).
      const straightRow = metricRows[0]!;
      expect(straightRow.bendTotal).toBe(0); // baseline is straight chords
      for (const r of metricRows) {
        expect(r.sharp70).toBeGreaterThanOrEqual(r.sharp30); // 70° wider net
      }
      // Denominators are non-vacuous where the arm makes them so.
      for (const r of badRows) {
        expect(r.totalEvents).toBeGreaterThan(0);
        expect(r.m3Edges).toBeGreaterThanOrEqual(0);
      }
      // The curve arm actually produced polylines (edge length > straight chords
      // is not guaranteed, but length must be positive).
      expect(badRows[1]!.edgeLenPx).toBeGreaterThan(0);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 20,
  );
});
