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
 * THIS IS A `*.probe.test.ts` FILE. The base `vitest.config.mts` EXCLUDES
 * `**\/*.probe.test.*`, so it can ONLY be run through the private probe config.
 * Running it under the default suite silently finds no test file.
 *
 * Assert against the committed baseline:
 *   yarn vitest run --config vitest.probe.config.mts \
 *     packages/excalidraw/components/terraformStrataGeometryRegression.probe.test.ts
 *
 * Regenerate the baseline (ONLY in the same commit as the change that justifies
 * it). A justification is MANDATORY — `STRATA_REGRESSION_JUSTIFY` is refused as
 * empty and no cell is written without it; it is appended to `__updates__`:
 *   STRATA_REGRESSION_UPDATE=1 \
 *   STRATA_REGRESSION_JUSTIFY="<gate artifact / Track C disposition ref>" \
 *   yarn vitest run --config vitest.probe.config.mts \
 *     packages/excalidraw/components/terraformStrataGeometryRegression.probe.test.ts
 *
 * Include the slow audit / vpc-de-band rows (packed-scoring descent blowup —
 * MINUTES each, and vitest's in-process test timeout CANNOT preempt the
 * synchronous descent, so give the whole run a generous wall-clock budget and
 * expect that a kill leaves a valid-but-partial baseline you can resume into):
 *   STRATA_REGRESSION_SLOW=1 STRATA_REGRESSION_UPDATE=1 \
 *   STRATA_REGRESSION_JUSTIFY="…" \
 *   yarn vitest run --config vitest.probe.config.mts …probe.test.ts
 *
 * SEEDING FROM THE PRE-CHANGE TIP (e962579f9): this HEAD-only harness measures
 * whatever layout code the working tree carries. To freeze the pre-overnight
 * baseline, run the UPDATE command above from a checkout/worktree whose HEAD is
 * e962579f9 (this suite's own worktree, branched from e962579f9 with only the
 * test files added, qualifies — the measured layout code IS e962579f9). The
 * probe config resolves its canvas-mock setup files by ABSOLUTE path off the
 * config's own directory, so it runs correctly from a nested worktree cwd where
 * the bare-specifier base config would resolve a stale sibling worktree.
 *
 * SLOW-CELL LIFECYCLE (freeze integrity): a slow cell measured once under
 * STRATA_REGRESSION_SLOW=1 is NEVER clobbered by a later fast UPDATE (which
 * would otherwise overwrite it with SKIPPED-SLOW), and a later fast assertion
 * run does NOT re-assert it (the fast lane did not measure it — the SLOW lane
 * owns that comparison). Only cells with no measured value are frozen/asserted
 * as SKIPPED-SLOW.
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
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
  | ({ status: "measured" } & Extract<
      StrataRegressionMeasurement,
      { ok: true }
    >)
  | { status: "measured-error"; error: string }
  | { status: "SKIPPED-SLOW" };

type Baseline = {
  __about__: string;
  __updates__: string[];
  cells: Record<string, BaselineCell>;
};

const UPDATE = process.env.STRATA_REGRESSION_UPDATE === "1";
const RUN_SLOW = process.env.STRATA_REGRESSION_SLOW === "1";
const JUSTIFY = process.env.STRATA_REGRESSION_JUSTIFY?.trim();

// Composed once so every per-cell write appends the SAME justification line at
// most once (dedupe by exact string below).
const UPDATE_ENTRY =
  UPDATE && JUSTIFY
    ? `${new Date().toISOString().slice(0, 10)} — ${JUSTIFY}`
    : undefined;

const PRESET_KEYS = Object.keys(
  STRATA_REGRESSION_PRESETS,
) as StrataRegressionPresetKey[];

