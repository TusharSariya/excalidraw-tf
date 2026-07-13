/**
 * W8b ε-constraint frontier battery (SDEC-59 Package B follow-up to W8,
 * docs/strata-view-w8-rank-scorer-factorial.md). Report-emitting, W7/W8-style:
 * this file owns NO layout behavior and NEVER asserts gate outcomes; δ is
 * swept as REPORT arms only — a nonzero default is an owner adjudication,
 * never a silent pick.
 *
 * Question under test: W8 showed the packed scorer under the rankSeparate
 * substrate separates the owner's SQS↔Dynamo pair (496→1629px) while its own
 * score tuple improves. The strict crossings-first comparator is structurally
 * an infinite exchange rate (a crossing outranks ANY (pen, L1) improvement);
 * the literature prices a crossing finitely (Ware et al. 2002, corpus doc
 * doi-10-1057-palgrave-ivs-9500013). W8b (a) dumps the descent's candidate
 * frontier so the report can say whether pair-adjacent layouts were present-
 * but-rejected, present-but-dominated, or absent-from-generator, and (b)
 * sweeps the ε-band (`strataPackedScoringEpsilon`) to measure what a bounded
 * crossings budget buys on the same arms.
 *
 * Arms (P1+P2 × compact, all strata builds, packed scoring ON everywhere):
 *   P        — K4+A7 + packedScoring, epsilon 0 (= W8's P arm)
 *   P_e1     — epsilon 1  (absolute: baseline crossings + 1)
 *   P_e2     — epsilon 2
 *   P_er     — epsilon 0.01 (relative: ceil(0.01 × baseline crossings))
 *   P_RS     — P + strataRankSeparate (= W8's P_RS arm)
 *   P_RS_e1 / P_RS_e2 / P_RS_er — the RS-substrate epsilon sweep
 *
 * Cells: per-arm W8 scalars (crossings, hull/card penetrations on FINAL
 * geometry, sharpShare, owner-case SQS→RDS + SQS→Dynamo px, buildMs, packed
 * meta incl. epsilon + effective delta + fellBack + selections), the FRONTIER
 * DUMP per preset+substrate (nondominated set over the epsilon-0 descent's
 * recorded trials, via the `strataPackedFrontierMeta` dev seam), and paired
 * extent + M-RT path-family CIs vs the matching epsilon-0 arm (shared
 * bootstrap helpers, seed 20260704, v3.2 floors; `gateEligible` is forced
 * false on voided or degenerate cells).
 *
 * Run:
 *   Q8B_REPORT_DIR=/tmp yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataEpsilonFrontier.test.ts \
 *     --exclude "**\/.claude/**"
 * Writes W8B_EPSILON_FRONTIER_REPORT.json to $Q8B_REPORT_DIR (default tmpdir).
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

import type { StrataPackedTrialRecord } from "./terraformPipelineStrataPackedScoring";
import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const PRESET_1 = "staging-extended-localstack-v2";
const PRESET_2 = "staging-localstack";
const REPORT_DIR = process.env.Q8B_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 40;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ── arms ─────────────────────────────────────────────────────────────────────

const BASE_P: Record<string, unknown> = {
  layoutMode: "strata",
  pipelineCompact: true,
  strataSweeps: 4,
  strataCoordinateRefine: true,
  strataPackedScoring: true,
};

const ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  P: { ...BASE_P },
  P_e1: { ...BASE_P, strataPackedScoringEpsilon: 1 },
  P_e2: { ...BASE_P, strataPackedScoringEpsilon: 2 },
  P_er: { ...BASE_P, strataPackedScoringEpsilon: 0.01 },
  P_RS: { ...BASE_P, strataRankSeparate: true },
  P_RS_e1: {
    ...BASE_P,
    strataRankSeparate: true,
    strataPackedScoringEpsilon: 1,
  },
  P_RS_e2: {
    ...BASE_P,
    strataRankSeparate: true,
    strataPackedScoringEpsilon: 2,
  },
  P_RS_er: {
    ...BASE_P,
    strataRankSeparate: true,
    strataPackedScoringEpsilon: 0.01,
  },
};

/** [epsilon-0 baseline, epsilon arm] pairs — each ε arm vs ITS substrate. */
const CELL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["P", "P_e1"],
  ["P", "P_e2"],
  ["P", "P_er"],
  ["P_RS", "P_RS_e1"],
  ["P_RS", "P_RS_e2"],
  ["P_RS", "P_RS_er"],
];

/** The two frontier dumps per preset come from the epsilon-0 substrate arms. */
const FRONTIER_ARMS = ["P", "P_RS"] as const;

// ── final-geometry penetration counter (W7/W8's probe, reused verbatim) ──────

type Box = { x: number; y: number; w: number; h: number };

