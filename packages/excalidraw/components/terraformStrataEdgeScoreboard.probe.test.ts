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
import {
  collectTerraformClusterFrameRectsByAddress,
  getTerraformEdgeLayer,
} from "./terraformVisibility";
import { computeStrataEdgeScoreboard } from "./terraformStrataEdgeScoreboard";
import {
  computePierceMetrics,
  segmentIntersectsRectInterior,
} from "./terraformPipelineStrataPierceMetrics";
import {
  diagnosePipelineScene,
  segmentsCross,
} from "./terraformPipelineCollisionDiagnostics";

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

/**
 * E3.2 lane-quality census over the final scene:
 *   • pair-once edge crossings via the SHARED `segmentsCross` kernel (the same
 *     pair-once semantics as `diagnosePipelineScene`'s `dataflow.crossings`),
 *     broken down into lane×lane / lane×plain / plain×plain pair classes;
 *   • a PER-LANE table (laneY, X-span, crossing count) — the loop-2 verdict's
 *     "five heavy full-span lanes" become visible and comparable run-to-run;
 *   • the PERMANENT lane-vs-leaf-frame walk: no lane-stamped polyline segment
 *     may strictly enter a FOREIGN leaf-cluster frame's interior (the loop-2
 *     obstacle-selection gap — 4 violations before E3.2, asserted 0 after);
 *   • the top detour ratios over routed edges with relationship attribution
 *     (the api7-class staircases bracket detourRatioP95).
 */
