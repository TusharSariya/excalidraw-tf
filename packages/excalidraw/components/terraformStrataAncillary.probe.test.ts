/**
 * THE MEASUREMENT — what does the §3o greedy right-slack allocator actually buy?
 *
 * The baseline (`6b391e2c8`) measured the cost of ancillary bands on the real
 * preset and it is large and pure HEIGHT: A2−A1 = **+29,888px (35,525 → 65,413,
 * +84%)** at `deBand=none`. Bands are invisible to every optimizer, so nothing
 * reclaims it. The allocator is the intended lever, and the Step 0 census
 * (`scratchpad/ancillary-census/census.json`) said it should reach: median right
 * slack 1194px (~3 card widths), total band height 18,880 → 9,178 (−51%), rows
 * 80 → 38.
 *
 * 🔴 THE CENSUS MEASURES BAND HEIGHT. THIS PROBE MEASURES SCENE HEIGHT. They are
 * NOT the same number and cannot be assumed proportional: bands live in different
 * hulls, and only the ones on the scene's critical vertical path can move the
 * scene's bounding box at all. Shortening a band that is not on that path buys
 * exactly zero scene height. That gap is the whole reason this probe exists —
 * everyone is currently extrapolating a scene-height win from a band-height
 * census. Report what is measured, not what was projected.
 *
 * ARMS (3 per de-band level, so the allocator is isolated from the feature):
 *   OFF       — `includeAncillary` absent            (the true baseline scene)
 *   BASELINE  — ancillary ON, allocator OFF          (§3f host-interior wrap)
 *   ALLOC     — ancillary ON, allocator ON           (§3o)
 * × `deBand ∈ {none, vpc}`, `strataBandDepth = "root"` (the owner's config).
 *
 * `strataTranspose` is ON in every arm. That is deliberate and load-bearing: it
 * is the owner's own config, and F1 (the re-settle driving off `placed` array
 * order instead of current Y order) made "All resources" + transpose drop EVERY
 * band silently. An arm without transpose would not have caught it, and every
 * synthetic fixture in the unit suite missed it.
 *
 * Non-negotiables (all learned the hard way, per the plan):
 *  - `clearTerraformImportPrepCache()` FIRST — prep is cached across builds;
 *  - the REAL app path (`layoutTerraformFromSources`), not the engine directly;
 *  - BAND_DEPTH pinned;
 *  - ONE `it()` per arm and **THE ARTIFACT IS WRITTEN AFTER EVERY ARM** — a
 *    predecessor timed out at 40min having written nothing.
 *
 * Metric accessors are the real ones; `pierceCount` does not exist.
 *
 * Run: yarn vitest run --config vitest.probe.config.mts \
 *        packages/excalidraw/components/terraformStrataAncillary.probe.test.ts
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
const OUT = path.resolve("scratchpad", "ancillary-allocator");

type Arm = {
  name: string;
  deBand: "none" | "vpc";
  ancillary: boolean;
  allocator: boolean;
};

const ARMS: Arm[] = [
  { name: "none/OFF", deBand: "none", ancillary: false, allocator: false },
  { name: "none/BASELINE", deBand: "none", ancillary: true, allocator: false },
  { name: "none/ALLOC", deBand: "none", ancillary: true, allocator: true },
  { name: "vpc/OFF", deBand: "vpc", ancillary: false, allocator: false },
  { name: "vpc/BASELINE", deBand: "vpc", ancillary: true, allocator: false },
  { name: "vpc/ALLOC", deBand: "vpc", ancillary: true, allocator: true },
];

/** Manual bbox — there is no `sceneHeight` metric; do not invent one. */
const sceneBox = (elements: readonly ExcalidrawElement[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.width);
    maxY = Math.max(maxY, el.y + el.height);
  }
  return {
    width: Math.round(maxX - minX),
    height: Math.round(maxY - minY),
  };
};

/**
 * The exact predicate `computePierceMetrics` uses to build its frame set
 * (`terraformPipelineStrataPierceMetrics.ts:38,228`), duplicated deliberately:
 * if the canary imported the module's own set, a change that broke the firewall
 * BY EDITING THAT SET would move both sides together and the canary would stay
 * silent. It is a copy so it can disagree.
 *
 * ⚠️ THE OBVIOUS WRONG VERSION IS `typeof role === "string"`, and it reads as
 * correct. §3j's firewall is NOT "a band has no role" — it is "a band has a role
 * that is not a TOPOLOGY_ROLE" (bands are stamped `ancillaryStrip` /
 * `ancillaryGroup`, exactly as the shipped v1 strip is). Counting any role
 * therefore counts all 326 ancillary frames and reports a firewall breach that
 * is not happening. Measured that exact false alarm on the first run of this
 * probe: 161 → 487.
 */
