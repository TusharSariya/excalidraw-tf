/**
 * Aesthetic-edges LOOP 0 — capture the EDGE-QUALITY BASELINE on the owner's
 * exact config, gating every later experiment. Metrics-only; mutates NOTHING
 * (this whole file is `.probe.test.ts`, excluded from the base vitest config —
 * see `vitest.probe.config.mts`). Run ONLY via the private probe config:
 *
 *   yarn vitest run --config vitest.probe.config.mts \
 *     packages/excalidraw/components/terraformStrataEdgeScoreboard.probe.test.ts
 *
 * TWO ARMS, both the REAL app path (`layoutTerraformFromSources`) on preset
 * staging-extended-localstack-v2 with the owner's URL options resolved through
 * `resolveStrataDemoOptions` (the same demo→engine resolver the share URL uses),
 * differing only in `compact`:
 *   • owner-full — compact:false (the owner's nightly URL)
 *   • compact    — compact:true
 *
 * Each arm logs ONE `SCOREBOARD <arm> {json}` line: the new edge scoreboard
 * ({@link computeStrataEdgeScoreboard}) + the existing pierce / crossing
 * diagnostics (`computePierceMetrics`, `diagnosePipelineScene`) + the repair
 * keep/flatten provenance packed into `scene.meta`. Assertions are SANITY
 * INVARIANTS only — THIS run IS the baseline, so no aspirational thresholds.
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
const buildArm = async (
  compact: boolean,
  extraStrata: Record<string, unknown> = {},
): Promise<Scene> => {
  const res = await layoutTerraformFromSources(v2Sources(), {
    layoutMode: "strata",
    pipelineCompact: compact,
    pipelineIncludeAncillary: false,
    pipelinePrivateApiRegional: true,
    ...resolveStrataDemoOptions({
      strataSweeps: 4,
      strataCoordRefine: true,
      strataRankSeparate: true,
      strataPackedScoring: false,
      strataBorderRoute: true,
      strataEdgeStyle: "curve",
      strataBandDepth: "root",
      strataDeBandLevel: "vpc",
      strataSift: true,
      strataBlockClamp: true,
      strataTranspose: true,
      strataHeightGate: true,
      ...extraStrata,
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

/**
 * E2.4 lane census: backwardXPx attribution split between lane edges
 * (`customData.terraformClipLane` — sanctioned over-the-top travel) and
 * non-lane edges (must be ≈0 once the Z-detours ride lanes), plus the
 * above/below lane counts. Mirrors the scoreboard's backward-X definition
 * (Σ max(0, −Δx) over consecutive absolute points of NET-FORWARD edges).
 */
