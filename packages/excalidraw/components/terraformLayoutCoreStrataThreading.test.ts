/**
 * Strata (S0a) threading test — pattern: `terraformLayoutCoreRcllThreading.test.ts`.
 *
 * Strata is a PURE v2 passthrough at S0a (docs/strata-view-implementation-flow.md
 * §2): `buildTerraformStrataExcalidrawScene` delegates verbatim to the v2 builder.
 * This proves the end-to-end wiring through `layoutTerraformFromSources` (the
 * worker/headless path the app actually uses) BEFORE any Strata-specific geometry
 * exists:
 *   - a URL/dialog-set "strata" variant reaches the engine (not a stale mis-route
 *     to "classic" — the `sceneContext` literal is the one seam where an option
 *     not listed there is silently dropped, trap #4)
 *   - scene meta echoes the Strata identity (`pipelineLayoutVariant: "strata"`,
 *     `strataPassthrough: true`) plus the three future-engine flags
 *     (accepted-and-threaded-but-unused until the M1 engine lands), default off/0
 *   - "honest packing meta" (owner decision SDEC-26): `pipelineColumnPackingInert`
 *     fires for Strata exactly like every non-rcll variant, and is absent on rcll
 *   - the passthrough geometry is byte-comparable to a plain v2 build for the same
 *     input (element count + sorted (x,y,width,height) tuples)
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { layoutTerraformFromSources } from "./terraformLayoutCore";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

const v2Sources = () =>
  getTerraformImportPresetSourcesFromDb(
    "staging-extended-localstack-v2",
  ) as unknown as TerraformPlanParsingSources;

/** Geometry-only fingerprint (ids/seeds/versions are non-deterministic across
 * builds in the same process — see the canonicalize() comment in the rcll
 * threading test for why). Sorted so element ORDER differences don't matter. */
const geometryTuples = (elements: readonly ExcalidrawElement[]): string[] =>
  elements
    .filter((el) => !el.isDeleted)
    .map((el) => `${el.x},${el.y},${el.width},${el.height}`)
    .sort();

type Scene = { elements: ExcalidrawElement[]; meta: Record<string, unknown> };

const buildStrata = async (opts: Record<string, unknown> = {}) => {
  const result = await layoutTerraformFromSources(v2Sources(), {
    layoutMode: "strata",
    pipelineCompact: true,
    ...opts,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.scene as Scene;
};

const buildV2 = async (opts: Record<string, unknown> = {}) => {
  const result = await layoutTerraformFromSources(v2Sources(), {
    layoutMode: "pipeline",
    pipelineLayoutVariant: "v2",
    pipelineCompact: true,
    ...opts,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.scene as Scene;
};

const buildRcll = async (opts: Record<string, unknown> = {}) => {
  const result = await layoutTerraformFromSources(v2Sources(), {
    layoutMode: "rcll",
    pipelineCompact: true,
    ...opts,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.scene as Scene;
};

describe("layoutTerraformFromSources — Strata (S0a) threading", () => {
  it(
    "a strata-set variant reaches the engine (dispatch, not a stale mis-route to classic)",
    async () => {
      const strata = await buildStrata();
      expect(strata.meta.pipelineLayoutVariant).toBe("strata");
      expect(strata.meta.strataPassthrough).toBe(true);
      // The v2 builder's own meta key survives underneath — S0a really did
      // delegate verbatim, not reimplement anything.
      expect(strata.meta.pipelineVariant).toBe("v2");
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 6,
  );

  it(
    "echoes the three future-engine flags end-to-end (URL/dialog → sceneContext → builder → meta), default off/0",
    async () => {
      const off = await buildStrata();
      expect(off.meta.strataNetworkSimplexRank).toBe(false);
      expect(off.meta.strataSweeps).toBe(0);
      expect(off.meta.strataCoordinateRefine).toBe(false);

      const on = await buildStrata({
        strataNetworkSimplexRank: true,
        strataSweeps: 4,
        strataCoordinateRefine: true,
      });
      expect(on.meta.strataNetworkSimplexRank).toBe(true);
      expect(on.meta.strataSweeps).toBe(4);
      expect(on.meta.strataCoordinateRefine).toBe(true);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 6,
  );

  it(
    "pipelineColumnPackingInert fires for strata when columnPacking is requested (SDEC-26) — present on v2, ABSENT on rcll",
    async () => {
      const strataOff = await buildStrata();
      expect(strataOff.meta.pipelineColumnPackingInert).toBeUndefined();

      const strataCompact = await buildStrata({
        pipelineColumnPacking: "compact",
      });
      expect(strataCompact.meta.pipelineColumnPacking).toBe("compact");
      expect(strataCompact.meta.pipelineColumnPackingInert).toBe(true);

      const v2Compact = await buildV2({ pipelineColumnPacking: "compact" });
      expect(v2Compact.meta.pipelineColumnPacking).toBe("compact");
      expect(v2Compact.meta.pipelineColumnPackingInert).toBe(true);

      const rcllCompact = await buildRcll({
        pipelineColumnPacking: "compact",
      });
      expect(rcllCompact.meta.pipelineColumnPacking).toBe("compact");
      expect(rcllCompact.meta.pipelineColumnPackingInert).toBeUndefined();
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
  );

  it(
    "passthrough geometry is byte-comparable to a plain v2 build for the same input",
    async () => {
      const strata = await buildStrata({ pipelineIncludeAncillary: true });
      const v2 = await buildV2({ pipelineIncludeAncillary: true });
      expect(strata.elements.length).toBe(v2.elements.length);
      expect(geometryTuples(strata.elements)).toEqual(
        geometryTuples(v2.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );
});
