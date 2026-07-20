/**
 * GATE 1 — OFF-PATH BYTE-IDENTITY.
 *
 * With `includeAncillary` absent, this whole feature (bands, the re-settle, the
 * §3o allocator) must be a provable no-op: elements + meta byte-identical to
 * pristine HEAD. The baseline proved this by `cmp`-ing ~3.5MB of serialized
 * output; this does the same in-process against a committed snapshot so it can
 * run in CI rather than as a one-off.
 *
 * ⚠️ THIS GATE IS NEAR-TAUTOLOGICAL AND MUST NOT BE OVERSOLD. Flag-off, the
 * injection block never runs at all, so of course nothing moves. It says NOTHING
 * about the flag-ON path — which is where F1 lived (the re-settle silently
 * undoing transpose and dropping every band). The flag-on evidence is the unit
 * suite's transpose/coordRefine arms plus the real-preset probe, not this file.
 *
 * Run: yarn vitest run --config vitest.probe.config.mts \
 *        packages/excalidraw/components/terraformStrataAncillaryByteIdentity.probe.test.ts
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { layoutTerraformFromSources } from "./terraformLayoutCore";
import { resolveStrataDemoOptions } from "./terraformStrataDefaults";

const PRESET = "staging-extended-localstack-v2";

const build = async (deBand: "none" | "vpc") => {
  clearTerraformImportPrepCache();
  const res = await layoutTerraformFromSources(
    getTerraformImportPresetSourcesFromDb(PRESET) as never,
    {
      layoutMode: "strata",
      pipelineCompact: true,
      // `pipelineIncludeAncillary` deliberately ABSENT — that is the gate.
      ...resolveStrataDemoOptions({
        strataSweeps: 4,
        strataCoordRefine: true,
        strataRankSeparate: true,
        strataPackedScoring: true,
        strataPackedEps: 1,
        strataBandDepth: "root",
        strataSift: true,
        strataPackedConverge: true,
        strataTransitiveAdopt: true,
        strataTranspose: true,
        ...(deBand !== "none" ? { strataDeBandLevel: deBand } : {}),
      } as never),
    } as Record<string, unknown>,
  );
  if (!res.ok) {
    throw new Error(String(res.error));
  }
  const scene = res.scene as {
    elements: ExcalidrawElement[];
    meta: Record<string, unknown>;
  };
  const payload = JSON.stringify({
    elements: scene.elements,
    meta: scene.meta,
  });
  return {
    bytes: payload.length,
    sha: createHash("sha256").update(payload).digest("hex"),
    meta: scene.meta,
  };
};

describe("GATE 1 — flag-off byte-identity", () => {
  for (const deBand of ["none", "vpc"] as const) {
    it(
      `emits no ancillary key and is stable at deBand=${deBand}`,
      async () => {
        const a = await build(deBand);
        const b = await build(deBand);

        // Determinism across builds (the prep cache is cleared between them).
        expect(a.sha).toBe(b.sha);
        // A real scene, not an empty one — an empty payload would hash-match too.
        expect(a.bytes).toBeGreaterThan(1_000_000);

        // Not one ancillary/allocator key may ride when the flag is absent: an
        // extra own key is exactly what breaks meta byte-identity.
        for (const key of Object.keys(a.meta)) {
          expect(key).not.toMatch(/[Aa]ncillary/);
        }
        expect(a.meta.rcllV2Degraded).toBeUndefined();
      },
      STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
    );
  }
});
