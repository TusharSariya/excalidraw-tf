/**
 * Aesthetic-edges — capture the EDGE-QUALITY BASELINE on the owner's exact
 * config. Metrics-only; mutates NOTHING (this whole file is `.probe.test.ts`,
 * excluded from the base vitest config — see `vitest.probe.config.mts`). Run
 * ONLY via the private probe config:
 *
 *   yarn vitest run --config vitest.probe.config.mts \
 *     packages/excalidraw/components/terraformStrataEdgeScoreboard.probe.test.ts
 *
 * ONE ARM — the REAL app path (`layoutTerraformFromSources`) on preset
 * staging-extended-localstack-v2 with the owner's URL options resolved through
 * `resolveStrataDemoOptions` (the same demo→engine resolver the share URL uses),
 * at compact:false:
 *   • owner-baseline — the owner's nightly plain-curve config
 *
 * The arm logs ONE `SCOREBOARD owner-baseline {json}` line: the edge scoreboard
 * ({@link computeStrataEdgeScoreboard}) + the existing pierce / crossing
 * diagnostics (`computePierceMetrics`, `diagnosePipelineScene`) + the repair
 * keep/flatten provenance packed into `scene.meta`. Assertions are SANITY
 * INVARIANTS only — THIS run IS the baseline, so no aspirational thresholds. A
 * later milestone adds a second arm.
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { layoutTerraformFromSources } from "./terraformLayoutCore";
import { resolveStrataDemoOptions } from "./terraformStrataDefaults";
import { getTerraformEdgeLayer } from "./terraformVisibility";
import { computeStrataEdgeScoreboard } from "./terraformStrataEdgeScoreboard";
import { computePierceMetrics } from "./terraformPipelineStrataPierceMetrics";
import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

const PRESET = "staging-extended-localstack-v2";
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 20;

const v2Sources = () =>
  getTerraformImportPresetSourcesFromDb(
    PRESET,
  ) as unknown as TerraformPlanParsingSources;

type Scene = { elements: ExcalidrawElement[]; meta: Record<string, unknown> };

/**
 * Owner's exact URL options, resolved through the same demo→engine path the
 * share URL uses. NOTE on option-key names (corrections vs the raw URL param
 * spellings): the top-level layout options are `pipelineCompact` (URL `compact`),
 * `pipelineIncludeAncillary` (URL `ancillary`) and `pipelinePrivateApiRegional`
 * (URL `privateApiRegional`); the strata flags go through `resolveStrataDemoOptions`
 * whose param names are `strataCoordRefine` (→ engine `strataCoordinateRefine`),
 * `strataSift` (→ engine `strataSiftRelocate`) and `strataDeBandLevel` (URL
 * `strataDeBand`). All other strata param names match the URL verbatim.
 */
const buildArm = async (): Promise<Scene> => {
  const res = await layoutTerraformFromSources(v2Sources(), {
    layoutMode: "strata",
    pipelineCompact: false,
    pipelineIncludeAncillary: false,
    pipelinePrivateApiRegional: true,
    ...resolveStrataDemoOptions({
      strataSweeps: 4,
      strataCoordRefine: true,
      strataRankSeparate: true,
      strataPackedScoring: false,
      strataEdgeStyle: "curve",
      strataBandDepth: "root",
      strataDeBandLevel: "vpc",
      strataSift: true,
      strataBlockClamp: true,
      strataTranspose: true,
      strataColumnGap: 250,
      strataRowGap: 1.5,
    }),
  } as Record<string, unknown>);
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res.scene as Scene;
};

/** Census of the declared-dataflow arrows (deleted vs not) — resolves whether
 * the shipped scene soft-hides them (layer pin off) so `edgeCount` is never a
 * silent 0. */
const declaredCensus = (
  elements: readonly ExcalidrawElement[],
): { total: number; nonDeleted: number; deleted: number } => {
  let total = 0;
  let nonDeleted = 0;
  for (const el of elements) {
    if (
      el.type === "arrow" &&
      getTerraformEdgeLayer(el) === "declaredDataFlow"
    ) {
      total += 1;
      if (!el.isDeleted) {
        nonDeleted += 1;
      }
    }
  }
  return { total, nonDeleted, deleted: total - nonDeleted };
};

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

