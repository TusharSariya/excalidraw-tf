import graphlibDot from "@dagrejs/graphlib-dot";
import { describe, expect, it } from "vitest";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import {
  setTerraformImportProfilerEnabled,
  terraformImportProfilerReset,
  terraformImportProfilerSummary,
} from "./terraformImportProfiler";
import { buildTerraformStrataExcalidrawScene } from "./terraformPipelineStrata";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
} from "./terraformPlanParsing";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";
import type { TerraformPlanNodesMap } from "./terraformPlanParsing";

/**
 * I2 verification: the strata engine emits a profiler span per stage
 * (model / rank / A0 place-or-descent / A7 (trialRelayout+score, or plain a7) /
 * post-passes / ancillary / sceneBuild / structural-check / finalize), and emits
 * NOTHING when the profiler is disabled (the zero-overhead-when-disabled
 * contract, proven at the summary level).
 */

const PRESET = "staging-extended-localstack-v2"; // P2 (small frozen measurement preset)

function loadNodes(preset: string): {
  nodes: TerraformPlanNodesMap;
  plan: unknown;
} {
  const raw = getTerraformImportPresetSourcesFromDb(preset);
  if (!raw) {
    throw new Error(`preset missing: ${preset}`);
  }
  const sources = resolveSourcesWithTfdComposition(
    raw as TerraformImportPresetSources,
  );
  const bundle = sources.planDotBundles[0]!;
  const graph = graphlibDot.read("digraph G {}\n");
  const nodes = buildTerraformLocalImportNodesMap(bundle.plan, graph, [], {});
  applyTfdOverlayToNodes(nodes, sources.tfdTexts, sources.tfdLabels);
  return { nodes, plan: bundle.plan };
}

function spanNames(): Set<string> {
  return new Set(terraformImportProfilerSummary().map((s) => s.name));
}

describe("strata engine profiler spans (I2)", () => {
  it(
    "emits per-stage spans when the profiler is enabled",
    async () => {
      const { nodes, plan } = loadNodes(PRESET);

      setTerraformImportProfilerEnabled(true);
      terraformImportProfilerReset();
      const scene = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
        // Exercise the A0 descent + A7 trial/score branch and the ancillary
        // stage so every required span name has a chance to appear.
        strataPackedScoring: true,
        strataCoordinateRefine: true,
        strataTranspose: true,
        includeAncillary: true,
      });
      const names = spanNames();
      setTerraformImportProfilerEnabled(null);

      expect(scene.elements.length).toBeGreaterThan(0);

      // Always-present sibling stages.
      for (const required of [
        "strata.model",
        "strata.rank",
        "strata.postpasses",
        "strata.ancillary",
        "strata.sceneBuild",
        "strata.structuralCheck",
        "strata.finalize",
      ]) {
        expect(names.has(required), `missing span ${required}`).toBe(true);
      }

      // A0: exactly one of legacy place / packed descent runs. With
      // strataPackedScoring on, the descent path is taken.
      expect(
        names.has("strata.descent") || names.has("strata.place"),
        "missing A0 span (place|descent)",
      ).toBe(true);

      // A7: either the never-worse trial+score guard (packed selections > 0) or
      // the plain single-arm refine.
      expect(
        (names.has("strata.trialRelayout") && names.has("strata.score")) ||
          names.has("strata.a7"),
        "missing A7 span (trialRelayout+score | a7)",
      ).toBe(true);

      // Every recorded span carries a callCount >= 1 and non-negative timing.
      for (const s of terraformImportProfilerSummary()) {
        expect(s.callCount).toBeGreaterThanOrEqual(1);
        expect(s.ms).toBeGreaterThanOrEqual(0);
        expect(s.selfMs).toBeGreaterThanOrEqual(0);
      }
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS,
  );

  it(
    "records NOTHING when the profiler is disabled (zero-overhead contract)",
    async () => {
      const { nodes, plan } = loadNodes(PRESET);

      setTerraformImportProfilerEnabled(false);
      terraformImportProfilerReset();
      const scene = await buildTerraformStrataExcalidrawScene(nodes, plan, {
        compact: true,
        includeAncillary: true,
      });
      const summary = terraformImportProfilerSummary();
      setTerraformImportProfilerEnabled(null);

      expect(scene.elements.length).toBeGreaterThan(0);
      expect(summary).toHaveLength(0);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS,
  );
});