const pointInBox = (px: number, py: number, b: Box, pad = 0): boolean =>
  px >= b.x - pad &&
  px <= b.x + b.w + pad &&
  py >= b.y - pad &&
  py <= b.y + b.h + pad;

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

const HULL_ROLES = new Set(["account", "region", "vpc", "subnetZone"]);

const topologyRole = (el: ExcalidrawElement): string | undefined => {
  const role = (el.customData as Record<string, unknown> | undefined)
    ?.terraformTopologyRole;
  return typeof role === "string" ? role : undefined;
};

const isHullFrame = (el: ExcalidrawElement): boolean =>
  el.type === "frame" && HULL_ROLES.has(topologyRole(el) ?? "");

const isResourceCard = (el: ExcalidrawElement): boolean =>
  el.type === "frame" && topologyRole(el) === "primaryCluster";

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

// ── owner case (round-9 screenshot; W8's resolution, distances only) ─────────

const SQS_PATH_RE = /aws_sqs_queue\.regional_writer_west(?![\w])/;
const DYNAMO_PATH_RE = /aws_dynamodb_table\.regional_events_west(?![\w])/;

type OwnerCase = {
  found: boolean;
  sqsToRdsPx: number | null;
  sqsToDynamoPx: number | null;
  pairAbsDx: number | null;
  pairAbsDy: number | null;
} | null;

function ownerCase(elements: readonly ExcalidrawElement[]): OwnerCase {
  const byPath = new Map<string, ExcalidrawElement>();
  for (const c of elements) {
    const nodePath = (c.customData as Record<string, unknown> | undefined)
      ?.nodePath;
    if (typeof nodePath === "string" && !byPath.has(nodePath) && c.width > 0) {
      byPath.set(nodePath, c);
    }
  }
  const rdsArrow = elements.filter(isTfdArrow).find((a) => {
    const rel = (a.customData as Record<string, unknown>)
      .relationship as Record<string, string>;
    const pair = `${rel.source} ${rel.target}`;
    return pair.includes("regional_writer_west") && pair.includes("rds");
  });
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
  return {
    found: true,
    sqsToRdsPx: dist(sqs, rds),
    sqsToDynamoPx: dist(sqs, dynamo),
    pairAbsDx: sqs && dynamo ? round2(Math.abs(cx(sqs) - cx(dynamo))) : null,
    pairAbsDy: sqs && dynamo ? round2(Math.abs(cy(sqs) - cy(dynamo))) : null,
  };
}

// ── frontier analysis ────────────────────────────────────────────────────────

type TrialScore = { crossings: number; penetrations: number; lengthL1: number };

const dominates = (a: TrialScore, b: TrialScore): boolean =>
  a.crossings <= b.crossings &&
  a.penetrations <= b.penetrations &&
  a.lengthL1 <= b.lengthL1 &&
  (a.crossings < b.crossings ||
    a.penetrations < b.penetrations ||
    a.lengthL1 < b.lengthL1);

/**
 * Nondominated set over the recorded trials (minimize all three terms),
 * deduped on the score triple keeping the EARLIEST trial (matching the
 * engine's earliest-candidate tiebreak). Each frontier point reports whether
 * the descent adopted it and how it compares term-wise to the baseline —
 * present-but-rejected candidates are exactly the nondominated, unadopted
 * points.
 */
