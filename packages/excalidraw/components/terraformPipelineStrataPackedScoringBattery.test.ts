/**
 * W7 packed-scoring acceptance battery (round-9 remedy, SDEC-57;
 * commits 6030151f8 + 81f7f86e4). Report-emitting, W5-style: this file owns
 * NO layout behavior and NEVER asserts gate outcomes — it measures the
 * `strataPackedScoring` lever against the round-9 gate plan.
 *
 * Arms (P1/P2 × compact):
 *   A_v2_baseline        — pipeline v2 (external reference)
 *   I_strata_k4_a7       — current strata default (K=4 + A7)
 *   P_strata_k4_a7_packed— I + strataPackedScoring (the lever under test)
 *
 * Cells: paired CIs for extent (p50/p90/mean-legacy, v3.2 floors) and the
 * M-RT path family, for A→I, A→P and I→P (the gate plan reads P vs BOTH).
 * Per-arm scalars: global crossings + crossing angles (battery counters),
 * structural collision count, edge–box penetrations recomputed on FINAL
 * geometry (hull frames and unrelated cards — the scorer's own term, so the
 * M-H tunneling evidence is measured where users see it), wall-clock, and
 * the owner-case SQS→RDS centre distance where the pair exists (P1).
 *
 * Run:
 *   Q7_REPORT_DIR=/tmp yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataPackedScoringBattery.test.ts \
 *     --exclude "**\/.claude/**"
 * Writes W7_PACKED_SCORING_REPORT.json to $Q7_REPORT_DIR (default tmpdir).
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

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
  type StrataPathMetrics,
} from "./terraformPipelineStrataPathMetrics";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const PRESET_1 = "staging-extended-localstack-v2";
const PRESET_2 = "staging-localstack";
const REPORT_DIR = process.env.Q7_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 12;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ── arms ─────────────────────────────────────────────────────────────────────

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
  P_strata_k4_a7_packed: {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
    strataPackedScoring: true,
  },
  // G-DESCENT converge pair. Converge is provably inert at ε 0 (strict-only
  // adoption is monotone; incumbent === best-seen), so the pair MUST carry
  // ε >= 1 — a bare P+converge arm would measure nothing. Config-2-shaped
  // (bandDepth root + A7 + rankSeparate + siftRelocate + ε 1 — the owner's
  // real URL), the configuration the hold-then-drop was diagnosed on.
  /** Config-2 substrate WITHOUT converge — the paired baseline for the lever. */
  C2_strata_config2: {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
    strataRankSeparate: true,
    strataBandDepth: "root",
    strataPackedScoring: true,
    strataSiftRelocate: true,
    strataPackedScoringEpsilon: 1,
    strataCrossWeightPenetration: 1,
    strataCrossWeightEdge: 1,
  },
  /** Config-2 + the lever under test: best-seen snapshot return. */
  Q_strata_config2_converge: {
    layoutMode: "strata",
    pipelineCompact: true,
    strataSweeps: 4,
    strataCoordinateRefine: true,
    strataRankSeparate: true,
    strataBandDepth: "root",
    strataPackedScoring: true,
    strataSiftRelocate: true,
    strataPackedScoringEpsilon: 1,
    strataCrossWeightPenetration: 1,
    strataCrossWeightEdge: 1,
    strataPackedConverge: true,
  },
};

/** [baseline, candidate] pairs the gate plan reads. */
const CELL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["A_v2_baseline", "I_strata_k4_a7"],
  ["A_v2_baseline", "P_strata_k4_a7_packed"],
  ["I_strata_k4_a7", "P_strata_k4_a7_packed"],
  ["C2_strata_config2", "Q_strata_config2_converge"],
  ["I_strata_k4_a7", "Q_strata_config2_converge"],
];

// ── final-geometry penetration counter (the scorer's term, re-measured) ─────

type Box = { x: number; y: number; w: number; h: number };

const pointInBox = (px: number, py: number, b: Box, pad = 0): boolean =>
  px >= b.x - pad &&
  px <= b.x + b.w + pad &&
  py >= b.y - pad &&
  py <= b.y + b.h + pad;

