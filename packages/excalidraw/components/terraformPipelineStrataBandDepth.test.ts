import { describe, expect, it } from "vitest";

import {
  resolveStrataHullPolicy,
  STRATA_HULL_POLICY,
} from "./terraformPipelineStrataTypes";

import type { StrataHullRole } from "./terraformPipelineStrataTypes";

/**
 * Pure unit test of `resolveStrataHullPolicy` (WP1 of the strata band-depth
 * slider plan). No engine build needed — this only exercises the resolver
 * and the static fallback map it must stay consistent with.
 */

// Independent depth list (NOT imported from the source module) so the table
// test below isn't circular with the resolver's own internal depth map.
const ROLE_DEPTH: Readonly<Record<StrataHullRole, number>> = {
  root: 0,
  provider: 1,
  account: 2,
  region: 3,
  vpc: 4,
  subnetZone: 5,
};

const ALL_ROLES: readonly StrataHullRole[] = [
  "root",
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
];

describe("resolveStrataHullPolicy", () => {
  it("resolves banded iff depth(role) <= depth(cut), for every (role, cut) pair", () => {
    for (const role of ALL_ROLES) {
      for (const cut of ALL_ROLES) {
        const expected =
          ROLE_DEPTH[role] <= ROLE_DEPTH[cut] ? "banded" : "packed";
        expect(resolveStrataHullPolicy(role, cut)).toBe(expected);
      }
    }
  });

  it("resolves root as banded for every legal cut", () => {
    for (const cut of ALL_ROLES) {
      expect(resolveStrataHullPolicy("root", cut)).toBe("banded");
    }
  });

  it("matches STRATA_HULL_POLICY exactly at the default cut (account)", () => {
    for (const role of ALL_ROLES) {
      expect(resolveStrataHullPolicy(role, "account")).toBe(
        STRATA_HULL_POLICY[role],
      );
    }
  });

  it("never resolves root as packed for any cut (all-packed root is unreachable)", () => {
    const anyRootPacked = ALL_ROLES.some(
      (cut) => resolveStrataHullPolicy("root", cut) === "packed",
    );
    expect(anyRootPacked).toBe(false);
  });
});
