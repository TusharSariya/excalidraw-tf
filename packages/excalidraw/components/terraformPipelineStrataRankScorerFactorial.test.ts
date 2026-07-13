/**
 * W8 rank×scorer factorial battery (owner "everything ON" regression follow-up
 * to round-9/SDEC-57 and the W7 packed-scoring battery). Report-emitting,
 * W7-style: this file owns NO layout behavior and NEVER asserts gate outcomes.
 *
 * Question under test: `strataPackedScoring` was battery-validated only on
 * K4+A7 (arm I). The owner ran K4+A7+rankSeparate+packedScoring and got the
 * P1/us-west-2 SQS↔DynamoDB separation (SQS→RDS crossing an unrelated VPC
 * hull). Hypothesis: rankSeparate rewrites the X-rank columns BEFORE packed
 * scoring runs; the scorer permutes unit order only and cannot undo rank.
 * W8 crosses the rank levers (none / NS / rankSeparate) with the scorer
 * (off / on) to show factorially where the regression comes from.
 *
 * Arms (P1/P2 × compact, all strata builds):
 *   I     — sweeps:4 + coordinateRefine (W7's I arm, the paired baseline)
 *   P     — I + strataPackedScoring
 *   I_NS  — I + strataNetworkSimplexRank
 *   P_NS  — I_NS + strataPackedScoring
 *   I_RS  — I + strataRankSeparate
 *   P_RS  — I_RS + strataPackedScoring
 *   ALL   — I + NS + RS + packedScoring (expect meta strataToggleSuppressions
 *           to show the rankSeparate-wins suppression — recorded, not gated)
 *
 * Cells: per-arm battery scalars (crossings, angles, penetrations on FINAL
 * geometry, structural collisions, wall-clock), owner-case distances
 * (SQS→RDS AND SQS→Dynamo centre px + the SQS↔Dynamo owner-pair Δx/Δy
 * between primaryCluster frame centres, resolved the canonical way via
 * customData.terraformPrimaryAddress — the same resolution
 * computeStrataPathMetrics uses; no leaf-column clustering heuristic),
 * engine meta echoes
 * (packed-scoring scores/selections/trials/fellBack, rankSeparate applied/
 * changed-rank counts, toggle suppressions), and paired extent + M-RT
 * path-family CIs vs arm I (v3.2 discipline, seed 20260704 inside the shared
 * bootstrap helpers) plus the I_RS→P_RS pair (does the scorer help under RS?).
 *
 * Run:
 *   Q8_REPORT_DIR=/tmp yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataRankScorerFactorial.test.ts \
 *     --exclude "**\/.claude/**"
 * Writes W8_RANK_SCORER_REPORT.json to $Q8_REPORT_DIR (default tmpdir).
 */
import { mkdirSync, writeFileSync } from "node:fs";
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
const REPORT_DIR = process.env.Q8_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 40;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ── arms ─────────────────────────────────────────────────────────────────────

const BASE_STRATA: Record<string, unknown> = {
  layoutMode: "strata",
  pipelineCompact: true,
  strataSweeps: 4,
  strataCoordinateRefine: true,
};

const ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  I: { ...BASE_STRATA },
  P: { ...BASE_STRATA, strataPackedScoring: true },
  I_NS: { ...BASE_STRATA, strataNetworkSimplexRank: true },
  P_NS: {
    ...BASE_STRATA,
    strataNetworkSimplexRank: true,
    strataPackedScoring: true,
  },
  I_RS: { ...BASE_STRATA, strataRankSeparate: true },
  P_RS: {
    ...BASE_STRATA,
    strataRankSeparate: true,
    strataPackedScoring: true,
  },
  ALL: {
    ...BASE_STRATA,
    strataNetworkSimplexRank: true,
    strataRankSeparate: true,
    strataPackedScoring: true,
  },
};

/** [baseline, candidate] pairs. All vs I, plus the within-RS scorer pair. */
const CELL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["I", "P"],
  ["I", "I_NS"],
  ["I", "P_NS"],
  ["I", "I_RS"],
  ["I", "P_RS"],
  ["I", "ALL"],
  ["I_RS", "P_RS"],
];

// ── final-geometry penetration counter (W7's probe, reused verbatim) ─────────

type Box = { x: number; y: number; w: number; h: number };