/** Proper segment vs axis-aligned box intersection (either endpoint inside counts). */
function segmentIntersectsBox(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  b: Box,
): boolean {
  if (pointInBox(x1, y1, b) || pointInBox(x2, y2, b)) {
    return true;
  }
  // Liang–Barsky clip test.
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) {
      return q >= 0;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) {
        return false;
      }
      if (r > t0) {
        t0 = r;
      }
    } else {
      if (r < t0) {
        return false;
      }
      if (r < t1) {
        t1 = r;
      }
    }
    return true;
  };
  return (
    clip(-dx, x1 - b.x) &&
    clip(dx, b.x + b.w - x1) &&
    clip(-dy, y1 - b.y) &&
    clip(dy, b.y + b.h - y1)
  );
}

/**
 * TFD arrows are emitted soft-deleted (visibility reconcile reveals them at
 * runtime), so — like the path-metrics and crossing counters — the probes
 * here deliberately do NOT filter on isDeleted.
 */
const isTfdArrow = (el: ExcalidrawElement): boolean => {
  if (el.type !== "arrow") {
    return false;
  }
  const rel = (el.customData as Record<string, unknown> | undefined)
    ?.relationship as Record<string, unknown> | undefined;
  return (
    typeof rel?.source === "string" &&
    typeof rel?.target === "string" &&
    rel?.aggregated !== true
  );
};

/** Container hulls in the pipeline/strata scene: topology-role frames. */
const HULL_ROLES = new Set(["account", "region", "vpc", "subnetZone"]);

const topologyRole = (el: ExcalidrawElement): string | undefined => {
  const role = (el.customData as Record<string, unknown> | undefined)
    ?.terraformTopologyRole;
  return typeof role === "string" ? role : undefined;
};

const isHullFrame = (el: ExcalidrawElement): boolean =>
  el.type === "frame" && HULL_ROLES.has(topologyRole(el) ?? "");

/** Per-resource card frames ("primaryCluster" wrappers). */
const isResourceCard = (el: ExcalidrawElement): boolean =>
  el.type === "frame" && topologyRole(el) === "primaryCluster";

function arrowPolyline(el: ExcalidrawElement): Array<[number, number]> {
  const pts = (el as unknown as { points?: Array<[number, number]> }).points;
  if (!Array.isArray(pts) || pts.length < 2) {
    return [];
  }
  return pts.map(([px, py]) => [el.x + px, el.y + py]);
}

/**
 * Count arrow→box penetrations on final geometry. An (arrow, box) pair counts
 * once when any polyline segment intersects the box while NEITHER arrow
 * endpoint lies inside the (2px-padded) box — endpoint boxes are the arrow's
 * own legitimate containers/targets.
 */
function countPenetrations(elements: readonly ExcalidrawElement[]): {
  hullPenetrations: number;
  cardPenetrations: number;
} {
  const arrows = elements.filter(isTfdArrow);
  const hulls: Box[] = elements
    .filter(isHullFrame)
    .map((e) => ({ x: e.x, y: e.y, w: e.width, h: e.height }));
  const cards: Box[] = elements
    .filter(isResourceCard)
    .map((e) => ({ x: e.x, y: e.y, w: e.width, h: e.height }));
  let hullPenetrations = 0;
  let cardPenetrations = 0;
  for (const arrow of arrows) {
    const poly = arrowPolyline(arrow);
    if (poly.length < 2) {
      continue;
    }
    const [sx, sy] = poly[0]!;
    const [ex, ey] = poly[poly.length - 1]!;
    const tally = (boxes: readonly Box[]): number => {
      let n = 0;
      for (const b of boxes) {
        if (pointInBox(sx, sy, b, 2) || pointInBox(ex, ey, b, 2)) {
          continue; // endpoint container/ancestor — legitimate entry
        }
        for (let i = 0; i + 1 < poly.length; i++) {
          const [x1, y1] = poly[i]!;
          const [x2, y2] = poly[i + 1]!;
          if (segmentIntersectsBox(x1, y1, x2, y2, b)) {
            n += 1;
            break;
          }
        }
      }
      return n;
    };
    hullPenetrations += tally(hulls);
    cardPenetrations += tally(cards);
  }
  return { hullPenetrations, cardPenetrations };
}