type LanePairClasses = {
  laneLane: number;
  lanePlain: number;
  plainPlain: number;
};
const laneQualityCensus = (
  elements: readonly ExcalidrawElement[],
): {
  crossingPairs: number;
  pairClasses: LanePairClasses;
  laneTable: Array<{
    rel: string;
    laneY: number;
    spanX: readonly [number, number];
    crossings: number;
  }>;
  laneFrameViolations: Array<{ rel: string; frame: string; seg?: number[] }>;
  /** P1-b (loop-3): the SAME strict-interior frame walk widened to ALL routed
   * edges (not just lane-stamped) — REPORTED ONLY, no threshold assert. Counts
   * (routed edge, foreign leaf-cluster frame) strict-interior violation PAIRS
   * plus the distinct edges responsible; the ~13 non-lane cuts on the clip arm
   * are wave-next work, so this keeps the number watched run-to-run. */
  routedFrameCutPairs: number;
  routedFrameCutEdges: number;
  detourTop: Array<{
    rel: string;
    ratio: number;
    poly: number;
    chord: number;
    /** Rounded absolute polyline — logged for the top-2 staircases only. */
    pts?: number[][];
  }>;
  /** Y-gaps (≥8px) of the rendered frame union over the widest lane span —
   * the candidate inter-band strips available to E3.2 lane placement. */
  stripGaps: Array<number[]>;
  /** Edges whose polyline crosses a hull frame's TOP/BOTTOM border, with the
   * crossing coordinates (debug attribution for the scoreboard wrongFace). */
  wrongFaceEdges: Array<{ rel: string; at: number[] }>;
} => {
  type Pt = readonly [number, number];
  type CensusEdge = {
    id: string;
    rel: string;
    ownKeys: Set<string>;
    pts: Pt[];
    lane: boolean;
    routed: boolean;
  };
  const edges: CensusEdge[] = [];
  for (const el of elements) {
    if (
      el.type !== "arrow" ||
      getTerraformEdgeLayer(el) !== "declaredDataFlow"
    ) {
      continue;
    }
    const raw = (el as { points?: ReadonlyArray<readonly [number, number]> })
      .points;
    if (!Array.isArray(raw) || raw.length < 2) {
      continue;
    }
    const pts = raw.map(([px, py]) => [el.x + px, el.y + py] as const);
    const cd = (el.customData ?? {}) as Record<string, unknown>;
    const rel = cd.relationship as
      | { source?: unknown; target?: unknown }
      | undefined;
    const src = typeof rel?.source === "string" ? rel.source : "";
    const tgt = typeof rel?.target === "string" ? rel.target : "";
    const lane =
      cd.terraformClipLane === "above" || cd.terraformClipLane === "below";
    edges.push({
      id: String(el.id),
      rel: `${src}→${tgt}`,
      ownKeys: new Set([src, tgt]),
      pts,
      lane,
      routed: cd.terraformRoutedPolyline === true && pts.length > 2,
    });
  }
  edges.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));

  const crossesOnce = (a: CensusEdge, b: CensusEdge): boolean => {
    for (let i = 0; i + 1 < a.pts.length; i++) {
      for (let j = 0; j + 1 < b.pts.length; j++) {
        if (
          segmentsCross(
            {
              x1: a.pts[i]![0],
              y1: a.pts[i]![1],
              x2: a.pts[i + 1]![0],
              y2: a.pts[i + 1]![1],
            },
            {
              x1: b.pts[j]![0],
              y1: b.pts[j]![1],
              x2: b.pts[j + 1]![0],
              y2: b.pts[j + 1]![1],
            },
          )
        ) {
          return true;
        }
      }
    }
    return false;
  };

  const perEdge = new Map<string, number>();
  const pairClasses: LanePairClasses = {
    laneLane: 0,
    lanePlain: 0,
    plainPlain: 0,
  };
  let crossingPairs = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (!crossesOnce(edges[i]!, edges[j]!)) {
        continue;
      }
      crossingPairs += 1;
      const lanes = (edges[i]!.lane ? 1 : 0) + (edges[j]!.lane ? 1 : 0);
      if (lanes === 2) {
        pairClasses.laneLane += 1;
      } else if (lanes === 1) {
        pairClasses.lanePlain += 1;
      } else {
        pairClasses.plainPlain += 1;
      }
      perEdge.set(edges[i]!.rel, (perEdge.get(edges[i]!.rel) ?? 0) + 1);
      perEdge.set(edges[j]!.rel, (perEdge.get(edges[j]!.rel) ?? 0) + 1);
    }
  }

  const laneTable = edges
    .filter((e) => e.lane)
    .map((e) => {
      // The lane travel = the longest horizontal run of the polyline.
      let laneY = e.pts[0]![1];
      let spanLo = e.pts[0]![0];
      let spanHi = e.pts[0]![0];
      let best = -1;
      for (let i = 0; i + 1 < e.pts.length; i++) {
        const [x0, y0] = e.pts[i]!;
        const [x1, y1] = e.pts[i + 1]!;
        if (Math.abs(y1 - y0) < 1e-6 && Math.abs(x1 - x0) > best) {
          best = Math.abs(x1 - x0);
          laneY = Math.round(y0 * 10) / 10;
          spanLo = Math.round(Math.min(x0, x1));
          spanHi = Math.round(Math.max(x0, x1));
        }
      }
      return {
        rel: e.rel,
        laneY,
        spanX: [spanLo, spanHi] as const,
        crossings: perEdge.get(e.rel) ?? 0,
      };
    });

  const frames = collectTerraformClusterFrameRectsByAddress(elements);
  const laneFrameViolations: Array<{
    rel: string;
    frame: string;
    seg?: number[];
  }> = [];
  for (const e of edges) {
    if (!e.lane) {
      continue;
    }
    for (const [address, rect] of frames) {
      if (e.ownKeys.has(address)) {
        continue;
      }
      for (let i = 0; i + 1 < e.pts.length; i++) {
        if (segmentIntersectsRectInterior(e.pts[i]!, e.pts[i + 1]!, rect)) {
          laneFrameViolations.push({
            rel: e.rel,
            frame: address,
            seg: [...e.pts[i]!, ...e.pts[i + 1]!].map((v) => Math.round(v)),
          });
          break;
        }
      }
    }
  }

  // P1-b (loop-3): widen the SAME strict-interior frame walk to ALL routed
  // edges (not just lane-stamped) — REPORTED ONLY. A non-lane routed polyline
  // that strictly enters a foreign leaf-cluster frame is wave-next work; this
  // keeps the count observable so a regression (e.g. the smoother re-cutting
  // frames the clip dodged) is visible even off the lane subset.
  let routedFrameCutPairs = 0;
  const routedFrameCutRels = new Set<string>();
  for (const e of edges) {
    if (!e.routed) {
      continue;
    }
    for (const [address, rect] of frames) {
      if (e.ownKeys.has(address)) {
        continue;
      }
      for (let i = 0; i + 1 < e.pts.length; i++) {
        if (segmentIntersectsRectInterior(e.pts[i]!, e.pts[i + 1]!, rect)) {
          routedFrameCutPairs += 1;
          routedFrameCutRels.add(e.rel);
          break;
        }
      }
    }
  }

  const detourTop = edges
    .filter((e) => e.routed)
    .map((e) => {
      const first = e.pts[0]!;
      const last = e.pts[e.pts.length - 1]!;
      const chord = Math.hypot(last[0] - first[0], last[1] - first[1]);
      let poly = 0;
      for (let i = 0; i + 1 < e.pts.length; i++) {
        poly += Math.hypot(
          e.pts[i + 1]![0] - e.pts[i]![0],
          e.pts[i + 1]![1] - e.pts[i]![1],
        );
      }
      return {
        rel: e.rel,
        ratio: chord >= 1 ? Math.round((poly / chord) * 1000) / 1000 : 1,
        poly: Math.round(poly),
        chord: Math.round(chord),
        pts: e.pts.map(([px, py]) => [Math.round(px), Math.round(py)]),
      };
    })
    .sort((a, b) => b.ratio - a.ratio || (a.rel < b.rel ? -1 : 1));
  // The loop-2 verdict's staircase bracket (api7 ECS → api9 API) tracked by
  // name, plus the top-5 with the top-2 polylines.
  const api7 = detourTop.filter(
    (d) => d.rel.includes("api7") && d.rel.includes("api9"),
  );
  const detourTopOut = detourTop
    .slice(0, 5)
    .map((d, i) => (i < 2 ? d : { ...d, pts: undefined }))
    .concat(api7.map((d) => ({ ...d, pts: undefined })));

  // Diagnostic: the TIER-2 strip gaps over the widest lane's X-span — the
  // Y-union of the LEAF-cluster frames plus every hull frame's
  // horizontal-border band (±4px). These are the leaf-free rows E3.2 lane
  // placement can transit (a hull interior is passable via vertical faces;
  // measured 2026-07-23: the FULL union incl. hull interiors has NO gaps on
  // this preset — bands tile — so tier-2 rows are the only inter-band
  // strips).
  const TOPOLOGY_ROLES = new Set([
    "provider",
    "account",
    "region",
    "vpc",
    "subnetZone",
  ]);
  const widest = laneTable.reduce(
    (acc, t) => (t.spanX[1] - t.spanX[0] > acc[1] - acc[0] ? t.spanX : acc),
    [0, 0] as readonly [number, number],
  );
  const stripGaps: Array<number[]> = [];
  if (widest[1] > widest[0]) {
    const intervals: Array<[number, number]> = [];
    for (const el of elements) {
      if (el.type !== "frame" || el.isDeleted) {
        continue;
      }
      const cd = (el.customData ?? {}) as Record<string, unknown>;
      const isHull =
        typeof cd.terraformTopologyRole === "string" &&
        TOPOLOGY_ROLES.has(cd.terraformTopologyRole);
      const isLeaf = cd.terraformTopologyRole === "primaryCluster";
      if (!isHull && !isLeaf) {
        continue;
      }
      if (el.x + el.width <= widest[0] || el.x >= widest[1]) {
        continue;
      }
      if (isLeaf) {
        intervals.push([el.y, el.y + el.height]);
      } else {
        intervals.push([el.y - 4, el.y + 4]);
        intervals.push([el.y + el.height - 4, el.y + el.height + 4]);
      }
    }
    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged: Array<[number, number]> = [];
    for (const [lo, hi] of intervals) {
      const last = merged[merged.length - 1];
      if (last && lo <= last[1] + 1) {
        last[1] = Math.max(last[1], hi);
      } else {
        merged.push([lo, hi]);
      }
    }
    for (let i = 0; i + 1 < merged.length; i++) {
      const gap = merged[i + 1]![0] - merged[i]![1];
      if (gap >= 8) {
        stripGaps.push([
          Math.round(merged[i]![1]),
          Math.round(merged[i + 1]![0]),
        ]);
      }
    }
  }

  // wrongFace attribution: which edges cross a hull frame's TOP/BOTTOM
  // border, and where (mirrors the scoreboard's crossing detection closely
  // enough for debugging — proper line intersection on horizontal borders).
  const wrongFaceEdges: Array<{ rel: string; at: number[] }> = [];
  {
    const hullRects: Array<{ x: number; y: number; w: number; h: number }> = [];
    for (const el of elements) {
      if (el.type !== "frame" || el.isDeleted) {
        continue;
      }
      const cd = (el.customData ?? {}) as Record<string, unknown>;
      if (
        typeof cd.terraformTopologyRole === "string" &&
        TOPOLOGY_ROLES.has(cd.terraformTopologyRole)
      ) {
        hullRects.push({ x: el.x, y: el.y, w: el.width, h: el.height });
      }
    }
    for (const e of edges) {
      const hits: number[] = [];
      for (const r of hullRects) {
        for (const by of [r.y, r.y + r.h]) {
          for (let i = 0; i + 1 < e.pts.length; i++) {
            const [x0, y0] = e.pts[i]!;
            const [x1, y1] = e.pts[i + 1]!;
            if (Math.abs(y1 - y0) < 1e-9) {
              continue; // horizontal segment cannot cross a horizontal border
            }
            const t = (by - y0) / (y1 - y0);
            if (t < 0 || t > 1) {
              continue;
            }
            const cx = x0 + t * (x1 - x0);
            if (cx >= r.x && cx <= r.x + r.w) {
              hits.push(Math.round(cx), Math.round(by));
            }
          }
        }
      }
      if (hits.length > 0) {
        wrongFaceEdges.push({ rel: e.rel, at: hits.slice(0, 8) });
      }
    }
  }

  return {
    crossingPairs,
    pairClasses,
    laneTable,
    laneFrameViolations,
    routedFrameCutPairs,
    routedFrameCutEdges: routedFrameCutRels.size,
    detourTop: detourTopOut,
    stripGaps,
    wrongFaceEdges,
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
      const ownerClipScene = await buildArm(false, { strataEdgeClip: true });
      const ownerClip = armMetrics(ownerClipScene);
      const ownerClipLanes = laneQualityCensus(ownerClipScene.elements);
      // Sixth arm (loop-3 E3.1): owner config + clip + the GLEE smoothing
      // pass — the finishing treatment over the clip polylines (kink
      // shortcut, collinear dedupe, chamfer rounding, roundness:null
      // exact-path rendering). The critical gate: NOTHING the smoother
      // touched may get flattened by repair (flattenedBy stays empty).
      const ownerClipSmoothScene = await buildArm(false, {
        strataEdgeClip: true,
        strataEdgeSmooth: true,
      });
      const ownerClipSmooth = armMetrics(ownerClipSmoothScene);
      const ownerClipSmoothLanes = laneQualityCensus(
        ownerClipSmoothScene.elements,
      );
      // Seventh arm (owner-final): clip + smooth + the E3.3 corridor dials the
      // owner runs — a widened inter-column gutter (strataColumnGap:250) and a
      // 1.25× row-gap scale (strataRowGap:1.25). Reported so the smoother's
      // leaf-frame obstacle handling stays watched under the wider corridors,
      // where the clip dodges have more room and the shortcuts are longer.
      const ownerFinalScene = await buildArm(false, {
        strataEdgeClip: true,
        strataEdgeSmooth: true,
        strataColumnGap: 250,
        strataRowGap: 1.25,
      });
      const ownerFinal = armMetrics(ownerFinalScene);
      const ownerFinalLanes = laneQualityCensus(ownerFinalScene.elements);

      for (const [arm, m] of [
        ["owner-full", ownerFull],
        ["compact", compact],
        ["owner-routing", ownerRouting],
        ["owner-channel", ownerChannel],
        ["owner-clip", ownerClip],
        ["owner-clip-smooth", ownerClipSmooth],
        ["owner-final", ownerFinal],
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

      // E3.2 lane-quality census over the three lane-bearing arms (clip is the
      // only pass that stamps lanes; smooth/final add the finishing treatment).
      // eslint-disable-next-line no-console
      console.log(`LANES owner-clip ${JSON.stringify(ownerClipLanes)}`);
      // eslint-disable-next-line no-console
      console.log(
        `LANES owner-clip-smooth ${JSON.stringify(ownerClipSmoothLanes)}`,
      );
      // eslint-disable-next-line no-console
      console.log(`LANES owner-final ${JSON.stringify(ownerFinalLanes)}`);

      // ── SANITY INVARIANTS (no aspirational thresholds — this IS the baseline).
      assertScoreboardSane(ownerFull);
      assertScoreboardSane(compact);
      assertScoreboardSane(ownerRouting);
      assertScoreboardSane(ownerChannel);
      assertScoreboardSane(ownerClip);
      assertScoreboardSane(ownerClipSmooth);
      assertScoreboardSane(ownerFinal);
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
      // E3.2 PERMANENT lane walk: a sanctioned lane polyline never strictly
      // enters a FOREIGN leaf-cluster frame's interior. Loop-2 measured 4 such
      // violations (the shared-ancestor obstacle-selection gap); the E3.2
      // full-span obstacle union guarantees 0 by construction.
      expect(ownerClipLanes.laneFrameViolations).toEqual([]);
      // P0-b (loop-3): the SAME permanent lane-vs-frame strict-interior walk on
      // the SMOOTH arm. The smoother must treat foreign leaf-cluster frames as an
      // obstacle class, or its inflection shortcuts / chamfer cuts re-cut a frame
      // the clip pass dodged around (measured RED without P0-a: 2 lane-frame
      // violations that are 0 pre-smooth). This is the assert that catches P0-a.
      expect(ownerClipSmoothLanes.laneFrameViolations).toEqual([]);

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
