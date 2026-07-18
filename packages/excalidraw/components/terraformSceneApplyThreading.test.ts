import { describe, expect, it } from "vitest";

import { terraformPipelineReplayOptionsFromSession } from "./terraformSceneApply";
import { TERRAFORM_STRATA_LAYOUT_DEFAULTS } from "./terraformStrataDefaults";

/**
 * Totality tripwire for the scene-apply seam.
 *
 * `terraformSceneApply.ts` re-materializes the strata option set with explicit
 * `=== true` coercions in TWO forwarding literals (the session replay below and
 * the private `buildPipelineFamilyLayoutOptions`). A toggle registered in
 * `TERRAFORM_STRATA_LAYOUT_DEFAULTS` but missing from those literals is
 * SILENTLY DROPPED on the real app path (dialog import, /demo auto-import,
 * session replay) while every headless probe still passes — exactly what
 * happened to `strataChainRelocate`/`strataCoordCascade` on 2026-07-18.
 *
 * This test derives the boolean key set from the defaults registry, so a new
 * boolean strata toggle fails here until the scene-apply literals forward it.
 */
describe("terraformSceneApply option threading", () => {
  const booleanStrataKeys = Object.entries(
    TERRAFORM_STRATA_LAYOUT_DEFAULTS,
  ).filter(
    (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
  );

  it("replay forwards every registered boolean strata toggle", () => {
    for (const [key] of booleanStrataKeys) {
      const session = {
        layoutMode: "strata",
        [key]: true,
      } as unknown as Parameters<
        typeof terraformPipelineReplayOptionsFromSession
      >[0];
      const out = terraformPipelineReplayOptionsFromSession(session) as Record<
        string,
        unknown
      >;
      expect(out[key], `session key "${key}" dropped by replay literal`).toBe(
        true,
      );
    }
  });
});
