/**
 * Probe P1 A/B: baseline (straight chords) vs strataChannelRoute vs
 * channelRoute + edgeStyle=step on the pinned preset, through the REAL app path
 * (`layoutTerraformFromSources`). Prints the angle/crossing/pierce metrics plus
 * the channel-occupancy report (columns, routed/guard-reverted/flat counts, peak
 * tracks per channel, overflow) so the owner can eyeball the numbers alongside
 * the rendered scene and gate the future P5 reserved-width decision. This is an
 * instrument, not a gate — the only hard assertions are structural (the pass
 * ran; straight == baseline).
 *
 * Metrics on decision surfaces only (arm-eval discipline): rendered
 * `diagnosePipelineScene` + `computePierceMetrics`, never chord proxies.
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { layoutTerraformFromSources } from "./terraformLayoutCore";
import {
  diagnosePipelineScene,
  type PipelineSceneDiagnostics,
} from "./terraformPipelineCollisionDiagnostics";
import { computePierceMetrics } from "./terraformPipelineStrataPierceMetrics";

const PRESET = "staging-extended-localstack-v2";

type Arm = "baseline" | "channel" | "channel+step";

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
  const result = await layoutTerraformFromSources(sources, {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
    ...(arm !== "baseline" ? { strataChannelRoute: true } : {}),
    ...(arm === "channel+step" ? { strataEdgeStyle: "step" as const } : {}),
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  const scene = result.scene as {
    elements: ExcalidrawElement[];
    meta?: Record<string, unknown>;
  };
  return {
    elements: scene.elements,
    meta: scene.meta ?? {},
  };
};

type Row = {
  arm: string;
  crossings: number;
  sharpShare30: number;
  sharpShare70: number;
  bendTotal: number;
  nearFlatShare: number;
  nearFlatSeg: string;
  horizSeg: number;
  endpointResMean: number;
  pierce: number;
  pierceEdges: number;
};

const rowOf = (arm: string, els: ExcalidrawElement[]): Row => {
  const diag: PipelineSceneDiagnostics = diagnosePipelineScene(els);
  const pm = computePierceMetrics(els);
  const ea = diag.edgeAngles;
  return {
    arm,
    crossings: diag.dataflow.crossings,
    sharpShare30: diag.crossingAngles.sharpShare,
    sharpShare70: diag.crossingAngles.sharpShare70,
    bendTotal: ea.bendCountTotal,
    nearFlatShare: ea.nearFlatShare,
    nearFlatSeg: `${ea.nearFlatSegments}/${ea.longSegments}`,
    horizSeg: ea.horizontalSegments,
    endpointResMean: ea.endpointAngularResolutionMeanDeg,
    pierce: pm.pierce.total,
    pierceEdges: pm.pierce.edgeCount,
  };
};

const occupancyOf = (arm: string, meta: Record<string, unknown>) => ({
  arm,
  columns: meta.strataChannelRouteColumns ?? "—",
  routed: meta.strataChannelRouteRouted ?? "—",
  guardReverted: meta.strataChannelRouteGuardReverted ?? "—",
  flat: meta.strataChannelRouteFlat ?? "—",
  skipped: meta.strataChannelRouteSkipped ?? "—",
  runsTotal: meta.strataChannelRouteRunsTotal ?? "—",
  maxTracksInChannel: meta.strataChannelRouteMaxTracksInChannel ?? "—",
  overflowChannels: meta.strataChannelRouteOverflowChannels ?? "—",
});

describe("strataChannelRoute probe — baseline vs channel vs channel+step", () => {
  it(
    "prints angle/crossing/pierce + channel-occupancy for each arm on the pinned preset",
    async () => {
      const baseline = await buildScene("baseline");
      const channel = await buildScene("channel");
      const channelStep = await buildScene("channel+step");

      const rows = [
        rowOf("baseline", baseline.elements),
        rowOf("channel", channel.elements),
        rowOf("channel+step", channelStep.elements),
      ];
      // eslint-disable-next-line no-console
      console.table(rows);
      // eslint-disable-next-line no-console
      console.table([
        occupancyOf("channel", channel.meta),
        occupancyOf("channel+step", channelStep.meta),
      ]);

      // Structural guards (not metric gates):
      // baseline is all straight chords → 0 bends; channel arms add bends by
      // construction (orthogonal staircases).
      expect(rows[0]!.bendTotal).toBe(0);
      expect(rows[1]!.bendTotal).toBeGreaterThan(0);
      expect(rows[2]!.bendTotal).toBeGreaterThan(0);
      // The pass actually routed inter-rank edges.
      expect(channel.meta.strataChannelRouteRouted as number).toBeGreaterThan(
        0,
      );
      // sharpShare70 ≥ sharpShare30 by definition (70° is the wider net).
      for (const r of rows) {
        expect(r.sharpShare70).toBeGreaterThanOrEqual(r.sharpShare30);
      }
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );
});