const armMetrics = (scene: Scene) => {
  const els = scene.elements;
  const scoreboard = computeStrataEdgeScoreboard(els);
  const pierce = computePierceMetrics(els);
  const diag = diagnosePipelineScene(els) as unknown as {
    dataflow: { crossings: number };
    badPatterns: { endpointOcclusion: { ownCardReentryCount: number } };
  };
  const meta = scene.meta ?? {};
  return {
    scoreboard,
    declared: declaredCensus(els),
    pierce: {
      total: pierce.pierce.total,
      edgeCount: pierce.pierce.edgeCount,
      unresolved: pierce.pierce.unresolvedEdgeCount,
      contiguityViolations: pierce.contiguity.totalViolations,
    },
    crossings: diag.dataflow.crossings,
    ownCardReentry: diag.badPatterns.endpointOcclusion.ownCardReentryCount,
    repairMeta: {
      styled: num(meta.strataEdgeStyleStyled),
      routedKept: num(meta.strataRoutedPolylinesKept),
      routedFlattened: num(meta.strataRoutedPolylinesFlattened),
      keptBy: (meta.strataRoutedPolylinesKeptBy ?? {}) as Record<
        string,
        number
      >,
      flattenedBy: (meta.strataRoutedPolylinesFlattenedBy ?? {}) as Record<
        string,
        number
      >,
    },
  };
};

const assertScoreboardSane = (arm: ReturnType<typeof armMetrics>): void => {
  const s = arm.scoreboard;
  const finiteNonNeg = [
    s.edgeCount,
    s.routedCount,
    s.backwardXPx,
    s.backwardEdgeCount,
    s.minCardClearancePx,
    s.cardOverlapCount,
    s.wrongFaceCrossings,
    s.hullBoundaryCrossings,
    s.detourRatioP95,
  ];
  for (const n of finiteNonNeg) {
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
  }
  // routed ⊆ edges; wrong-face ⊆ all boundary crossings.
  expect(s.routedCount).toBeLessThanOrEqual(s.edgeCount);
  expect(s.wrongFaceCrossings).toBeLessThanOrEqual(s.hullBoundaryCrossings);
};

describe("strata edge-quality scoreboard — owner-config baseline", () => {
  it(
    "captures the baseline (owner-baseline arm)",
    async () => {
      const ownerBaseline = armMetrics(await buildArm());

      // eslint-disable-next-line no-console
      console.log(
        `SCOREBOARD owner-baseline ${JSON.stringify({
          ...ownerBaseline.scoreboard,
          declared: ownerBaseline.declared,
          pierce: ownerBaseline.pierce,
          crossings: ownerBaseline.crossings,
          ownCardReentry: ownerBaseline.ownCardReentry,
          repairMeta: ownerBaseline.repairMeta,
        })}`,
      );

      // ── SANITY INVARIANTS (no aspirational thresholds — this IS the baseline).
      assertScoreboardSane(ownerBaseline);

      // The declared-dataflow edge set is non-empty and its geometry is measured;
      // the plain-curve style stamps routed polylines, so routedCount > 0.
      expect(ownerBaseline.scoreboard.edgeCount).toBeGreaterThan(0);
      expect(ownerBaseline.scoreboard.routedCount).toBeGreaterThan(0);

      // The scoreboard's edge set == the FULL declared-dataflow census. The
      // shipped scene soft-hides the whole declared layer (nonDeleted === 0), so
      // the scoreboard counts every declared arrow regardless of isDeleted.
      expect(ownerBaseline.declared.nonDeleted).toBe(0);
      expect(ownerBaseline.scoreboard.edgeCount).toBe(
        ownerBaseline.declared.total,
      );
      // Both metric modules see the same declared-edge population.
      expect(ownerBaseline.scoreboard.edgeCount).toBe(
        ownerBaseline.pierce.edgeCount,
      );
      expect(ownerBaseline.pierce.edgeCount).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});
