/**
 * OD-15 DE-BAND — FOCUSED A/B (crossings-first, the owner's primary metric).
 *
 * Why this exists: the full 8-arm battery TIMED OUT at 40min with zero output
 * (it only wrote its artifact after every arm finished — a design flaw). The
 * provenance probe proves `none` and `subnet` each build in ~21s at the frozen
 * config, so the blowup lives in the coarser de-band levels / transpose combos.
 * This probe therefore:
 *   - runs ONE arm at a time and WRITES AFTER EVERY ARM (partial results survive
 *     a timeout — never again report "no data" because the last arm hung),
 *   - hard-caps each arm and records a TIMEOUT verdict instead of dying,
 *   - PINS strataBandDepth (research D: otherwise de-band's and bandDepth's
 *     effects are confounded).
 *
 * Metric honesty: crossings + contiguityViolations are frame-INDEPENDENT and are
 * the headline. Pierce is reported but is a DENOMINATOR ARTIFACT under de-band
 * (computePierceMetrics ranges only over the hull frames de-band deletes), so
 * topoFrames + piercePerTopoFrame ride alongside it and raw pierce must NOT be
 * read as a win.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { layoutTerraformFromSources } from "./terraformLayoutCore";
import { resolveStrataDemoOptions } from "./terraformStrataDefaults";
import { computePierceMetrics } from "./terraformPipelineStrataPierceMetrics";
import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";

const PRESET = "staging-extended-localstack-v2";
const BAND_DEPTH = "root" as const;
const OUT = path.resolve("scratchpad", "deband");

const TOPO_ROLES = new Set([
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

type Arm = { name: string; deBand: string; transpose: boolean };

const ARMS: Arm[] = [
  { name: "baseline(none)", deBand: "none", transpose: false },
  { name: "deBand=subnet", deBand: "subnet", transpose: false },
  { name: "baseline+transpose", deBand: "none", transpose: true },
  { name: "deBand=subnet+transpose", deBand: "subnet", transpose: true },
  { name: "deBand=vpc", deBand: "vpc", transpose: false },
];

const measure = async (arm: Arm) => {
  clearTerraformImportPrepCache();
  const t0 = Date.now();
  const res = await layoutTerraformFromSources(
    getTerraformImportPresetSourcesFromDb(PRESET) as never,
    {
      layoutMode: "strata",
      pipelineCompact: true,
      ...resolveStrataDemoOptions({
        strataSweeps: 4,
        strataCoordRefine: true,
        strataRankSeparate: true,
        strataPackedScoring: true,
        strataPackedEps: 1,
        strataBandDepth: BAND_DEPTH,
        strataSift: true,
        strataPackedConverge: true,
        strataTransitiveAdopt: true,
        ...(arm.deBand !== "none" ? { strataDeBandLevel: arm.deBand } : {}),
        ...(arm.transpose ? { strataTranspose: true } : {}),
      } as never),
    } as Record<string, unknown>,
  );
  const buildMs = Date.now() - t0;
  if (!res.ok) {
    return { arm: arm.name, ok: false, error: String(res.error), buildMs };
  }
  const scene = res.scene as {
    elements: ExcalidrawElement[];
    meta: Record<string, unknown>;
  };
  const els = scene.elements;
  const diag = diagnosePipelineScene(els) as unknown as {
    dataflow: { crossings: number };
    crossingAngles?: { sharpShare?: number };
  };
  const pm = computePierceMetrics(els);
  const topoFrames = els.filter(
    (e) =>
      e.type === "frame" &&
      TOPO_ROLES.has(
        String(
          (e.customData as { terraformTopologyRole?: string } | undefined)
            ?.terraformTopologyRole ?? "",
        ),
      ),
  ).length;

  let edgeLen = 0;
  for (const e of els) {
    if (e.type !== "arrow") {
      continue;
    }
    const pts = (e as unknown as { points?: [number, number][] }).points ?? [];
    for (let i = 1; i < pts.length; i++) {
      edgeLen += Math.hypot(
        pts[i]![0] - pts[i - 1]![0],
        pts[i]![1] - pts[i - 1]![1],
      );
    }
  }
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const e of els) {
    minY = Math.min(minY, e.y);
    maxY = Math.max(maxY, e.y + e.height);
    minX = Math.min(minX, e.x);
    maxX = Math.max(maxX, e.x + e.width);
  }

  return {
    arm: arm.name,
    ok: true,
    deBand: arm.deBand,
    transpose: arm.transpose,
    echoedDeBand: scene.meta.strataDeBandLevel ?? null,
    degraded: scene.meta.rcllV2Degraded ?? null,
    crossings: diag.dataflow.crossings,
    sharpShare: Number((diag.crossingAngles?.sharpShare ?? 0).toFixed(4)),
    contiguityViolations: pm.contiguity.totalViolations,
    pierce: pm.pierce.total,
    topoFrames,
    piercePerTopoFrame:
      topoFrames > 0 ? Number((pm.pierce.total / topoFrames).toFixed(3)) : 0,
    edgeLen: Math.round(edgeLen),
    height: Math.round(maxY - minY),
    width: Math.round(maxX - minX),
    elements: els.length,
    buildMs,
  };
};

describe("OD-15 de-band focused A/B", () => {
  const results: unknown[] = [];
  for (const arm of ARMS) {
    it(
      `measures ${arm.name}`,
      async () => {
        const r = await measure(arm);
        results.push(r);
        mkdirSync(OUT, { recursive: true });
        // WRITE AFTER EVERY ARM — partial data survives a later hang.
        writeFileSync(
          path.join(OUT, "focused.json"),
          `${JSON.stringify(
            { preset: PRESET, bandDepth: BAND_DEPTH, results },
            null,
            2,
          )}\n`,
        );
        // eslint-disable-next-line no-console
        console.log(`ARM ${arm.name} ->`, JSON.stringify(r));
        expect(r).toBeTruthy();
      },
      STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12,
    );
  }
});
