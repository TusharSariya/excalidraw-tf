import { describe, expect, it } from "vitest";

import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { layoutTerraformFromSources } from "./terraformLayoutCore";
import {
  buildTerraformImportPrepCache,
  clearTerraformImportPrepCache,
  terraformImportPrepFingerprint,
} from "./terraformImportPrepCache";
import { buildTerraformLayoutSnapshot } from "./terraformLayoutSnapshot";
import { stagingMultiStateLayoutSources } from "./terraformLayoutSnapshotFixtures";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

const minimalSources = (
  overrides: Partial<TerraformPlanParsingSources>,
): TerraformPlanParsingSources => ({
  planDotBundles: [],
  states: [],
  tfdTexts: [],
  ...overrides,
});

describe("terraformImportPrepFingerprint", () => {
  it("does not collide for two .tfd texts sharing a length and 40-char prefix but differing after (the old bug)", () => {
    // Old scheme: `tfd:${t.length}:${t.slice(0, 40)}` — both of these produced
    // the identical part `tfd:41:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`.
    const prefix = "A".repeat(40);
    const a = minimalSources({ tfdTexts: [`${prefix}1`] });
    const b = minimalSources({ tfdTexts: [`${prefix}2`] });
    expect(a.tfdTexts[0]!.length).toBe(b.tfdTexts[0]!.length);
    expect(a.tfdTexts[0]!.slice(0, 40)).toBe(b.tfdTexts[0]!.slice(0, 40));

    expect(terraformImportPrepFingerprint(a)).not.toBe(
      terraformImportPrepFingerprint(b),
    );
  });

  it("does not collide for two bundle tuples that joined identically under the old bare `:` separator", () => {
    // Old scheme: `${label}:${n}:${first}:${last}`. Both of these joined to the
    // identical string "a:1:b:2:c:b:2:c" — a resource address containing ":"
    // let the (label, n, first, last) boundary shift without changing the
    // joined text.
    const a = minimalSources({
      planDotBundles: [
        {
          label: "a",
          plan: { resource_changes: [{ address: "b:2:c" }] },
          dotText: "",
        } as never,
      ],
    });
    const b = minimalSources({
      planDotBundles: [
        {
          label: "a:1:b",
          plan: {
            resource_changes: [{ address: "c" }, { address: "b:2:c" }],
          },
          dotText: "",
        } as never,
      ],
    });
    expect(terraformImportPrepFingerprint(a)).not.toBe(
      terraformImportPrepFingerprint(b),
    );
  });

  it("is stable (same input, same fingerprint)", () => {
    const sources = minimalSources({ tfdTexts: ["hello world"] });
    expect(terraformImportPrepFingerprint(sources)).toBe(
      terraformImportPrepFingerprint(sources),
    );
  });
});

describe("terraform import prep cache", () => {
  it(
    "semantic layout matches with prep cache built vs cold",
    async () => {
      const sources = stagingMultiStateLayoutSources();
      clearTerraformImportPrepCache();

      const cold = await layoutTerraformFromSources(sources, {
        semanticLayout: true,
      });
      expect(cold.ok).toBe(true);
      const coldSnap = buildTerraformLayoutSnapshot(
        cold.ok
          ? (cold.scene as Parameters<typeof buildTerraformLayoutSnapshot>[0])
          : {},
      );

      buildTerraformImportPrepCache(sources, { semanticLayout: true });
      const warm = await layoutTerraformFromSources(sources, {
        semanticLayout: true,
      });
      expect(warm.ok).toBe(true);
      const warmSnap = buildTerraformLayoutSnapshot(
        warm.ok
          ? (warm.scene as Parameters<typeof buildTerraformLayoutSnapshot>[0])
          : {},
      );

      expect(warmSnap).toEqual(coldSnap);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS,
  );
});
