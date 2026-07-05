/**
 * Focused pin for the ADDITIVE v3.1 §2.5 per-edge export (WP-3e scope
 * extension): `computeSliceMetrics(...).perEdge`.
 *
 * Proves, on BOTH a hand-built fixture and a real preset scene, that the
 * per-edge rows carry exactly the classification + geometry the existing
 * aggregates are computed from: recomputing the `extent.A`/`extent.B`
 * aggregates from the rows (same sort / nearest-rank percentile / round2 /
 * 24px near-straight conventions) reproduces the reported aggregates
 * verbatim, and `populations.nA`/`nB` equal the per-slice row counts. This is
 * the additivity guarantee the frozen docs/strata-baselines/*.json aggregates
 * rely on (they are NOT regenerated).
 */
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import {
  computeSliceMetrics,
  type SliceEdgeRow,
  type SliceExtentStats,
} from "./terraformPipelineSliceMetrics";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

// ── aggregate recomputation (mirrors computeSliceMetrics's module-private
// extentStatsFor / percentileAt / round2 / NEAR_STRAIGHT_MAX_PX — deliberately
// re-declared, NOT exported from the module under test, so this test fails if
// the module's conventions drift from the pinned ones) ───────────────────────

const NEAR_STRAIGHT_MAX_PX = 24;
const round2 = (n: number): number => Math.round(n * 100) / 100;

function percentileAt(sortedAsc: readonly number[], fraction: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.floor(sortedAsc.length * fraction),
  );
  return sortedAsc[idx]!;
}

function recomputeExtentStats(rows: readonly SliceEdgeRow[]): SliceExtentStats {
  const extents = rows.map((r) => r.extentPx).sort((a, b) => a - b);
  const n = extents.length;
  const mean = n ? extents.reduce((a, b) => a + b, 0) / n : 0;
  const nearStraightCount = extents.filter(
    (d) => d <= NEAR_STRAIGHT_MAX_PX,
  ).length;
  return {
    n,
    p50: round2(percentileAt(extents, 0.5)),
    p90: round2(percentileAt(extents, 0.9)),
    mean: round2(mean),
    fractionNearStraight: n ? round2(nearStraightCount / n) : 0,
    nearStraightCount,
  };
}

function assertPerEdgeConsistency(elements: readonly ExcalidrawElement[]) {
  const m = computeSliceMetrics(elements);
  const rowsA = m.perEdge.filter((r) => r.slice === "A");
  const rowsB = m.perEdge.filter((r) => r.slice === "B");
  expect(rowsA.length).toBe(m.populations.nA);
  expect(rowsB.length).toBe(m.populations.nB);
  expect(m.perEdge.length).toBe(m.populations.nA + m.populations.nB);
  expect(recomputeExtentStats(rowsA)).toEqual(m.extent.A);
  expect(recomputeExtentStats(rowsB)).toEqual(m.extent.B);
  return m;
}

// ── synthetic fixture (same element factories convention as
// terraformPipelineSliceMetrics.test.ts, minimal subset) ─────────────────────

function cluster(
  address: string,
  path: string[],
  x: number,
  y: number,
): ExcalidrawElement {
  return {
    id: address,
    type: "frame",
    x,
    y,
    width: 40,
    height: 40,
    angle: 0,
    isDeleted: false,
    customData: {
      terraformTopologyRole: "primaryCluster",
      terraformPrimaryAddress: address,
      terraformTopologyPath: path,
    },
  } as unknown as ExcalidrawElement;
}

function arrow(
  source: string,
  target: string,
  pts: Array<[number, number]>,
  relType?: string,
): ExcalidrawElement {
  const [ox, oy] = pts[0]!;
  return {
    id: `arrow:${source}->${target}:${relType ?? ""}`,
    type: "arrow",
    x: ox,
    y: oy,
    width: 0,
    height: 0,
    angle: 0,
    points: pts.map(([px, py]) => [px - ox, py - oy]),
    isDeleted: false,
    customData: {
      relationship: {
        source,
        target,
        aggregated: false,
        ...(relType ? { type: relType } : {}),
      },
    },
  } as unknown as ExcalidrawElement;
}

describe("perEdge export (synthetic fixture)", () => {
  it("rows carry source/target/relKind/slice/extentPx; aggregates recompute exactly", () => {
    const els = [
      // slice A pair (same vpc, different subnets)
      cluster("a", ["aws", "acct1", "us-east-1", "vpc-1", "s-a"], 0, 0),
      cluster("b", ["aws", "acct1", "us-east-1", "vpc-1", "s-b"], 300, 0),
      // slice B pair (same account, different regions)
      cluster("c", ["aws", "acct1", "us-east-1"], 0, 200),
      cluster("d", ["aws", "acct1", "us-west-2"], 300, 200),
      arrow(
        "a",
        "b",
        [
          [40, 20],
          [300, 50],
        ],
        "dataflow",
      ),
      // no relationship.type ⇒ relKind "" (the churn-metrics convention)
      arrow("c", "d", [
        [40, 220],
        [300, 220],
      ]),
      // unresolved endpoint ⇒ excluded from perEdge, counted
      arrow("a", "ghost", [
        [40, 20],
        [300, 20],
      ]),
    ];
    const m = assertPerEdgeConsistency(els);
    expect(m.populations.unresolvedEdgeCount).toBe(1);
    expect(m.perEdge).toEqual([
      {
        source: "a",
        target: "b",
        relKind: "dataflow",
        slice: "A",
        extentPx: 30,
      },
      { source: "c", target: "d", relKind: "", slice: "B", extentPx: 0 },
    ]);
  });

  it("determinism: identical rows on repeat", () => {
    const build = () => [
      cluster("a", ["aws", "acct1", "us-east-1"], 0, 0),
      cluster("b", ["aws", "acct1", "us-west-2"], 300, 0),
      arrow("a", "b", [
        [40, 20],
        [300, 90],
      ]),
    ];
    expect(computeSliceMetrics(build()).perEdge).toEqual(
      computeSliceMetrics(build()).perEdge,
    );
  });
});

// ── real preset (the coordinator-required pin) ───────────────────────────────

const PRESET = "staging-localstack";

describe("perEdge export (real preset)", () => {
  it(
    `${PRESET} — aggregates recomputed from perEdge rows equal reported aggregates (v2 + strata arms)`,
    async () => {
      const raw = getTerraformImportPresetSourcesFromDb(PRESET);
      expect(raw, `preset ${PRESET} exists`).toBeTruthy();
      const sources = resolveSourcesWithTfdComposition(
        raw! as TerraformImportPresetSources,
      );
      const arms: Array<Record<string, unknown>> = [
        {
          layoutMode: "pipeline",
          pipelineLayoutVariant: "v2",
          pipelineCompact: true,
        },
        { layoutMode: "strata", pipelineCompact: true, strataSweeps: 4 },
      ];
      for (const options of arms) {
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
        const m = assertPerEdgeConsistency(
          body.elements as ExcalidrawElement[],
        );
        expect(m.perEdge.length).toBeGreaterThan(0);
      }
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 2,
  );
});