// ── owner case (round-9 screenshot): SQS regional_writer_west → RDS ─────────

function ownerCase(elements: readonly ExcalidrawElement[]) {
  const byPath = new Map<string, ExcalidrawElement>();
  for (const c of elements) {
    const nodePath = (c.customData as Record<string, unknown> | undefined)
      ?.nodePath;
    if (typeof nodePath === "string" && !byPath.has(nodePath) && c.width > 0) {
      byPath.set(nodePath, c);
    }
  }
  const arrow = elements.filter(isTfdArrow).find((a) => {
    const rel = (a.customData as Record<string, unknown>)
      .relationship as Record<string, string>;
    const pair = `${rel.source} ${rel.target}`;
    return pair.includes("regional_writer_west") && pair.includes("rds");
  });
  if (!arrow) {
    return null;
  }
  const rel = (arrow.customData as Record<string, unknown>)
    .relationship as Record<string, string>;
  const src = byPath.get(rel.source);
  const dst = byPath.get(rel.target);
  if (!src || !dst) {
    return { found: true, centreDistancePx: null };
  }
  const cx = (e: ExcalidrawElement) => e.x + e.width / 2;
  const cy = (e: ExcalidrawElement) => e.y + e.height / 2;
  return {
    found: true,
    centreDistancePx: round2(Math.hypot(cx(src) - cx(dst), cy(src) - cy(dst))),
  };
}

// ── per-arm build ────────────────────────────────────────────────────────────

