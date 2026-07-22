import { describe, expect, it } from "vitest";

import { terraformPipelineReplayOptionsFromSession } from "./terraformSceneApply";
import { TERRAFORM_STRATA_LAYOUT_DEFAULTS } from "./terraformStrataDefaults";

/**
 * Totality tripwire for the scene-apply seam.
 *
 * `terraformSceneApply.ts` re-materializes the strata option set with explicit
 * `=== true` (booleans), `?? default` (numbers), and conditional raw-forward
 * (string enums) coercions in TWO forwarding literals (the session replay below
 * and the private `buildPipelineFamilyLayoutOptions`). A toggle registered in
 * `TERRAFORM_STRATA_LAYOUT_DEFAULTS` but missing from those literals is SILENTLY
 * DROPPED on the real app path (dialog import, /demo auto-import, session
 * replay) while every headless probe still passes — exactly what happened to
 * `strataChainRelocate`/`strataCoordCascade` on 2026-07-18.
 *
 * The earlier version derived only the BOOLEAN keys (`typeof value ===
 * "boolean"`), so string enums like `strataEdgeStyle` were unprotected: deleting
 * their forward passed the suite (mutation-proven). This now derives EVERY
 * defaults key regardless of type and asserts replay survival with a non-default
 * value per key — booleans flip, numbers +1, enums pick an explicit non-default
 * variant (the defaults registry records only the default, not the variants).
 */
describe("terraformSceneApply option threading", () => {
  // String-enum defaults record only the default value; a first-non-default
  // variant per enum key must be supplied explicitly.
  const ENUM_NON_DEFAULT: Record<string, string> = {
    strataBandDepth: "root", // default "account"
    strataEdgeStyle: "step", // default "straight"
    strataDeBandLevel: "subnet", // default "none"
  };

  /** A value guaranteed to differ from the registered default, per type. */
  const nonDefaultFor = (key: string, def: unknown): boolean | number | string => {
    if (typeof def === "boolean") {
      return !def;
    }
    if (typeof def === "number") {
      return def + 1;
    }
    const variant = ENUM_NON_DEFAULT[key];
    if (variant === undefined) {
      throw new Error(
        `No non-default variant registered for enum defaults key "${key}" — add one to ENUM_NON_DEFAULT.`,
      );
    }
    return variant;
  };

  const allDefaultKeys = Object.entries(TERRAFORM_STRATA_LAYOUT_DEFAULTS);

  it("replay forwards EVERY registered strata toggle (boolean, number, and enum)", () => {
    for (const [key, def] of allDefaultKeys) {
      const value = nonDefaultFor(key, def);
      const session = {
        layoutMode: "strata",
        [key]: value,
      } as unknown as Parameters<
        typeof terraformPipelineReplayOptionsFromSession
      >[0];
      const out = terraformPipelineReplayOptionsFromSession(session) as Record<
        string,
        unknown
      >;
      expect(
        out[key],
        `session key "${key}" (=${JSON.stringify(
          value,
        )}) dropped by replay literal`,
      ).toBe(value);
    }
  });
});
