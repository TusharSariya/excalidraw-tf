/**
 * W10b `strataBandCompact` adjudication battery (WP3 of the W10 Stage-2 plan;
 * follows the Stage-1 ceiling probe terraformPipelineStrataBandCompactProbe
 * .test.ts and the W8 factorial terraformPipelineStrataRankScorerFactorial
 * .test.ts). Report-emitting, W7/W8/W10a-style: this file owns NO layout
 * behavior, changes NO product geometry, and NEVER asserts metric values — it
 * asserts ONLY harness health (report written, presets exist, scenes/paths
 * non-empty, determinism, R2 structural counts zero, no rcllV2 degradation,
 * softFailures empty). Every adjudication number (BC height/rt̂ effect, PS on
 * the final substrate, ε divergence, churn) is REPORT-only for the owner's one
 * decision pass.
 *
 * Arms (P1 = staging-extended-localstack-v2, P2 = staging-localstack; all
 * K=4 sweeps + coordRefine on):
 *   1 I             — all levers off (absolute baseline / byte anchor)
 *   2 I_BC          — strataBandCompact only (inertness proof vs I on P1/P2)
 *   3 I_RS          — strataRankSeparate only (paired substrate anchor)
 *   4 I_RS_BC       — RS + BC (main lever, isolated)
 *   5 P_RS          — RS + strataPackedScoring, ε0 (W7-waiver pre-BC substrate)
 *   6 P_RS_BC       — RS + PS + BC (PS × BC interaction)
 *   7 P_RS_BC_eps1  — RS + PS + BC + strataPackedScoringEpsilon:1 (ε adjudication)
 *
 * Isolating paired contrasts (paired bootstrap CI p50/p90 on rt̂ and extent,
 * v3.2 discipline, seed 20260704, floors n≥31/10 inside the shared helpers):
 *   BC effect            I_RS→I_RS_BC   and   P_RS→P_RS_BC
 *   PS on final substrate I_RS_BC→P_RS_BC
 *   ε                    P_RS_BC→P_RS_BC_eps1
 *   rt̂ vs I (height wins inadmissible without rt̂ pairing) for arms 4/6/7.
 *
 * Churn cells (arms I_RS, I_RS_BC, P_RS_BC, P_RS_BC_eps1): per arm build base →
 * apply add-mutation → rebuild → computeStrataChurnMetrics(base, mutated); same
 * for a rename mutation (with the renames opt). Report M1_rel / M2_flip per arm
 * per mutation, with the register thresholds (M1_rel≤0.08 / M2_flip≤0.10) noted
 * as REFERENCE VALUES only (report-only; the battery never gates on them). The
 * add/rename mutation builders are DELIBERATELY DUPLICATED (minimally) from
 * terraformPipelineStrataChurnTriple.test.ts (owner D3: blast-radius over DRY);
 * churnTriple stays untouched and green.
 *
 * Run:
 *   Q10B_REPORT_DIR=/tmp yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataBandCompactBattery.test.ts \
 *     --exclude "**\/.claude/**"
 * Writes W10B_BAND_COMPACT_BATTERY.json to $Q10B_REPORT_DIR (default tmpdir).
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
import { computeStrataChurnMetrics } from "./terraformPipelineStrataChurnMetrics";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";
import type { TerraformPlanDotBundle } from "./terraformImportMerge";

const PRESET_1 = "staging-extended-localstack-v2";
const PRESET_2 = "staging-localstack";
const REPORT_DIR = process.env.Q10B_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 60;

/** Register reference thresholds (v3.1 §3 / gate register) — echoed into the
 * JSON for the reader; the battery NEVER gates on them (report-only). */
const M1_REL_THRESHOLD = 0.08;
const M2_FLIP_THRESHOLD = 0.1;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ── arms (K=4 sweeps + coordRefine everywhere) ───────────────────────────────

const BASE_STRATA: Record<string, unknown> = {
  layoutMode: "strata",
  pipelineCompact: true,
  strataSweeps: 4,
  strataCoordinateRefine: true,
};

const ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  I: { ...BASE_STRATA },
  I_BC: { ...BASE_STRATA, strataBandCompact: true },
  I_RS: { ...BASE_STRATA, strataRankSeparate: true },
  I_RS_BC: {
    ...BASE_STRATA,
    strataRankSeparate: true,
    strataBandCompact: true,
  },
  P_RS: {
    ...BASE_STRATA,
    strataRankSeparate: true,
    strataPackedScoring: true,
  },
  P_RS_BC: {
    ...BASE_STRATA,
    strataRankSeparate: true,
    strataPackedScoring: true,
    strataBandCompact: true,
  },
  P_RS_BC_eps1: {
    ...BASE_STRATA,
    strataRankSeparate: true,
    strataPackedScoring: true,
    strataBandCompact: true,
    strataPackedScoringEpsilon: 1,
  },
};

const ARM_LABELS = Object.keys(ARM_OPTIONS);
const BC_ARMS = new Set(["I_BC", "I_RS_BC", "P_RS_BC", "P_RS_BC_eps1"]);
const PS_ARMS = new Set(["P_RS", "P_RS_BC", "P_RS_BC_eps1"]);
/** BC arms under rankSeparate — where a real height reclaim is expected. */
const RS_BC_ARMS = new Set(["I_RS_BC", "P_RS_BC", "P_RS_BC_eps1"]);

