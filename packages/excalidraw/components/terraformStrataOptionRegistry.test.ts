/**
 * Guards for the strata option registry (c04 / c09 §2).
 *
 *  - Every registry `default` agrees with TERRAFORM_STRATA_LAYOUT_DEFAULTS (the
 *    anti-drift contract: the catalog can never claim a default the resolver
 *    does not apply).
 *  - Option keys and canonical URL params are unique; alias spellings resolve.
 *  - The disposition rows the effect matrix / audit already decided are pinned
 *    (blockClamp KEPT in advanced per A1; the four matrix-inert options present;
 *    the S5-6 full-name alias present).
 */
import { describe, expect, it } from "vitest";

import { TERRAFORM_STRATA_LAYOUT_DEFAULTS } from "./terraformStrataDefaults";
import {
  STRATA_OPTION_REGISTRY,
  strataRegistryByUrlParam,
} from "./terraformStrataOptionRegistry";

const defaults = TERRAFORM_STRATA_LAYOUT_DEFAULTS as unknown as Record<
  string,
  boolean | number | string
>;

describe("strata option registry (c04)", () => {
  it("EVERY registry row's default is validated against the resolver (no silent skips)", () => {
    // C19 fix (edge-cap-default-drift): the old form only checked rows whose key
    // was present in the defaults module, silently skipping inherited-default
    // rows (strataEdgeCrossCap) — which is exactly where a fabricated `default:
    // 0` hid. Now every row must be classified and checked.
    for (const entry of STRATA_OPTION_REGISTRY) {
      const seeded = Object.prototype.hasOwnProperty.call(
        defaults,
        entry.optionKey,
      );
      // Exactly one of `default` / `defaultInherits` is present.
      const hasConcrete = entry.default !== undefined;
      const inherits = entry.defaultInherits !== undefined;
      expect(
        hasConcrete !== inherits,
        `${entry.optionKey}: exactly one of default/defaultInherits required`,
      ).toBe(true);

      if (inherits) {
        // An inherited-default option must NOT be seeded by the resolver (the
        // engine's absence contract), and the option it inherits from must be a
        // real seeded key.
        expect(
          seeded,
          `${entry.optionKey}: inherited-default row must be ABSENT from the resolver defaults`,
        ).toBe(false);
        expect(
          Object.prototype.hasOwnProperty.call(
            defaults,
            entry.defaultInherits!,
          ),
          `${entry.optionKey}: inherits from unknown key ${entry.defaultInherits}`,
        ).toBe(true);
      } else {
        // A concrete-default row MUST be seeded and MUST match byte-for-byte.
        expect(
          seeded,
          `${entry.optionKey}: concrete-default row must be seeded by the resolver`,
        ).toBe(true);
        expect(
          entry.default,
          `registry default for ${entry.optionKey} drifted from the resolver`,
        ).toBe(defaults[entry.optionKey]);
      }
    }
  });

  it("option keys and canonical URL params are unique", () => {
    const keys = STRATA_OPTION_REGISTRY.map((e) => e.optionKey);
    expect(new Set(keys).size).toBe(keys.length);
    const params = STRATA_OPTION_REGISTRY.map((e) => e.urlParam).filter(
      (p): p is string => p != null,
    );
    expect(new Set(params).size).toBe(params.length);
  });

  it("alias spellings resolve to their entry (S5-6 strataRankSeparate)", () => {
    const byParam = strataRegistryByUrlParam();
    expect(byParam.get("strataRankSeparate")?.optionKey).toBe(
      "strataRankSeparate",
    );
    expect(byParam.get("strataRankSep")?.optionKey).toBe("strataRankSeparate");
    expect(byParam.get("strataRankSep")).toBe(
      byParam.get("strataRankSeparate"),
    );
  });

  it("emit classes and surfaces are within the declared taxonomy", () => {
    for (const entry of STRATA_OPTION_REGISTRY) {
      expect(["C1", "C2", "C3", "C4"]).toContain(entry.emitClass);
      expect(["basic", "advanced", "hidden", "engine-only"]).toContain(
        entry.surface,
      );
    }
  });

  it("pins the audit/matrix-decided dispositions", () => {
    const byKey = new Map(
      STRATA_OPTION_REGISTRY.map((e) => [e.optionKey, e] as const),
    );
    // blockClamp: KEPT in advanced (A1 post-matrix behavior change), decidable.
    const blockClamp = byKey.get("strataBlockClamp");
    expect(blockClamp?.surface).toBe("advanced");
    expect(blockClamp?.decidedNow).toBe(true);
    expect(blockClamp?.note).toMatch(/A1/);
    // The four matrix-inert options are all catalogued.
    for (const k of [
      "strataBlockClamp",
      "strataHeightGate",
      "strataPackedConverge",
      "strataTransitiveAdopt",
    ]) {
      expect(byKey.has(k), `missing registry entry ${k}`).toBe(true);
    }
    // heightGate hidden→advanced now; delete-from-UI is matrix cell M3a.
    expect(byKey.get("strataHeightGate")?.surface).toBe("advanced");
    // transpose is the flip candidate but NOT decided now (T-FLIP + owner).
    expect(byKey.get("strataTranspose")?.decidedNow).toBe(false);
  });
});
