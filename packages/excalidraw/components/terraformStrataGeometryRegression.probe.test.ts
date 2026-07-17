/**
 * W0-I4 GEOMETRY REGRESSION PROBE — full matrix.
 *
 * Freezes the current (pre-overnight-change) strata layout behavior across
 * presets P1/P2 × the config matrix into a committed baseline JSON. Every cell
 * pins: canonical geometryHash, elementCount, RENDERED crossings, pierce +
 * topoFrames + piercePerTopoFrame (pierce is a denominator artifact under
 * de-band, so its normalizers ride alongside — trap #3).
 *
 * The suite's value is NOT the first (tautological) run — it is the first later
 * merge that flips a hash it should not have.
 *
 * Run (assert against committed baseline):
 *   yarn vitest run packages/excalidraw/components/terraformStrataGeometryRegression.probe.test.ts
 *
 * Regenerate the baseline (ONLY in the same commit as the change that justifies
 * it — add a one-line justification to the header of the baseline JSON per
 * update, referencing a gate artifact or the Track C disposition doc):
 *   STRATA_REGRESSION_UPDATE=1 yarn vitest run …probe.test.ts
 *
 * Include the slow audit / vpc-de-band rows (packed-scoring descent blowup —
 * minutes each; SKIPPED-SLOW in the baseline by default):
 *   STRATA_REGRESSION_SLOW=1 STRATA_REGRESSION_UPDATE=1 yarn vitest run …probe.test.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import {
  STRATA_REGRESSION_CONFIGS,
  STRATA_REGRESSION_PRESETS,
  cellKey,
  measureStrataRegressionCell,
  type StrataRegressionMeasurement,
  type StrataRegressionPresetKey,
} from "./terraformStrataGeometryRegression.cells";

const BASELINE_PATH = join(
  __dirname,
  "terraformStrataGeometryRegression.baseline.json",
);

type BaselineCell =
  | ({ status: "measured" } & Extract<StrataRegressionMeasurement, { ok: true }>)
  | { status: "measured-error"; error: string }
  | { status: "SKIPPED-SLOW" };

type Baseline = {
  __about__: string;
  __updates__: string[];
  cells: Record<string, BaselineCell>;
};

const UPDATE = process.env.STRATA_REGRESSION_UPDATE === "1";
const RUN_SLOW = process.env.STRATA_REGRESSION_SLOW === "1";

const PRESET_KEYS = Object.keys(
  STRATA_REGRESSION_PRESETS,
) as StrataRegressionPresetKey[];

const readBaseline = (): Baseline => {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  } catch {
    return {
      __about__:
        "W0-I4 strata geometry regression freeze baseline. Regenerate ONLY " +
        "alongside the change that justifies it (STRATA_REGRESSION_UPDATE=1); " +
        "add a one-line justification to __updates__ per regeneration, " +
        "referencing a gate artifact or the Track C disposition doc.",
      __updates__: [],
      cells: {},
    };
  }
};

const measurementToCell = (m: StrataRegressionMeasurement): BaselineCell =>
  m.ok ? { status: "measured", ...m } : { status: "measured-error", error: m.error };

describe("strata geometry regression (freeze matrix)", () => {
  const nextBaseline = readBaseline();

  for (const presetKey of PRESET_KEYS) {
    for (const config of STRATA_REGRESSION_CONFIGS) {
      const key = cellKey(presetKey, config);
      const isSlow = config.slow === true && !RUN_SLOW;

      it(
        `${key}${isSlow ? " [SKIPPED-SLOW]" : ""}`,
        async () => {
          if (isSlow) {
            // Do not run the blowup-risk cell in the default lane; freeze it as
            // SKIPPED-SLOW so a later reader knows it exists and was deliberately
            // not measured here. STRATA_REGRESSION_SLOW=1 measures it for real.
            if (UPDATE) {
              nextBaseline.cells[key] = { status: "SKIPPED-SLOW" };
              writeFileSync(
                BASELINE_PATH,
                `${JSON.stringify(nextBaseline, null, 2)}\n`,
              );
            }
            expect(nextBaseline.cells[key]?.status ?? "SKIPPED-SLOW").toBe(
              "SKIPPED-SLOW",
            );
            return;
          }

          const measured = await measureStrataRegressionCell(presetKey, config);
          const cell = measurementToCell(measured);

          if (UPDATE) {
            nextBaseline.cells[key] = cell;
            writeFileSync(
              BASELINE_PATH,
              `${JSON.stringify(nextBaseline, null, 2)}\n`,
            );
            expect(cell.status).not.toBe("SKIPPED-SLOW");
            return;
          }

          const expected = nextBaseline.cells[key];
          expect(
            expected,
            `no baseline for ${key} — run STRATA_REGRESSION_UPDATE=1 to seed it`,
          ).toBeTruthy();
          // A freeze test: the committed baseline is the source of truth. A
          // mismatch means this merge changed strata geometry — investigate
          // and, if intended, regenerate with a justification.
          expect(cell).toEqual(expected);
        },
        config.slow === true
          ? 600_000
          : STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 16,
      );
    }
  }
});