/** Isolating paired [baseline, candidate] contrasts (extent + rt̂ CIs). */
const CELL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["I_RS", "I_RS_BC"], // BC effect (isolated)
  ["P_RS", "P_RS_BC"], // BC effect (on the PS substrate)
  ["I_RS_BC", "P_RS_BC"], // PS on the final (post-BC) substrate
  ["P_RS_BC", "P_RS_BC_eps1"], // ε on the final substrate
  ["I", "I_RS_BC"], // rt̂ vs I — arm 4
  ["I", "P_RS_BC"], // rt̂ vs I — arm 6
  ["I", "P_RS_BC_eps1"], // rt̂ vs I — arm 7
];

/** Churn arms: I_RS baseline + all three BC arms (D4 — supports W7 waiver + ε). */
const CHURN_ARMS = ["I_RS", "I_RS_BC", "P_RS_BC", "P_RS_BC_eps1"];
/** Determinism rebuilds: baseline, main BC lever, ε arm (subset, budget). */
const DETERMINISM_ARMS = ["I", "I_RS_BC", "P_RS_BC_eps1"];

// ── scene readers (roles) ────────────────────────────────────────────────────

/** Penetration-probe hull roles — W8's exact set (comparable to W8/M-H probe;
 * NOT the banded-level set, which is provider|account). */
const PENETRATION_HULL_ROLES = new Set([
  "account",
  "region",
  "vpc",
  "subnetZone",
]);

const topologyRole = (el: ExcalidrawElement): string | undefined => {
  const role = (el.customData as Record<string, unknown> | undefined)
    ?.terraformTopologyRole;
  return typeof role === "string" ? role : undefined;
};

const isPenetrationHull = (el: ExcalidrawElement): boolean =>
  el.type === "frame" && PENETRATION_HULL_ROLES.has(topologyRole(el) ?? "");

const isResourceCard = (el: ExcalidrawElement): boolean =>
  el.type === "frame" && topologyRole(el) === "primaryCluster";

const frameName = (el: ExcalidrawElement): string | null => {
  const name = (el as unknown as { name?: unknown }).name;
  return typeof name === "string" ? name : null;
};

/**
 * TFD arrows are emitted soft-deleted (visibility reconcile reveals them at
 * runtime), so — like the path-metrics and crossing counters — the probes
 * here deliberately do NOT filter on isDeleted (same as W7/W8/W10a).
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

// ── final-geometry penetration counter (W8's probe, reused verbatim) ─────────

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

function arrowPolyline(el: ExcalidrawElement): Array<[number, number]> {
  const pts = (el as unknown as { points?: Array<[number, number]> }).points;
  if (!Array.isArray(pts) || pts.length < 2) {
    return [];
  }
  return pts.map(([px, py]) => [el.x + px, el.y + py]);
}

function countPenetrations(elements: readonly ExcalidrawElement[]): {
  hullPenetrations: number;
  cardPenetrations: number;
} {
  const arrows = elements.filter(isTfdArrow);
  const hulls: Box[] = elements
    .filter(isPenetrationHull)
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
          continue;
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

// ── banded-level heights + canvas height ─────────────────────────────────────

type BandLevels = {
  canvasHeight: number;
  provider: Array<{ name: string | null; height: number }>;
  account: Array<{ name: string | null; height: number }>;
};

function bandLevels(elements: readonly ExcalidrawElement[]): BandLevels {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const el of elements) {
    if (el.isDeleted) {
      continue;
    }
    minY = Math.min(minY, el.y);
    maxY = Math.max(maxY, el.y + el.height);
  }
  const canvasHeight = round2(Number.isFinite(maxY - minY) ? maxY - minY : 0);
  const byRole = (role: string) =>
    elements
      .filter(
        (e) => e.type === "frame" && !e.isDeleted && topologyRole(e) === role,
      )
      .sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
      .map((e) => ({ name: frameName(e), height: round2(e.height) }));
  return {
    canvasHeight,
    provider: byRole("provider"),
    account: byRole("account"),
  };
}

// ── actual chord lengths (W10a's address resolution; REAL per-arm geometry,
// not the Stage-1 invariant-by-construction estimate — divergence is expected
// and IS the point) ──────────────────────────────────────────────────────────

type ChordCell = {
  found: boolean;
  /** found:false ⟺ a resource address is absent from the preset (P2 has no
   * WAF/SQS resources) — a MISSING pair, never a measured Δ0. */
  absentFromPreset: boolean;
  sourceAddress: string | null;
  targetAddress: string | null;
  lengthPx: number | null;
};

