import { describe, expect, it } from "vitest";

import { parseTerraformDemoUrlParams } from "./terraformDemoUrlParams";
import {
  TERRAFORM_STRATA_LAYOUT_DEFAULTS,
  resolveStrataDemoOptions,
} from "./terraformStrataDefaults";

describe("resolveStrataDemoOptions", () => {
  it("resolves a bare view=strata URL to the post-owner-flip defaults (K=4 + A7 + transpose/sift/packedScoring ON, ε=1; owner-decisions.md 2026-07-17), not K=0", () => {
    const params = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata",
    );
    expect(params).not.toBeNull();
    expect(resolveStrataDemoOptions(params!)).toEqual({
      strataNetworkSimplexRank: false,
      strataSweeps: 4,
      strataCoordinateRefine: true,
      strataRankSeparate: false,
      strataPackedScoring: true,
      strataPackedScoringEpsilon: 1,
      strataEdgeRouting: false,
      strataBorderRoute: false,
      strataChannelRoute: false,
      strataEdgeClip: false,
      strataBandCompact: false,
      strataSiftRelocate: true,
      strataCrossWeightPenetration: 1,
      strataCrossWeightEdge: 1,
      strataPackedConverge: false,
      strataTransitiveAdopt: false,
      strataBlockClamp: false,
      strataTranspose: true,
      strataChainRelocate: false,
      strataCoordCascade: false,
      strataHeightGate: false,
      strataLeafShift: false,
      // The default cut ("account") is OMITTED (raw-forward discipline): no
      // seam may materialize a default `strataBandDepth` own key.
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        resolveStrataDemoOptions(params!),
        "strataBandDepth",
      ),
    ).toBe(false);
  });

  it("keeps an explicit strataSweeps=0 — the default must not override an explicit opt-out", () => {
    const params = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata&strataSweeps=0",
    );
    expect(params).not.toBeNull();
    expect(resolveStrataDemoOptions(params!).strataSweeps).toBe(0);
    // The other fields still fall back to the defaults.
    expect(resolveStrataDemoOptions(params!).strataCoordinateRefine).toBe(true);
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
      strataPackedScoring: true,
      strataPackedScoringEpsilon: 1,
      strataEdgeRouting: false,
      strataBorderRoute: false,
      strataChannelRoute: false,
      strataEdgeClip: false,
      strataBandCompact: false,
      strataSiftRelocate: true,
      strataCrossWeightPenetration: 1,
      strataCrossWeightEdge: 1,
      strataPackedConverge: false,
      strataTransitiveAdopt: false,
      strataBlockClamp: false,
      strataTranspose: true,
      strataChainRelocate: false,
      strataCoordCascade: false,
      strataHeightGate: false,
      strataLeafShift: false,
      // Default cut omitted — see the bare-URL test above.
    });
  });

  it("resolves strataPackedScoring: default true (owner flip 2026-07-17), explicit opt-out wins", () => {
    const bare = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata",
    );
    expect(resolveStrataDemoOptions(bare!).strataPackedScoring).toBe(true);
    const off = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata&strataPackedScoring=0",
    );
    expect(resolveStrataDemoOptions(off!).strataPackedScoring).toBe(false);
  });

  it("resolves strataEdgeRouting: default false, explicit URL param wins", () => {
    const bare = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata",
    );
    expect(resolveStrataDemoOptions(bare!).strataEdgeRouting).toBe(false);
    const on = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata&strataEdgeRouting=1",
    );
    expect(resolveStrataDemoOptions(on!).strataEdgeRouting).toBe(true);
  });

  it("resolves strataBandCompact: default false, explicit URL param wins", () => {
    const bare = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata",
    );
    expect(resolveStrataDemoOptions(bare!).strataBandCompact).toBe(false);
    const on = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata&strataBandCompact=1",
    );
    expect(resolveStrataDemoOptions(on!).strataBandCompact).toBe(true);
  });

  it("resolves strataBandDepth: default omitted (no default key), explicit URL param wins", () => {
    const bare = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata",
    );
    // The default cut is never materialized as an own key (raw-forward).
    expect(resolveStrataDemoOptions(bare!).strataBandDepth).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(
        resolveStrataDemoOptions(bare!),
        "strataBandDepth",
      ),
    ).toBe(false);
    const on = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata&strataBandDepth=region",
    );
    expect(resolveStrataDemoOptions(on!).strataBandDepth).toBe("region");
  });

  it("legacy strataBandCompact=1 aliases to strataBandDepth:'root' when strataBandDepth is absent", () => {
    const legacy = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata&strataBandCompact=1",
    );
    expect(resolveStrataDemoOptions(legacy!).strataBandDepth).toBe("root");
    expect(resolveStrataDemoOptions(legacy!).strataBandCompact).toBe(true);
  });

  it("explicit strataBandDepth always wins over the legacy strataBandCompact alias", () => {
    const both = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata&strataBandDepth=region&strataBandCompact=1",
    );
    expect(resolveStrataDemoOptions(both!).strataBandDepth).toBe("region");
  });

  it("strataBandCompact=0 (explicit false) does not alias to root — resolves the plain default (omitted)", () => {
    const off = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata&strataBandCompact=0",
    );
    // Resolves to the default cut, which is omitted rather than materialized.
    expect(resolveStrataDemoOptions(off!).strataBandDepth).toBeUndefined();
  });

  it("resolves strataPackedScoringEpsilon: default 1 (owner flip 2026-07-17), explicit strataPackedEps wins (incl. relative)", () => {
    const bare = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata",
    );
    expect(resolveStrataDemoOptions(bare!).strataPackedScoringEpsilon).toBe(1);
    const abs = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata&strataPackedScoring=1&strataPackedEps=2",
    );
    expect(resolveStrataDemoOptions(abs!).strataPackedScoringEpsilon).toBe(2);
    const rel = parseTerraformDemoUrlParams(
      "?preset=staging-multi-state-expanded&view=strata&strataPackedScoring=1&strataPackedEps=0.01",
    );
    expect(resolveStrataDemoOptions(rel!).strataPackedScoringEpsilon).toBe(
      0.01,
    );
  });
});
