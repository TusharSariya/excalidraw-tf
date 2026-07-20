/**
 * Unit coverage for `deriveLayoutModeFromView` — trap #3 (regression):
 * docs/strata-view-implementation-flow.md §1 notes the function else-falls to
 * "module" for any view it doesn't recognize, so a newly-added view that is
 * omitted from the branch list silently strands as the module layout instead
 * of its own layoutMode. This pins every recognized view, including the
 * gating on `canUseSemanticView` (no plan/dot bundles or state files ⇒ every
 * non-module view degrades to "module").
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deriveLayoutModeFromView,
  runTerraformPresetImport,
} from "./terraformPresetImport";
import { loadTerraformImportPresetSources } from "./terraformImportPresetLoader";
import { runTerraformImportFromSources } from "./terraformSceneApply";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

// The preset/demo import bridge (`runTerraformPresetImport` →
// `runTerraformImportWithView` → `runTerraformImportFromSources`) is the seam the
// A2 re-judge flagged: the strata-view threading test drives
// `layoutTerraformFromSources` DIRECTLY and never crosses this bridge, so an option
// that RunTerraformPresetImportOptions fails to declare/forward is silently dropped
// on the real `?view=strata` demo/preset path. Stub the two edges (preset loader +
// the worker entry) so we can assert exactly what the bridge forwards.
vi.mock("./terraformImportPresetLoader", () => ({
  loadTerraformImportPresetSources: vi.fn(),
}));
vi.mock("./terraformSceneApply", () => ({
  runTerraformImportFromSources: vi.fn(),
}));

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
    expect(deriveLayoutModeFromView("strata", sourcesWithPlan)).toBe("strata");
    expect(deriveLayoutModeFromView("module", sourcesWithPlan)).toBe("module");
  });

  it("degrades every non-module view to 'module' without plan/dot/state sources", () => {
    expect(deriveLayoutModeFromView("semantic", sourcesWithoutPlan)).toBe(
      "module",
    );
    expect(deriveLayoutModeFromView("pipeline", sourcesWithoutPlan)).toBe(
      "module",
    );
    expect(deriveLayoutModeFromView("rcll", sourcesWithoutPlan)).toBe("module");
    expect(deriveLayoutModeFromView("strata", sourcesWithoutPlan)).toBe(
      "module",
    );
  });

  it("recognizes state-only sources as usable (canUseSemanticView via states)", () => {
    const stateOnly: Pick<
      TerraformPlanParsingSources,
      "planDotBundles" | "states"
    > = {
      planDotBundles: [],
      states: [{}],
    };
    expect(deriveLayoutModeFromView("strata", stateOnly)).toBe("strata");
    expect(deriveLayoutModeFromView("rcll", stateOnly)).toBe("rcll");
  });
});

// ── strataLeafShift forwarding through the preset/demo import bridge (A2 #2) ──────

describe("runTerraformPresetImport — strataLeafShift bridge forwarding", () => {
  // A preset sources stub with a plan bundle so `deriveLayoutModeFromView` keeps a
  // strata view as "strata" (canUseSemanticView). `states: []`, no dot needed
  // beyond a bundle being present.
  const presetSourcesStub = {
    planDotBundles: [{ plan: {}, dotText: "digraph {}", label: "s" }],
    states: [],
    stateLabels: [],
    tfdTexts: [],
    tfdLabels: [],
    repoName: "r",
    stackCatalog: undefined,
    warnings: [],
  };
  const strataPreset = { view: "strata" } as unknown as Parameters<
    typeof runTerraformPresetImport
  >[2];
  const app = {} as Parameters<typeof runTerraformPresetImport>[0];
  const setAppState = (() => {}) as Parameters<
    typeof runTerraformPresetImport
  >[1];

  const forwardedOptions = (): Record<string, unknown> => {
    const calls = vi.mocked(runTerraformImportFromSources).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // runTerraformImportFromSources(app, setAppState, sources, optionsObject)
    return calls[calls.length - 1]![3] as unknown as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadTerraformImportPresetSources).mockResolvedValue(
      presetSourcesStub as never,
    );
    vi.mocked(runTerraformImportFromSources).mockResolvedValue({} as never);
  });

  it("forwards strataLeafShift + all four budget knobs through RunTerraformPresetImportOptions to the worker options", async () => {
    await runTerraformPresetImport(app, setAppState, strataPreset, {
      view: "strata",
      strataLeafShift: true,
      strataLeafShiftHeightBudgetPx: 200,
      strataLeafShiftHeightBudgetFrac: 0.02,
      strataLeafShiftRankBudget: 5,
      strataLeafShiftRightEdgeGuardPx: 400,
    });
    const forwarded = forwardedOptions();
    expect(forwarded.layoutMode).toBe("strata"); // reached the pipeline family.
    expect(forwarded.strataLeafShift).toBe(true);
    expect(forwarded.strataLeafShiftHeightBudgetPx).toBe(200);
    expect(forwarded.strataLeafShiftHeightBudgetFrac).toBe(0.02);
    expect(forwarded.strataLeafShiftRankBudget).toBe(5);
    expect(forwarded.strataLeafShiftRightEdgeGuardPx).toBe(400);
  });

  it("resolves absent budget knobs to engine defaults (only-when-set forward) — a bare ?view=strata&strataLeafShift=1 demo URL", async () => {
    // The default-resolution seam: with only the flag set (the shape a bare demo URL
    // yields), the flag rides but every optional budget knob is ABSENT so the engine
    // inherits its own defaults — not present-with-undefined (which would change the
    // worker options object shape).
    await runTerraformPresetImport(app, setAppState, strataPreset, {
      view: "strata",
      strataLeafShift: true,
    });
    const forwarded = forwardedOptions();
    expect(forwarded.strataLeafShift).toBe(true);
    const has = (k: string) =>
      Object.prototype.hasOwnProperty.call(forwarded, k);
    expect(has("strataLeafShiftHeightBudgetPx")).toBe(false);
    expect(has("strataLeafShiftHeightBudgetFrac")).toBe(false);
    expect(has("strataLeafShiftRankBudget")).toBe(false);
    expect(has("strataLeafShiftRightEdgeGuardPx")).toBe(false);
  });

  it("drops the entire strata block (incl. strataLeafShift) when the view degrades to module (no plan/dot/state sources)", async () => {
    // Non-vacuity guard: prove the forward above is view-gated, not unconditional.
    // Without plan/dot/state sources, `deriveLayoutModeFromView` degrades the strata
    // view to "module", so the whole pipeline-family block — strataLeafShift and its
    // budgets — is never spread onto the worker options.
    vi.mocked(loadTerraformImportPresetSources).mockResolvedValue({
      ...presetSourcesStub,
      planDotBundles: [],
      states: [],
    } as never);
    await runTerraformPresetImport(app, setAppState, strataPreset, {
      view: "strata",
      strataLeafShift: true,
      strataLeafShiftHeightBudgetPx: 200,
    });
    const forwarded = forwardedOptions();
    expect(forwarded.layoutMode).toBeUndefined();
    const has = (k: string) =>
      Object.prototype.hasOwnProperty.call(forwarded, k);
    expect(has("strataLeafShift")).toBe(false);
    expect(has("strataLeafShiftHeightBudgetPx")).toBe(false);
  });
});