function chordCells(elements: readonly ExcalidrawElement[]): {
  wafElb: ChordCell;
  sqsRds: ChordCell;
  sqsDynamo: ChordCell;
} {
  const cards = elements.filter(isResourceCard).filter((e) => !e.isDeleted);
  const cardByAddress = new Map<string, ExcalidrawElement>();
  for (const card of cards) {
    const addr = (card.customData as Record<string, unknown> | undefined)
      ?.terraformPrimaryAddress;
    if (typeof addr === "string" && !cardByAddress.has(addr)) {
      cardByAddress.set(addr, card);
    }
  }
  const findAddress = (re: RegExp): string | null =>
    [...cardByAddress.keys()].find((a) => re.test(a)) ?? null;

  const cx = (e: ExcalidrawElement) => e.x + e.width / 2;
  const cy = (e: ExcalidrawElement) => e.y + e.height / 2;
  const chord = (
    sourceAddress: string | null,
    targetAddress: string | null,
  ): ChordCell => {
    const a = sourceAddress ? cardByAddress.get(sourceAddress) : undefined;
    const b = targetAddress ? cardByAddress.get(targetAddress) : undefined;
    if (!a || !b) {
      return {
        found: false,
        absentFromPreset: true,
        sourceAddress,
        targetAddress,
        lengthPx: null,
      };
    }
    return {
      found: true,
      absentFromPreset: false,
      sourceAddress,
      targetAddress,
      lengthPx: round2(Math.hypot(cx(b) - cx(a), cy(b) - cy(a))),
    };
  };

  // WAF→ELB (owner obs 1): waf_acl = aws_wafv2_web_acl.api, ELB = aws_lb.ecs.
  const wafAddr = findAddress(/aws_wafv2_web_acl\.api(?![\w])/);
  const elbAddr = findAddress(/aws_lb\.ecs(?![\w])/);
  // Owner SQS pairs (round-9 case): SQS→RDS via the TFD arrow's own addresses,
  // Dynamo by address regex.
  const sqsAddr = findAddress(/aws_sqs_queue\.regional_writer_west(?![\w])/);
  const dynamoAddr = findAddress(
    /aws_dynamodb_table\.regional_events_west(?![\w])/,
  );
  let rdsAddr: string | null = null;
  const rdsArrow = elements.filter(isTfdArrow).find((a) => {
    const rel = (a.customData as Record<string, unknown>)
      .relationship as Record<string, string>;
    const pair = `${rel.source} ${rel.target}`;
    return pair.includes("regional_writer_west") && pair.includes("rds");
  });
  if (rdsArrow) {
    const rel = (rdsArrow.customData as Record<string, unknown>)
      .relationship as Record<string, string>;
    rdsAddr =
      [rel.source, rel.target].find(
        (addr) => /rds|db_instance/i.test(addr) && cardByAddress.has(addr),
      ) ?? null;
  }
  return {
    wafElb: chord(wafAddr, elbAddr),
    sqsRds: chord(sqsAddr, rdsAddr),
    sqsDynamo: chord(sqsAddr, dynamoAddr),
  };
}

// ── engine meta echoes (BC + PS + RS + structural) ───────────────────────────

