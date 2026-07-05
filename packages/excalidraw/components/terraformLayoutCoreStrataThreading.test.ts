/**
 * Strata threading test — pattern: `terraformLayoutCoreRcllThreading.test.ts`.
 *
 * The M1a Strata engine now runs behind the §5 failure contract (WP-2c);
 * `buildTerraformStrataExcalidrawScene` no longer delegates verbatim to v2.
 * This proves the end-to-end wiring through `layoutTerraformFromSources` (the
 * worker/headless path the app actually uses):
 *   - a URL/dialog-set "strata" variant reaches the engine (not a stale mis-route
 *     to "classic" — the `sceneContext` literal is the one seam where an option
 *     not listed there is silently dropped, trap #4)
 *   - scene meta echoes the Strata identity (`pipelineLayoutVariant: "strata"`,
 *     `pipelineVariant: "strata"`), the `strataPassthrough` marker is GONE (the
 *     passthrough was removed with the engine), and on this preset the engine
 *     runs to completion (no `rcllV2Degraded`)
 *   - the three future-engine flags echo end-to-end (accepted-and-threaded),
 *     default off/0 — surfaced on BOTH the success and the degraded meta
 *   - "honest packing meta" (owner decision SDEC-26): `pipelineColumnPackingInert`
 *     fires for Strata exactly like every non-rcll variant, and is absent on rcll
 *   - ancillary is deferred at M1 (extraction-free) and echoed honestly
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
      // The passthrough is gone: the Strata engine now emits its OWN identity.
      expect(strata.meta.strataPassthrough).toBeUndefined();
      expect(strata.meta.pipelineVariant).toBe("strata");
      // On this preset the engine runs to completion — no degraded fallback.
      expect(strata.meta.rcllV2Degraded).toBeUndefined();
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
    "the Strata engine produces its OWN scene (not a v2 passthrough) and defers ancillary honestly",
    async () => {
      const strata = await buildStrata({ pipelineIncludeAncillary: true });
      // engine ran end-to-end and emitted geometry
      expect(strata.meta.rcllV2Degraded).toBeUndefined();
      expect(strata.meta.pipelineVariant).toBe("strata");
      expect(strata.elements.length).toBeGreaterThan(0);
      // ancillary is deferred at M1 (extraction-free) — echoed, never silently ignored
      expect(strata.meta.strataAncillaryDeferred).toBe(true);
      // it is NOT a byte-for-byte v2 passthrough anymore: the Strata engine owns
      // placement, so its geometry differs from the v2 packer's.
      const v2 = await buildV2({ pipelineIncludeAncillary: true });
      expect(geometryTuples(strata.elements)).not.toEqual(
        geometryTuples(v2.elements),
      );
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );
});
