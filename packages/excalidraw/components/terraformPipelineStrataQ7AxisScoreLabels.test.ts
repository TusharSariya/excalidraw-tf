/**
 * W11 WP-OWNER — file-driven Q7-AXIS scoring runner (SDEC-65).
 *
 * Scores the OWNER-FILLED blinded sheets against the sealed keys and emits
 * `Q7_AXIS_RESULT.json`. This is the real invocation the W11 doc's owner
 * runbook points at (the sibling `terraformPipelineStrataQ7AxisScore.test.ts`
 * holds synthetic-fixture unit tests only):
 *
 *   Q7AXIS_LABELS_DIR=<dir> yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataQ7AxisScoreLabels.test.ts \
 *     --exclude "**\/.claude/**"
 *
 * `<dir>` must contain, per preset tag (P1, P2):
 *   Q7_AXIS_SHEET_<tag>.json  — the sheet with `rows[].ownerLabel` filled
 *   Q7_AXIS_KEY_<tag>.json    — the sealed key emitted alongside it
 *
 * Without `Q7AXIS_LABELS_DIR` the suite skips (it is not part of CI; scoring
 * only makes sense after the owner labeling session). Result JSON is written
 * back into the same directory. Pre-registered reading of the numbers lives
 * in docs/strata-view-w11-task-tracing.md — recorded BEFORE labels.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  scoreQ7Axis,
  type Q7AxisKey,
  type Q7AxisLabelEntry,
} from "./terraformPipelineStrataQ7AxisScore";

const LABELS_DIR = process.env.Q7AXIS_LABELS_DIR;
const PRESET_TAGS = ["P1", "P2"] as const;

type SheetFile = {
  preset: string;
  seed: number;
  rows: Array<{ index: number; ownerLabel?: string }>;
};

describe("Q7-AXIS owner-labels scoring runner (W11 WP-OWNER)", () => {
  it.skipIf(!LABELS_DIR)(
    "scores the filled sheets against the sealed keys and emits Q7_AXIS_RESULT.json",
    () => {
      const dir = LABELS_DIR!;
      const inputs: Array<{
        key: Q7AxisKey;
        labels: Q7AxisLabelEntry[];
      }> = [];
      const loadedTags: string[] = [];

      for (const tag of PRESET_TAGS) {
        const sheetPath = join(dir, `Q7_AXIS_SHEET_${tag}.json`);
        const keyPath = join(dir, `Q7_AXIS_KEY_${tag}.json`);
        if (!existsSync(sheetPath) || !existsSync(keyPath)) {
          continue;
        }
        const sheet = JSON.parse(readFileSync(sheetPath, "utf8")) as SheetFile;
        const key = JSON.parse(readFileSync(keyPath, "utf8")) as Q7AxisKey;
        expect(key.preset).toBe(sheet.preset);
        inputs.push({
          key,
          labels: sheet.rows.map((row) => ({
            index: row.index,
            ownerLabel: row.ownerLabel,
          })),
        });
        loadedTags.push(tag);
      }

      expect(
        inputs.length,
        `no Q7_AXIS_SHEET_*/Q7_AXIS_KEY_* pairs found in ${dir}`,
      ).toBeGreaterThan(0);

      // Refuse to score fully-unlabeled sheets — that is the pre-labeling
      // state, and emitting an all-missing "result" would look like evidence.
      const labeledCount = inputs
        .flatMap((i) => i.labels)
        .filter((l) => (l.ownerLabel ?? "").trim().length > 0).length;
      expect(
        labeledCount,
        "sheets are unlabeled — fill rows[].ownerLabel before scoring",
      ).toBeGreaterThan(0);

      const result = scoreQ7Axis(inputs);
      const outPath = join(dir, "Q7_AXIS_RESULT.json");
      writeFileSync(
        outPath,
        `${JSON.stringify(
          {
            generatedBy: "terraformPipelineStrataQ7AxisScoreLabels.test.ts",
            presetsLoaded: loadedTags,
            result,
          },
          null,
          2,
        )}\n`,
      );

      for (const score of [...result.perPreset, result.pooled]) {
        // eslint-disable-next-line no-console
        console.info(
          `[q7-axis] ${score.preset}: n=${score.n} matches=${score.matches} ` +
            `mismatches=${score.mismatches} ambiguous=${score.ambiguous} ` +
            `missing=${score.missing} accuracy=${
              score.accuracy === null ? "n/a" : score.accuracy.toFixed(3)
            } wilson=${
              score.wilson === null
                ? "n/a"
                : `[${score.wilson.lo.toFixed(4)}, ${score.wilson.hi.toFixed(
                    4,
                  )}]`
            }`,
        );
        if (score.warnings.length > 0) {
          // eslint-disable-next-line no-console
          console.warn(`[q7-axis] ${score.preset} warnings:`, score.warnings);
        }
      }
      // eslint-disable-next-line no-console
      console.info(`[q7-axis] result written: ${outPath}`);
    },
  );
});
