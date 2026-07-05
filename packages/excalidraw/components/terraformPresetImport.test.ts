/**
 * Unit coverage for `deriveLayoutModeFromView` — trap #3 (regression):
 * docs/strata-view-implementation-flow.md §1 notes the function else-falls to
 * "module" for any view it doesn't recognize, so a newly-added view that is
 * omitted from the branch list silently strands as the module layout instead
 * of its own layoutMode. This pins every recognized view, including the
 * gating on `canUseSemanticView` (no plan/dot bundles or state files ⇒ every
 * non-module view degrades to "module").
 */
import { describe, expect, it } from "vitest";

import { deriveLayoutModeFromView } from "./terraformPresetImport";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

const sourcesWithPlan: Pick<
  TerraformPlanParsingSources,
  "planDotBundles" | "states"
> = {
  planDotBundles: [{ plan: {}, dotText: "digraph {}", label: "s" }],
  states: [],
};

const sourcesWithoutPlan: Pick<
  TerraformPlanParsingSources,
  "planDotBundles" | "states"
> = {
  planDotBundles: [],
  states: [],
};

describe("deriveLayoutModeFromView", () => {
  it("maps each view to its own layoutMode when plan/dot sources are present", () => {
    expect(deriveLayoutModeFromView("semantic", sourcesWithPlan)).toBe(
      "semantic",
    );
    expect(deriveLayoutModeFromView("pipeline", sourcesWithPlan)).toBe(
      "pipeline",
    );
    expect(deriveLayoutModeFromView("rcll", sourcesWithPlan)).toBe("rcll");
    expect(deriveLayoutModeFromView("strata", sourcesWithPlan)).toBe(
      "strata",
    );
    expect(deriveLayoutModeFromView("module", sourcesWithPlan)).toBe(
      "module",
    );
  });

  it("degrades every non-module view to 'module' without plan/dot/state sources", () => {
    expect(deriveLayoutModeFromView("semantic", sourcesWithoutPlan)).toBe(
      "module",
    );
    expect(deriveLayoutModeFromView("pipeline", sourcesWithoutPlan)).toBe(
      "module",
    );
    expect(deriveLayoutModeFromView("rcll", sourcesWithoutPlan)).toBe(
      "module",
    );
    expect(deriveLayoutModeFromView("strata", sourcesWithoutPlan)).toBe(
      "module",
    );
  });

  it("recognizes state-only sources as usable (canUseSemanticView via states)", () => {
    const stateOnly: Pick<TerraformPlanParsingSources, "planDotBundles" | "states"> =
      {
        planDotBundles: [],
        states: [{}],
      };
    expect(deriveLayoutModeFromView("strata", stateOnly)).toBe("strata");
    expect(deriveLayoutModeFromView("rcll", stateOnly)).toBe("rcll");
  });
});