function metaEcho(meta: Record<string, unknown>): Record<string, unknown> {
  const pick = (key: string): unknown =>
    Object.prototype.hasOwnProperty.call(meta, key) ? meta[key] : null;
  const has = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(meta, key);
  return {
    pipelineColumnCount: pick("pipelineColumnCount"),
    // BC meta (WP1): Requested rides the fallback too; AppliedHullCount is the
    // count of banded hulls that took the skyline branch (success path only);
    // ReclaimedPx is present ONLY when > 0.
    strataBandCompactRequested: pick("strataBandCompactRequested"),
    strataBandCompactRequestedPresent: has("strataBandCompactRequested"),
    strataBandCompactAppliedHullCount: pick(
      "strataBandCompactAppliedHullCount",
    ),
    strataBandCompactReclaimedPx: pick("strataBandCompactReclaimedPx"),
    strataBandCompactReclaimedPxPresent: has("strataBandCompactReclaimedPx"),
    // RS meta.
    strataRankSeparateApplied: pick("strataRankSeparateApplied"),
    strataRankSeparatePairCount: pick("strataRankSeparatePairCount"),
    strataRankSeparateChangedRankCount: pick(
      "strataRankSeparateChangedRankCount",
    ),
    strataRankSeparateFallback: pick("strataRankSeparateFallback"),
    // PS meta (arms 5-7).
    strataPackedScoringSelections: pick("strataPackedScoringSelections"),
    strataPackedScoringBaselineScore: pick("strataPackedScoringBaselineScore"),
    strataPackedScoringScore: pick("strataPackedScoringScore"),
    strataPackedScoringTrials: pick("strataPackedScoringTrials"),
    strataPackedScoringFellBack: pick("strataPackedScoringFellBack"),
    strataPackedScoringEpsilon: pick("strataPackedScoringEpsilon"),
    strataPackedScoringEffectiveDelta: pick(
      "strataPackedScoringEffectiveDelta",
    ),
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
  chords: ReturnType<typeof chordCells>;
  bandLevels: BandLevels;
  buildMs: number;
  elementCount: number;
  rcllV2Degraded: unknown;
  strataStructural: unknown;
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

async function buildArmFrom(
  planDotBundles: readonly TerraformPlanDotBundle[],
  tfdTexts: readonly string[],
  tfdLabels: readonly string[],
  options: Record<string, unknown>,
): Promise<{
  data: ArmData;
  pathRows: PathMetricsRow[];
  elements: ExcalidrawElement[];
}> {
  clearTerraformImportPrepCache();
  const t0 = performance.now();
  const body = await layoutTerraformViaWorkers(
    {
      planDotBundles: [...planDotBundles],
      states: [],
      stateLabels: [],
      tfdTexts: [...tfdTexts],
      tfdLabels: [...tfdLabels],
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
      chords: chordCells(elements),
      bandLevels: bandLevels(elements),
      buildMs: round2(buildMs),
      elementCount: elements.filter((e) => !e.isDeleted).length,
      rcllV2Degraded: meta.rcllV2Degraded,
      strataStructural: meta.strataStructural ?? null,
      metaEcho: metaEcho(meta),
    },
    pathRows: paths.rows,
    elements,
  };
}

async function buildArm(
  sources: TerraformImportPresetSources,
  options: Record<string, unknown>,
) {
  return buildArmFrom(
    sources.planDotBundles,
    sources.tfdTexts,
    sources.tfdLabels,
    options,
  );
}

// ── paired-CI cells (W8 machinery, reused) ───────────────────────────────────

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
    chords: data.chords,
    bandLevels: data.bandLevels,
    buildMs: data.buildMs,
    rcllV2Degraded: data.rcllV2Degraded ?? null,
    strataStructural: data.strataStructural,
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

/** Normalized summary for determinism byte-comparison: drop only the wall-clock
 * buildMs (everything else is deterministic — no toggle-suppression field here,
 * unlike W8). */
function armSummaryNormalized(data: ArmData, rows: readonly PathMetricsRow[]) {
  const { buildMs: _buildMs, ...rest } = armSummary(data, rows);
  return rest;
}

// ── I_BC ≡ I scene-level element comparison (report-only, expected-true on
// P1/P2 only — owner D1: no account-direct leaves in these presets) ───────────

/** Strip volatile per-element fields that legitimately differ across otherwise
 * identical builds. */
function normalizeElement(el: ExcalidrawElement): unknown {
  const {
    version: _v,
    versionNonce: _vn,
    updated: _u,
    seed: _s,
    ...rest
  } = el as unknown as Record<string, unknown>;
  return rest;
}

function sceneEquality(
  a: readonly ExcalidrawElement[],
  b: readonly ExcalidrawElement[],
): {
  equal: boolean;
  countA: number;
  countB: number;
  differingElementCount: number;
  differingByType: Record<string, number>;
} {
  const differingByType: Record<string, number> = {};
  let differingElementCount = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const ea = a[i];
    const eb = b[i];
    const sa = ea ? JSON.stringify(normalizeElement(ea)) : null;
    const sb = eb ? JSON.stringify(normalizeElement(eb)) : null;
    if (sa !== sb) {
      differingElementCount += 1;
      const type = (ea?.type ?? eb?.type ?? "unknown") as string;
      differingByType[type] = (differingByType[type] ?? 0) + 1;
    }
  }
  return {
    equal: a.length === b.length && differingElementCount === 0,
    countA: a.length,
    countB: b.length,
    differingElementCount,
    differingByType,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Churn mutation builders — DELIBERATELY DUPLICATED (minimally) from
// terraformPipelineStrataChurnTriple.test.ts (owner D3: blast-radius over DRY;
// churnTriple's gate harness stays untouched & green). Only the two mutations
// this battery uses (add-one-resource, moved{}-rename) and their strict
// dependency closure are copied — NOT the add-one-edge path or unrelated
// helpers. Mechanics mirror churnTriple:463 (add) and :545 (rename).
// ─────────────────────────────────────────────────────────────────────────────

type RawPlan = {
  resource_changes: Array<Record<string, unknown>>;
  prior_state?: { values?: { root_module?: unknown } };
  [k: string]: unknown;
};

type BindEntry = {
  alias: string;
  rhs: string;
  fileIndex: number;
  lineIndex: number;
};

type ParsedAddress = {
  prefix: string;
  type: string;
  name: string;
  indexSuffix: string;
};

type BindCandidate = BindEntry & { bareAddress: string; parsed: ParsedAddress };

type MutationPayload = {
  label: "addOneResource" | "movedRename";
  planDotBundles: TerraformPlanDotBundle[];
  tfdTexts: string[];
  note: string;
  oldAddress: string;
  newAddress: string;
};

/** Single-target `src -> tgt` edge line (mirrors churnTriple's isEdgeLine). */
const isEdgeLine = (line: string): { src: string; tgt: string } | null => {
  const t = line.trim();
  if (!t || t.startsWith("#") || /^bind\s/i.test(t) || t.includes("-->")) {
    return null;
  }
  const m = t.match(/^([^\s#]+)\s*->\s*(.+)$/);
  if (!m) {
    return null;
  }
  const targets = m[2]!.split(",").map((s) => s.trim());
  if (targets.length !== 1) {
    return null;
  }
  return { src: m[1]!, tgt: targets[0]! };
};

/** index of the tfd file with the most single-target edge lines. */
const pickTfdFile = (texts: readonly string[]): number => {
  let best = -1;
  let bestCount = -1;
  texts.forEach((t, i) => {
    const n = (t ?? "")
      .split(/\r?\n/)
      .filter((l) => isEdgeLine(l) != null).length;
    if (n > bestCount) {
      bestCount = n;
      best = i;
    }
  });
  expect(bestCount).toBeGreaterThan(10);
  return best;
};

function parseAllBindEntries(texts: readonly string[]): BindEntry[] {
  const out: BindEntry[] = [];
  texts.forEach((text, fileIndex) => {
    const lines = (text ?? "").split(/\r?\n/);
    lines.forEach((line, lineIndex) => {
      const m = line.trim().match(/^bind\s+([A-Za-z_][\w]*)\s*=?\s+(.+)$/i);
      if (m) {
        out.push({ alias: m[1]!, rhs: m[2]!.trim(), fileIndex, lineIndex });
      }
    });
  });
  return out;
}

const bareAddressOf = (rhs: string): string =>
  rhs.includes("::") ? rhs.slice(rhs.indexOf("::") + 2) : rhs;

function parseResourceAddress(address: string): ParsedAddress | null {
  const m = address.match(
    /^(.*\.)?([A-Za-z_][\w-]*)\.([A-Za-z_][\w-]*)(\[[^\]]*\])?$/,
  );
  if (!m) {
    return null;
  }
  return {
    prefix: m[1] ?? "",
    type: m[2]!,
    name: m[3]!,
    indexSuffix: m[4] ?? "",
  };
}

function pickBindCandidate(
  binds: readonly BindEntry[],
  resourceAddresses: ReadonlySet<string>,
  opts: { requireNoBracket?: boolean } = {},
): BindCandidate {
  for (const b of binds) {
    const bare = bareAddressOf(b.rhs);
    if (!resourceAddresses.has(bare)) {
      continue;
    }
    if (opts.requireNoBracket && bare.includes("[")) {
      continue;
    }
    const parsed = parseResourceAddress(bare);
    if (!parsed) {
      continue;
    }
    return { ...b, bareAddress: bare, parsed };
  }
  throw new Error("pickBindCandidate: no matching bind found (harness bug)");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renameAddressTokenInText(
  text: string,
  oldAddr: string,
  newAddr: string,
): string {
  const re = new RegExp(
    `(?<![\\w.\\]])${escapeRegExp(oldAddr)}(?![\\w.[])`,
    "g",
  );
  return text.replace(re, newAddr);
}

function clonePlan(plan: unknown): RawPlan {
  return JSON.parse(JSON.stringify(plan)) as RawPlan;
}

function resourceChangeAddresses(plan: RawPlan): Set<string> {
  return new Set(
    plan.resource_changes
      .map((rc) => rc.address)
      .filter((a): a is string => typeof a === "string"),
  );
}

/** Recursively renames every `{address: oldAddr}` object's `.address` (+ `.name`
 * + any `depends_on` reference) across the whole plan object graph. */
function renameAddressEverywhereInPlan(
  plan: RawPlan,
  oldAddr: string,
  newAddr: string,
  newName: string,
): number {
  let count = 0;
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item);
      }
      return;
    }
    if (node && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      if (typeof obj.address === "string" && obj.address === oldAddr) {
        obj.address = newAddr;
        count += 1;
        if (typeof obj.name === "string") {
          obj.name = newName;
        }
      }
      if (Array.isArray(obj.depends_on)) {
        obj.depends_on = (obj.depends_on as unknown[]).map((d) =>
          d === oldAddr ? newAddr : d,
        );
      }
      for (const key of Object.keys(obj)) {
        if (key === "address" || key === "depends_on") {
          continue;
        }
        walk(obj[key]);
      }
    }
  };
  walk(plan);
  return count;
}

/** add-one-resource — clone one bind-referenced leaf resource under a fresh
 * address in the same container, wired into the declared dataflow via one new
 * bind + widening an existing single-target tfd edge into a 2-target fanout
 * (mirrors churnTriple:463). */
function buildAddResourceMutation(
  sources: TerraformImportPresetSources,
): MutationPayload {
  const bundle = sources.planDotBundles[0]!;
  const plan = clonePlan(bundle.plan);
  const resourceAddrs = resourceChangeAddresses(plan);
  const binds = parseAllBindEntries(sources.tfdTexts);
  const picked = pickBindCandidate(binds, resourceAddrs, {
    requireNoBracket: true,
  });
  const newName = `${picked.parsed.name}_a4new`;
  const newAddress = `${picked.parsed.prefix}${picked.parsed.type}.${newName}${picked.parsed.indexSuffix}`;
  expect(resourceAddrs.has(newAddress), "new address must not pre-exist").toBe(
    false,
  );

  const origEntry = plan.resource_changes.find(
    (rc) => rc.address === picked.bareAddress,
  );
  expect(origEntry, `resource_changes has ${picked.bareAddress}`).toBeTruthy();
  const clonedEntry = JSON.parse(JSON.stringify(origEntry)) as Record<
    string,
    unknown
  >;
  clonedEntry.address = newAddress;
  if (typeof clonedEntry.name === "string") {
    clonedEntry.name = newName;
  }
  plan.resource_changes = [...plan.resource_changes, clonedEntry];

  const newAlias = `${picked.alias}_a4new`;
  const newRhs = picked.rhs.includes("::")
    ? `${picked.rhs.slice(0, picked.rhs.indexOf("::"))}::${newAddress}`
    : newAddress;
  const newBindLine = `bind ${newAlias} = ${newRhs}`;

  const texts = [...sources.tfdTexts];
  const bindFileLines = texts[picked.fileIndex]!.split(/\r?\n/);
  bindFileLines.splice(picked.lineIndex + 1, 0, newBindLine);
  texts[picked.fileIndex] = bindFileLines.join("\n");

  const edgeFileIdx = pickTfdFile(texts);
  const edgeLines = texts[edgeFileIdx]!.split(/\r?\n/);
  const edgeIdx = edgeLines
    .map((l, i) => (isEdgeLine(l) ? i : -1))
    .filter((i) => i >= 0);
  expect(edgeIdx.length).toBeGreaterThan(0);
  const mid = edgeIdx[Math.floor(edgeIdx.length / 2)]!;
  const parsedEdge = isEdgeLine(edgeLines[mid]!)!;
  edgeLines[mid] = `${parsedEdge.src} -> ${parsedEdge.tgt}, ${newAlias}`;
  texts[edgeFileIdx] = edgeLines.join("\n");

  return {
    label: "addOneResource",
    planDotBundles: [{ ...bundle, plan } as unknown as TerraformPlanDotBundle],
    tfdTexts: texts,
    note:
      `duplicated resource "${picked.bareAddress}" -> "${newAddress}" ` +
      `(new bind ${newAlias}); attached via widening ` +
      `"${parsedEdge.src} -> ${parsedEdge.tgt}" into a 2-target fanout in tfd[${edgeFileIdx}]`,
    oldAddress: picked.bareAddress,
    newAddress,
  };
}

/** moved{}-rename — rename one existing resource's address consistently across
 * the plan (resource_changes + prior_state) and every tfd bind reference
 * (mirrors churnTriple:545). */
function buildRenameMutation(
  sources: TerraformImportPresetSources,
): MutationPayload {
  const bundle = sources.planDotBundles[0]!;
  const plan = clonePlan(bundle.plan);
  const resourceAddrs = resourceChangeAddresses(plan);
  const binds = [...parseAllBindEntries(sources.tfdTexts)].reverse();
  const picked = pickBindCandidate(binds, resourceAddrs, {});
  const newName = `${picked.parsed.name}_moved`;
  const newAddress = `${picked.parsed.prefix}${picked.parsed.type}.${newName}${picked.parsed.indexSuffix}`;
  expect(resourceAddrs.has(newAddress), "new address must not pre-exist").toBe(
    false,
  );

  const renameCount = renameAddressEverywhereInPlan(
    plan,
    picked.bareAddress,
    newAddress,
    newName,
  );
  expect(
    renameCount,
    "rename must hit >=1 plan object (resource_changes and/or prior_state)",
  ).toBeGreaterThanOrEqual(1);

  const texts = sources.tfdTexts.map((text) =>
    renameAddressTokenInText(text ?? "", picked.bareAddress, newAddress),
  );
  const textsChanged = texts.some((t, i) => t !== sources.tfdTexts[i]);
  expect(textsChanged, "rename must textually alter >=1 tfd file").toBe(true);

  return {
    label: "movedRename",
    planDotBundles: [{ ...bundle, plan } as unknown as TerraformPlanDotBundle],
    tfdTexts: texts,
    note: `renamed "${picked.bareAddress}" -> "${newAddress}" (bind ${picked.alias}; ${renameCount} plan object(s) updated)`,
    oldAddress: picked.bareAddress,
    newAddress,
  };
}

// ── harness ──────────────────────────────────────────────────────────────────

describe("W10b strataBandCompact adjudication battery (report-emitting; never asserts metrics)", () => {
  it(
    "P1 + P2 compact — {I, I_BC, I_RS, I_RS_BC, P_RS, P_RS_BC, P_RS_BC_eps1}",
    async () => {
      const softFailures: string[] = [];
      const report: Record<string, unknown> = {
        methodology:
          "W10b factorial: 7 arms (I, I_BC, I_RS, I_RS_BC, P_RS, P_RS_BC, " +
          "P_RS_BC_eps1) at K=4 sweeps + coordRefine, P1/P2 compact. Per-arm " +
          "battery scalars (canvas height + provider/account hull heights, " +
          "global crossings + angles, structural collisionCount, edge-box " +
          "penetrations on FINAL geometry (probe, not the M-H counter), " +
          "actual WAF->ELB / SQS->RDS / SQS->Dynamo chord lengths via the " +
          "canonical terraformPrimaryAddress resolution (absentFromPreset on " +
          "P2), R2 structural counts (meta.strataStructural incl. " +
          "contiguityViolations), BC/PS/RS meta echoes, wall-clock). Isolating " +
          "paired extent + M-RT CIs: BC effect (I_RS->I_RS_BC, P_RS->P_RS_BC), " +
          "PS on the final substrate (I_RS_BC->P_RS_BC), epsilon " +
          "(P_RS_BC->P_RS_BC_eps1), rt-hat vs I for arms 4/6/7. I_BC==I " +
          "scene-level element equality (report-only, expected-true on P1/P2). " +
          "Churn M1_rel/M2_flip (add + rename mutations) on I_RS, I_RS_BC, " +
          "P_RS_BC, P_RS_BC_eps1. Report-only — no metric or gate is asserted; " +
          "seed 20260704 inside the shared bootstrap helpers.",
        referenceThresholds: {
          note: "REPORT-ONLY reference values from the gate register (v3.1 §3); the battery NEVER gates on them.",
          m1RelThreshold: M1_REL_THRESHOLD,
          m2FlipThreshold: M2_FLIP_THRESHOLD,
        },
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
        const armElements = new Map<string, ExcalidrawElement[]>();
        const arms: Record<string, unknown> = {};
        for (const armLabel of ARM_LABELS) {
          const { data, pathRows, elements } = await buildArm(
            sources,
            ARM_OPTIONS[armLabel]!,
          );
          armData.set(armLabel, data);
          armRows.set(armLabel, pathRows);
          armElements.set(armLabel, elements);
          arms[armLabel] = {
            options: ARM_OPTIONS[armLabel],
            ...armSummary(data, pathRows),
          };
          if (elements.length === 0) {
            softFailures.push(`${preset}/${armLabel}: scene EMPTY`);
          }
          // Under the band-depth model, strataBandCompact aliases to the
          // band-depth root cut: provider/account resolve to hull.policy
          // "packed" (same as region/vpc/subnetZone today), and slice-metrics
          // (WP3) reads that resolved policy — so provider/account edges
          // reclassify from slice-B (banded) to slice-A (packed). For BC arms
          // (the arms whose ARM_OPTIONS set strataBandCompact:true, i.e.
          // BC_ARMS) slice-B legitimately empties; this is the documented
          // "characterized delta" from the band-depth slider work, not a
          // harness failure. Only exempt BC arms — every non-BC arm must
          // still trip this check.
          if (data.nSliceB === 0 && !BC_ARMS.has(armLabel)) {
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
          // R2 structural counts must be all-zero (the engine throws on a
          // nonzero count; a survivor here is a harness/engine-health failure).
          const st = data.strataStructural as {
            nonAncestorOverlaps?: number;
            titleCollisions?: number;
            contiguityViolations?: number;
          } | null;
          if (
            st &&
            ((st.nonAncestorOverlaps ?? 0) > 0 ||
              (st.titleCollisions ?? 0) > 0 ||
              (st.contiguityViolations ?? 0) > 0)
          ) {
            softFailures.push(
              `${preset}/${armLabel}: R2 structural nonzero ${JSON.stringify(
                st,
              )}`,
            );
          }
          // Meta wiring health (byte-identity of the flag-off path): Requested
          // must be present iff BC arm — a leak onto a non-BC arm is a wiring
          // bug, not a metric value.
          const requestedPresent =
            data.metaEcho.strataBandCompactRequestedPresent === true;
          if (BC_ARMS.has(armLabel) && !requestedPresent) {
            softFailures.push(
              `${preset}/${armLabel}: BC arm missing strataBandCompactRequested meta`,
            );
          }
          if (!BC_ARMS.has(armLabel) && requestedPresent) {
            softFailures.push(
              `${preset}/${armLabel}: non-BC arm leaked strataBandCompactRequested meta`,
            );
          }
        }

        // ── isolating paired contrasts ──────────────────────────────────────
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

        // ── I_BC ≡ I scene-level equality (report-only) ─────────────────────
        const iBcEquality = sceneEquality(
          armElements.get("I")!,
          armElements.get("I_BC")!,
        );

        // ── meta-echo BC consistency (report-only booleans, per BC arm) ─────
        const nonBcHeightOf: Record<string, string> = {
          I_BC: "I",
          I_RS_BC: "I_RS",
          P_RS_BC: "P_RS",
          P_RS_BC_eps1: "P_RS", // matching non-BC substrate (PS+RS)
        };
        const bcConsistency: Record<string, unknown> = {};
        for (const armLabel of BC_ARMS) {
          const d = armData.get(armLabel)!;
          const appliedHullCount =
            typeof d.metaEcho.strataBandCompactAppliedHullCount === "number"
              ? (d.metaEcho.strataBandCompactAppliedHullCount as number)
              : null;
          const reclaimedPresent =
            d.metaEcho.strataBandCompactReclaimedPxPresent === true;
          const reclaimedPx =
            typeof d.metaEcho.strataBandCompactReclaimedPx === "number"
              ? (d.metaEcho.strataBandCompactReclaimedPx as number)
              : null;
          const matchLabel = nonBcHeightOf[armLabel]!;
          const heightBc = d.bandLevels.canvasHeight;
          const heightMatch = armData.get(matchLabel)!.bandLevels.canvasHeight;
          const heightDelta = round2(heightBc - heightMatch);
          bcConsistency[armLabel] = {
            matchingNonBcArm: matchLabel,
            appliedHullCount,
            appliedHullCountPositive: (appliedHullCount ?? 0) > 0,
            reclaimedPxPresent: reclaimedPresent,
            reclaimedPx,
            reclaimExpectedUnderRs: RS_BC_ARMS.has(armLabel),
            canvasHeight: heightBc,
            matchingCanvasHeight: heightMatch,
            heightDeltaVsMatch: heightDelta,
            // sign-consistency: a positive reclaim should not INCREASE height.
            reclaimSignConsistent:
              reclaimedPx == null || reclaimedPx <= 0
                ? heightDelta <= 0.01 // allow float noise; no reclaim => ~no change
                : heightDelta <= 0.01,
          };
        }

        // ── ε-selection divergence (arm 7 vs arm 6) ─────────────────────────
        const eps1 = armData.get("P_RS_BC_eps1")!;
        const eps0 = armData.get("P_RS_BC")!;
        const epsDivergence = {
          selectionsEqual:
            JSON.stringify(eps0.metaEcho.strataPackedScoringSelections) ===
            JSON.stringify(eps1.metaEcho.strataPackedScoringSelections),
          scoreEqual:
            JSON.stringify(eps0.metaEcho.strataPackedScoringScore) ===
            JSON.stringify(eps1.metaEcho.strataPackedScoringScore),
          eps0Score: eps0.metaEcho.strataPackedScoringScore ?? null,
          eps1Score: eps1.metaEcho.strataPackedScoringScore ?? null,
          eps0Selections: eps0.metaEcho.strataPackedScoringSelections ?? null,
          eps1Selections: eps1.metaEcho.strataPackedScoringSelections ?? null,
          eps1EffectiveDelta:
            eps1.metaEcho.strataPackedScoringEffectiveDelta ?? null,
          eps1Epsilon: eps1.metaEcho.strataPackedScoringEpsilon ?? null,
        };

        // ── packedScoringFellBack rate (arms 5-7) ───────────────────────────
        const packedFellBack: Record<string, unknown> = {};
        for (const armLabel of PS_ARMS) {
          packedFellBack[armLabel] =
            armData.get(armLabel)!.metaEcho.strataPackedScoringFellBack ?? null;
        }

        // ── determinism rebuilds (subset; normalized sans buildMs) ──────────
        for (const armLabel of DETERMINISM_ARMS) {
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
              `${preset}/${armLabel}: full arm rebuild NOT deterministic (normalized sans buildMs)`,
            );
          }
        }

        // ── churn cells (I_RS + all three BC arms; add + rename) ────────────
        const addMutation = buildAddResourceMutation(sources);
        const renameMutation = buildRenameMutation(sources);
        const churn: Record<string, unknown> = {};
        for (const armLabel of CHURN_ARMS) {
          const base = armElements.get(armLabel)!;
          if (base.length === 0) {
            softFailures.push(`${preset}/${armLabel}: churn base scene EMPTY`);
            continue;
          }
          const addBuilt = await buildArmFrom(
            addMutation.planDotBundles,
            addMutation.tfdTexts,
            sources.tfdLabels,
            ARM_OPTIONS[armLabel]!,
          );
          const renameBuilt = await buildArmFrom(
            renameMutation.planDotBundles,
            renameMutation.tfdTexts,
            sources.tfdLabels,
            ARM_OPTIONS[armLabel]!,
          );
          if (addBuilt.elements.length === 0) {
            softFailures.push(
              `${preset}/${armLabel}: churn add-mutation scene EMPTY`,
            );
          }
          if (renameBuilt.elements.length === 0) {
            softFailures.push(
              `${preset}/${armLabel}: churn rename-mutation scene EMPTY`,
            );
          }
          const addMetrics = computeStrataChurnMetrics(base, addBuilt.elements);
          const renameMetrics = computeStrataChurnMetrics(
            base,
            renameBuilt.elements,
            {
              renames: {
                [renameMutation.oldAddress]: renameMutation.newAddress,
              },
            },
          );
          churn[armLabel] = {
            add: {
              note: addMutation.note,
              uSize: addMetrics.U.size,
              m1Rel: addMetrics.m1Rel,
              m2Flip: addMetrics.m2Flip.value,
              m2FlipInversions: addMetrics.m2Flip.inversions,
              m2FlipComparedPairs: addMetrics.m2Flip.comparedPairs,
              m1RelWithinRef: addMetrics.m1Rel <= M1_REL_THRESHOLD,
              m2FlipWithinRef: addMetrics.m2Flip.value <= M2_FLIP_THRESHOLD,
            },
            rename: {
              note: renameMutation.note,
              uSize: renameMetrics.U.size,
              m1Rel: renameMetrics.m1Rel,
              m2Flip: renameMetrics.m2Flip.value,
              m2FlipInversions: renameMetrics.m2Flip.inversions,
              m2FlipComparedPairs: renameMetrics.m2Flip.comparedPairs,
              m1RelWithinRef: renameMetrics.m1Rel <= M1_REL_THRESHOLD,
              m2FlipWithinRef: renameMetrics.m2Flip.value <= M2_FLIP_THRESHOLD,
            },
          };
        }

        report[presetLabel] = {
          preset,
          arms,
          cells,
          iBcEquality,
          bcConsistency,
          epsDivergence,
          packedScoringFellBack: packedFellBack,
          churn,
        };
      }

      const json = JSON.stringify({ ...report, softFailures }, null, 2);
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(`${REPORT_DIR}/W10B_BAND_COMPACT_BATTERY.json`, json);
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        `W10B_BAND_COMPACT_BATTERY.json written to ${REPORT_DIR} (${json.length} bytes)`,
      );

      expect(
        softFailures,
        `harness health failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
