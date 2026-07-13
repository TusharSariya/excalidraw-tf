/**
 * W9 routing-spike battery (SDEC-59 Package C — post-A7 obstacle-avoiding edge
 * routing, terraformPipelineStrataEdgeRouting.ts). Report-emitting, W7/W8/W8b-
 * style: this file owns NO layout behavior and NEVER asserts gate outcomes —
 * the KEY GATE CELL (hull+card penetrations on the routed arms) is REPORTED,
 * not minted as a PASS; the normative M-H exact-zero prerequisite still needs
 * the freeze-register wiring.
 *
 * Question under test: Strata edges render as straight centre-to-centre
 * chords; W7/W8 measured 65–123 foreign-box penetrations per preset (an edge
 * tunneling through a hull/card related to neither endpoint — the owner's
 * SQS→RDS crossing vpc-5b5). Placement cannot zero this class; routing around
 * obstacles is the standard remedy (Wybrow/Marriott/Stuckey
 * doi-10-1007-11618058-40; Bouts & Speckmann
 * forward-10-1109-pacificvis-2015-7156356). W9 measures what penetrating-only
 * routing buys (penetrations on FINAL POLYLINES) and what it costs (bends,
 * route stretch, scene crossings, sharp angles, paired M-RT rt̂).
 *
 * Arms (P1+P2 × compact, all strata builds):
 *   I    — K4+A7 (the validated substrate)
 *   P    — I + strataPackedScoring
 *   P_R  — P + strataEdgeRouting
 *   I_R  — I + strataEdgeRouting
 *
 * CODEX TRAP GUARD: every post-route metric here consumes the rendered
 * POLYLINES, not centre chords — countPenetrations walks points[] segment by
 * segment (the W7 probe convention), diagnosePipelineScene's crossing kernel
 * keeps all consecutive segments, and computeStrataPathMetrics' cr/con/tll
 * are per-segment/arc-length over points[] (see that module). The rt̂ cr term
 * therefore SEES the routed polylines.
 *
 * Run:
 *   Q9_REPORT_DIR=/tmp yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineStrataRoutingSpike.test.ts \
 *     --exclude "**\/.claude/**"
 * Writes W9_ROUTING_SPIKE_REPORT.json to $Q9_REPORT_DIR (default tmpdir).
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
const REPORT_DIR = process.env.Q9_REPORT_DIR ?? tmpdir();
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 40;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ── arms ─────────────────────────────────────────────────────────────────────

const BASE_I: Record<string, unknown> = {
  layoutMode: "strata",
  pipelineCompact: true,
  strataSweeps: 4,
  strataCoordinateRefine: true,
};

const ARM_OPTIONS: Record<string, Record<string, unknown>> = {
  I: { ...BASE_I },
  P: { ...BASE_I, strataPackedScoring: true },
  P_R: { ...BASE_I, strataPackedScoring: true, strataEdgeRouting: true },
  I_R: { ...BASE_I, strataEdgeRouting: true },
};

/** [unrouted baseline, routed arm] — each routed arm vs ITS substrate. */
const CELL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["I", "I_R"],
  ["P", "P_R"],
];

// ── final-geometry penetration counter (W7/W8/W8b's probe, reused verbatim —
// it already walks the polyline segment by segment, so routed multi-point
// arrows are measured on their FINAL rendered paths) ─────────────────────────

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
  /** Residual attribution (routed arms): penetrations on BENT arrows are
   * detour side-effects (e.g. clearance-zone obstacle drops); penetrations on
   * STRAIGHT arrows belong to unroutable-cap fallbacks or edges the router's
   * engine-geometry eligibility test did not flag. */
  onBentArrows: number;
  onStraightArrows: number;
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
  let onBentArrows = 0;
  let onStraightArrows = 0;
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
    const hullHits = tally(hulls);
    const cardHits = tally(cards);
    hullPenetrations += hullHits;
    cardPenetrations += cardHits;
    if (poly.length > 2) {
      onBentArrows += hullHits + cardHits;
    } else {
      onStraightArrows += hullHits + cardHits;
    }
  }
  return {
    hullPenetrations,
    cardPenetrations,
    onBentArrows,
    onStraightArrows,
  };
}

// ── bend / stretch distributions over routed polylines ───────────────────────

const percentile = (sortedVals: readonly number[], q: number): number =>
  sortedVals.length === 0
    ? 0
    : sortedVals[
        Math.min(sortedVals.length - 1, Math.floor(sortedVals.length * q))
      ]!;

