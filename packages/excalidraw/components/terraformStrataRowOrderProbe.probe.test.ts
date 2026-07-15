/**
 * SCRATCH read-only probe — Strata region-row-order investigation, ROUND 2
 * (2026-07-14). Supersedes the Round-1 scratch probe (same path). Applies the
 * six codex harness corrections, redefines the owner target per config, and
 * runs the corrected EXP-3R (descent replay a/b/c/d) + EXP-5R/6 (stage-separated
 * rankings) with rendered crossings/TLL metrics.
 *
 * CODEX FIXES LANDED (see block comments tagged [FIX-n]):
 *  1. assert reconMatchesReal            — the calibration gate now FAILS on divergence
 *  2. reproduce chooseStrataRefinedPlacement guard — orchestrator-identical finalize
 *  3. strengthen the scene signature     — id/points/containment/order, not type|x,y,w,h
 *  4. geometry-dedup the rankings         — rank over equivalence classes
 *  5. validate EVERY candidate index      — vs production strataPackedCandidateSequences count
 *  6. measure rendered CROSSINGS + TLL    — diagnosePipelineScene + Σ|hypot|, not just pierce
 *
 * Run ONLY this file (single process):
 *   yarn vitest run packages/excalidraw/components/terraformStrataRowOrderProbe.probe.test.ts
 *
 * NOT committed. Imports existing exports only; mutates nothing.
 */
import { describe, expect, it } from "vitest";

import graphlibDot from "@dagrejs/graphlib-dot";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";
import { layoutTerraformFromSources } from "./terraformLayoutCore";
import { resolveStrataDemoOptions } from "./terraformStrataDefaults";
import { preparePipelineLayout } from "./terraformPipelineLayoutShared";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { clusterFrameLocalRect } from "./terraformPipelineV2Pack";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
} from "./terraformPlanParsing";
import { buildStrataModel } from "./terraformPipelineStrataModel";
import { repairStrataCycles } from "./terraformPipelineStrataCycleRepair";
import { rankStrataClusters } from "./terraformPipelineStrataRank";
import { placeStrataHulls } from "./terraformPipelineStrataPlacement";
import {
  chooseStrataRefinedPlacement,
  placeStrataHullsPackedScored,
  scoreStrataPlacementGeometry,
  strataRelocateAdoptable,
  strataWeightedCross,
} from "./terraformPipelineStrataPackedScoring";
import type {
  StrataPackedScore,
  StrataPackedTrialRecord,
} from "./terraformPipelineStrataPackedScoring";
import {
  liftStrataEdgesToUnits,
  orderStrataUnits,
  strataPackedCandidateSequences,
  strataUnitId,
} from "./terraformPipelineStrataOrdering";
import { refineStrataCoordinates } from "./terraformPipelineStrataCoordRefine";
import { refineStrataVerticalSlots } from "./terraformPipelineStrataVerticalRelocate";
import { buildStrataScene } from "./terraformPipelineStrataSceneBuild";
import { computePierceMetrics } from "./terraformPipelineStrataPierceMetrics";
import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import { computeStrataPathMetrics } from "./terraformPipelineStrataPathMetrics";

import type {
  StrataEngineOptions,
  StrataHullNode,
  StrataModel,
  StrataPlacementResult,
  StrataPrimeEdge,
  StrataRankResult,
  StrataUnit,
} from "./terraformPipelineStrataTypes";
import type { TerraformPlanParsingSources } from "./terraformPlanParsing";
import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";
import type { TerraformPlanNodesMap } from "./terraformPlanParsing";

const PRESET = "staging-extended-localstack-v2";
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 30;

const v2Sources = () =>
  getTerraformImportPresetSourcesFromDb(
    PRESET,
  ) as unknown as TerraformPlanParsingSources;

// ── A/B/C owner configs ───────────────────────────────────────────────────────
type Variant = "A" | "B" | "C";
const EPS: Record<Variant, number> = { A: 2, B: 0, C: 1 };
const PAR: Record<Variant, boolean> = { A: true, B: false, C: false };

const demoStrataOptions = (v: Variant) =>
  resolveStrataDemoOptions({
    strataSweeps: 4,
    strataCoordRefine: true,
    strataRankSeparate: true,
    strataPackedScoring: true,
    strataBandDepth: "root",
    strataSift: true,
    strataPackedEps: EPS[v],
  });

// ── real app-path build ───────────────────────────────────────────────────────
type Scene = { elements: ExcalidrawElement[]; meta: Record<string, unknown> };

const buildReal = async (
  v: Variant,
  opts: { frontier?: boolean; compact?: boolean } = {},
): Promise<Scene> => {
  const compact = opts.compact !== false;
  const res = await layoutTerraformFromSources(v2Sources(), {
    layoutMode: "strata",
    pipelineCompact: compact,
    pipelinePrivateApiRegional: PAR[v],
    ...demoStrataOptions(v),
    ...(opts.frontier ? { strataPackedFrontierMeta: true } : {}),
  } as Record<string, unknown>);
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res.scene as Scene;
};

// ── [FIX-3] strengthened scene signature ──────────────────────────────────────
// Round 1 used a sorted multiset of `type|x,y,w,h`, which omits identity, points,
// containment and ordering — two structurally-different scenes can collide.
// The strata finalize pass gives every element a CONTENT-DERIVED stable id and
// pins seed/version/versionNonce/updated deterministically, so id IS stable
// across two identical builds and is safe to include; only the (also
// deterministic but noisy) seed/version fields are left out. Elements arrive in
// a stable array order, so array position carries z-order.
type Anyel = ExcalidrawElement & {
  points?: ReadonlyArray<readonly [number, number]>;
  containerId?: string | null;
  boundElements?: ReadonlyArray<{ id: string }> | null;
  startBinding?: { elementId: string } | null;
  endBinding?: { elementId: string } | null;
  text?: string;
  name?: string | null;
  customData?: Record<string, unknown>;
};

const elementSignature = (el: Anyel, ordinal: number): string => {
  const parts: string[] = [
    `#${ordinal}`,
    el.type,
    `id=${el.id}`,
    `xywh=${el.x},${el.y},${el.width},${el.height}`,
    `a=${el.angle}`,
    `f=${el.frameId ?? ""}`,
  ];
  if (el.containerId != null) {
    parts.push(`c=${el.containerId}`);
  }
  if (el.groupIds && el.groupIds.length) {
    parts.push(`g=${el.groupIds.join("+")}`);
  }
  if (el.boundElements && el.boundElements.length) {
    parts.push(`be=${el.boundElements.map((b) => b.id).join("+")}`);
  }
  if (Array.isArray(el.points)) {
    parts.push(`p=${el.points.map(([px, py]) => `${px}:${py}`).join(";")}`);
  }
  if (el.startBinding) {
    parts.push(`sb=${el.startBinding.elementId}`);
  }
  if (el.endBinding) {
    parts.push(`eb=${el.endBinding.elementId}`);
  }
  if (typeof el.text === "string") {
    parts.push(`t=${el.text}`);
  }
  if (typeof el.name === "string") {
    parts.push(`n=${el.name}`);
  }
  return parts.join("|");
};

