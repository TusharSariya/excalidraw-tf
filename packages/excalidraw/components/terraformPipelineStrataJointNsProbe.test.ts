/**
 * W5b joint constrained-NS probe harness (round-8 R8-F9). Report-emitting,
 * W5-style: NEVER asserts gate outcomes — it compares the sequential
 * rankSeparate composition (arm J) against the joint constrained-NS solve
 * (arm X) with the v3.2 instruments, so the "rankSeparate WINS, NS dropped"
 * mutual-exclusion rule can be adjudicated on evidence.
 *
 * Arms (P1/P2 compact): A_v2_baseline · I (K4+A7) · J (K4+A7+RS sequential) ·
 * X (K4+A7+RS+jointNS — the probe; the joint floor REPLACES the sequential
 * separated floor when the solve succeeds and satisfies every constraint).
 *
 * Run:
 *   Q2_REPORT_DIR=/tmp yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataJointNsProbe.test.ts \
 *     --exclude "**\/.claude/**"
 * Writes W5B_JOINT_NS_PROBE_REPORT.json to $Q2_REPORT_DIR (default tmpdir).
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import {
  canonicalEdgeKey,
  pairedBootstrapCi,
  statisticGateEligible,
  type BootstrapCiResult,
  type BootstrapStatistic,
} from "./terraformPipelineBootstrapCi";
import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import {
  computeSliceMetrics,
  type SliceEdgeRow,
} from "./terraformPipelineSliceMetrics";
import {
  computeStrataPathMetrics,
  pairedPathMetricsCi,
  type PathMetricsRow,
} from "./terraformPipelineStrataPathMetrics";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const PRESET_1 = "staging-extended-localstack-v2";
const PRESET_2 = "staging-localstack";
const REPORT_DIR = process.env.Q2_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

const ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  A_v2_baseline: {
    layoutMode: "pipeline",
    pipelineLayoutVariant: "v2",
    pipelineCompact: true,
  },
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
  X_strata_k4_a7_jointns: {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
    strataRankSeparate: true,
    strataJointNsRank: true,
  },
};

type ArmData = {
  sliceB: Map<string, number>;
  pathRows: PathMetricsRow[];
  crossings: number;
  crossingAngles: {
    nCross: number;
    sharpShare: number;
    p10Deg: number;
    minDeg: number;
  };
  bounds: { width: number; height: number };
  jointNs: {
    applied: unknown;
    fallback: unknown;
    realSpanBefore: unknown;
    realSpanAfter: unknown;
  } | null;
  rankSeparateApplied: unknown;
  rcllV2Degraded: unknown;
};

function sliceBKeyed(perEdge: readonly SliceEdgeRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of perEdge) {
    if (row.slice !== "B") {
      continue;
    }
    const key = canonicalEdgeKey(row.source, row.target, row.relKind);
    if (!map.has(key)) {
      map.set(key, row.extentPx);
    }
  }
  return map;
}

function sceneBounds(elements: readonly ExcalidrawElement[]): {
  width: number;
  height: number;
} {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of elements) {
    if (e.isDeleted) {
      continue;
    }
    minX = Math.min(minX, e.x);
    minY = Math.min(minY, e.y);
    maxX = Math.max(maxX, e.x + e.width);
    maxY = Math.max(maxY, e.y + e.height);
  }
  return Number.isFinite(minX)
    ? { width: round2(maxX - minX), height: round2(maxY - minY) }
    : { width: 0, height: 0 };
}

async function buildArm(
  sources: TerraformImportPresetSources,
  options: Record<string, unknown>,
): Promise<ArmData> {
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
  const meta = (body.meta ?? {}) as Record<string, unknown>;
  const diag = diagnosePipelineScene(elements);
  return {
    sliceB: sliceBKeyed(computeSliceMetrics(elements).perEdge),
    pathRows: [...computeStrataPathMetrics(elements).rows],
    crossings: diag.dataflow.crossings,
    crossingAngles: {
      nCross: diag.crossingAngles.nCross,
      sharpShare: round4(diag.crossingAngles.sharpShare),
      p10Deg: round2(diag.crossingAngles.p10Deg),
      minDeg: round2(diag.crossingAngles.minDeg),
    },
    bounds: sceneBounds(elements),
    jointNs:
      meta.strataJointNsApplied !== undefined
        ? {
            applied: meta.strataJointNsApplied,
            fallback: meta.strataJointNsFallback ?? null,
            realSpanBefore: meta.strataJointNsRealSpanBefore ?? null,
            realSpanAfter: meta.strataJointNsRealSpanAfter ?? null,
          }
        : null,
    rankSeparateApplied: meta.strataRankSeparateApplied,
    rcllV2Degraded: meta.rcllV2Degraded,
  };
}

function ciView(ci: BootstrapCiResult) {
  return {
    statistic: ci.statistic,
    n: ci.n,
    point: round4(ci.point),
    lo: round4(ci.lo),
    hi: round4(ci.hi),
    degenerate: ci.degenerate,
    voided: ci.voided,
    ciExcludesZeroImproving: !ci.voided && ci.hi < 0,
    gateEligible: statisticGateEligible(
      ci.statistic as Exclude<BootstrapStatistic, never>,
      ci.n,
    ),
  };
}

function cellOf(base: ArmData, cand: ArmData) {
  const extent = (statistic: BootstrapStatistic) =>
    ciView(
      pairedBootstrapCi(
        { baseline: base.sliceB, candidate: cand.sliceB },
        { statistic },
      ),
    );
  const p = pairedPathMetricsCi(base.pathRows, cand.pathRows);
  return {
    extent: { p50: extent("p50"), p90: extent("p90") },
    paths: {
      rtHatP50: ciView(p.rtHatP50),
      rtHatP90: ciView(p.rtHatP90),
      conP90: ciView(p.conP90),
      crP90: ciView(p.crP90),
      tllP50: ciView(p.tllP50),
    },
  };
}

describe("W5b joint constrained-NS probe (report-emitting; never asserts gates)", () => {
  it(
    "P1 + P2 compact — sequential RS (J) vs joint constrained-NS (X)",
    async () => {
      const softFailures: string[] = [];
      const report: Record<string, unknown> = {
        methodology:
          "R8-F9 probe: one network-simplex solve over (real E' multiplicity-" +
          "weighted edges ∪ zero-weight all-to-all sibling-separation edges), " +
          "start floor = the sequential separated floor. Arm X replaces J's " +
          "rank when the joint floor validates against BOTH edge sets.",
      };

      for (const [presetLabel, preset] of [
        ["P1", PRESET_1],
        ["P2", PRESET_2],
      ] as const) {
        const raw = getTerraformImportPresetSourcesFromDb(preset);
        expect(raw, `preset ${preset} exists`).toBeTruthy();
        const sources = resolveSourcesWithTfdComposition(
          raw! as TerraformImportPresetSources,
        );

        const armData = new Map<string, ArmData>();
        const arms: Record<string, unknown> = {};
        for (const armLabel of Object.keys(ARM_OPTIONS)) {
          const data = await buildArm(sources, ARM_OPTIONS[armLabel]!);
          armData.set(armLabel, data);
          arms[armLabel] = {
            crossings: data.crossings,
            crossingAngles: data.crossingAngles,
            bounds: data.bounds,
            rankSeparateApplied: data.rankSeparateApplied ?? null,
            jointNs: data.jointNs,
            rcllV2Degraded: data.rcllV2Degraded ?? null,
          };
          if (
            data.rcllV2Degraded !== undefined &&
            data.rcllV2Degraded !== false &&
            armLabel !== "A_v2_baseline"
          ) {
            softFailures.push(
              `${preset}/${armLabel}: rcllV2Degraded=${JSON.stringify(
                data.rcllV2Degraded,
              )}`,
            );
          }
        }

        // Probe health: X must actually have run the probe (meta echo present)
        // on top of a live rankSeparate; a fallback is a valid RESULT (recorded
        // in the report), but a MISSING echo means the threading broke.
        const x = armData.get("X_strata_k4_a7_jointns")!;
        if (x.jointNs === null) {
          softFailures.push(
            `${preset}/X: strataJointNsApplied echo MISSING (threading broken?)`,
          );
        }

        const base = armData.get("A_v2_baseline")!;
        report[presetLabel] = {
          preset,
          arms,
          cells: {
            A__vs__I: cellOf(base, armData.get("I_strata_k4_a7")!),
            A__vs__J: cellOf(base, armData.get("J_strata_k4_a7_rs")!),
            A__vs__X: cellOf(base, x),
            // The direct adjudication cell: joint (X) paired against sequential (J).
            J__vs__X: cellOf(armData.get("J_strata_k4_a7_rs")!, x),
          },
        };
      }

      const json = JSON.stringify({ ...report, softFailures }, null, 2);
      writeFileSync(`${REPORT_DIR}/W5B_JOINT_NS_PROBE_REPORT.json`, json);
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        `W5B_JOINT_NS_PROBE_REPORT.json written to ${REPORT_DIR} (${json.length} bytes)`,
      );

      expect(
        softFailures,
        `harness health failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
