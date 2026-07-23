import { describe, expect, it } from "vitest";

import {
  DEBAND_LEVELS,
  DEBAND_LEVEL_BY_TOPOLOGY_ROLE,
  deBandLevelRank,
  isDeBandLevel,
  topologyRoleDeBandRank,
  type DeBandLevel,
} from "./terraformPipelineLayoutProfiles";

// The RCLL "Layout" profile machinery this file used to cover was removed with
// the Pipeline/RCLL views; only the de-band depth ladder (still read by Strata)
// remains here, so this suite pins that ladder's invariants.

describe("de-band depth ladder", () => {
  it("DEBAND_LEVELS lists every rung, shallow→deep", () => {
    expect([...DEBAND_LEVELS]).toEqual([
      "none",
      "subnet",
      "vpc",
      "region",
      "account",
      "provider",
    ]);
  });

  it("isDeBandLevel accepts every rung and rejects anything else", () => {
    for (const level of DEBAND_LEVELS) {
      expect(isDeBandLevel(level)).toBe(true);
    }
    expect(isDeBandLevel("zone")).toBe(false);
    expect(isDeBandLevel("")).toBe(false);
    expect(isDeBandLevel(undefined)).toBe(false);
    expect(isDeBandLevel(3)).toBe(false);
  });

  it("deBandLevelRank orders none=0 (shallowest) → subnet=5 (deepest)", () => {
    const ranks = DEBAND_LEVELS.map((l) => deBandLevelRank(l));
    expect(deBandLevelRank("none")).toBe(0);
    expect(deBandLevelRank("provider")).toBe(1);
    expect(deBandLevelRank("account")).toBe(2);
    expect(deBandLevelRank("region")).toBe(3);
    expect(deBandLevelRank("vpc")).toBe(4);
    expect(deBandLevelRank("subnet")).toBe(5);
    // Every rank is distinct.
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("each topology role maps to the level that dissolves it, and ranks agree", () => {
    const roles = [
      "subnetZone",
      "vpc",
      "region",
      "account",
      "provider",
    ] as const;
    for (const role of roles) {
      const level: DeBandLevel = DEBAND_LEVEL_BY_TOPOLOGY_ROLE[role];
      expect(isDeBandLevel(level)).toBe(true);
      expect(level).not.toBe("none");
      expect(topologyRoleDeBandRank(role)).toBe(deBandLevelRank(level));
    }
    // subnetZone is the deepest role → highest rank; provider the shallowest.
    expect(topologyRoleDeBandRank("subnetZone")).toBe(5);
    expect(topologyRoleDeBandRank("provider")).toBe(1);
  });
});
