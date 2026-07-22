/**
 * Allowlist-coverage tripwire for the THIRD silent-drop seam.
 *
 * `GET /api/terraform-layout` (terraformImportPresetDevPlugin.mjs) hand-picks
 * which params it parses/forwards via five allowlist tables. A strata param the
 * /demo URL API (terraformDemoUrlParams.ts) emits but the plugin omits is
 * SILENTLY DROPPED on the proof-API path — the arm no-ops (`applied.<key>=null`)
 * while every headless engine probe still passes. That is exactly how
 * `strataEdgeStyle` / `strataChannelRoute` (and `strataBandCompact` /
 * `strataChainRelocate` / `strataCoordCascade` / `strataLeafShift` /
 * `strataPenW` / `strataCrossW` / `strataEdgeCap`) shipped invisibly.
 *
 * This derives the expected param set from the SAME builder a share URL uses
 * (`collectTerraformDemoParams` → `buildTerraformDemoUrl`) with every strata
 * field forced non-default, so a new strata param added to the URL API fails
 * here until the plugin allowlist forwards it too.
 */
import { describe, expect, it } from "vitest";

import {
  LAYOUT_BOOLEAN_PARAMS,
  LAYOUT_ENUM_PARAMS,
  LAYOUT_INT_PARAMS,
  LAYOUT_EPS_PARAMS,
  LAYOUT_NUM_PARAMS,
} from "../../../excalidraw-app/dev/terraformImportPresetDevPlugin.mjs";

import {
  buildTerraformDemoUrl,
  collectTerraformDemoParams,
  type TerraformDemoSettingsSnapshot,
} from "./terraformDemoUrlParams";

/** Every param name the plugin accepts, across all five allowlist tables. */
const acceptedParamNames = new Set<string>(
  [
    ...LAYOUT_BOOLEAN_PARAMS,
    ...LAYOUT_ENUM_PARAMS,
    ...LAYOUT_INT_PARAMS,
    ...LAYOUT_EPS_PARAMS,
    ...LAYOUT_NUM_PARAMS,
  ].map((entry) => entry[0] as string),
);

/**
 * A strata snapshot with EVERY strata field forced to a non-default value, so
 * `collectTerraformDemoParams` emits all of them (several are emitted only when
 * non-default) — the maximal strata param surface a share URL can carry.
 */
const fullStrataSnapshot: TerraformDemoSettingsSnapshot = {
  presetId: "staging-extended-localstack-v2",
  view: "strata",
  pipelineCompact: true,
  pipelineLayoutVariant: "v2",
  pipelinePacked: false,
  pipelinePackedPullLeft: false,
  pipelineIncludeAncillary: true,
  pipelinePrivateApiRegional: true,
  pipelineSemanticPlacement: false,
  pipelineSwimlaneLaneRise: false,
  pipelineReorder: false,
  pipelineCrossingMin: false,
  pipelineDeBandLevel: "none",
  pipelineRankSeparate: false,
  pipelineStraighten: false,
  pipelineCoordRepack: false,
  pipelineColumnPacking: "none",
  pipelineLayoutProfile: "balanced",
  pipelineStaircaseBandOverlap: true,
  moduleLayoutMode: "default",
  strataNetworkSimplexRank: true,
  strataSweeps: 4,
  strataCoordinateRefine: true,
  strataRankSeparate: false,
  strataPackedScoring: true,
  strataPackedScoringEpsilon: 2,
  strataEdgeRouting: true,
  strataBorderRoute: true,
  strataChannelRoute: true,
  strataEdgeStyle: "step",
  strataBandCompact: true,
  strataBandDepth: "root",
  strataSiftRelocate: true,
  strataCrossWeightPenetration: 2,
  strataCrossWeightEdge: 3,
  strataEdgeCrossCap: 5,
  strataPackedConverge: true,
  strataTransitiveAdopt: true,
  strataBlockClamp: true,
  strataTranspose: true,
  strataChainRelocate: true,
  strataCoordCascade: true,
  strataHeightGate: true,
  strataLeafShift: true,
  strataDeBandLevel: "subnet",
};

describe("terraform-layout dev API allowlist coverage", () => {
  it("accepts every strata / privateApiRegional param a share URL emits", () => {
    const url = buildTerraformDemoUrl(
      collectTerraformDemoParams(fullStrataSnapshot),
    );
    const query = url.slice(url.indexOf("?") + 1);
    const emittedKeys = [...new URLSearchParams(query).keys()].filter(
      (k) => k.startsWith("strata") || k === "privateApiRegional",
    );

    // Sanity: the snapshot really did drive a broad strata surface (guards
    // against a builder change silently emptying this set and vacuously passing).
    expect(emittedKeys.length).toBeGreaterThanOrEqual(20);

    const missing = emittedKeys.filter((k) => !acceptedParamNames.has(k));
    expect(
      missing,
      `share-URL params dropped by the /api/terraform-layout allowlist: ${missing.join(
        ", ",
      )}`,
    ).toEqual([]);
  });

  it("includes the wave-1 edge-routing params the allowlist was missing", () => {
    // Explicit regression pins for the exact keys this hardening added, so the
    // above derivation can never silently stop covering them.
    for (const key of [
      "strataEdgeStyle",
      "strataChannelRoute",
      "strataBandCompact",
      "strataChainRelocate",
      "strataCoordCascade",
      "strataLeafShift",
      "strataPenW",
      "strataCrossW",
      "strataEdgeCap",
    ]) {
      expect(acceptedParamNames.has(key), `plugin drops ?${key}`).toBe(true);
    }
  });
});
