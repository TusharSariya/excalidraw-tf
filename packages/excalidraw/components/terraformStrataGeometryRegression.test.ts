/**
 * W0-I4 QUICK SUBSET — per-merge tripwire (kept < ~60s).
 *
 * Asserts the single cheapest cell (P2 × bare strata default) against the SAME
 * committed baseline the full probe writes
 * (`terraformStrataGeometryRegression.baseline.json`). This runs on every merge;
 * the full matrix probe (`…probe.test.ts`) is the slower, complete freeze.
 *
 * If this trips: strata geometry changed on the canonical preset. Investigate,
 * and only if the change is intended regenerate the baseline via the probe
 * (STRATA_REGRESSION_UPDATE=1) with a justification.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import {
  STRATA_REGRESSION_CONFIGS,
  cellKey,
  measureStrataRegressionCell,
} from "./terraformStrataGeometryRegression.cells";

const BASELINE_PATH = join(
  __dirname,
  "terraformStrataGeometryRegression.baseline.json",
);

const DEFAULT_CONFIG = STRATA_REGRESSION_CONFIGS.find(
  (c) => c.name === "strata-default",
)!;

describe("strata geometry regression — quick subset (P2 default)", () => {
  it(
    "P2 × strata-default matches the committed freeze baseline",
    async () => {
      const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as {
        cells: Record<string, unknown>;
      };
      const key = cellKey("P2", DEFAULT_CONFIG);
      const expected = baseline.cells[key];
      expect(
        expected,
        `no baseline for ${key} — seed it via the probe (STRATA_REGRESSION_UPDATE=1)`,
      ).toBeTruthy();

      const measured = await measureStrataRegressionCell("P2", DEFAULT_CONFIG);
      const cell = measured.ok
        ? { status: "measured", ...measured }
        : { status: "measured-error", error: measured.error };
      expect(cell).toEqual(expected);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
  );
});
