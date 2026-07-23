/**
 * Aesthetic-edges — capture the EDGE-QUALITY BASELINE on the owner's exact
 * config. Metrics-only; mutates NOTHING (this whole file is `.probe.test.ts`,
 * excluded from the base vitest config — see `vitest.probe.config.mts`). Run
 * ONLY via the private probe config:
 *
 *   yarn vitest run --config vitest.probe.config.mts \
 *     packages/excalidraw/components/terraformStrataEdgeScoreboard.probe.test.ts
 *
 * TWO ARMS — the REAL app path (`layoutTerraformFromSources`) on preset
 * staging-extended-localstack-v2 with the owner's URL options resolved through
 * `resolveStrataDemoOptions` (the same demo→engine resolver the share URL uses),
 * at compact:false:
 *   • owner-baseline — the owner's nightly plain-curve config
 *   • owner-box      — the same config + `strataBoxEndpoints:true` (M5/M6 opt-in:
 *                      declared edges terminate on the labeled leaf-cluster frame
 *                      border instead of the resource card)
 *
 * Each arm logs ONE `SCOREBOARD <arm> {json}` line: the edge scoreboard
 * ({@link computeStrataEdgeScoreboard}) + the existing pierce / crossing
 * diagnostics (`computePierceMetrics`, `diagnosePipelineScene`) + the repair
 * keep/flatten provenance packed into `scene.meta`.
 *
 * GATE (permanent, cross-arm): box endpoints must not increase card overlaps —
 * `cardOverlapCount(owner-box) <= cardOverlapCount(owner-baseline)`. Everything
 * else is a SANITY INVARIANT (per-arm internal consistency). `wrongFaceCrossings`
 * is computed + printed for BOTH arms but INFORMATIONAL ONLY: any-face
 * termination on the frame border is legal by design, so it is never gated.
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
const buildArm = async ({
  boxEndpoints,
}: {
  boxEndpoints: boolean;
}): Promise<Scene> => {
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
      // owner-box arm: the ONLY delta vs owner-baseline.
      strataBoxEndpoints: boxEndpoints,
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

const logScoreboard = (
  arm: string,
  m: ReturnType<typeof armMetrics>,
): void => {
  // eslint-disable-next-line no-console
  console.log(
    `SCOREBOARD ${arm} ${JSON.stringify({
      ...m.scoreboard,
      declared: m.declared,
      pierce: m.pierce,
      crossings: m.crossings,
      ownCardReentry: m.ownCardReentry,
      repairMeta: m.repairMeta,
    })}`,
  );
};

/** Per-arm internal-consistency checks (no cross-arm / aspirational thresholds).
 * Note: `wrongFaceCrossings <= hullBoundaryCrossings` here is a structural
 * SUBSET invariant (wrong-face crossings are a subset of all boundary
 * crossings), NOT a legality gate on wrong-face termination — that is
 * informational only and never gated across arms. */
const assertArmSane = (m: ReturnType<typeof armMetrics>): void => {
  assertScoreboardSane(m);
  expect(m.scoreboard.edgeCount).toBeGreaterThan(0);
  expect(m.scoreboard.routedCount).toBeGreaterThan(0);
  // The scoreboard's edge set == the FULL declared-dataflow census. The shipped
  // scene soft-hides the whole declared layer (nonDeleted === 0), so the
  // scoreboard counts every declared arrow regardless of isDeleted.
  expect(m.declared.nonDeleted).toBe(0);
  expect(m.scoreboard.edgeCount).toBe(m.declared.total);
  // Both metric modules see the same declared-edge population.
  expect(m.scoreboard.edgeCount).toBe(m.pierce.edgeCount);
  expect(m.pierce.edgeCount).toBeGreaterThan(0);
};

describe("strata edge-quality scoreboard — owner-config baseline + box endpoints", () => {
  it(
    "captures both arms and gates box endpoints on card overlap",
    async () => {
      const ownerBaseline = armMetrics(await buildArm({ boxEndpoints: false }));
      const ownerBox = armMetrics(await buildArm({ boxEndpoints: true }));

      logScoreboard("owner-baseline", ownerBaseline);
      logScoreboard("owner-box", ownerBox);

      // ── SANITY INVARIANTS (per-arm internal consistency).
      assertArmSane(ownerBaseline);
      assertArmSane(ownerBox);

      // ── PERMANENT GATE (cross-arm): box endpoints must not increase card
      // overlaps. `wrongFaceCrossings` stays INFORMATIONAL (printed above, never
      // asserted) — any-face termination on the frame border is legal by design.
      expect(ownerBox.scoreboard.cardOverlapCount).toBeLessThanOrEqual(
        ownerBaseline.scoreboard.cardOverlapCount,
      );
    },
    TIMEOUT,
  );
});