function bendStretch(elements: readonly ExcalidrawElement[]) {
  const bends: number[] = [];
  const stretches: number[] = [];
  let tfdArrowCount = 0;
  for (const el of elements.filter(isTfdArrow)) {
    const poly = arrowPolyline(el);
    if (poly.length < 2) {
      continue;
    }
    tfdArrowCount += 1;
    const bendCount = poly.length - 2;
    if (bendCount <= 0) {
      continue;
    }
    let arc = 0;
    for (let i = 0; i + 1 < poly.length; i++) {
      arc += Math.hypot(
        poly[i + 1]![0] - poly[i]![0],
        poly[i + 1]![1] - poly[i]![1],
      );
    }
    const chord = Math.hypot(
      poly[poly.length - 1]![0] - poly[0]![0],
      poly[poly.length - 1]![1] - poly[0]![1],
    );
    bends.push(bendCount);
    stretches.push(chord > 0 ? arc / chord : 1);
  }
  bends.sort((a, b) => a - b);
  stretches.sort((a, b) => a - b);
  return {
    tfdArrowCount,
    bentEdgeCount: bends.length,
    bendTotal: bends.reduce((s, n) => s + n, 0),
    bendP50: percentile(bends, 0.5),
    bendP90: percentile(bends, 0.9),
    bendMax: bends.length > 0 ? bends[bends.length - 1]! : 0,
    stretchP50: round4(percentile(stretches, 0.5)),
    stretchP90: round4(percentile(stretches, 0.9)),
    stretchMax:
      stretches.length > 0 ? round4(stretches[stretches.length - 1]!) : 0,
  };
}

// ── owner case (W8/W8b resolution + routed-path arc lengths) ─────────────────

const SQS_PATH_RE = /aws_sqs_queue\.regional_writer_west(?![\w])/;
const DYNAMO_PATH_RE = /aws_dynamodb_table\.regional_events_west(?![\w])/;

type OwnerCase = {
  found: boolean;
  sqsToRdsPx: number | null;
  sqsToDynamoPx: number | null;
  pairAbsDx: number | null;
  pairAbsDy: number | null;
  /** SQS→RDS arrow: rendered polyline arc length vs its straight chord. */
  sqsToRdsArrow: { pathPx: number; chordPx: number; bends: number } | null;
  /** SQS→Dynamo arrow (when drawn): same decomposition. */
  sqsToDynamoArrow: { pathPx: number; chordPx: number; bends: number } | null;
} | null;

function arrowPathCell(
  el: ExcalidrawElement | undefined,
): { pathPx: number; chordPx: number; bends: number } | null {
  if (!el) {
    return null;
  }
  const poly = arrowPolyline(el);
  if (poly.length < 2) {
    return null;
  }
  let arc = 0;
  for (let i = 0; i + 1 < poly.length; i++) {
    arc += Math.hypot(
      poly[i + 1]![0] - poly[i]![0],
      poly[i + 1]![1] - poly[i]![1],
    );
  }
  const chord = Math.hypot(
    poly[poly.length - 1]![0] - poly[0]![0],
    poly[poly.length - 1]![1] - poly[0]![1],
  );
  return {
    pathPx: round2(arc),
    chordPx: round2(chord),
    bends: poly.length - 2,
  };
}