type ArmData = {
  sliceB: Map<string, number>;
  nSliceB: number;
  paths: StrataPathMetrics;
  crossings: number;
  crossingAngles: {
    nCross: number;
    sharpShare: number;
    p10Deg: number;
    minDeg: number;
  };
  collisionCount: number;
  penetrations: { hullPenetrations: number; cardPenetrations: number };
  ownerCase: ReturnType<typeof ownerCase>;
  buildMs: number;
  elementCount: number;
  rcllV2Degraded: unknown;
  packedScoringMeta: unknown;
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

function pathPercentile(
  rows: readonly PathMetricsRow[],
  pick: (r: PathMetricsRow) => number,
  q: number,
): number {
  if (rows.length === 0) {
    return 0;
  }
  const vals = rows.map(pick).sort((a, b) => a - b);
  return vals[Math.min(vals.length - 1, Math.floor(vals.length * q))]!;
}

async function buildArm(
  sources: TerraformImportPresetSources,
  options: Record<string, unknown>,
): Promise<{ data: ArmData; pathRows: PathMetricsRow[] }> {
  clearTerraformImportPrepCache();
  const t0 = performance.now();
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
  const buildMs = performance.now() - t0;
  const elements = (body.elements ?? []) as ExcalidrawElement[];
  const meta = (body.meta ?? {}) as Record<string, unknown>;
  const slices = computeSliceMetrics(elements);
  const sliceB = sliceBKeyed(slices.perEdge);
  const paths = computeStrataPathMetrics(elements);
  const diag = diagnosePipelineScene(elements);
  return {
    data: {
      sliceB,
      nSliceB: sliceB.size,
      paths,
      crossings: diag.dataflow.crossings,
      crossingAngles: {
        nCross: diag.crossingAngles.nCross,
        sharpShare: round4(diag.crossingAngles.sharpShare),
        p10Deg: round2(diag.crossingAngles.p10Deg),
        minDeg: round2(diag.crossingAngles.minDeg),
      },
      collisionCount: diag.collisionCount,
      penetrations: countPenetrations(elements),
      ownerCase: ownerCase(elements),
      buildMs: round2(buildMs),
      elementCount: elements.filter((e) => !e.isDeleted).length,
      rcllV2Degraded: meta.rcllV2Degraded,
      packedScoringMeta: {
        fellBack: meta.strataPackedScoringFellBack ?? null,
        hasSelections: meta.strataPackedScoringSelections != null,
      },
    },
    pathRows: paths.rows,
  };
}

// ── cells ────────────────────────────────────────────────────────────────────

function ciView(ci: BootstrapCiResult) {
  return {
    statistic: ci.statistic,
    n: ci.n,
    nUnmatched: ci.nUnmatched,
    point: round4(ci.point),
    lo: round4(ci.lo),
    hi: round4(ci.hi),
    degenerate: ci.degenerate,
    voided: ci.voided,
    ciExcludesZeroImproving: !ci.voided && ci.hi < 0,
    ciExcludesZeroWorsening: !ci.voided && ci.lo > 0,
    gateEligible: statisticGateEligible(
      ci.statistic as Exclude<BootstrapStatistic, never>,
      ci.n,
    ),
  };
}

function extentCell(
  base: ReadonlyMap<string, number>,
  cand: ReadonlyMap<string, number>,
) {
  const run = (statistic: BootstrapStatistic) =>
    ciView(
      pairedBootstrapCi({ baseline: base, candidate: cand }, { statistic }),
    );
  return { p50: run("p50"), p90: run("p90"), meanLegacy: run("mean") };
}

function pathsCell(
  baseRows: readonly PathMetricsRow[],
  candRows: readonly PathMetricsRow[],
) {
  const ci = pairedPathMetricsCi(baseRows, candRows);
  return {
    rtHatP50: ciView(ci.rtHatP50),
    rtHatP90: ciView(ci.rtHatP90),
    conP90: ciView(ci.conP90),
    crP90: ciView(ci.crP90),
    tllP50: ciView(ci.tllP50),
  };
}

function armSummary(data: ArmData, rows: readonly PathMetricsRow[]) {
  return {
    elementCount: data.elementCount,
    nSliceB: data.nSliceB,
    crossings: data.crossings,
    crossingAngles: data.crossingAngles,
    collisionCount: data.collisionCount,
    penetrations: data.penetrations,
    ownerCase: data.ownerCase,
    buildMs: data.buildMs,
    rcllV2Degraded: data.rcllV2Degraded ?? null,
    packedScoringMeta: data.packedScoringMeta,
    paths: {
      populationTotal: data.paths.populationTotal,
      sampled: data.paths.sampled,
      edgeCoverage: data.paths.edgeCoverage,
      unresolvedPathCount: data.paths.unresolvedPathCount,
      rtHatP50: round2(pathPercentile(rows, (r) => r.rtHat, 0.5)),
      rtHatP90: round2(pathPercentile(rows, (r) => r.rtHat, 0.9)),
      conP90: round2(pathPercentile(rows, (r) => r.con, 0.9)),
      crP90: pathPercentile(rows, (r) => r.cr, 0.9),
      tllP50: round2(pathPercentile(rows, (r) => r.tll, 0.5)),
    },
  };
}

// ── harness ──────────────────────────────────────────────────────────────────

describe("W7 packed-scoring battery (report-emitting; never asserts gates)", () => {
  it(
    "P1 + P2 compact — strataPackedScoring vs I and vs v2",
    async () => {
      const softFailures: string[] = [];
      const report: Record<string, unknown> = {
        methodology:
          "Round-9 gate plan cells for the strataPackedScoring lever: paired " +
          "extent CIs ON p50/p90 + M-RT path family for A→I, A→P, I→P; " +
          "battery global crossings + angles; structural collisionCount; " +
          "edge–box penetrations recomputed on FINAL geometry (hulls + " +
          "unrelated cards, endpoint-padded 2px); owner-case SQS→RDS centre " +
          "distance; per-arm wall-clock. Report-only — no gate is asserted.",
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
        const armRows = new Map<string, PathMetricsRow[]>();
        const arms: Record<string, unknown> = {};
        // W10b known flag (owner-flagged in W15 for the `_BC` arms):
        // bandDepth-"root" arms legitimately produce an EMPTY slice-B (edges
        // reclassify B→A) — confirmed on BOTH presets in the W15 bandCompact
        // battery. NOT a converge regression. The whitelist is deliberately
        // narrow: (1) exact (preset, arm) pairs only — a new preset added to
        // the battery is NOT auto-whitelisted; (2) OFF/ON PARITY required —
        // both Config-2 arms must empty together on that preset, so a NEW
        // empty slice on just one side of the pair still fails the health
        // gate. Every other arm hard-fails as before.
        const SLICE_B_ROOT_CUT_ARMS = [
          "C2_strata_config2",
          "Q_strata_config2_converge",
        ] as const;
        const SLICE_B_ROOT_CUT_EMPTY_PRESETS: ReadonlySet<string> = new Set([
          "P1",
          "P2",
        ]);
        const emptyRootCutSliceB = new Set<string>();
        for (const armLabel of Object.keys(ARM_OPTIONS)) {
          const { data, pathRows } = await buildArm(
            sources,
            ARM_OPTIONS[armLabel]!,
          );
          armData.set(armLabel, data);
          armRows.set(armLabel, pathRows);
          arms[armLabel] = armSummary(data, pathRows);
          if (data.nSliceB === 0) {
            if (
              (SLICE_B_ROOT_CUT_ARMS as readonly string[]).includes(
                armLabel,
              ) &&
              SLICE_B_ROOT_CUT_EMPTY_PRESETS.has(presetLabel)
            ) {
              // Deferred: whitelisted only if the paired arm empties too.
              emptyRootCutSliceB.add(armLabel);
            } else {
              softFailures.push(`${preset}/${armLabel}: slice-B EMPTY`);
            }
          }
          if (data.paths.sampled === 0) {
            softFailures.push(`${preset}/${armLabel}: path population EMPTY`);
          }
          if (
            armLabel !== "A_v2_baseline" &&
            data.rcllV2Degraded !== undefined &&
            data.rcllV2Degraded !== false
          ) {
            softFailures.push(
              `${preset}/${armLabel}: rcllV2Degraded=${JSON.stringify(
                data.rcllV2Degraded,
              )}`,
            );
          }
        }

        // OFF/ON parity gate for the deferred root-cut empties: whitelisted
        // ONLY when BOTH Config-2 arms emptied on this preset. A one-sided
        // empty is a NEW divergence between the paired arms → health failure.
        if (emptyRootCutSliceB.size > 0) {
          if (emptyRootCutSliceB.size === SLICE_B_ROOT_CUT_ARMS.length) {
            // eslint-disable-next-line no-console -- probe output IS the deliverable
            console.log(
              `${preset}: slice-B EMPTY for ${[...emptyRootCutSliceB].join(
                " + ",
              )} (whitelisted W10b bandDepth-root behavior; OFF/ON parity held)`,
            );
          } else {
            for (const armLabel of emptyRootCutSliceB) {
              softFailures.push(
                `${preset}/${armLabel}: slice-B EMPTY without OFF/ON parity (paired Config-2 arm non-empty)`,
              );
            }
          }
        }

        const cells: Record<string, unknown> = {};
        for (const [baseLabel, candLabel] of CELL_PAIRS) {
          const b = armData.get(baseLabel)!;
          const c = armData.get(candLabel)!;
          const bRows = armRows.get(baseLabel)!;
          const cRows = armRows.get(candLabel)!;
          const cell = {
            extent: extentCell(b.sliceB, c.sliceB),
            paths: pathsCell(bRows, cRows),
          };
          const again = {
            extent: extentCell(b.sliceB, c.sliceB),
            paths: pathsCell(bRows, cRows),
          };
          if (JSON.stringify(cell) !== JSON.stringify(again)) {
            softFailures.push(
              `${preset}/${baseLabel}->${candLabel}: cell recompute NOT deterministic`,
            );
          }
          cells[`${baseLabel}__vs__${candLabel}`] = cell;
        }

        report[presetLabel] = { preset, arms, cells };
      }

      const json = JSON.stringify({ ...report, softFailures }, null, 2);
      writeFileSync(`${REPORT_DIR}/W7_PACKED_SCORING_REPORT.json`, json);
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        `W7_PACKED_SCORING_REPORT.json written to ${REPORT_DIR} (${json.length} bytes)`,
      );

      expect(
        softFailures,
        `harness health failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
