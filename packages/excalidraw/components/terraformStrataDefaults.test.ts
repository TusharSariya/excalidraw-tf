import { describe, expect, it } from "vitest";

import { parseTerraformDemoUrlParams } from "./terraformDemoUrlParams";
import {
  TERRAFORM_STRATA_LAYOUT_DEFAULTS,
  resolveStrataDemoOptions,
} from "./terraformStrataDefaults";

describe("resolveStrataDemoOptions", () => {
  it("resolves a bare view=strata URL to the SDEC-54 validated defaults (K=4 + A7), not K=0", () => {
    const params = parseTerraformDemoUrlParams("?preset=staging-multi-state-expanded&view=strata");
    expect(params).not.toBeNull();
    expect(resolveStrataDemoOptions(params!)).toEqual({
      strataNetworkSimplexRank: false,
      strataSweeps: 4,
      strataCoordinateRefine: true,
      strataRankSeparate: false,
    });
  });

  it("keeps an explicit strataSweeps=0 — the default must not override an explicit opt-out", () => {
    const params = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata&strataSweeps=0",
    );
    expect(params).not.toBeNull();
    expect(resolveStrataDemoOptions(params!).strataSweeps).toBe(0);
    // The other fields still fall back to the defaults.
    expect(resolveStrataDemoOptions(params!).strataCoordinateRefine).toBe(
      true,
    );
  });

  it("keeps an explicit strataCoordRefine=0 (maps to strataCoordinateRefine=false)", () => {
    const params = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata&strataCoordRefine=0",
    );
    expect(params).not.toBeNull();
    expect(resolveStrataDemoOptions(params!).strataCoordinateRefine).toBe(
      false,
    );
    expect(resolveStrataDemoOptions(params!).strataSweeps).toBe(
      TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataSweeps,
    );
  });

  it("keeps explicit rank options on (truthy params win over the false defaults)", () => {
    const params = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata&strataNsRank=1&strataRankSep=1",
    );
    expect(params).not.toBeNull();
    expect(resolveStrataDemoOptions(params!)).toEqual({
      strataNetworkSimplexRank: true,
      strataSweeps: 4,
      strataCoordinateRefine: true,
      strataRankSeparate: true,
    });
  });
});