const TOPOLOGY_ROLES: ReadonlySet<string> = new Set([
  "provider",
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

const topoFrameCount = (elements: readonly ExcalidrawElement[]): number =>
  elements.filter((el) => {
    const role = (el.customData as { terraformTopologyRole?: string } | undefined)
      ?.terraformTopologyRole;
    return (
      el.type === "frame" && typeof role === "string" && TOPOLOGY_ROLES.has(role)
    );
  }).length;

const measure = async (arm: Arm) => {
  clearTerraformImportPrepCache();
  const t0 = Date.now();
  const res = await layoutTerraformFromSources(
    getTerraformImportPresetSourcesFromDb(PRESET) as never,
    {
      layoutMode: "strata",
      pipelineCompact: true,
      ...(arm.ancillary ? { pipelineIncludeAncillary: true } : {}),
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
        // The owner's config, and the pass F1 proved this feature was silently
        // incompatible with. Every arm runs it.
        strataTranspose: true,
        ...(arm.deBand !== "none" ? { strataDeBandLevel: arm.deBand } : {}),
      } as never),
      // Not a `resolveStrataDemoOptions` key — it rides the builder options
      // directly, and is inert unless `pipelineIncludeAncillary` is also on.
      ...(arm.ancillary ? { strataAncillaryAllocator: arm.allocator } : {}),
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
  const box = sceneBox(scene.elements);
  const pm = computePierceMetrics(scene.elements) as Record<string, any>;
  const diag = diagnosePipelineScene(scene.elements) as Record<string, any>;

  return {
    arm: arm.name,
    ok: true,
    buildMs,
    deBand: arm.deBand,
    ancillary: arm.ancillary,
    allocator: arm.allocator,
    sceneHeight: box.height,
    sceneWidth: box.width,
    elementCount: scene.elements.length,
    // RISK-B canary: bands/groups carry no topology role, so they must not enter
    // pierce's frame set ⇒ this must be IDENTICAL between OFF and the ancillary
    // arms. A falsifiable prediction; if it moves, the role firewall has failed.
    topoFrames: topoFrameCount(scene.elements),
    metrics: {
      pierceTotal: pm?.pierce?.total ?? null,
      pierceEdgeCount: pm?.pierce?.edgeCount ?? null,
      pierceUnresolved: pm?.pierce?.unresolvedEdgeCount ?? null,
      contiguityTotalViolations: pm?.contiguity?.totalViolations ?? null,
      crossings: diag?.dataflow?.crossings ?? null,
      nCross: diag?.crossingAngles?.nCross ?? null,
      sharpShare: diag?.crossingAngles?.sharpShare ?? null,
      collisionCount: diag?.collisionCount ?? null,
    },
    meta: {
      degraded: scene.meta.rcllV2Degraded ?? null,
      ancillaryDegraded: scene.meta.strataAncillaryDegraded ?? null,
      includeAncillary: scene.meta.pipelineIncludeAncillary ?? null,
      ancillaryCount: scene.meta.pipelineAncillaryCount ?? null,
      stripCount: scene.meta.pipelineAncillaryStripCount ?? null,
      bandCount: scene.meta.strataAncillaryBandCount ?? null,
      nestDepthMax: scene.meta.strataAncillaryNestDepthMax ?? null,
      relocatedStripCount:
        scene.meta.strataAncillaryRelocatedStripCount ?? null,
      containment: scene.meta.strataAncillaryContainment ?? null,
      suppressedBandCount: scene.meta.strataAncillarySuppressedBandCount ?? 0,
      suppressedHostIds: scene.meta.strataAncillarySuppressedHostIds ?? null,
      allocator: scene.meta.strataAncillaryAllocator ?? null,
    },
  };
};

describe("§3o allocator — the real measurement", () => {
  const results: Record<string, unknown>[] = [];
  for (const arm of ARMS) {
    it(
      `measures ${arm.name}`,
      async () => {
        const r = await measure(arm);
        results.push(r as Record<string, unknown>);

        // ── WRITE AFTER EVERY ARM (the 40min-zero-output lesson) ──
        const byName = new Map(results.map((x) => [x.arm as string, x]));
        const delta = (a: string, b: string) => {
          const A = byName.get(a) as { sceneHeight?: number } | undefined;
          const B = byName.get(b) as { sceneHeight?: number } | undefined;
          if (!A?.sceneHeight || !B?.sceneHeight) {
            return null;
          }
          return {
            from: B.sceneHeight,
            to: A.sceneHeight,
            deltaPx: A.sceneHeight - B.sceneHeight,
            pct: `${(
              ((A.sceneHeight - B.sceneHeight) / B.sceneHeight) *
              100
            ).toFixed(1)}%`,
          };
        };
        const summary = {
          none: {
            bandCostBaseline: delta("none/BASELINE", "none/OFF"),
            bandCostAllocator: delta("none/ALLOC", "none/OFF"),
            allocatorVsBaseline: delta("none/ALLOC", "none/BASELINE"),
          },
          vpc: {
            bandCostBaseline: delta("vpc/BASELINE", "vpc/OFF"),
            bandCostAllocator: delta("vpc/ALLOC", "vpc/OFF"),
            allocatorVsBaseline: delta("vpc/ALLOC", "vpc/BASELINE"),
          },
        };
        mkdirSync(OUT, { recursive: true });
        writeFileSync(
          path.join(OUT, "allocator.json"),
          `${JSON.stringify(
            { preset: PRESET, bandDepth: BAND_DEPTH, n: 1, summary, results },
            null,
            2,
          )}\n`,
        );
        // eslint-disable-next-line no-console
        console.log(`ARM ${arm.name} ->`, JSON.stringify(r, null, 2));

        expect(r.ok).toBe(true);
        const rr = r as Record<string, any>;
        expect(rr.meta.degraded).toBeNull();
        if (arm.ancillary) {
          // GATE 2 — a dropped band set would make every height number a lie.
          expect(rr.meta.ancillaryDegraded).toBeNull();
          expect(rr.meta.bandCount).toBeGreaterThan(0);
          expect(rr.meta.containment).toEqual({
            bandEscapesHost: 0,
            bandOverlaps: 0,
            bandTitleCollisions: 0,
          });
        }
      },
      STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 8,
    );
  }
});