const pointInBox = (px: number, py: number, b: Box, pad = 0): boolean =>
  px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad;

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
function countPenetrations(
  elements: readonly ExcalidrawElement[],
): { hullPenetrations: number; cardPenetrations: number } {
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

// ── owner case (round-9 screenshot), extended for W8 ─────────────────────────
//
// W7 measured SQS(regional_writer_west)→RDS centre distance. W8 adds:
//   - SQS→Dynamo centre distance, where Dynamo = the staging-extended-events
//     DynamoDB table in us-west-2 (`aws_dynamodb_table.regional_events_west`);
//   - the SQS↔Dynamo owner-pair Δx / Δy between their `primaryCluster` frame
//     centres, resolved the CANONICAL way (the same resolution the path-metrics
//     computeStrataPathMetrics uses): each node resolves to the primaryCluster
//     frame whose customData.terraformPrimaryAddress matches, and we record the
//     signed and absolute centre-to-centre Δx/Δy directly. This replaces the
//     earlier leaf-card X-centre clustering heuristic — Δx≈0 with a large Δy is
//     an unambiguous vertical (not X-column) split, read straight off the
//     frame centres rather than inferred from derived column buckets.

const SQS_PATH_RE = /aws_sqs_queue\.regional_writer_west(?![\w])/;
const DYNAMO_PATH_RE = /aws_dynamodb_table\.regional_events_west(?![\w])/;

type OwnerCaseW8 = {
  found: boolean;
  sqsToRdsPx: number | null;
  sqsToDynamoPx: number | null;
  sqsFrameCenter: { x: number; y: number } | null;
  dynamoFrameCenter: { x: number; y: number } | null;
  /** dynamo − sqs primaryCluster frame-centre delta (signed) + absolutes. */
  ownerPairDx: number | null;
  ownerPairDy: number | null;
  ownerPairDxAbs: number | null;
  ownerPairDyAbs: number | null;
  resolution: string;
} | null;

function ownerCaseW8(elements: readonly ExcalidrawElement[]): OwnerCaseW8 {
  const byPath = new Map<string, ExcalidrawElement>();
  for (const c of elements) {
    const nodePath = (c.customData as Record<string, unknown> | undefined)
      ?.nodePath;
    if (typeof nodePath === "string" && !byPath.has(nodePath) && c.width > 0) {
      byPath.set(nodePath, c);
    }
  }

  // SQS→RDS arrow, exactly as W7 finds it.
  const rdsArrow = elements.filter(isTfdArrow).find((a) => {
    const rel = (a.customData as Record<string, unknown>)
      .relationship as Record<string, string>;
    const pair = `${rel.source} ${rel.target}`;
    return pair.includes("regional_writer_west") && pair.includes("rds");
  });

  // SQS node: prefer the arrow's own source path (exact), else path-regex scan.
  let sqs: ExcalidrawElement | undefined;
  if (rdsArrow) {
    const rel = (rdsArrow.customData as Record<string, unknown>)
      .relationship as Record<string, string>;
    sqs = byPath.get(rel.source);
  }
  if (!sqs) {
    for (const [path, el] of byPath) {
      if (SQS_PATH_RE.test(path)) {
        sqs = el;
        break;
      }
    }
  }
  let dynamo: ExcalidrawElement | undefined;
  for (const [path, el] of byPath) {
    if (DYNAMO_PATH_RE.test(path)) {
      dynamo = el;
      break;
    }
  }
  let rds: ExcalidrawElement | undefined;
  if (rdsArrow) {
    const rel = (rdsArrow.customData as Record<string, unknown>)
      .relationship as Record<string, string>;
    rds = byPath.get(rel.target);
  }
  if (!sqs && !dynamo) {
    return null; // preset does not contain the owner case (P2)
  }

  const cx = (e: ExcalidrawElement) => e.x + e.width / 2;
  const cy = (e: ExcalidrawElement) => e.y + e.height / 2;
  const dist = (a?: ExcalidrawElement, b?: ExcalidrawElement): number | null =>
    a && b ? round2(Math.hypot(cx(a) - cx(b), cy(a) - cy(b))) : null;

  // Canonical resolution (mirrors computeStrataPathMetrics): resolve both nodes
  // to their primaryCluster frame via customData.terraformPrimaryAddress, then
  // record centre-to-centre Δx/Δy directly. No X-column clustering heuristic —
  // the arrow relationship source/target ARE these primary addresses, so the
  // RDS arrow's own source is the exact SQS address; Dynamo is matched by regex
  // against the frame addresses.
  const frameCenterByAddress = new Map<string, { x: number; y: number }>();
  for (const el of elements) {
    if (el.type !== "frame" || el.isDeleted) {
      continue;
    }
    const cd = el.customData as Record<string, unknown> | undefined;
    if (cd?.terraformTopologyRole !== "primaryCluster") {
      continue;
    }
    const addr = cd?.terraformPrimaryAddress;
    if (typeof addr === "string" && !frameCenterByAddress.has(addr)) {
      frameCenterByAddress.set(addr, { x: cx(el), y: cy(el) });
    }
  }
  const sqsAddress =
    (rdsArrow &&
      (
        (rdsArrow.customData as Record<string, unknown>)
          .relationship as Record<string, string>
      ).source) ||
    [...frameCenterByAddress.keys()].find((a) => SQS_PATH_RE.test(a)) ||
    null;
  const dynamoAddress =
    [...frameCenterByAddress.keys()].find((a) => DYNAMO_PATH_RE.test(a)) ?? null;
  const sqsFrameCenter =
    (sqsAddress && frameCenterByAddress.get(sqsAddress)) ?? null;
  const dynamoFrameCenter =
    (dynamoAddress && frameCenterByAddress.get(dynamoAddress)) ?? null;
  const ownerPairDx =
    sqsFrameCenter && dynamoFrameCenter
      ? round2(dynamoFrameCenter.x - sqsFrameCenter.x)
      : null;
  const ownerPairDy =
    sqsFrameCenter && dynamoFrameCenter
      ? round2(dynamoFrameCenter.y - sqsFrameCenter.y)
      : null;
  return {
    found: true,
    sqsToRdsPx: dist(sqs, rds),
    sqsToDynamoPx: dist(sqs, dynamo),
    sqsFrameCenter: sqsFrameCenter
      ? { x: round2(sqsFrameCenter.x), y: round2(sqsFrameCenter.y) }
      : null,
    dynamoFrameCenter: dynamoFrameCenter
      ? { x: round2(dynamoFrameCenter.x), y: round2(dynamoFrameCenter.y) }
      : null,
    ownerPairDx,
    ownerPairDy,
    ownerPairDxAbs: ownerPairDx != null ? Math.abs(ownerPairDx) : null,
    ownerPairDyAbs: ownerPairDy != null ? Math.abs(ownerPairDy) : null,
    resolution:
      "primaryCluster frame centres resolved by customData.terraformPrimaryAddress (canonical, same as computeStrataPathMetrics); Δ = dynamo − sqs frame centre",
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
  ownerCase: OwnerCaseW8;
  buildMs: number;
  elementCount: number;
  rcllV2Degraded: unknown;
  metaEcho: Record<string, unknown>;
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

/** Engine meta echoes the report records (whatever subset exists). */
function metaEcho(meta: Record<string, unknown>): Record<string, unknown> {
  const pick = (key: string): unknown => meta[key] ?? null;
  return {
    pipelineColumnCount: pick("pipelineColumnCount"),
    strataNetworkSimplexApplied: pick("strataNetworkSimplexApplied"),
    strataNetworkSimplexSkipReason: pick("strataNetworkSimplexSkipReason"),
    strataRankSeparateApplied: pick("strataRankSeparateApplied"),
    strataRankSeparatePairCount: pick("strataRankSeparatePairCount"),
    strataRankSeparateChangedRankCount: pick(
      "strataRankSeparateChangedRankCount",
    ),
    strataRankSeparateFallback: pick("strataRankSeparateFallback"),
    strataToggleSuppressions: pick("strataToggleSuppressions"),
    strataPackedScoringSelections: pick("strataPackedScoringSelections"),
    strataPackedScoringBaselineScore: pick("strataPackedScoringBaselineScore"),
    strataPackedScoringScore: pick("strataPackedScoringScore"),
    strataPackedScoringTrials: pick("strataPackedScoringTrials"),
    strataPackedScoringFellBack: pick("strataPackedScoringFellBack"),
  };
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
      ownerCase: ownerCaseW8(elements),
      buildMs: round2(buildMs),
      elementCount: elements.filter((e) => !e.isDeleted).length,
      rcllV2Degraded: meta.rcllV2Degraded,
      metaEcho: metaEcho(meta),
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
    // A cell may only be gated when it clears the per-statistic pair floor AND
    // is neither voided (unmatched>20% or n=0) nor a degenerate p90 (upper
    // bound pinned to the sample max — v3.1 §2.5 voids the p90 gate).
    gateEligible:
      statisticGateEligible(
        ci.statistic as Exclude<BootstrapStatistic, never>,
        ci.n,
      ) &&
      !ci.voided &&
      !(ci.statistic === "p90" && ci.degenerate),
  };
}

function extentCell(
  base: ReadonlyMap<string, number>,
  cand: ReadonlyMap<string, number>,
) {
  const run = (statistic: BootstrapStatistic) =>
    ciView(pairedBootstrapCi({ baseline: base, candidate: cand }, { statistic }));
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
    metaEcho: data.metaEcho,
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

/**
 * Normalized deterministic payload for byte-comparison: everything EXCEPT the
 * two fields that legitimately differ across otherwise-equivalent builds — the
 * wall-clock `buildMs`, and `metaEcho.strataToggleSuppressions` (populated on
 * ALL, empty on P_RS, yet the two produce identical geometry once NS is
 * suppressed). Comparing this payload proves the normalized AGGREGATE summary
 * (scalar counters, owner-case fields, cell values) is identical — it does not
 * compare emitted elements, slice maps, or full path rows, so it is a
 * summary-level determinism check, not a full-geometry proof.
 */
function armSummaryNormalized(data: ArmData, rows: readonly PathMetricsRow[]) {
  const { buildMs: _buildMs, metaEcho, ...rest } = armSummary(data, rows);
  const { strataToggleSuppressions: _suppressions, ...metaRest } =
    metaEcho as Record<string, unknown>;
  return { ...rest, metaEcho: metaRest };
}

// ── harness ──────────────────────────────────────────────────────────────────

describe("W8 rank×scorer factorial battery (report-emitting; never asserts gates)", () => {
  it(
    "P1 + P2 compact — {none,NS,RS} × {scorer off,on} + ALL",
    async () => {
      const softFailures: string[] = [];
      const report: Record<string, unknown> = {
        methodology:
          "W8 factorial: rank lever {none, strataNetworkSimplexRank, " +
          "strataRankSeparate} × strataPackedScoring {off, on} + the ALL arm " +
          "(NS+RS+scorer; NS expected suppressed). Per-arm battery scalars " +
          "(global crossings + angles, structural collisionCount, edge–box " +
          "penetrations on FINAL geometry (hullPenetrationsProbe — a " +
          "non-normative probe, not the M-H counter), wall-clock), owner-case " +
          "SQS(regional_writer_west)→RDS and →Dynamo(regional_events_west) " +
          "centre distances + SQS↔Dynamo Δx/Δy between primaryCluster frame " +
          "centres (canonical terraformPrimaryAddress resolution), engine meta " +
          "echoes, and paired extent + M-RT path-family CIs vs arm I plus " +
          "I_RS→P_RS. Report-only — no gate is asserted.",
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
        for (const armLabel of Object.keys(ARM_OPTIONS)) {
          const { data, pathRows } = await buildArm(
            sources,
            ARM_OPTIONS[armLabel]!,
          );
          armData.set(armLabel, data);
          armRows.set(armLabel, pathRows);
          arms[armLabel] = armSummary(data, pathRows);
          if (data.nSliceB === 0) {
            softFailures.push(`${preset}/${armLabel}: slice-B EMPTY`);
          }
          if (data.paths.sampled === 0) {
            softFailures.push(`${preset}/${armLabel}: path population EMPTY`);
          }
          if (
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

        // Determinism probe: rebuild arms I, P_RS and ALL end-to-end and
        // compare their normalized (buildMs- and suppression-free) summaries
        // against the originals; also byte-compare the I→P cell from a rebuilt
        // I. Extending beyond arm I closes the "only I was proven deterministic"
        // gap and re-exercises the two scorer-heavy arms.
        {
          for (const armLabel of ["I", "P_RS", "ALL"] as const) {
            const rebuilt = await buildArm(sources, ARM_OPTIONS[armLabel]!);
            const before = JSON.stringify(
              armSummaryNormalized(
                armData.get(armLabel)!,
                armRows.get(armLabel)!,
              ),
            );
            const after = JSON.stringify(
              armSummaryNormalized(rebuilt.data, rebuilt.pathRows),
            );
            if (before !== after) {
              softFailures.push(
                `${preset}/${armLabel}: full arm rebuild NOT deterministic (normalized: sans buildMs + suppressions)`,
              );
            }
            if (armLabel === "I") {
              const cellBefore = JSON.stringify(cells.I__vs__P);
              const cellAfter = JSON.stringify({
                extent: extentCell(
                  rebuilt.data.sliceB,
                  armData.get("P")!.sliceB,
                ),
                paths: pathsCell(rebuilt.pathRows, armRows.get("P")!),
              });
              if (cellBefore !== cellAfter) {
                softFailures.push(
                  `${preset}/I->P: cell from rebuilt I NOT byte-identical`,
                );
              }
            }
          }

          // ALL ≡ P_RS on effective geometry and comparison cells: identical
          // once buildMs and the (ALL-only) suppression list are normalized out.
          if (
            JSON.stringify(
              armSummaryNormalized(armData.get("ALL")!, armRows.get("ALL")!),
            ) !==
            JSON.stringify(
              armSummaryNormalized(armData.get("P_RS")!, armRows.get("P_RS")!),
            )
          ) {
            softFailures.push(
              `${preset}/ALL vs P_RS: effective geometry/cells NOT identical (normalized)`,
            );
          }
        }

        report[presetLabel] = { preset, arms, cells };
      }

      const json = JSON.stringify({ ...report, softFailures }, null, 2);
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(`${REPORT_DIR}/W8_RANK_SCORER_REPORT.json`, json);
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        `W8_RANK_SCORER_REPORT.json written to ${REPORT_DIR} (${json.length} bytes)`,
      );

      expect(
        softFailures,
        `harness health failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