// Ordering-sensitive signature: elements in array order, each with its ordinal.
const sceneSignature = (elements: readonly ExcalidrawElement[]): string =>
  elements
    .filter((el) => !el.isDeleted)
    .map((el, i) => elementSignature(el as Anyel, i))
    .join("\n");

// ── rendered metrics [FIX-6] ──────────────────────────────────────────────────
// diagnosePipelineScene(...).dataflow.crossings = whole-scene rendered polyline
// crossings (pair-counted, endpoint-share guarded). TLL is not exported, so we
// compute Σ|hypot| over the SAME arrow population the metrics use.
const isDataflowArrow = (el: Anyel): boolean => {
  if (el.type !== "arrow") {
    return false;
  }
  const rel = el.customData?.relationship as
    | { source?: unknown; target?: unknown; aggregated?: unknown }
    | undefined;
  return (
    !!rel &&
    typeof rel.source === "string" &&
    typeof rel.target === "string" &&
    rel.aggregated !== true
  );
};

const sceneTLL = (elements: readonly ExcalidrawElement[]): number => {
  let tll = 0;
  for (const el of elements as Anyel[]) {
    if (!isDataflowArrow(el) || !Array.isArray(el.points)) {
      continue;
    }
    const pts = el.points;
    for (let i = 1; i < pts.length; i++) {
      tll += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
    }
  }
  return Math.round(tll);
};

type RenderedMetrics = {
  crossings: number;
  sharpShare: number;
  tll: number;
  pierce: number;
  rtHatP50: number;
  rtHatMean: number;
  pathRows: number;
};

const renderedMetrics = (
  elements: readonly ExcalidrawElement[],
): RenderedMetrics => {
  const diag = diagnosePipelineScene(elements) as unknown as {
    dataflow: { crossings: number };
    crossingAngles?: { sharpShare?: number };
  };
  const pm = computePierceMetrics(elements);
  const paths = computeStrataPathMetrics(elements);
  const rt = paths.rows.map((r) => r.rtHat).sort((a, b) => a - b);
  const p50 = rt.length ? rt[Math.floor((rt.length - 1) / 2)]! : 0;
  const mean = rt.length ? rt.reduce((s, x) => s + x, 0) / rt.length : 0;
  return {
    crossings: diag.dataflow.crossings,
    sharpShare: Math.round((diag.crossingAngles?.sharpShare ?? 0) * 1000) / 1000,
    tll: sceneTLL(elements),
    pierce: pm.pierce.total,
    rtHatP50: Math.round(p50 * 1000) / 1000,
    rtHatMean: Math.round(mean * 1000) / 1000,
    pathRows: paths.rows.length,
  };
};

// ── faithful internal-pipeline reconstruction ─────────────────────────────────
const loadNodes = (): { nodes: TerraformPlanNodesMap; plan: unknown } => {
  const raw = getTerraformImportPresetSourcesFromDb(PRESET);
  const sources = resolveSourcesWithTfdComposition(
    raw! as TerraformImportPresetSources,
  );
  const bundle = sources.planDotBundles[0]!;
  const graph = graphlibDot.read("digraph G {}\n");
  const nodes = buildTerraformLocalImportNodesMap(bundle.plan, graph, [], {});
  applyTfdOverlayToNodes(nodes, sources.tfdTexts, sources.tfdLabels);
  return { nodes, plan: bundle.plan };
};

type RelocateCfg = {
  penW: number;
  crossW: number;
  epsilon: number;
  edgeCrossCap: number;
};

type Recon = {
  nodes: TerraformPlanNodesMap;
  prep: ReturnType<typeof preparePipelineLayout>;
  model: StrataModel;
  edgesPrime: readonly StrataPrimeEdge[];
  rank: StrataRankResult;
  engineOptions: StrataEngineOptions;
  packedScored: ReturnType<typeof placeStrataHullsPackedScored>;
  trials: StrataPackedTrialRecord[];
  relocateCfg: RelocateCfg;
};

const reconstruct = (v: Variant, compact = true): Recon => {
  const s = demoStrataOptions(v) as Record<string, unknown>;
  const eps = (s.strataPackedScoringEpsilon as number) ?? 0;
  const siftRelocate = s.strataSiftRelocate === true;
  const packedScoring = s.strataPackedScoring === true;
  const rankSeparate = s.strataRankSeparate === true;
  const sweeps = (s.strataSweeps as number) ?? 0;
  const coordinateRefine = s.strataCoordinateRefine === true;
  const bandDepth = (s.strataBandDepth as string | undefined) ?? "account";

  const { nodes, plan } = loadNodes();
  const prep = preparePipelineLayout(nodes, plan, compact, {
    privateApiRegional: PAR[v],
  });

  const engineOptions = {
    compact,
    includeAncillary: false,
    networkSimplexRank: false,
    rankSeparate,
    sweeps,
    coordinateRefine,
    ...(packedScoring ? { packedScoring: true } : {}),
    ...((packedScoring || siftRelocate) && eps !== 0
      ? { packedScoringEpsilon: eps }
      : {}),
    ...(bandDepth !== "account" ? { strataBandDepth: bandDepth } : {}),
    ...(siftRelocate ? { strataSiftRelocate: true } : {}),
  } as unknown as StrataEngineOptions;

  const model = buildStrataModel(prep, engineOptions);
  const repair = repairStrataCycles(model.edges, model.addressOf);
  const rank = rankStrataClusters([...model.clusters.keys()], repair, {
    networkSimplexRank: engineOptions.networkSimplexRank,
    rankSeparate: engineOptions.rankSeparate,
    hullRoot: model.hullRoot,
    unitWidthOf: (id) => {
      const c = model.clusters.get(id);
      return c ? clusterFrameLocalRect(c).width : 0;
    },
  });
  // [EXP-3R] capture the FULL descent trial trace via the production onPackedTrial
  // callback — the same hook the orchestrator uses for strataPackedFrontierMeta.
  const trials: StrataPackedTrialRecord[] = [];
  const packedScored = placeStrataHullsPackedScored(
    model,
    repair.edgesPrime,
    rank,
    engineOptions,
    (record) => trials.push(record),
  );
  const relocateCfg: RelocateCfg = {
    penW: 1,
    crossW: 1,
    epsilon: eps,
    edgeCrossCap: eps, // strataEdgeCrossCap absent ⇒ inherits packedScoringEpsilon
  };
  return {
    nodes,
    prep,
    model,
    edgesPrime: repair.edgesPrime,
    rank,
    engineOptions,
    packedScored,
    trials,
    relocateCfg,
  };
};

