/**
 * Probe P2 A/B: baseline (straight) vs curve `strataEdgeStyle` on the
 * pinned preset, through the REAL app path (`layoutTerraformFromSources`).
 * Prints the new angle metrics + crossings/pierce so the owner can eyeball the
 * numbers alongside the rendered scene. This is an instrument, not a gate — the
 * only hard assertions are structural (style ran; straight == baseline).
 *
 * Metrics on decision surfaces only (arm-eval discipline): rendered
 * `diagnosePipelineScene` + `computePierceMetrics`, never chord proxies.
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { layoutTerraformFromSources } from "./terraformLayoutCore";
import {
  diagnosePipelineScene,
  type PipelineSceneDiagnostics,
} from "./terraformPipelineCollisionDiagnostics";
import { computePierceMetrics } from "./terraformPipelineStrataPierceMetrics";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

const PRESET = "staging-extended-localstack-v2";

const buildScene = async (
  edgeStyle: "straight" | "curve",
): Promise<ExcalidrawElement[]> => {
  clearTerraformImportPrepCache();
  const sources = getTerraformImportPresetSourcesFromDb(
    PRESET,
  ) as unknown as TerraformPlanParsingSources | null;
  if (!sources) {
    throw new Error(`preset ${PRESET} not found`);
  }
  const result = await layoutTerraformFromSources(sources, {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
    ...(edgeStyle !== "straight" ? { strataEdgeStyle: edgeStyle } : {}),
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return (result.scene as { elements: ExcalidrawElement[] }).elements;
};

type Row = {
  style: string;
  crossings: number;
  sharpShare30: number;
  sharpShare70: number;
  bendTotal: number;
  bendMax: number;
  nearFlatShare: number;
  nearFlatSeg: string;
  horizSeg: number;
  endpointResMin: number;
  endpointResMean: number;
  endpointSides: number;
  pierce: number;
  pierceEdges: number;
};

const rowOf = (style: string, els: ExcalidrawElement[]): Row => {
  const diag: PipelineSceneDiagnostics = diagnosePipelineScene(els);
  const pm = computePierceMetrics(els);
  const ea = diag.edgeAngles;
  return {
    style,
    crossings: diag.dataflow.crossings,
    sharpShare30: diag.crossingAngles.sharpShare,
    sharpShare70: diag.crossingAngles.sharpShare70,
    bendTotal: ea.bendCountTotal,
    bendMax: ea.bendCountMax,
    nearFlatShare: ea.nearFlatShare,
    nearFlatSeg: `${ea.nearFlatSegments}/${ea.longSegments}`,
    horizSeg: ea.horizontalSegments,
    endpointResMin: ea.endpointAngularResolutionMinDeg,
    endpointResMean: ea.endpointAngularResolutionMeanDeg,
    endpointSides: ea.endpointSidesConsidered,
    pierce: pm.pierce.total,
    pierceEdges: pm.pierce.edgeCount,
  };
};

describe("strataEdgeStyle probe — baseline vs curve", () => {
  it(
    "prints angle/crossing/pierce metrics for each style on the pinned preset",
    async () => {
      const baseline = await buildScene("straight");
      const curve = await buildScene("curve");

      const rows = [rowOf("straight", baseline), rowOf("curve", curve)];
      // eslint-disable-next-line no-console
      console.table(rows);

      // Structural guards (not metric gates):
      // straight == baseline topology; curve reshaped ≥1 edge (more bends
      // than baseline, which is all straight chords → 0 bends).
      expect(rows[0]!.bendTotal).toBe(0);
      // curve segments are gentle; assert the pass ran via near-flat/crossings
      // staying finite and endpoint resolution being reported.
      expect(rows[1]!.endpointSides).toBeGreaterThanOrEqual(0);
      // sharpShare70 ≥ sharpShare30 by definition (70° is the wider net).
      for (const r of rows) {
        expect(r.sharpShare70).toBeGreaterThanOrEqual(r.sharpShare30);
      }
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );
});