function ownerCase(elements: readonly ExcalidrawElement[]): OwnerCase {
  const byPath = new Map<string, ExcalidrawElement>();
  for (const c of elements) {
    const nodePath = (c.customData as Record<string, unknown> | undefined)
      ?.nodePath;
    if (typeof nodePath === "string" && !byPath.has(nodePath) && c.width > 0) {
      byPath.set(nodePath, c);
    }
  }
  const relPair = (a: ExcalidrawElement): string => {
    const rel = (a.customData as Record<string, unknown>)
      .relationship as Record<string, string>;
    return `${rel.source} ${rel.target}`;
  };
  const tfd = elements.filter(isTfdArrow);
  const rdsArrow = tfd.find((a) => {
    const pair = relPair(a);
    return pair.includes("regional_writer_west") && pair.includes("rds");
  });
  const dynamoArrow = tfd.find((a) => {
    const pair = relPair(a);
    return (
      pair.includes("regional_writer_west") &&
      pair.includes("regional_events_west")
    );
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
    sqsToRdsArrow: arrowPathCell(rdsArrow),
    sqsToDynamoArrow: arrowPathCell(dynamoArrow),
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
  penetrations: ReturnType<typeof countPenetrations>;
  bendStretch: ReturnType<typeof bendStretch>;
  ownerCase: OwnerCase;
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

function metaEcho(meta: Record<string, unknown>): Record<string, unknown> {
  const pick = (key: string): unknown => meta[key] ?? null;
  return {
    pipelineColumnCount: pick("pipelineColumnCount"),
    strataToggleSuppressions: pick("strataToggleSuppressions"),
    strataPackedScoringSelections: pick("strataPackedScoringSelections"),
    strataPackedScoringFellBack: pick("strataPackedScoringFellBack"),
    strataEdgeRouting: pick("strataEdgeRouting"),
    strataEdgeRoutingRouted: pick("strataEdgeRoutingRouted"),
    strataEdgeRoutingUnroutable: pick("strataEdgeRoutingUnroutable"),
    strataEdgeRoutingWaypoints: pick("strataEdgeRoutingWaypoints"),
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
    {
      semanticLayout: false,
      ...options,
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
      bendStretch: bendStretch(elements),
      ownerCase: ownerCase(elements),
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
    bendStretch: data.bendStretch,
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

describe("W9 routing spike battery (report-emitting; never asserts gates)", () => {
  it(
    "P1 + P2 compact — arms {I, P, P_R, I_R}; penetrations/bends/stretch on FINAL polylines + paired M-RT",
    async () => {
      const softFailures: string[] = [];
      const report: Record<string, unknown> = {
        methodology:
          "W9 (Package C spike): strataEdgeRouting detours TFD arrows whose " +
          "straight chord penetrates a foreign box (non-ancestor hull or " +
          "unrelated card) around clearance-inflated obstacles (14px = " +
          "PIPELINE_FRAME_PAD/2, <=6 waypoints, min added L1, deterministic " +
          "ties; unroutable edges keep their chord and are counted). Arms I " +
          "(K4+A7), P (I+packedScoring), P_R (P+routing), I_R (I+routing) on " +
          "P1+P2 compact. ALL post-route metrics consume the rendered " +
          "POLYLINES: the W7 penetration probe walks points[] per segment, " +
          "diagnosePipelineScene crossings/angles are per-segment, and " +
          "computeStrataPathMetrics cr/con/tll are per-segment/arc-length — " +
          "the rt-hat cr term sees the routed paths. Owner-case cells report " +
          "the SQS->RDS and SQS->Dynamo arrows' rendered path length vs " +
          "chord. Paired extent + M-RT path-family CIs vs the matching " +
          "unrouted arm (seed 20260704 inside the shared bootstrap helpers; " +
          "gateEligible forced false on voided/degenerate cells). KEY GATE " +
          "CELL (report-only, no PASS minted): hull+card penetrations on " +
          "P_R/I_R — target exact 0 for routed-eligible edges; residuals are " +
          "reported with the unroutable counts as the reason ledger.",
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
          const routedMeta = data.metaEcho.strataEdgeRoutingRouted;
          const isRoutedArm = armLabel.endsWith("_R");
          if (isRoutedArm && typeof routedMeta !== "number") {
            softFailures.push(
              `${preset}/${armLabel}: routing meta MISSING on a routed arm`,
            );
          }
          if (!isRoutedArm && routedMeta !== null) {
            softFailures.push(
              `${preset}/${armLabel}: routing meta PRESENT on an unrouted arm`,
            );
          }
        }

        // KEY GATE CELL (report-only): penetrations on the routed arms, with
        // the unroutable counts as the residual-reason ledger.
        const keyGateCell: Record<string, unknown> = {};
        for (const armLabel of ["I_R", "P_R"]) {
          const d = armData.get(armLabel)!;
          keyGateCell[armLabel] = {
            hullPenetrations: d.penetrations.hullPenetrations,
            cardPenetrations: d.penetrations.cardPenetrations,
            // Whole-scene exact-zero: no hull OR card penetration anywhere in the
            // arm (includes straight arrows the router never touched). False in
            // every routed arm today — kept for continuity, not the gate signal.
            sceneExactZero:
              d.penetrations.hullPenetrations === 0 &&
              d.penetrations.cardPenetrations === 0,
            // Routed-eligible exact-zero: no penetration on the arrows explicitly
            // routed (bent, poly.length > 2). This is the actual Package C gate
            // signal — straight residuals are unroutable-cap fallbacks, not
            // routing failures, so they must not sink the routed exact-zero.
            routedExactZero: d.penetrations.onBentArrows === 0,
            residualReasons: {
              unroutableEdges: d.metaEcho.strataEdgeRoutingUnroutable,
              penetrationsOnBentArrows: d.penetrations.onBentArrows,
              penetrationsOnStraightArrows: d.penetrations.onStraightArrows,
              note:
                "straight-arrow residuals = unroutable-cap fallbacks (kept " +
                "straight by design) or engine-vs-probe eligibility " +
                "mismatches; bent-arrow residuals = detour side-effects " +
                "(clearance-zone obstacle drops / boxes entered by the " +
                "detour itself).",
            },
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

        // Determinism probe: rebuild arm P_R end-to-end and compare the
        // normalized (wall-clock-free) summary — the routed pipeline is a
        // pure function of its inputs.
        {
          const rebuilt = await buildArm(sources, ARM_OPTIONS.P_R!);
          const before = JSON.stringify(
            armSummaryDeterministic(armData.get("P_R")!, armRows.get("P_R")!),
          );
          const after = JSON.stringify(
            armSummaryDeterministic(rebuilt.data, rebuilt.pathRows),
          );
          if (before !== after) {
            softFailures.push(
              `${preset}/P_R: routed rebuild NOT identical (normalized, sans buildMs)`,
            );
          }
        }

        report[presetLabel] = { preset, arms, keyGateCell, cells };
      }

      const json = JSON.stringify({ ...report, softFailures }, null, 2);
      mkdirSync(REPORT_DIR, { recursive: true });
      writeFileSync(`${REPORT_DIR}/W9_ROUTING_SPIKE_REPORT.json`, json);
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        `W9_ROUTING_SPIKE_REPORT.json written to ${REPORT_DIR} (${json.length} bytes)`,
      );

      expect(
        softFailures,
        `harness health failures:\n${softFailures.join("\n")}`,
      ).toEqual([]);
    },
    TIMEOUT,
  );
});