// ── [FIX-2] orchestrator-identical finalize (chooseStrataRefinedPlacement guard) ─
// Mirrors terraformPipelineStrata.ts:430-486: refine BOTH the packed-scored arm
// AND the legacy baseline arm, pick via chooseStrataRefinedPlacement (only when a
// hull actually moved), THEN relocate. Round-1's scoreStages skipped the guard.
const finalizeOrchestrator = (
  recon: Recon,
): { placement: StrataPlacementResult; fellBack: boolean } => {
  const { model, edgesPrime, rank, engineOptions, packedScored, relocateCfg } =
    recon;
  let placement = packedScored.placement;
  let fellBack = false;
  if (engineOptions.coordinateRefine) {
    if (packedScored.selections.size > 0) {
      const scoredFinal = refineStrataCoordinates(placement, model, edgesPrime);
      const legacyFinal = refineStrataCoordinates(
        packedScored.baselinePlacement,
        model,
        edgesPrime,
      );
      const chosen = chooseStrataRefinedPlacement(
        scoredFinal,
        legacyFinal,
        model,
        edgesPrime,
        packedScored.effectiveDelta,
        engineOptions.strataSiftRelocate ? relocateCfg : undefined,
      );
      placement = chosen.placement;
      fellBack = chosen.fellBack;
    } else {
      placement = refineStrataCoordinates(placement, model, edgesPrime);
    }
  }
  if (engineOptions.strataSiftRelocate) {
    placement = refineStrataVerticalSlots(
      placement,
      model,
      edgesPrime,
      rank,
      engineOptions,
    );
  }
  return { placement, fellBack };
};

// Per-CANDIDATE stage scoring (for the oracle) — place(override) → A7 → relocate.
// This is NOT the guard path; a forced candidate is scored on its OWN geometry.
type StageScores = {
  preA7: StrataPackedScore;
  postA7: StrataPackedScore;
  postRelocate: StrataPackedScore;
};

const scoreStages = (
  recon: Recon,
  base: StrataPlacementResult,
): { stages: StageScores; final: StrataPlacementResult } => {
  const { model, edgesPrime, rank, engineOptions } = recon;
  const preA7 = scoreStrataPlacementGeometry(base, model, edgesPrime);
  const a7 = engineOptions.coordinateRefine
    ? refineStrataCoordinates(base, model, edgesPrime)
    : base;
  const postA7 = scoreStrataPlacementGeometry(a7, model, edgesPrime);
  const relocated = engineOptions.strataSiftRelocate
    ? refineStrataVerticalSlots(a7, model, edgesPrime, rank, engineOptions)
    : a7;
  const postRelocate = scoreStrataPlacementGeometry(
    relocated,
    model,
    edgesPrime,
  );
  return { stages: { preA7, postA7, postRelocate }, final: relocated };
};

const weighted = (recon: Recon, s: StrataPackedScore): number =>
  strataWeightedCross(s, recon.relocateCfg.penW, recon.relocateCfg.crossW);

const fmtScore = (recon: Recon, s: StrataPackedScore) =>
  `{cr:${s.crossings} pen:${s.penetrations} L1:${Math.round(
    s.lengthL1,
  )} C=${weighted(recon, s)}}`;

// ── hull-tree helpers ─────────────────────────────────────────────────────────
const findHull = (
  root: StrataHullNode,
  pred: (h: StrataHullNode) => boolean,
): StrataHullNode | undefined => {
  if (pred(root)) {
    return root;
  }
  for (const c of root.children) {
    const f = findHull(c, pred);
    if (f) {
      return f;
    }
  }
  return undefined;
};

const subtreeLeafIds = (h: StrataHullNode): string[] => {
  const out = [...h.leafClusterIds];
  for (const c of h.children) {
    out.push(...subtreeLeafIds(c));
  }
  return out;
};

const regionHullOf = (model: StrataModel, region: string): StrataHullNode => {
  const h = findHull(
    model.hullRoot,
    (n) => n.role === "region" && n.path[n.path.length - 1] === region,
  );
  if (!h) {
    const any = findHull(
      model.hullRoot,
      (n) =>
        n.role === "region" &&
        subtreeLeafIds(n).some((id) => model.addressOf(id).includes(region)),
    );
    if (!any) {
      throw new Error(`no region hull for ${region}`);
    }
    return any;
  }
  return h;
};

const unitsOf = (h: StrataHullNode): StrataUnit[] => {
  const units: StrataUnit[] = [];
  for (const c of h.children) {
    units.push({ kind: "hull", hullId: c.id });
  }
  for (const leafId of h.leafClusterIds) {
    units.push({ kind: "leaf", clusterId: leafId });
  }
  return units;
};

// role tag for a region unit: V5-apis / Va-rds / S3 / singleton:* / vpc:*
const classifyRegionUnits = (model: StrataModel, h: StrataHullNode) => {
  const map = new Map<string, string>();
  for (const u of unitsOf(h)) {
    const id = strataUnitId(u);
    if (u.kind === "leaf") {
      const addr = model.addressOf(u.clusterId);
      map.set(id, /s3|bucket/i.test(addr) ? `S3:${addr}` : `singleton:${addr}`);
      continue;
    }
    const child = findHull(model.hullRoot, (n) => n.id === u.hullId)!;
    const addrs = subtreeLeafIds(child).map((x) => model.addressOf(x));
    const tag = child.path[child.path.length - 1] ?? "?";
    let role = `vpc:${tag}`;
    if (addrs.some((a) => /api|apigateway|rest_api/i.test(a))) {
      role = `V5-apis:${tag}`;
    } else if (addrs.some((a) => /rds|db_instance|database/i.test(a))) {
      role = `Va-rds:${tag}`;
    }
    map.set(id, role);
  }
  return map;
};

// Build the exact orderParams placeStrataHulls passes to the ordering module for
// one hull (mirrors terraformPipelineStrataPlacement.ts step 3).
type UInfo = {
  unit: StrataUnit;
  unitId: string;
  x0: number;
  x1: number;
  height: number;
  colSpan: readonly [number, number];
  contentKey: string;
};