const laneCensus = (
  elements: readonly ExcalidrawElement[],
): {
  laneEdges: number;
  laneAbove: number;
  laneBelow: number;
  laneBackwardXPx: number;
  nonLaneBackwardXPx: number;
} => {
  let laneEdges = 0;
  let laneAbove = 0;
  let laneBelow = 0;
  let laneBackwardXPx = 0;
  let nonLaneBackwardXPx = 0;
  for (const el of elements) {
    if (
      el.type !== "arrow" ||
      getTerraformEdgeLayer(el) !== "declaredDataFlow"
    ) {
      continue;
    }
    const pts = (
      (el as { points?: ReadonlyArray<readonly [number, number]> }).points ?? []
    ).map(([px, py]) => [el.x + px, el.y + py] as const);
    if (pts.length < 2) {
      continue;
    }
    const lane = (el.customData as Record<string, unknown> | undefined)
      ?.terraformClipLane;
    if (lane === "above" || lane === "below") {
      laneEdges += 1;
      if (lane === "above") {
        laneAbove += 1;
      } else {
        laneBelow += 1;
      }
    }
    const netForward = pts[pts.length - 1]![0] - pts[0]![0] > 1;
    if (!netForward) {
      continue;
    }
    let back = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const dx = pts[i + 1]![0] - pts[i]![0];
      if (dx < 0) {
        back += -dx;
      }
    }
    if (lane === "above" || lane === "below") {
      laneBackwardXPx += back;
    } else {
      nonLaneBackwardXPx += back;
    }
  }
  return {
    laneEdges,
    laneAbove,
    laneBelow,
    laneBackwardXPx: Math.round(laneBackwardXPx * 100) / 100,
    nonLaneBackwardXPx: Math.round(nonLaneBackwardXPx * 100) / 100,
  };
};

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
    lanes: laneCensus(els),
    pierce: {
      total: pierce.pierce.total,
      edgeCount: pierce.pierce.edgeCount,
      unresolved: pierce.pierce.unresolvedEdgeCount,
      contiguityViolations: pierce.contiguity.totalViolations,
    },
    crossings: diag.dataflow.crossings,
    ownCardReentry: diag.badPatterns.endpointOcclusion.ownCardReentryCount,
    smoothMeta: {
      smoothed: num(meta.strataEdgeSmoothSmoothed),
      kinksRemoved: num(meta.strataEdgeSmoothKinksRemoved),
      collinearRemoved: num(meta.strataEdgeSmoothCollinearRemoved),
      cornersRounded: num(meta.strataEdgeSmoothCornersRounded),
      cornersBlocked: num(meta.strataEdgeSmoothCornersBlocked),
      cornersBudget: num(meta.strataEdgeSmoothCornersBudget),
      pointsBefore: num(meta.strataEdgeSmoothPointsBefore),
      pointsAfter: num(meta.strataEdgeSmoothPointsAfter),
    },
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
    "captures the LOOP-0 baseline (owner-full compact:false + compact arm)",
    async () => {
      const ownerFull = armMetrics(await buildArm(false));
      const compact = armMetrics(await buildArm(true));
      // Third arm: owner config + the around-boxes router — the pass whose
      // backward-loop detours E1.3 reworks; backwardXPx is only exercisable here.
      const ownerRouting = armMetrics(
        await buildArm(false, { strataEdgeRouting: true }),
      );
      // Fourth arm: owner config + channel router — full mode is where the
      // channel's 107-edge frame-vs-body self-flatten signature lived (E1.2).
      const ownerChannel = armMetrics(
        await buildArm(false, { strataChannelRoute: true }),
      );
      // Fifth arm (loop-2 E2.1+E2.2): owner config + the container-boundary
      // CLIP pass — endpoints ON the leaf frame borders with LR port
      // discipline, so clipped edges contribute ≈0 wrong-face crossings and
      // survive repair via the typed clip gate (flattenedBy must not contain
      // "clip").
      const ownerClip = armMetrics(
        await buildArm(false, { strataEdgeClip: true }),
      );
      // Sixth arm (loop-3 E3.1): owner config + clip + the GLEE smoothing
      // pass — the finishing treatment over the clip polylines (kink
      // shortcut, collinear dedupe, chamfer rounding, roundness:null
      // exact-path rendering). The critical gate: NOTHING the smoother
      // touched may get flattened by repair (flattenedBy stays empty).
      const ownerClipSmooth = armMetrics(
        await buildArm(false, { strataEdgeClip: true, strataEdgeSmooth: true }),
      );

      for (const [arm, m] of [
        ["owner-full", ownerFull],
        ["compact", compact],
        ["owner-routing", ownerRouting],
        ["owner-channel", ownerChannel],
        ["owner-clip", ownerClip],
        ["owner-clip-smooth", ownerClipSmooth],
      ] as const) {
        // eslint-disable-next-line no-console
        console.log(
          `SCOREBOARD ${arm} ${JSON.stringify({
            ...m.scoreboard,
            declared: m.declared,
            lanes: m.lanes,
            pierce: m.pierce,
            crossings: m.crossings,
            ownCardReentry: m.ownCardReentry,
            repairMeta: m.repairMeta,
            smoothMeta: m.smoothMeta,
          })}`,
        );
      }

      // ── SANITY INVARIANTS (no aspirational thresholds — this IS the baseline).
      assertScoreboardSane(ownerFull);
      assertScoreboardSane(compact);
      assertScoreboardSane(ownerRouting);
      assertScoreboardSane(ownerChannel);
      assertScoreboardSane(ownerClip);
      assertScoreboardSane(ownerClipSmooth);
      expect(ownerRouting.scoreboard.edgeCount).toBe(
        ownerFull.scoreboard.edgeCount,
      );
      expect(ownerChannel.scoreboard.edgeCount).toBe(
        ownerFull.scoreboard.edgeCount,
      );
      expect(ownerClip.scoreboard.edgeCount).toBe(
        ownerFull.scoreboard.edgeCount,
      );
      // Loop-2 clip gate contract: repair must never flatten a clip-stamped
      // polyline on the unmoved import geometry — the typed frame-face gate
      // validates them by construction.
      expect(ownerClip.repairMeta.flattenedBy.clip ?? 0).toBe(0);

      // ── Loop-3 E3.1 gates on the owner-clip-smooth arm. ──
      expect(ownerClipSmooth.scoreboard.edgeCount).toBe(
        ownerFull.scoreboard.edgeCount,
      );
      // THE critical gate: nothing the smoother touched got flattened —
      // endpoints never move and provenance is never restamped, so repair's
      // flatten census must be EMPTY on this arm.
      expect(ownerClipSmooth.repairMeta.flattenedBy).toEqual({});
      // The smoothed clip population survives repair exactly as un-smoothed.
      expect(ownerClipSmooth.repairMeta.keptBy.clip ?? 0).toBe(
        ownerClip.repairMeta.keptBy.clip ?? 0,
      );
      // LR port discipline is untouched by smoothing.
      expect(ownerClipSmooth.scoreboard.wrongFaceCrossings).toBe(0);
      // Rounding must not ADD card touches (the 12px clearance test should
      // only ever improve it) — gate against the clip arm's own count.
      expect(ownerClipSmooth.scoreboard.cardOverlapCount).toBeLessThanOrEqual(
        ownerClip.scoreboard.cardOverlapCount,
      );
      // The pass actually ran and simplified: smoothed > 0 and the point
      // census moved (or at worst stayed flat — never grew past the budget).
      expect(ownerClipSmooth.smoothMeta.smoothed ?? 0).toBeGreaterThan(0);

      // The declared-dataflow edge set is non-empty and its geometry is measured.
      expect(ownerFull.scoreboard.edgeCount).toBeGreaterThan(0);
      expect(compact.scoreboard.edgeCount).toBeGreaterThan(0);
      expect(ownerFull.scoreboard.routedCount).toBeGreaterThan(0);
      expect(compact.scoreboard.routedCount).toBeGreaterThan(0);

      // The scoreboard's edge set == the FULL declared-dataflow census. The
      // shipped scene soft-hides the whole declared layer (nonDeleted === 0),
      // so the scoreboard counts every declared arrow regardless of isDeleted
      // (see the module header) — 145 on this preset in both arms.
      expect(ownerFull.declared.nonDeleted).toBe(0);
      expect(ownerFull.scoreboard.edgeCount).toBe(ownerFull.declared.total);
      expect(compact.scoreboard.edgeCount).toBe(compact.declared.total);
      // Both metric modules see the same declared-edge population.
      expect(ownerFull.scoreboard.edgeCount).toBe(ownerFull.pierce.edgeCount);

      // Pierce diagnostics resolve the same dataflow edges (cross-check the two
      // metric modules agree the scene has a real TFD edge population).
      expect(ownerFull.pierce.edgeCount).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});