const DEFAULT_ABOUT =
  "W0-I4 strata geometry regression FREEZE baseline. Regenerate ONLY " +
  "alongside the change that justifies it: STRATA_REGRESSION_UPDATE=1 " +
  'STRATA_REGRESSION_JUSTIFY="<ref>" yarn vitest run --config ' +
  "vitest.probe.config.mts " +
  "packages/excalidraw/components/terraformStrataGeometryRegression.probe.test.ts " +
  "(add STRATA_REGRESSION_SLOW=1 to measure the audit / vpc-de-band rows). " +
  "Each regeneration appends its justification to __updates__.";

const readBaseline = (): Baseline => {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;
  } catch {
    return { __about__: DEFAULT_ABOUT, __updates__: [], cells: {} };
  }
};

/**
 * Atomic write: serialize to a sibling temp file then rename over the target so
 * a kill mid-descent (the slow arm cannot be preempted in-process) never leaves
 * a TORN JSON. An interrupted UPDATE therefore leaves a VALID, partially
 * regenerated baseline that a resumed run completes cell-by-cell.
 */
const writeBaseline = (baseline: Baseline): void => {
  if (UPDATE_ENTRY && !baseline.__updates__.includes(UPDATE_ENTRY)) {
    baseline.__updates__.push(UPDATE_ENTRY);
  }
  const tmp = `${BASELINE_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(baseline, null, 2)}\n`);
  renameSync(tmp, BASELINE_PATH);
};

const measurementToCell = (m: StrataRegressionMeasurement): BaselineCell =>
  m.ok
    ? { status: "measured", ...m }
    : { status: "measured-error", error: m.error };

const isMeasuredCell = (cell: BaselineCell | undefined): boolean =>
  cell != null && cell.status !== "SKIPPED-SLOW";

describe("strata geometry regression (freeze matrix)", () => {
  // Justification gate — fail BEFORE any measurement/write so an UPDATE run
  // without a reason cannot silently rewrite the freeze.
  if (UPDATE) {
    it("regeneration requires STRATA_REGRESSION_JUSTIFY", () => {
      expect(
        JUSTIFY,
        "STRATA_REGRESSION_UPDATE=1 requires a non-empty " +
          "STRATA_REGRESSION_JUSTIFY (a gate artifact / Track C disposition ref) " +
          "— it is appended to the baseline __updates__ log.",
      ).toBeTruthy();
    });
  }

  const nextBaseline = readBaseline();

  for (const presetKey of PRESET_KEYS) {
    for (const config of STRATA_REGRESSION_CONFIGS) {
      const key = cellKey(presetKey, config);
      const isSlow = config.slow === true && !RUN_SLOW;

      it(
        `${key}${isSlow ? " [SKIPPED-SLOW]" : ""}`,
        async () => {
          if (isSlow) {
            const existing = nextBaseline.cells[key];
            // A slow cell measured earlier under STRATA_REGRESSION_SLOW=1 is a
            // real frozen baseline. The fast lane must NEVER destroy it (UPDATE)
            // nor pretend to assert it (it wasn't measured here — the SLOW lane
            // owns that comparison).
            if (isMeasuredCell(existing)) {
              return;
            }
            if (UPDATE) {
              if (!JUSTIFY) {
                return; // justification gate above already failed the run
              }
              nextBaseline.cells[key] = { status: "SKIPPED-SLOW" };
              writeBaseline(nextBaseline);
              return;
            }
            expect(existing?.status ?? "SKIPPED-SLOW").toBe("SKIPPED-SLOW");
            return;
          }

          const measured = await measureStrataRegressionCell(presetKey, config);
          const cell = measurementToCell(measured);

          if (UPDATE) {
            if (!JUSTIFY) {
              return; // justification gate above already failed the run
            }
            nextBaseline.cells[key] = cell;
            writeBaseline(nextBaseline);
            expect(cell.status).not.toBe("SKIPPED-SLOW");
            return;
          }

          const expected = nextBaseline.cells[key];
          expect(
            expected,
            `no baseline for ${key} — seed it on a e962579f9 checkout: ` +
              "STRATA_REGRESSION_UPDATE=1 STRATA_REGRESSION_JUSTIFY=… " +
              "yarn vitest run --config vitest.probe.config.mts …probe.test.ts",
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