const buildOrderParams = (recon: Recon, h: StrataHullNode) => {
  const { model, rank, edgesPrime, engineOptions } = recon;
  const rankOf = (cid: string): number => {
    const r = rank.rank.get(cid);
    if (r === undefined) {
      throw new Error(`no rank ${cid}`);
    }
    return r;
  };
  const columnLeft = (r: number): number => rank.columnX[r]!;
  const infos: UInfo[] = [];
  const fullPlacement = placeStrataHulls(model, edgesPrime, rank, engineOptions);
  for (const child of h.children) {
    const bh = fullPlacement.boxedHulls.get(child.id)!;
    const leaves = subtreeLeafIds(child);
    let colMin = Number.POSITIVE_INFINITY;
    let colMax = Number.NEGATIVE_INFINITY;
    for (const leaf of leaves) {
      const r = rankOf(leaf);
      colMin = Math.min(colMin, r);
      colMax = Math.max(colMax, r);
    }
    let minAddr: string | undefined;
    for (const id of leaves) {
      const a = model.addressOf(id);
      if (minAddr === undefined || a < minAddr) {
        minAddr = a;
      }
    }
    infos.push({
      unit: { kind: "hull", hullId: child.id },
      unitId: `H:${child.id}`,
      x0: bh.box.x,
      x1: bh.box.x + bh.box.width,
      height: bh.box.height,
      colSpan: [colMin, colMax],
      contentKey: minAddr ?? "",
    });
  }
  for (const leafId of h.leafClusterIds) {
    const cluster = model.clusters.get(leafId)!;
    const rect = clusterFrameLocalRect(cluster);
    const r = rankOf(leafId);
    const x0 = columnLeft(r);
    infos.push({
      unit: { kind: "leaf", clusterId: leafId },
      unitId: `L:${leafId}`,
      x0,
      x1: x0 + rect.width,
      height: rect.height,
      colSpan: [r, r],
      contentKey: model.addressOf(leafId),
    });
  }
  const infoByUnitId = new Map(infos.map((i) => [i.unitId, i]));
  const unitOfCluster = new Map<string, string>();
  for (const child of h.children) {
    const uid = `H:${child.id}`;
    for (const cid of subtreeLeafIds(child)) {
      unitOfCluster.set(cid, uid);
    }
  }
  for (const leafId of h.leafClusterIds) {
    unitOfCluster.set(leafId, `L:${leafId}`);
  }
  const liftedEdges = liftStrataEdgesToUnits(edgesPrime, (cid) =>
    unitOfCluster.get(cid),
  );
  const orderParams = {
    units: infos.map((i) => i.unit),
    contentKeyOf: (unit: StrataUnit) =>
      infoByUnitId.get(strataUnitId(unit))!.contentKey,
    liftedEdges,
    unitHeightOf: (id: string) => infoByUnitId.get(id)?.height ?? 0,
    policy: h.policy,
    sweeps: engineOptions.sweeps,
    unitXSpanOf: (id: string): readonly [number, number] => {
      const info = infoByUnitId.get(id);
      return info ? [info.x0, info.x1] : [0, 0];
    },
    unitColSpanOf: (id: string): readonly [number, number] =>
      infoByUnitId.get(id)?.colSpan ?? [0, 0],
    siftRelocate: engineOptions.strataSiftRelocate,
    edgesPrime,
    unitOfCluster: (cid: string) => unitOfCluster.get(cid),
  };
  return { orderParams, infos, infoByUnitId };
};

// place with a per-region candidate override (undefined ⇒ legacy order)
const placeWithRegion = (
  recon: Recon,
  contextSel: ReadonlyMap<string, number>,
  regionId: string,
  idx: number | "legacy",
): StrataPlacementResult => {
  const m = new Map(contextSel);
  if (idx === "legacy") {
    m.delete(regionId);
  } else {
    m.set(regionId, idx);
  }
  return placeStrataHulls(
    recon.model,
    recon.edgesPrime,
    recon.rank,
    recon.engineOptions,
    m,
  );
};

// canonical leaf-box signature (geometry-equivalence key) for a placement
const boxSig = (p: StrataPlacementResult): string => {
  const parts: string[] = [];
  for (const id of [...p.leafBoxes.keys()].sort()) {
    const b = p.leafBoxes.get(id)!;
    parts.push(`${id}:${b.x},${b.y},${b.width},${b.height}`);
  }
  return parts.join("|");
};

// vertical (top->bottom) order of the region's DIRECT units in a placement.
const realizedRegionOrder = (
  recon: Recon,
  p: StrataPlacementResult,
  h: StrataHullNode,
): string[] => {
  const yOfUnit = (u: StrataUnit): number => {
    const leaves =
      u.kind === "leaf"
        ? [u.clusterId]
        : subtreeLeafIds(
            findHull(recon.model.hullRoot, (n) => n.id === u.hullId)!,
          );
    let minY = Number.POSITIVE_INFINITY;
    for (const leaf of leaves) {
      const b = p.leafBoxes.get(leaf);
      if (b) {
        minY = Math.min(minY, b.y);
      }
    }
    return minY;
  };
  return unitsOf(h)
    .map((u) => ({ id: strataUnitId(u), y: yOfUnit(u) }))
    .sort((a, b) => a.y - b.y)
    .map((e) => e.id);
};

// s3 leaf-box min-Y in a placement (owner "S3 exiled to bottom" measurement)
const s3MinY = (
  recon: Recon,
  p: StrataPlacementResult,
  h: StrataHullNode,
): number => {
  const classify = classifyRegionUnits(recon.model, h);
  for (const u of unitsOf(h)) {
    if (u.kind === "leaf" && classify.get(strataUnitId(u))?.startsWith("S3")) {
      const b = p.leafBoxes.get(u.clusterId);
      return b ? b.y : NaN;
    }
  }
  return NaN;
};

const buildScene = async (recon: Recon, placement: StrataPlacementResult) =>
  buildStrataScene({
    prep: recon.prep,
    model: recon.model,
    placement,
    nodes: recon.nodes,
    generation: 1,
  });

const US_WEST_2 = "us-west-2";

// production per-hull candidate count for a region (the count the descent used)
const productionRegionCount = (recon: Recon, regionId: string): number => {
  const counts = new Map<string, number>();
  placeStrataHulls(
    recon.model,
    recon.edgesPrime,
    recon.rank,
    recon.engineOptions,
    new Map(),
    (hullId, count) => counts.set(hullId, count),
  );
  return counts.get(regionId) ?? -1;
};

