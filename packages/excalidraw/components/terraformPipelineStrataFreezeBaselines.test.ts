/**
 * v3.2 frozen-rows freeze harness (R8-F3; gate-family proposal §3).
 *
 * Regenerates the frozen row artifacts under docs/strata-baselines/ that the
 * always-on gate-register assertion test loads:
 *   V32_ROWS_P1_COMPACT.json / V32_ROWS_P2_COMPACT.json  (per-arm rows)
 *   V32_BASELINE_MANIFEST.json                            (SHA-256 pins)
 *
 * Heavy (rebuilds every W5 arm) and therefore FLAG-GATED: it only runs with
 *   STRATA_FREEZE_REGEN=1 yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataFreezeBaselines.test.ts \
 *     --exclude "**\/.claude/**"
 * Without the flag the suite skips — ordinary CI must never rebuild baselines
 * (that is the R8-F3 defect this design removes). The v2 substrate is
 * byte-deterministic (D2′/C3′) and the path/bootstrap machinery is seeded, so
 * regen from the same revision is byte-identical; the manifest SHAs pin it.
 *
 * Candidate arms (G/H/I/J) are frozen SNAPSHOTS of the engine at the recorded
 * revision — the register's claims are about those recorded runs. After any
 * engine change, re-run this harness and re-adjudicate the register.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { canonicalEdgeKey } from "./terraformPipelineBootstrapCi";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import { computeSliceMetrics } from "./terraformPipelineSliceMetrics";
import { computeStrataPathMetrics } from "./terraformPipelineStrataPathMetrics";
import type {
  FrozenArmRows,
  FrozenRowsArtifact,
} from "./terraformPipelineStrataGateRegister";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const REGEN = process.env.STRATA_FREEZE_REGEN === "1";
const OUT_DIR = join(__dirname, "../../../docs/strata-baselines");
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Same arm bundles as the W5 repaired-stats harness. */
const ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  A_v2_baseline: {
    layoutMode: "pipeline",
    pipelineLayoutVariant: "v2",
    pipelineCompact: true,
  },
  G_strata_k0: { layoutMode: "strata", pipelineCompact: true },
  H_strata_k4: { layoutMode: "strata", pipelineCompact: true, strataSweeps: 4 },
  I_strata_k4_a7: {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
  },
  J_strata_k4_a7_rs: {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
    strataRankSeparate: true,
  },
};

const CELLS: ReadonlyArray<{
  presetLabel: "P1" | "P2";
  preset: string;
  file: string;
}> = [
  {
    presetLabel: "P1",
    preset: "staging-extended-localstack-v2",
    file: "V32_ROWS_P1_COMPACT.json",
  },
  {
    presetLabel: "P2",
    preset: "staging-localstack",
    file: "V32_ROWS_P2_COMPACT.json",
  },
];

async function buildArmRows(
  sources: TerraformImportPresetSources,
  options: Record<string, unknown>,
): Promise<FrozenArmRows> {
  clearTerraformImportPrepCache();
  const body = await layoutTerraformViaWorkers(
    {
      planDotBundles: sources.planDotBundles,
      states: [],
      stateLabels: [],
      tfdTexts: [...sources.tfdTexts],
      tfdLabels: sources.tfdLabels,
    },
    { semanticLayout: false, ...options },
  );
  const elements = (body.elements ?? []) as ExcalidrawElement[];
  const slices = computeSliceMetrics(elements);
  const sliceBByKey = new Map<string, number>();
  for (const row of slices.perEdge) {
    if (row.slice !== "B") {
      continue;
    }
    const key = canonicalEdgeKey(row.source, row.target, row.relKind);
    if (!sliceBByKey.has(key)) {
      sliceBByKey.set(key, row.extentPx);
    }
  }
  const paths = computeStrataPathMetrics(elements);
  const diag = diagnosePipelineScene(elements);
  return {
    sliceB: [...sliceBByKey.entries()]
      .sort(([a], [b]) => (a === b ? 0 : a < b ? -1 : 1))
      .map(([key, extentPx]) => ({ key, extentPx: round4(extentPx) })),
    paths: paths.rows.map((r) => ({
      pathKey: r.pathKey,
      k: r.k,
      con: r.con,
      cr: r.cr,
      tll: r.tll,
      br: r.br,
      rtHat: r.rtHat,
    })),
    scalars: {
      crossings: diag.dataflow.crossings,
      nCross: diag.crossingAngles.nCross,
      sharpShare: round4(diag.crossingAngles.sharpShare),
      p10Deg: round4(diag.crossingAngles.p10Deg),
      minDeg: round4(diag.crossingAngles.minDeg),
      elementCount: elements.filter((e) => !e.isDeleted).length,
    },
  };
}

describe("v3.2 baseline freeze harness (flag-gated regen; see header)", () => {
  it.skipIf(!REGEN)(
    "regenerates V32_ROWS_* artifacts + SHA manifest",
    async () => {
      mkdirSync(OUT_DIR, { recursive: true });
      const manifest: Record<string, unknown> = {
        schemaVersion: 1,
        provenance:
          "Frozen from the v3.2 minimal-slice working tree (W5 battery era). " +
          "Regen: STRATA_FREEZE_REGEN=1 vitest run terraformPipelineStrataFreezeBaselines.test.ts. " +
          "After any engine change, regen AND re-adjudicate gateRegister.json.",
        seedConvention: "mulberry32(20260704), B=1000 (v3.1 §2.5 / §12)",
        files: {} as Record<string, string>,
      };
      const files = manifest.files as Record<string, string>;

      for (const cell of CELLS) {
        const raw = getTerraformImportPresetSourcesFromDb(cell.preset);
        expect(raw, `preset ${cell.preset} exists`).toBeTruthy();
        const sources = resolveSourcesWithTfdComposition(
          raw! as TerraformImportPresetSources,
        );
        const arms: Record<string, FrozenArmRows> = {};
        for (const armLabel of Object.keys(ARM_OPTIONS)) {
          arms[armLabel] = await buildArmRows(
            sources,
            ARM_OPTIONS[armLabel]!,
          );
          expect(
            arms[armLabel]!.paths.length,
            `${cell.preset}/${armLabel} path rows non-empty`,
          ).toBeGreaterThan(0);
        }
        const artifact: FrozenRowsArtifact = {
          schemaVersion: 1,
          preset: cell.preset,
          cardMode: "compact",
          arms,
        };
        const json = `${JSON.stringify(artifact, null, 2)}\n`;
        writeFileSync(join(OUT_DIR, cell.file), json);
        files[cell.file] = createHash("sha256").update(json).digest("hex");
      }

      writeFileSync(
        join(OUT_DIR, "V32_BASELINE_MANIFEST.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      // eslint-disable-next-line no-console -- regen output IS the deliverable
      console.log(`v3.2 frozen rows written to ${OUT_DIR}`, files);
    },
    TIMEOUT,
  );
});