function frontierOf(trials: readonly StrataPackedTrialRecord[]) {
  const deduped: StrataPackedTrialRecord[] = [];
  const seen = new Set<string>();
  for (const t of trials) {
    const key = `${t.score.crossings}|${t.score.penetrations}|${t.score.lengthL1}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(t);
    }
  }
  const baseline = trials.find((t) => t.hullId === "__baseline__");
  const nondominated = deduped.filter(
    (t) => !deduped.some((o) => o !== t && dominates(o.score, t.score)),
  );
  return nondominated
    .slice()
    .sort(
      (a, b) =>
        a.score.crossings - b.score.crossings ||
        a.score.penetrations - b.score.penetrations ||
        a.score.lengthL1 - b.score.lengthL1,
    )
    .map((t) => ({
      hullId: t.hullId,
      candidateIndex: t.candidateIndex,
      pass: t.pass,
      score: t.score,
      adopted: t.adopted,
      adoptedVia: t.adoptedVia ?? null,
      vsBaseline: baseline
        ? {
            crossings: t.score.crossings - baseline.score.crossings,
            penetrations: t.score.penetrations - baseline.score.penetrations,
            lengthL1: t.score.lengthL1 - baseline.score.lengthL1,
          }
        : null,
    }));
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
  ownerCase: OwnerCase;
  buildMs: number;
  elementCount: number;
  rcllV2Degraded: unknown;
  metaEcho: Record<string, unknown>;
  frontierTrials: StrataPackedTrialRecord[] | null;
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

function metaEcho(meta: Record<string, unknown>): Record<string, unknown> {
  const pick = (key: string): unknown => meta[key] ?? null;
  return {
    pipelineColumnCount: pick("pipelineColumnCount"),
    strataRankSeparateApplied: pick("strataRankSeparateApplied"),
    strataRankSeparateChangedRankCount: pick(
      "strataRankSeparateChangedRankCount",
    ),
    strataToggleSuppressions: pick("strataToggleSuppressions"),
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

async function buildArm(
  sources: TerraformImportPresetSources,
  options: Record<string, unknown>,
  collectFrontier: boolean,
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
    {
      semanticLayout: false,
      ...options,
      ...(collectFrontier ? { strataPackedFrontierMeta: true } : {}),
    },
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
      metaEcho: metaEcho(meta),
      frontierTrials: collectFrontier
        ? ((meta.strataPackedScoringFrontierTrials ?? null) as
            | StrataPackedTrialRecord[]
            | null)
        : null,
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
    // W8 remediation convention: never report a voided/degenerate cell as
    // gate-eligible.
    gateEligible:
      !ci.voided &&
      !ci.degenerate &&
      statisticGateEligible(
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

/** armSummary minus wall-clock, for the normalized determinism probe. */
function armSummaryDeterministic(
  data: ArmData,
  rows: readonly PathMetricsRow[],
) {
  const { buildMs: _buildMs, ...rest } = armSummary(data, rows);
  return rest;
}

// ── harness ──────────────────────────────────────────────────────────────────

describe("W8b epsilon frontier battery (report-emitting; never asserts gates)", () => {
  it(
    "P1 + P2 compact — epsilon sweep {0,1,2,0.01rel} × substrate {base,RS} + frontier dumps",
    async () => {
      const softFailures: string[] = [];
      const report: Record<string, unknown> = {
        methodology:
          "W8b: strataPackedScoring ON everywhere; epsilon sweep {0, 1, 2, " +
          "0.01 relative} on the base (K4+A7) and rankSeparate substrates. " +
          "Per-arm W8 scalars (crossings + angles, structural collisionCount, " +
          "edge-box penetrations on FINAL geometry, owner-case " +
          "SQS(regional_writer_west)->RDS and ->Dynamo(regional_events_west) " +
          "centre distances + |dx|/|dy|, wall-clock, packed meta incl. " +
          "epsilon/effectiveDelta), FRONTIER DUMP per preset+substrate " +
          "(nondominated set over the epsilon-0 descent's recorded trials via " +
          "the strataPackedFrontierMeta dev seam; the epsilon-0 selection is " +
          "unchanged by collection), and paired extent + M-RT path-family CIs " +
          "vs the matching epsilon-0 arm (seed 20260704 inside the shared " +
          "bootstrap helpers; gateEligible forced false on voided/degenerate " +
          "cells). REPORT-only: no gate asserted, no delta silently chosen.",
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
          const collectFrontier = (FRONTIER_ARMS as readonly string[]).includes(
            armLabel,
          );
          const { data, pathRows } = await buildArm(
            sources,
            ARM_OPTIONS[armLabel]!,
            collectFrontier,
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
          if (collectFrontier && !data.frontierTrials) {
            softFailures.push(
              `${preset}/${armLabel}: frontier trials MISSING from meta`,
            );
          }
        }

        // Frontier dumps (per substrate) from the epsilon-0 arms.
        const frontiers: Record<string, unknown> = {};
        for (const armLabel of FRONTIER_ARMS) {
          const trials = armData.get(armLabel)!.frontierTrials;
          if (!trials) {
            continue;
          }
          frontiers[armLabel] = {
            trialCount: trials.length,
            adoptedCount: trials.filter(
              (t) => t.adopted && t.hullId !== "__baseline__",
            ).length,
            nondominated: frontierOf(trials),
          };
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

        // Determinism probe: rebuild arm P end-to-end (WITHOUT the frontier
        // seam, proving collection does not change the layout) and compare
        // the normalized (wall-clock-free, frontier-free) summary.
        {
          const rebuilt = await buildArm(sources, ARM_OPTIONS.P!, false);
          const before = JSON.stringify(
            armSummaryDeterministic(armData.get("P")!, armRows.get("P")!),
          );
          const after = JSON.stringify(
            armSummaryDeterministic(rebuilt.data, rebuilt.pathRows),
          );
          if (before !== after) {
            softFailures.push(
              `${preset}/P: frontier-off rebuild NOT identical (normalized, sans buildMs)`,
            );
          }
        }

        report[presetLabel] = { preset, arms, frontiers, cells };
      }

      const json = JSON.stringify({ ...report, softFailures }, null, 2);
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(`${REPORT_DIR}/W8B_EPSILON_FRONTIER_REPORT.json`, json);
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        `W8B_EPSILON_FRONTIER_REPORT.json written to ${REPORT_DIR} (${json.length} bytes)`,
      );

      expect(
        softFailures,
        `harness health failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