// ══════════════════════════════════════════════════════════════════════════════
describe("Strata row-order probe — ROUND 2", () => {
  it(
    "EXP-0R: determinism + strengthened-signature fidelity gate (asserted) + orchestrator guard",
    async () => {
      const report: string[] = [];
      const gateFailures: string[] = [];
      for (const v of ["A", "B", "C"] as Variant[]) {
        report.push(`\n===== CONFIG ${v} (eps=${EPS[v]} PAR=${PAR[v]}) =====`);

        // determinism: 2 cold + 1 warm, strengthened signature
        clearTerraformImportPrepCache();
        const cold1 = await buildReal(v, { frontier: true });
        clearTerraformImportPrepCache();
        const cold2 = await buildReal(v, { frontier: true });
        const warm = await buildReal(v, { frontier: true });
        const s1 = sceneSignature(cold1.elements);
        const s2 = sceneSignature(cold2.elements);
        const s3 = sceneSignature(warm.elements);
        report.push(
          `determinism (strengthened sig): cold1==cold2 ${
            s1 === s2
          } cold1==warm ${s1 === s3} (elements=${cold1.elements.length})`,
        );
        expect(s1).toBe(s2);
        expect(s1).toBe(s3);

        const m = cold1.meta;
        report.push(
          `meta: fellBack=${m.strataPackedScoringFellBack} trials=${m.strataPackedScoringTrials} eps=${m.strataPackedScoringEpsilon} effDelta=${m.strataPackedScoringEffectiveDelta}`,
        );
        report.push(
          `meta selections: ${JSON.stringify(m.strataPackedScoringSelections)}`,
        );

        // reconstruction fidelity — packed descent selections/score/trials
        const recon = reconstruct(v);
        const reSel = Object.fromEntries(recon.packedScored.selections);
        expect(reSel).toEqual(m.strataPackedScoringSelections);
        expect(recon.packedScored.score).toEqual(m.strataPackedScoringScore);
        expect(recon.packedScored.baselineScore).toEqual(
          m.strataPackedScoringBaselineScore,
        );
        expect(recon.packedScored.trialCount).toBe(m.strataPackedScoringTrials);
        report.push(`RECON packed: selections/score/baseline/trials MATCH real meta`);

        // [FIX-2] finalize through the orchestrator guard, [FIX-1] ASSERT parity
        const { placement, fellBack } = finalizeOrchestrator(recon);
        const scene = await buildScene(recon, placement);
        const reconSig = sceneSignature(scene.elements);
        const realSig = sceneSignature(cold1.elements);
        const reconMatchesReal = reconSig === realSig;
        report.push(
          `RECON final-scene (guard, strengthened sig) == real: ${reconMatchesReal} (reconFellBack=${fellBack}, metaFellBack=${m.strataPackedScoringFellBack})`,
        );
        if (!reconMatchesReal) {
          const a = reconSig.split("\n");
          const b = realSig.split("\n");
          let shown = 0;
          for (let i = 0; i < Math.max(a.length, b.length) && shown < 3; i++) {
            if (a[i] !== b[i]) {
              report.push(`  DIFF@${i}:\n    recon: ${a[i]}\n    real:  ${b[i]}`);
              shown++;
            }
          }
          report.push(`  (recon lines=${a.length} real lines=${b.length})`);
        }
        // [FIX-1] gate: collect failures, assert AFTER logging the full report.
        if (fellBack !== (m.strataPackedScoringFellBack === true)) {
          gateFailures.push(`${v}: fellBack recon=${fellBack} meta=${m.strataPackedScoringFellBack}`);
        }
        if (!reconMatchesReal) {
          gateFailures.push(`${v}: reconMatchesReal=false`);
        }

        // region row order from the reconstructed model
        const region = regionHullOf(recon.model, US_WEST_2);
        const classify = classifyRegionUnits(recon.model, region);
        report.push(
          `us-west-2 hull id=${region.id} policy=${region.policy} units(${
            unitsOf(region).length
          }): ${unitsOf(region)
            .map((u) => classify.get(strataUnitId(u)))
            .join(" | ")}`,
        );
        report.push(
          `  legacy order (top->bottom): ${realizedRegionOrder(
            recon,
            placeWithRegion(
              recon,
              recon.packedScored.selections,
              region.id,
              "legacy",
            ),
            region,
          )
            .map((id) => classify.get(id))
            .join(" -> ")}`,
        );
      }
      // eslint-disable-next-line no-console
      console.log(`\n[EXP-0R]\n${report.join("\n")}`);
      // [FIX-1] fidelity gate now ENFORCED (after logging so diagnostics survive)
      expect(gateFailures).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "FIX-5 + Config-A exclusion: validate every candidate index vs production enumeration; verify us-west-2 V5 presence",
    async () => {
      const report: string[] = [];
      const gateFailures: string[] = [];
      for (const v of ["A", "B", "C"] as Variant[]) {
        clearTerraformImportPrepCache();
        const recon = reconstruct(v);
        const region = regionHullOf(recon.model, US_WEST_2);
        const classify = classifyRegionUnits(recon.model, region);
        const { orderParams } = buildOrderParams(recon, region);
        const cands = strataPackedCandidateSequences(orderParams);
        const prodCount = productionRegionCount(recon, region.id);
        report.push(`\n===== CONFIG ${v} =====`);
        report.push(
          `region units: ${unitsOf(region)
            .map((u) => classify.get(strataUnitId(u)))
            .join(" | ")}`,
        );

        // [FIX-5] mirrored enumeration must equal production's candidate count
        report.push(
          `candidate count: mirrored=${cands.length} production=${prodCount} MATCH=${
            cands.length === prodCount
          }`,
        );
        if (cands.length !== prodCount) {
          gateFailures.push(`${v}: count mirrored=${cands.length} prod=${prodCount}`);
        }

        // [FIX-5] validate EVERY index: idx<count, force via engine, byte-check
        // the realized top->bottom region order equals the enumerated candidate.
        const contextSel = recon.packedScored.selections;
        let fullMatches = 0;
        for (let i = 0; i < cands.length; i++) {
          if (i >= prodCount) {
            gateFailures.push(`${v}: idx ${i} >= prodCount ${prodCount}`);
          }
          const p = placeWithRegion(recon, contextSel, region.id, i);
          const realized = realizedRegionOrder(recon, p, region).join(",");
          const enumerated = cands[i]!.map(strataUnitId).join(",");
          if (realized === enumerated) {
            fullMatches++;
          }
        }
        report.push(
          `every idx<count: PASS; full realized-order==enumerated for ${fullMatches}/${cands.length} (remainder = X-disjoint dropY reordering, expected)`,
        );

        // Config-A V5 location: is there a region-level V5 (vpc-5b587) unit?
        const hasV5 = unitsOf(region).some((u) =>
          classify.get(strataUnitId(u))?.startsWith("V5"),
        );
        report.push(`us-west-2 has region-level V5 unit: ${hasV5}`);
        if (!hasV5) {
          const apiLeaves = [...recon.model.clusters.keys()].filter((id) =>
            /api|apigateway|rest_api/i.test(recon.model.addressOf(id)),
          );
          const locs = apiLeaves.slice(0, 8).map((id) => {
            let deepest: StrataHullNode | undefined;
            const walk = (n: StrataHullNode) => {
              if (subtreeLeafIds(n).includes(id)) {
                deepest = n;
                n.children.forEach(walk);
              }
            };
            walk(recon.model.hullRoot);
            return `${recon.model.addressOf(id)} @ ${deepest?.role}:${
              deepest?.path[deepest.path.length - 1]
            }`;
          });
          report.push(
            `  private-API leaves (${apiLeaves.length}) render at: ${locs.join(
              " ; ",
            )}`,
          );
        }
      }
      // eslint-disable-next-line no-console
      console.log(`\n[FIX-5 + Config-A]\n${report.join("\n")}`);
      expect(gateFailures).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "EXP-5R/6: stage-separated rankings (pre-A7 / post-A7 / post-relocate), geometry-deduped, + rendered crossings/TLL; S3 X-disjoint check",
    async () => {
      const report: string[] = [];
      const gateFailures: string[] = [];
      for (const v of ["B", "C"] as Variant[]) {
        clearTerraformImportPrepCache();
        const recon = reconstruct(v);
        const region = regionHullOf(recon.model, US_WEST_2);
        const classify = classifyRegionUnits(recon.model, region);
        const roleOf = (id: string) => classify.get(id) ?? "?";
        const built = buildOrderParams(recon, region);
        const orderParams = built.orderParams;
        const infoByUnitId = built.infoByUnitId;
        const cands = strataPackedCandidateSequences(orderParams);
        const contextSel = recon.packedScored.selections;
        const engIdx = contextSel.get(region.id);

        report.push(`\n===== CONFIG ${v} (eps=${EPS[v]}) =====`);

        // CALIBRATION: engine-map placement == descent-winner placement
        const enginePlacement = placeWithRegion(
          recon,
          contextSel,
          region.id,
          engIdx === undefined ? "legacy" : engIdx,
        );
        const calibOk =
          boxSig(enginePlacement) === boxSig(recon.packedScored.placement);
        report.push(`CALIBRATION engine-map==descent-winner: ${calibOk}`);
        if (!calibOk) {
          gateFailures.push(`${v}: calibration engine-map!=descent-winner`);
        }

        // score every reachable candidate at all THREE stages (production scorer)
        type Row = {
          label: string;
          idx: number | "legacy";
          orderTag: string;
          pre: StrataPackedScore;
          a7: StrataPackedScore;
          rel: StrataPackedScore;
          geomKey: string;
        };
        const rows: Row[] = [];
        const evalIdx = (idx: number | "legacy", label: string) => {
          const base = placeWithRegion(recon, contextSel, region.id, idx);
          const { stages, final } = scoreStages(recon, base);
          const seq =
            idx === "legacy"
              ? orderStrataUnits(orderParams)
              : cands[Math.min(idx as number, cands.length - 1)]!;
          rows.push({
            label,
            idx,
            orderTag: seq.map((u) => roleOf(strataUnitId(u))).join(">"),
            pre: stages.preA7,
            a7: stages.postA7,
            rel: stages.postRelocate,
            geomKey: boxSig(final),
          });
        };
        for (let i = 0; i < cands.length; i++) {
          evalIdx(i, `cand${i}`);
        }
        evalIdx("legacy", "legacy");

        // [FIX-4] geometry-dedup: collapse to distinct FINAL-geometry classes.
        const classOfKey = new Map<string, number>();
        const classRep: Row[] = [];
        for (const r of rows) {
          if (!classOfKey.has(r.geomKey)) {
            classOfKey.set(r.geomKey, classRep.length);
            classRep.push(r);
          }
        }
        const wC = (s: StrataPackedScore) => strataWeightedCross(s, 1, 1);
        const cmp = (a: StrataPackedScore, b: StrataPackedScore) =>
          wC(a) !== wC(b) ? wC(a) - wC(b) : a.lengthL1 - b.lengthL1;
        const rankIn = (stage: "pre" | "a7" | "rel", label: string) => {
          const sorted = [...classRep].sort((x, y) => cmp(x[stage], y[stage]));
          // rank the row's CLASS, so duplicate-geometry rows share a rank
          const key = rows.find((r) => r.label === label)!.geomKey;
          return sorted.findIndex((r) => r.geomKey === key) + 1;
        };
        const nClasses = classRep.length;
        report.push(
          `reachable candidates: ${cands.length} (+legacy) | distinct final-geometry classes: ${nClasses}`,
        );

        const engLabel = engIdx === undefined ? "legacy" : `cand${engIdx}`;
        const rowOf = (label: string) => rows.find((r) => r.label === label)!;

        // owner target per config
        const engSeq =
          engIdx === undefined
            ? orderStrataUnits(orderParams)
            : cands[Math.min(engIdx, cands.length - 1)]!;
        const engIds = engSeq.map(strataUnitId);
        let ownerLabel: string | undefined;
        let ownerDesc = "";
        if (v === "C") {
          const v5i = engIds.findIndex((id) => roleOf(id).startsWith("V5"));
          const vai = engIds.findIndex((id) => roleOf(id).startsWith("Va"));
          if (v5i >= 0 && vai >= 0) {
            const sw = [...engIds];
            [sw[v5i], sw[vai]] = [sw[vai]!, sw[v5i]!];
            const oi = cands.findIndex(
              (c) => c.map(strataUnitId).join("") === sw.join(""),
            );
            ownerLabel = oi >= 0 ? `cand${oi}` : undefined;
            ownerDesc = "VPC-swap (Va above V5)";
          }
        } else {
          const s3Unit = unitsOf(region).find((u) =>
            classify.get(strataUnitId(u))?.startsWith("S3"),
          );
          if (s3Unit) {
            const s3Id = strataUnitId(s3Unit);
            const lifters = rows.filter((r) => {
              if (r.idx === "legacy") {
                return false;
              }
              const seq = cands[r.idx as number]!.map(strataUnitId);
              return seq[seq.length - 1] !== s3Id;
            });
            lifters.sort((x, y) => cmp(x.rel, y.rel));
            ownerLabel = lifters[0]?.label;
            ownerDesc = "best S3-lifting order (S3 not last in sequence)";
          }
        }

        const dumpRow = (label: string, tag: string) => {
          const r = rowOf(label);
          report.push(`${tag} (${label}) order=[${r.orderTag}]`);
          report.push(
            `  pre-A7 ${fmtScore(recon, r.pre)} rank ${rankIn("pre", label)}/${nClasses}`,
          );
          report.push(
            `  postA7 ${fmtScore(recon, r.a7)} rank ${rankIn("a7", label)}/${nClasses}`,
          );
          report.push(
            `  postRel ${fmtScore(recon, r.rel)} rank ${rankIn("rel", label)}/${nClasses}`,
          );
        };

        dumpRow(engLabel, "ENGINE-SELECTED");
        const bestFinal = [...classRep].sort((x, y) => cmp(x.rel, y.rel))[0]!;
        dumpRow(bestFinal.label, "PRODUCTION-OPTIMUM(final)");
        if (ownerLabel) {
          dumpRow(ownerLabel, `OWNER-TARGET[${ownerDesc}]`);
        } else {
          report.push(`OWNER-TARGET[${ownerDesc}]: NOT REACHABLE among candidates`);
        }

        // stage-rank inversion summary
        for (const label of [engLabel, bestFinal.label, ownerLabel].filter(
          Boolean,
        ) as string[]) {
          report.push(
            `  STAGE-RANKS ${label}: pre=${rankIn("pre", label)} a7=${rankIn(
              "a7",
              label,
            )} rel=${rankIn("rel", label)}`,
          );
        }

        // ── rendered crosswalk [FIX-6]: crossings + TLL + rtHat + pierce
        // Some FORCED candidate orders trip a global A6 icon-group finalize
        // invariant in buildStrataScene (unrelated to us-west-2 row order); guard
        // each build so one un-buildable order doesn't sink the whole crosswalk.
        // Engine order uses the proven orchestrator-guard finalize path.
        const renderOf = async (label: string): Promise<string> => {
          const r = rowOf(label);
          let final: StrataPlacementResult;
          if (label === engLabel) {
            final = finalizeOrchestrator(recon).placement;
          } else {
            const base = placeWithRegion(recon, contextSel, region.id, r.idx);
            final = scoreStages(recon, base).final;
          }
          try {
            const scene = await buildScene(recon, final);
            const rm = renderedMetrics(scene.elements);
            return `cross=${rm.crossings} sharp=${rm.sharpShare} TLL=${rm.tll} pierce=${rm.pierce} rtHat(p50=${rm.rtHatP50},mean=${rm.rtHatMean},rows=${rm.pathRows})`;
          } catch (e) {
            return `SCENE-BUILD-FAILED (${String((e as Error).message).slice(0, 90)})`;
          }
        };
        report.push(`RENDERED engine(${engLabel}):   ${await renderOf(engLabel)}`);
        report.push(
          `RENDERED prod-opt(${bestFinal.label}): ${await renderOf(bestFinal.label)}`,
        );
        if (ownerLabel) {
          report.push(`RENDERED owner(${ownerLabel}):    ${await renderOf(ownerLabel)}`);
        }

        // ── S3 X-disjoint verification (does row-order even move S3's Y?)
        const s3Unit = unitsOf(region).find((u) =>
          classify.get(strataUnitId(u))?.startsWith("S3"),
        );
        if (s3Unit && s3Unit.kind === "leaf") {
          const s3Id = strataUnitId(s3Unit);
          const s3Info = infoByUnitId.get(s3Id)!;
          const overlaps = unitsOf(region)
            .filter((u) => strataUnitId(u) !== s3Id)
            .filter((u) => {
              const info = infoByUnitId.get(strataUnitId(u));
              if (!info) {
                return false;
              }
              const a = s3Info.colSpan;
              const b = info.colSpan;
              return a[0] <= b[1] && b[0] <= a[1]; // colSpanOverlap (touch=overlap)
            });
          const xDisjoint = overlaps.length === 0;
          report.push(
            `S3 colSpan=[${s3Info.colSpan}] X-disjoint=${xDisjoint} (overlapping siblings: ${
              overlaps.map((u) => classify.get(strataUnitId(u))).join(",") ||
              "none"
            })`,
          );
          const s3YOf = (label: string) => {
            const r = rowOf(label);
            const base = placeWithRegion(recon, contextSel, region.id, r.idx);
            const { final } = scoreStages(recon, base);
            return Math.round(s3MinY(recon, final, region));
          };
          const ys = [engLabel, bestFinal.label, ownerLabel]
            .filter(Boolean)
            .map((l) => `${l}:y=${s3YOf(l as string)}`);
          report.push(
            `S3 rendered min-Y across orders: ${ys.join("  ")}${
              xDisjoint
                ? " → X-disjoint ⇒ row-order CANNOT lift S3 (dropY-fixed); needs vertical relocation"
                : ""
            }`,
          );
        } else {
          report.push(`S3 not a region-level leaf unit for config ${v}`);
        }
      }
      // eslint-disable-next-line no-console
      console.log(`\n[EXP-5R/6]\n${report.join("\n")}`);
      expect(gateFailures).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    "EXP-3R: descent replay — a/b/c/d for the dominant reachable order per config",
    async () => {
      const report: string[] = [];
      for (const v of ["B", "C"] as Variant[]) {
        clearTerraformImportPrepCache();
        const recon = reconstruct(v);
        const region = regionHullOf(recon.model, US_WEST_2);
        const classify = classifyRegionUnits(recon.model, region);
        const roleOf = (id: string) => classify.get(id) ?? "?";
        const { orderParams } = buildOrderParams(recon, region);
        const cands = strataPackedCandidateSequences(orderParams);
        const prodCount = productionRegionCount(recon, region.id);
        const contextSel = recon.packedScored.selections;
        const engIdx = contextSel.get(region.id);
        report.push(
          `\n===== CONFIG ${v} (eps=${EPS[v]}) region=${region.id} =====`,
        );
        report.push(
          `engine-selected region idx=${engIdx ?? "legacy"} count=${prodCount}`,
        );

        // ── replay incumbent timeline from the captured trial trace ──
        const baseline = recon.packedScored.baselineScore;
        type Visit = {
          hullId: string;
          candidateIndex: number;
          pass: number;
          score: StrataPackedScore;
          adopted: boolean;
          incumbentBefore: StrataPackedScore;
        };
        const visits: Visit[] = [];
        let bestScore = baseline;
        for (const t of recon.trials) {
          if (t.hullId === "__baseline__") {
            continue;
          }
          visits.push({
            hullId: t.hullId,
            candidateIndex: t.candidateIndex,
            pass: t.pass,
            score: t.score,
            adopted: t.adopted,
            incumbentBefore: bestScore,
          });
          if (t.adopted) {
            bestScore = t.score;
          }
        }
        const regionVisits = visits.filter((vv) => vv.hullId === region.id);
        report.push(
          `descent: ${visits.length} trials total, ${regionVisits.length} at region; final incumbent ${fmtScore(
            recon,
            bestScore,
          )}`,
        );

        // targets to classify
        const engSeq =
          engIdx === undefined
            ? orderStrataUnits(orderParams)
            : cands[Math.min(engIdx, cands.length - 1)]!;
        const engIds = engSeq.map(strataUnitId);
        const targets: { name: string; idx: number }[] = [];
        const finalKey = (s: StrataPackedScore) =>
          strataWeightedCross(s, 1, 1) * 1e7 + s.lengthL1;
        // production optimum (dominant) by final score
        {
          let bestIdx = 0;
          let bestRel: StrataPackedScore | undefined;
          for (let i = 0; i < cands.length; i++) {
            const base = placeWithRegion(recon, contextSel, region.id, i);
            const { stages } = scoreStages(recon, base);
            if (!bestRel || finalKey(stages.postRelocate) < finalKey(bestRel)) {
              bestRel = stages.postRelocate;
              bestIdx = i;
            }
          }
          targets.push({ name: "prod-optimum(final)", idx: bestIdx });
        }
        if (v === "C") {
          const v5i = engIds.findIndex((id) => roleOf(id).startsWith("V5"));
          const vai = engIds.findIndex((id) => roleOf(id).startsWith("Va"));
          if (v5i >= 0 && vai >= 0) {
            const sw = [...engIds];
            [sw[v5i], sw[vai]] = [sw[vai]!, sw[v5i]!];
            const oi = cands.findIndex(
              (c) => c.map(strataUnitId).join("") === sw.join(""),
            );
            if (oi >= 0 && !targets.some((t) => t.idx === oi)) {
              targets.push({ name: "owner VPC-swap (Va>V5)", idx: oi });
            }
          }
        } else {
          const s3Unit = unitsOf(region).find((u) =>
            classify.get(strataUnitId(u))?.startsWith("S3"),
          );
          if (s3Unit) {
            const s3Id = strataUnitId(s3Unit);
            let bestIdx = -1;
            let bestRel: StrataPackedScore | undefined;
            for (let i = 0; i < cands.length; i++) {
              const seq = cands[i]!.map(strataUnitId);
              if (seq[seq.length - 1] === s3Id) {
                continue;
              }
              const base = placeWithRegion(recon, contextSel, region.id, i);
              const { stages } = scoreStages(recon, base);
              if (!bestRel || finalKey(stages.postRelocate) < finalKey(bestRel)) {
                bestRel = stages.postRelocate;
                bestIdx = i;
              }
            }
            if (bestIdx >= 0 && !targets.some((t) => t.idx === bestIdx)) {
              targets.push({ name: "owner S3-lift (best)", idx: bestIdx });
            }
          }
        }

        const cfg = recon.relocateCfg;
        for (const tgt of targets) {
          const seq = cands[tgt.idx]!.map((u) => roleOf(strataUnitId(u))).join(
            ">",
          );
          report.push(`\n-- TARGET ${tgt.name} = cand${tgt.idx} [${seq}]`);

          // (a) availability
          if (tgt.idx >= prodCount) {
            report.push(
              `  VERDICT (a): idx ${tgt.idx} >= count ${prodCount} — NOT GENERATED`,
            );
            continue;
          }

          const recVisits = regionVisits.filter(
            (vv) => vv.candidateIndex === tgt.idx,
          );
          if (recVisits.length === 0) {
            report.push(
              `  no recorded (region,idx=${tgt.idx}) trial — it was the region's current selection at those visits (adopted earlier / skipped as current)`,
            );
          }
          let sawBug = false;
          let sawLegitLoss = false;
          for (const rv of recVisits) {
            const adoptable = strataRelocateAdoptable(
              rv.score,
              baseline,
              rv.incumbentBefore,
              cfg,
            );
            const line = `  pass${rv.pass} visit: score ${fmtScore(
              recon,
              rv.score,
            )} vs incumbent ${fmtScore(recon, rv.incumbentBefore)} → recorded adopted=${
              rv.adopted
            }, replay adoptable=${adoptable}`;
            if (!rv.adopted && adoptable) {
              report.push(`${line}  ⇒ (d) BUG-SELECT`);
              sawBug = true;
            } else if (!rv.adopted && !adoptable) {
              report.push(`${line}  ⇒ (b) legitimate loss on descent's own surface`);
              sawLegitLoss = true;
            } else {
              report.push(`${line}  ⇒ adopted at this visit (later possibly dropped)`);
            }
          }

          // (c) nonstationarity: under the FINAL selection map, would a fresh
          // descent visit to region adopt this candidate on the PRE-A7 surface?
          const finalIncumbentPre = scoreStrataPlacementGeometry(
            placeWithRegion(
              recon,
              contextSel,
              region.id,
              engIdx === undefined ? "legacy" : engIdx,
            ),
            recon.model,
            recon.edgesPrime,
          );
          const tgtPre = scoreStrataPlacementGeometry(
            placeWithRegion(recon, contextSel, region.id, tgt.idx),
            recon.model,
            recon.edgesPrime,
          );
          const nonstationaryAdopt = strataRelocateAdoptable(
            tgtPre,
            baseline,
            finalIncumbentPre,
            cfg,
          );
          report.push(
            `  (c) under FINAL map: region@cand${tgt.idx} pre-A7 ${fmtScore(
              recon,
              tgtPre,
            )} vs final-incumbent pre-A7 ${fmtScore(
              recon,
              finalIncumbentPre,
            )} → 3rd-pass would adopt=${nonstationaryAdopt}`,
          );

          const verdict = sawBug
            ? "(d) BUG-SELECT"
            : nonstationaryAdopt
            ? "(c) NONSTATIONARY ⇒ bounded-greedy G-DESCENT; a 3rd full pass adopts it"
            : sawLegitLoss
            ? "(b) legitimate loss at every visit (expected greedy behavior)"
            : "indeterminate (see per-visit lines)";
          report.push(`  ==> VERDICT: ${verdict}`);
        }
      }
      // eslint-disable-next-line no-console
      console.log(`\n[EXP-3R]\n${report.join("\n")}`);
    },
    TIMEOUT,
  );
});
