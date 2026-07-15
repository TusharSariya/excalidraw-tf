/**
 * STRATA BLINDED PAIRWISE PREFERENCE HARNESS — generator (P1 of the 2026-07-15
 * objective audit, docs/strata-pipeline-objective-audit-2026-07-15.md §P1).
 *
 * Purpose: produce a HELD-OUT, blinded, forced-choice pair set that lets the
 * owner + ≥2 raters calibrate the crossings ↔ penetration ↔ length exchange
 * rate the engine's objective currently guesses. The engine both optimizes AND
 * evaluates on the same technical rank; this instrument is the independent
 * human-preference circuit-breaker. It changes NO layout behavior and asserts
 * ONLY harness structure (fidelity, blinding, determinism, pair diversity) —
 * NEVER a metric value.
 *
 * Pattern: mirrors the Q7-AXIS blinded sheet + sealed key generator
 * (terraformPipelineStrataQ7AxisSheet.test.ts): BLINDED sheet (md+json, blank
 * raterChoice) + SEALED key (candidate identity + technical scores) + seeded
 * A/B randomization. Pair mechanics reuse the audit probes' reconstruction
 * (terraformStrataRowOrderProbe / silly-layout probe): placeStrataHulls with a
 * per-hull candidate override, forced through the FULL downstream pipeline
 * (A7 refine + sift/relocate), rendered via buildStrataScene + exportToSvg.
 *
 * Pair sources (documented ledger, all PROVEN geometries):
 *  - CONFIG AUDIT (eps=2 + converge, PAR=0 — the audited owner config):
 *    region-04 frontier trio (engine vs alt#142 vs alt#146 — the chord-proxy
 *    sign-inversion cases), Account-04 subtree pull-in (X search-space gap,
 *    +crossings for −length), DLQ sink pull-in (pure length win, Δcross=0),
 *    cross-hull anchors r1#249 / r2#528 / r3#120 / r3#1080 (incl. two
 *    expected-dominated attention checks).
 *  - CONFIG C (eps=1): us-west-2 prod-optimum ("cand33"-class) vs owner
 *    VPC-swap ("cand13"-class, S3 kept high at +1 crossing) vs engine.
 *  - CONFIG B (eps=0): us-west-2 owner S3-lift ("cand9"-class) vs engine.
 *
 * HELD-OUT INVARIANT: the emitted key + labels must NEVER feed an optimizer,
 * a default flip, or a comparator weight directly — only the FITTED exchange
 * rate (scripts/strata-pref-fit.mjs) is a decision input, and this pair set is
 * then frozen (see docs/strata-baselines/prefpairs/README.md).
 *
 * Heavy generation is env-gated so normal `yarn test` never pays the cost:
 *   STRATA_PREF_REPORT_DIR=docs/strata-baselines/prefpairs yarn vitest run \
 *     packages/excalidraw/components/terraformStrataPrefPairs.test.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import graphlibDot from "@dagrejs/graphlib-dot";

import { exportToSvg } from "@excalidraw/utils";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";
import { STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS } from "../test-fixtures/terraformPresetFixtures";

import { mulberry32 } from "./terraformPipelineBootstrapCi";
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
  strataWeightedCross,
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

import type { StrataPackedScore } from "./terraformPipelineStrataPackedScoring";
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
const REPORT_DIR = process.env.STRATA_PREF_REPORT_DIR;
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 60;

/** Frozen instrument seed — distinct from the Q7-AXIS BOOTSTRAP_SEED so the
 * two instruments' random streams are independent. Do not change after any
 * labels exist. */
export const STRATA_PREF_SEED = 20260715;

/** The FROZEN proposition (do not reword after labeling starts). */
const PROPOSITION =
  "Which layout is easier to read and trace dependencies in? " +
  "(A / B / tie; confidence 1=slight 2=clear 3=strong)";

// ── configs under study ───────────────────────────────────────────────────────
// All PAR=0, bandDepth=root, sift=1, packedScoring=1, rankSep=1, sweeps=4,
// coordRefine=1. AUDIT = the audited owner config (eps=2 + converge); B/C are
// the row-order investigation's configs whose candidate ledger (cand9 /
// cand13-class / cand33-class) the audit cites.
type CfgName = "AUDIT" | "B" | "C";
const CFG: Record<CfgName, { eps: number; converge: boolean }> = {
  AUDIT: { eps: 2, converge: true },
  B: { eps: 0, converge: false },
  C: { eps: 1, converge: false },
};

const demoStrataOptions = (cfg: CfgName) =>
  resolveStrataDemoOptions({
    strataSweeps: 4,
    strataCoordRefine: true,
    strataRankSeparate: true,
    strataPackedScoring: true,
    strataBandDepth: "root",
    strataSift: true,
    strataPackedEps: CFG[cfg].eps,
    ...(CFG[cfg].converge ? { strataPackedConverge: true } : {}),
  });

const v2Sources = () =>
  getTerraformImportPresetSourcesFromDb(
    PRESET,
  ) as unknown as TerraformPlanParsingSources;

type Scene = { elements: ExcalidrawElement[]; meta: Record<string, unknown> };

const buildReal = async (cfg: CfgName): Promise<Scene> => {
  const res = await layoutTerraformFromSources(v2Sources(), {
    layoutMode: "strata",
    pipelineCompact: true,
    pipelinePrivateApiRegional: false,
    ...demoStrataOptions(cfg),
    strataPackedFrontierMeta: true,
  } as Record<string, unknown>);
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res.scene as Scene;
};

// ── internal-pipeline reconstruction (mirrors the audit probes) ──────────────
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

type Recon = {
  nodes: TerraformPlanNodesMap;
  prep: ReturnType<typeof preparePipelineLayout>;
  model: StrataModel;
  edgesPrime: readonly StrataPrimeEdge[];
  rank: StrataRankResult;
  engineOptions: StrataEngineOptions;
  packedScored: ReturnType<typeof placeStrataHullsPackedScored>;
  relocateCfg: {
    penW: number;
    crossW: number;
    epsilon: number;
    edgeCrossCap: number;
  };
};

const reconstruct = (cfg: CfgName): Recon => {
  const s = demoStrataOptions(cfg) as Record<string, unknown>;
  const eps = (s.strataPackedScoringEpsilon as number) ?? 0;
  const { nodes, plan } = loadNodes();
  const prep = preparePipelineLayout(nodes, plan, true, {
    privateApiRegional: false,
  });
  const engineOptions = {
    compact: true,
    includeAncillary: false,
    networkSimplexRank: false,
    rankSeparate: s.strataRankSeparate === true,
    sweeps: (s.strataSweeps as number) ?? 0,
    coordinateRefine: s.strataCoordinateRefine === true,
    packedScoring: true,
    ...(eps !== 0 ? { packedScoringEpsilon: eps } : {}),
    strataBandDepth: (s.strataBandDepth as string) ?? "account",
    strataSiftRelocate: s.strataSiftRelocate === true,
    ...(s.strataPackedConverge === true ? { packedConverge: true } : {}),
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
  const packedScored = placeStrataHullsPackedScored(
    model,
    repair.edgesPrime,
    rank,
    engineOptions,
  );
  return {
    nodes,
    prep,
    model,
    edgesPrime: repair.edgesPrime,
    rank,
    engineOptions,
    packedScored,
    relocateCfg: { penW: 1, crossW: 1, epsilon: eps, edgeCrossCap: eps },
  };
};

// orchestrator-identical finalize (guard path) — the ENGINE arm
const finalizeOrchestrator = (recon: Recon): StrataPlacementResult => {
  const { model, edgesPrime, rank, engineOptions, packedScored, relocateCfg } =
    recon;
  let placement = packedScored.placement;
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
  return placement;
};

// forced-candidate pipeline: place(override) → A7 → relocate
const finalOf = (
  recon: Recon,
  base: StrataPlacementResult,
): StrataPlacementResult => {
  const { model, edgesPrime, rank, engineOptions } = recon;
  const a7 = engineOptions.coordinateRefine
    ? refineStrataCoordinates(base, model, edgesPrime)
    : base;
  return engineOptions.strataSiftRelocate
    ? refineStrataVerticalSlots(a7, model, edgesPrime, rank, engineOptions)
    : a7;
};

const placeWithHull = (
  recon: Recon,
  hullId: string,
  idx: number | "legacy",
): StrataPlacementResult => {
  const m = new Map(recon.packedScored.selections);
  if (idx === "legacy") {
    m.delete(hullId);
  } else {
    m.set(hullId, idx);
  }
  return placeStrataHulls(
    recon.model,
    recon.edgesPrime,
    recon.rank,
    recon.engineOptions,
    m,
  );
};

const candidateCounts = (recon: Recon): Map<string, number> => {
  const counts = new Map<string, number>();
  placeStrataHulls(
    recon.model,
    recon.edgesPrime,
    recon.rank,
    recon.engineOptions,
    new Map(),
    (hullId, count) => counts.set(hullId, count),
  );
  return counts;
};

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

const hullLabel = (model: StrataModel, h: StrataHullNode): string =>
  `${h.role}:${h.path.join("/")}`;

const regionHullByAccount = (
  model: StrataModel,
  accountSuffix: string,
): StrataHullNode | undefined =>
  findHull(
    model.hullRoot,
    (n) =>
      n.role === "region" && n.path.some((p) => p.endsWith(accountSuffix)),
  );

const regionHullByName = (
  model: StrataModel,
  region: string,
): StrataHullNode | undefined =>
  findHull(
    model.hullRoot,
    (n) => n.role === "region" && n.path[n.path.length - 1] === region,
  );

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

// exact orderParams placeStrataHulls passes to the ordering module for one hull
// (mirrors terraformPipelineStrataPlacement step 3; copied from the row-order
// probe where it passed the production-enumeration fidelity checks).
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
  type UInfo = {
    unit: StrataUnit;
    unitId: string;
    x0: number;
    x1: number;
    height: number;
    colSpan: readonly [number, number];
    contentKey: string;
  };
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
  return {
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
};

// ── metrics ───────────────────────────────────────────────────────────────────
type Anyel = ExcalidrawElement & {
  points?: ReadonlyArray<readonly [number, number]>;
  customData?: Record<string, unknown>;
};

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

type Rendered = {
  crossings: number;
  sharpShare: number;
  tll: number;
  maxArrowLen: number;
  pierce: number;
  rtHatP50: number;
};

const renderedMetrics = (elements: readonly ExcalidrawElement[]): Rendered => {
  const diag = diagnosePipelineScene(elements) as unknown as {
    dataflow: { crossings: number };
    crossingAngles?: { sharpShare?: number };
  };
  const pm = computePierceMetrics(elements);
  const paths = computeStrataPathMetrics(elements);
  const rt = paths.rows.map((r) => r.rtHat).sort((a, b) => a - b);
  const p50 = rt.length ? rt[Math.floor((rt.length - 1) / 2)]! : 0;
  let tll = 0;
  let maxLen = 0;
  for (const el of elements as Anyel[]) {
    if (!isDataflowArrow(el) || !Array.isArray(el.points)) {
      continue;
    }
    let l = 0;
    for (let i = 1; i < el.points.length; i++) {
      l += Math.hypot(
        el.points[i]![0] - el.points[i - 1]![0],
        el.points[i]![1] - el.points[i - 1]![1],
      );
    }
    tll += l;
    maxLen = Math.max(maxLen, l);
  }
  return {
    crossings: diag.dataflow.crossings,
    sharpShare: Math.round((diag.crossingAngles?.sharpShare ?? 0) * 1000) / 1000,
    tll: Math.round(tll),
    maxArrowLen: Math.round(maxLen),
    pierce: pm.pierce.total,
    rtHatP50: Math.round(p50 * 1000) / 1000,
  };
};

const boxSig = (p: StrataPlacementResult): string => {
  const parts: string[] = [];
  for (const id of [...p.leafBoxes.keys()].sort()) {
    const b = p.leafBoxes.get(id)!;
    parts.push(`${id}:${b.x},${b.y},${b.width},${b.height}`);
  }
  return parts.join("|");
};

const sha1 = (s: string): string =>
  createHash("sha1").update(s).digest("hex").slice(0, 12);

// ── out-of-search-space geometry edits (from the silly-layout probe) ─────────
type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box, margin: number): boolean =>
  a.x - margin < b.x + b.width &&
  b.x - margin < a.x + a.width &&
  a.y - margin < b.y + b.height &&
  b.y - margin < a.y + a.height;

/** Pull the whole account-`suffix` subtree left by the max collision-free dx
 * (strict interior overlap, ancestor hulls whitelisted). Returns undefined
 * when no collision-free shift exists. */
const accountPullIn = (
  recon: Recon,
  engine: StrataPlacementResult,
  accountSuffix: string,
): { placement: StrataPlacementResult; dx: number } | undefined => {
  const acct = findHull(
    recon.model.hullRoot,
    (n) =>
      n.role === "account" && n.path[n.path.length - 1]?.endsWith(accountSuffix),
  );
  if (!acct) {
    return undefined;
  }
  const subLeaves = new Set(subtreeLeafIds(acct));
  const subHulls = new Set<string>();
  const collect = (h: StrataHullNode) => {
    subHulls.add(h.id);
    h.children.forEach(collect);
  };
  collect(acct);
  const ancestors = new Set<string>();
  const walkAnc = (h: StrataHullNode, chain: string[]): void => {
    if (h.id === acct.id) {
      chain.forEach((c) => ancestors.add(c));
      return;
    }
    h.children.forEach((c) => walkAnc(c, [...chain, h.id]));
  };
  walkAnc(recon.model.hullRoot, [recon.model.hullRoot.id]);

  const shifted = (dx: number): StrataPlacementResult => {
    const leafBoxes = new Map<string, Box>();
    for (const [id, b] of engine.leafBoxes) {
      leafBoxes.set(id, subLeaves.has(id) ? { ...b, x: b.x - dx } : { ...b });
    }
    const boxedHulls = new Map<string, unknown>();
    for (const [id, bh] of engine.boxedHulls) {
      const anyBh = bh as unknown as { box: Box };
      boxedHulls.set(
        id,
        subHulls.has(id)
          ? { ...anyBh, box: { ...anyBh.box, x: anyBh.box.x - dx } }
          : { ...anyBh },
      );
    }
    return { leafBoxes, boxedHulls } as unknown as StrataPlacementResult;
  };

  const firstCollision = (p: StrataPlacementResult): boolean => {
    for (const [id, b] of p.leafBoxes) {
      if (!subLeaves.has(id)) {
        continue;
      }
      for (const [oid, ob] of p.leafBoxes) {
        if (subLeaves.has(oid)) {
          continue;
        }
        if (intersects(b, ob, 0)) {
          return true;
        }
      }
    }
    const movedBox = (
      p.boxedHulls.get(acct.id) as unknown as { box: Box }
    ).box;
    for (const [oid, obh] of p.boxedHulls) {
      if (subHulls.has(oid) || ancestors.has(oid)) {
        continue;
      }
      const ob = (obh as unknown as { box: Box }).box;
      if (intersects(movedBox, ob, 0)) {
        return true;
      }
    }
    return false;
  };

  let bestDx = 0;
  for (let dx = 10; dx <= 4000; dx += 10) {
    if (!firstCollision(shifted(dx))) {
      bestDx = dx;
    } else {
      break;
    }
  }
  if (bestDx === 0) {
    return undefined;
  }
  return { placement: shifted(bestDx), dx: bestDx };
};

/** Pull pure-sink DLQ leaves in toward their predecessors (collision-gated). */
const dlqPullIn = (
  recon: Recon,
  engine: StrataPlacementResult,
): { placement: StrataPlacementResult; moved: number } | undefined => {
  const outDeg = new Map<string, number>();
  const preds = new Map<string, string[]>();
  for (const pe of recon.edgesPrime) {
    outDeg.set(pe.edge.source, (outDeg.get(pe.edge.source) ?? 0) + 1);
    const arr = preds.get(pe.edge.target) ?? [];
    arr.push(pe.edge.source);
    preds.set(pe.edge.target, arr);
  }
  const dlqIds = [...engine.leafBoxes.keys()].filter(
    (id) => /dlq/i.test(recon.model.addressOf(id)) && (outDeg.get(id) ?? 0) === 0,
  );
  if (!dlqIds.length) {
    return undefined;
  }
  const leafBoxes = new Map([...engine.leafBoxes].map(([k, v]) => [k, { ...v }]));
  let moved = 0;
  for (const dlq of dlqIds) {
    const box = leafBoxes.get(dlq)!;
    const ps = preds.get(dlq) ?? [];
    let targetX = -Infinity;
    for (const p of ps) {
      const pb = leafBoxes.get(p);
      if (pb) {
        targetX = Math.max(targetX, pb.x + pb.width + 100);
      }
    }
    if (!Number.isFinite(targetX) || targetX >= box.x) {
      continue;
    }
    const fits = (cx: number): boolean => {
      const cand = { ...box, x: cx };
      for (const [oid, ob] of leafBoxes) {
        if (oid === dlq) {
          continue;
        }
        if (intersects(cand, ob, 16)) {
          return false;
        }
      }
      return true;
    };
    for (let x = targetX; x <= box.x; x += 20) {
      if (fits(x)) {
        if (x < box.x) {
          box.x = x;
          moved++;
        }
        break;
      }
    }
  }
  if (moved === 0) {
    return undefined;
  }
  return {
    placement: {
      leafBoxes,
      boxedHulls: engine.boxedHulls,
    } as unknown as StrataPlacementResult,
    moved,
  };
};

// ── arm / pair model ─────────────────────────────────────────────────────────
type Arm = {
  cfg: CfgName;
  ref: string; // stable candidate identity, e.g. "AUDIT:engine", "C:uswest2#33"
  note: string; // provenance (sealed key only)
  placement: StrataPlacementResult;
  chord: StrataPackedScore;
  rendered?: Rendered;
  svgFile?: string; // shared svg path (report-relative), copied per pair slot
  svgSha1?: string;
  placementSig: string;
};

type PairSpec = {
  pairId: string;
  cfg: CfgName;
  left: string; // arm ref — pre-randomization "first"
  right: string;
  focusHint: string; // shown to raters (blinded)
  expectedDominated?: "left" | "right"; // attention check (sealed key only)
  rationale: string; // why this pair identifies the exchange rate (sealed)
};

type SheetRow = {
  index: number;
  pairId: string;
  focusHint: string;
  proposition: string;
  raterChoice: string; // "" — rater fills A | B | tie
  confidence: string; // "" — rater fills 1 | 2 | 3
  notes: string;
};

type KeySlot = {
  armRef: string;
  note: string;
  chord: { crossings: number; penetrations: number; lengthL1: number };
  rendered: Rendered | null;
  placementSigSha1: string;
  svgSha1: string | null;
};

type KeyEntry = {
  index: number;
  pairId: string;
  cfg: CfgName;
  slotA: KeySlot;
  slotB: KeySlot;
  // deltas (B − A), rendered where available, else chord
  deltas: Record<string, number>;
  expectedDominatedSlot: "A" | "B" | null;
  rationale: string;
  focusHint: string;
};

const chordOf = (recon: Recon, p: StrataPlacementResult): StrataPackedScore =>
  scoreStrataPlacementGeometry(p, recon.model, recon.edgesPrime);

/** Pure sheet+key builder from computed arms + pair specs — deterministic
 * given the same inputs and seed (asserted by double-run). */
const buildSheetAndKey = (
  pairs: readonly PairSpec[],
  arms: ReadonlyMap<string, Arm>,
): { sheet: SheetRow[]; key: KeyEntry[] } => {
  const rng = mulberry32(STRATA_PREF_SEED);
  const sheet: SheetRow[] = [];
  const key: KeyEntry[] = [];
  pairs.forEach((p, i) => {
    const index = i + 1;
    const flip = rng() < 0.5;
    const aRef = flip ? p.right : p.left;
    const bRef = flip ? p.left : p.right;
    const a = arms.get(aRef)!;
    const b = arms.get(bRef)!;
    const slot = (arm: Arm): KeySlot => ({
      armRef: arm.ref,
      note: arm.note,
      chord: {
        crossings: arm.chord.crossings,
        penetrations: arm.chord.penetrations,
        lengthL1: Math.round(arm.chord.lengthL1),
      },
      rendered: arm.rendered ?? null,
      placementSigSha1: sha1(arm.placementSig),
      svgSha1: arm.svgSha1 ?? null,
    });
    const slotA = slot(a);
    const slotB = slot(b);
    const deltas: Record<string, number> = {
      chordCrossings: slotB.chord.crossings - slotA.chord.crossings,
      chordPenetrations: slotB.chord.penetrations - slotA.chord.penetrations,
      chordLengthL1: slotB.chord.lengthL1 - slotA.chord.lengthL1,
    };
    if (slotA.rendered && slotB.rendered) {
      deltas.renderedCrossings =
        slotB.rendered.crossings - slotA.rendered.crossings;
      deltas.renderedPierce = slotB.rendered.pierce - slotA.rendered.pierce;
      deltas.renderedTll = slotB.rendered.tll - slotA.rendered.tll;
      deltas.renderedSharpShare =
        Math.round(
          (slotB.rendered.sharpShare - slotA.rendered.sharpShare) * 1000,
        ) / 1000;
      deltas.renderedRtHatP50 =
        Math.round((slotB.rendered.rtHatP50 - slotA.rendered.rtHatP50) * 1000) /
        1000;
    }
    const expectedDominatedSlot: "A" | "B" | null = p.expectedDominated
      ? (p.expectedDominated === "left") !== flip
        ? "A"
        : "B"
      : null;
    sheet.push({
      index,
      pairId: p.pairId,
      focusHint: p.focusHint,
      proposition: PROPOSITION,
      raterChoice: "",
      confidence: "",
      notes: "",
    });
    key.push({
      index,
      pairId: p.pairId,
      cfg: p.cfg,
      slotA,
      slotB,
      deltas,
      expectedDominatedSlot,
      rationale: p.rationale,
      focusHint: p.focusHint,
    });
  });
  return { sheet, key };
};

const sheetMarkdown = (sheet: readonly SheetRow[]): string => {
  const lines: string[] = [];
  lines.push(`# Strata pairwise preference sheet — BLINDED (${PRESET})`);
  lines.push("");
  lines.push(
    "For each pair open `pairs/<pairId>/A.svg` and `pairs/<pairId>/B.svg` " +
      "side by side (or use `index.html`), study the hinted area, and record " +
      "which layout is easier to read and trace dependencies in. Do NOT open " +
      "`PREF_PAIRS_KEY.json` until every row of every rater is filled.",
  );
  lines.push("");
  lines.push(`Proposition (per pair): ${PROPOSITION}`);
  lines.push("");
  lines.push("| # | pair | look at | choice (A/B/tie) | confidence (1-3) | notes |");
  lines.push("| - | ---- | ------- | ---------------- | ---------------- | ----- |");
  for (const r of sheet) {
    lines.push(`| ${r.index} | ${r.pairId} | ${r.focusHint} |  |  |  |`);
  }
  lines.push("");
  return lines.join("\n");
};

const viewerHtml = (
  sheet: readonly SheetRow[],
  images: ReadonlyMap<string, { a: string; b: string }>,
): string => {
  const manifest = sheet.map((r) => ({
    pairId: r.pairId,
    focusHint: r.focusHint,
    imgA: images.get(r.pairId)!.a,
    imgB: images.get(r.pairId)!.b,
  }));
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Strata preference labeling (blinded)</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;background:#f5f5f5}
header{position:sticky;top:0;background:#222;color:#fff;padding:8px 16px;z-index:9;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header input{padding:4px 8px}
.pair{background:#fff;margin:16px;padding:12px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.imgs{display:flex;gap:8px}
.imgs figure{flex:1;margin:0;border:1px solid #ccc;overflow:auto;max-height:70vh}
.imgs img{width:100%;height:auto;display:block}
.imgs figcaption{text-align:center;font-weight:bold;padding:4px;background:#eee;position:sticky;top:0}
.controls{margin-top:8px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.warn{background:#fff3cd;border:1px solid #ffc107;padding:8px 16px;margin:16px;border-radius:6px}
button{padding:8px 14px;font-size:14px;cursor:pointer}
</style></head><body>
<header>
  <strong>Strata blinded preference labeling</strong>
  <label>Rater name: <input id="rater" placeholder="e.g. owner"></label>
  <button onclick="downloadLabels()">Download labels JSON</button>
  <span id="progress"></span>
</header>
<div class="warn"><b>Blinded instrument.</b> ${PROPOSITION}
Judge readability only — do NOT open PREF_PAIRS_KEY.json or any score output
until every rater has submitted labels. Zoom into the hinted area; the rest of
the canvas may be identical or shift slightly.</div>
<div id="pairs"></div>
<script>
const MANIFEST = ${JSON.stringify(manifest)};
const state = {};
const root = document.getElementById("pairs");
for (const m of MANIFEST) {
  const d = document.createElement("div");
  d.className = "pair";
  d.innerHTML =
    '<h3>' + m.pairId + ' — look at: ' + m.focusHint + '</h3>' +
    '<div class="imgs">' +
    '<figure><figcaption>A</figcaption><img loading="lazy" src="' + m.imgA + '"></figure>' +
    '<figure><figcaption>B</figcaption><img loading="lazy" src="' + m.imgB + '"></figure>' +
    '</div><div class="controls">' +
    '<span>Easier to read/trace:</span>' +
    ['A','B','tie'].map(v => '<label><input type="radio" name="c-' + m.pairId + '" value="' + v + '"> ' + v + '</label>').join('') +
    '<span>Confidence:</span>' +
    [1,2,3].map(v => '<label><input type="radio" name="k-' + m.pairId + '" value="' + v + '"> ' + v + '</label>').join('') +
    '<label>notes <input name="n-' + m.pairId + '" size="30"></label>' +
    '</div>';
  root.appendChild(d);
}
document.addEventListener("change", update);
function update() {
  let done = 0;
  for (const m of MANIFEST) {
    const c = document.querySelector('input[name="c-' + m.pairId + '"]:checked');
    if (c) { done++; }
  }
  document.getElementById("progress").textContent = done + "/" + MANIFEST.length + " labeled";
}
function downloadLabels() {
  const rater = document.getElementById("rater").value.trim();
  if (!rater) { alert("Enter a rater name first."); return; }
  const labels = [];
  for (const m of MANIFEST) {
    const c = document.querySelector('input[name="c-' + m.pairId + '"]:checked');
    const k = document.querySelector('input[name="k-' + m.pairId + '"]:checked');
    const n = document.querySelector('input[name="n-' + m.pairId + '"]');
    labels.push({ pairId: m.pairId, choice: c ? c.value : "", confidence: k ? Number(k.value) : null, notes: n && n.value || "" });
  }
  const missing = labels.filter(l => !l.choice).length;
  if (missing && !confirm(missing + " pairs unlabeled. Download anyway?")) { return; }
  const blob = new Blob([JSON.stringify({ rater, generatedAt: new Date().toISOString(), seed: ${STRATA_PREF_SEED}, labels }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "labels-" + rater.replace(/[^a-z0-9_-]/gi, "_") + ".json";
  a.click();
}
update();
</script></body></html>
`;
};

// ── SVG export ───────────────────────────────────────────────────────────────
const sceneToSvg = async (elements: readonly ExcalidrawElement[]) => {
  const svg = await exportToSvg({
    elements: elements as ExcalidrawElement[],
    files: {},
    exportPadding: 48,
    skipInliningFonts: true,
    appState: {
      exportBackground: true,
      viewBackgroundColor: "#ffffff",
      exportEmbedScene: false,
    },
  });
  return svg.outerHTML;
};

// simple pearson correlation
const pearson = (xs: number[], ys: number[]): number => {
  const n = xs.length;
  if (n < 2) {
    return 0;
  }
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    dx += (xs[i]! - mx) ** 2;
    dy += (ys[i]! - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
};

// ══════════════════════════════════════════════════════════════════════════════
describe.runIf(!!REPORT_DIR)(
  "Strata blinded pairwise preference harness (report-emitting; asserts structure only)",
  () => {
    it(
      "generates blinded pair SVGs + sheet + sealed key + viewer (deterministic, diverse, blinded)",
      async () => {
        const outDir = path.resolve(REPORT_DIR!);
        mkdirSync(outDir, { recursive: true });
        const softFailures: string[] = [];
        const report: string[] = [];

        const arms = new Map<string, Arm>();
        const pairs: PairSpec[] = [];
        const recons = new Map<CfgName, Recon>();

        const addArm = (
          recon: Recon,
          cfg: CfgName,
          ref: string,
          note: string,
          placement: StrataPlacementResult,
        ): Arm => {
          const arm: Arm = {
            cfg,
            ref,
            note,
            placement,
            chord: chordOf(recon, placement),
            placementSig: boxSig(placement),
          };
          arms.set(ref, arm);
          return arm;
        };

        // ── build + fidelity-gate each config ─────────────────────────────
        for (const cfg of ["AUDIT", "B", "C"] as CfgName[]) {
          clearTerraformImportPrepCache();
          const real = await buildReal(cfg);
          const recon = reconstruct(cfg);
          recons.set(cfg, recon);
          const reSel = Object.fromEntries(recon.packedScored.selections);
          const metaSel = real.meta.strataPackedScoringSelections;
          // FIDELITY GATE (hard): the reconstruction must reproduce the real
          // app path's packed-scoring selections exactly, or every candidate
          // identity below is untrustworthy.
          expect(reSel, `${cfg}: recon selections == real meta`).toEqual(
            metaSel,
          );
          report.push(
            `[${cfg}] fidelity OK — selections ${JSON.stringify(metaSel)}`,
          );
        }

        // ── CONFIG AUDIT arms ─────────────────────────────────────────────
        {
          const cfg: CfgName = "AUDIT";
          const recon = recons.get(cfg)!;
          const counts = candidateCounts(recon);
          const engine = addArm(
            recon,
            cfg,
            "AUDIT:engine",
            "engine pick, full pipeline (packed+sift+converge, eps=2)",
            finalizeOrchestrator(recon),
          );

          const regionOfAccount = (suffix: string) =>
            regionHullByAccount(recon.model, suffix);

          const addCandArm = (
            hull: StrataHullNode | undefined,
            idx: number,
            ref: string,
            note: string,
          ): Arm | undefined => {
            if (!hull) {
              softFailures.push(`${ref}: hull not found`);
              return undefined;
            }
            const count = counts.get(hull.id) ?? 0;
            if (idx >= count) {
              softFailures.push(
                `${ref}: candidate idx ${idx} >= production count ${count} — ledger drift, pair skipped`,
              );
              return undefined;
            }
            return addArm(
              recon,
              cfg,
              ref,
              `${note} [hull ${hullLabel(recon.model, hull)} cand#${idx}]`,
              finalOf(recon, placeWithHull(recon, hull.id, idx)),
            );
          };

          const r4 = regionOfAccount("004");
          const alt142 = addCandArm(
            r4,
            142,
            "AUDIT:r4#142",
            "region-04 alt#142 — descent-rejected for +3 chord crossings; renders 162 vs engine 169 (audit §1.6)",
          );
          const alt146 = addCandArm(
            r4,
            146,
            "AUDIT:r4#146",
            "region-04 alt#146 — missed by descent; renders 143 vs engine 169 (audit §1.6)",
          );
          const r1alt = addCandArm(
            regionOfAccount("001"),
            249,
            "AUDIT:r1#249",
            "region-01 alt#249 — missed joint win (chord cr 182)",
          );
          const r2alt = addCandArm(
            regionOfAccount("002"),
            528,
            "AUDIT:r2#528",
            "region-02 min-TEL alt#528 — +23 chord cr, +8 pen for -0.1% TEL (expected-dominated anchor)",
          );
          const r3alt120 = addCandArm(
            regionOfAccount("003"),
            120,
            "AUDIT:r3#120",
            "region-03 alt#120 — missed joint win (chord cr 193)",
          );
          const r3alt1080 = addCandArm(
            regionOfAccount("003"),
            1080,
            "AUDIT:r3#1080",
            "region-03 min-TEL alt#1080 — +73 chord cr for -1.2% TEL (expected-dominated anchor)",
          );

          const pull = accountPullIn(recon, engine.placement, "004");
          const acctPull = pull
            ? addArm(
                recon,
                cfg,
                "AUDIT:acct04-pull",
                `Account-04 subtree pulled left dx=${pull.dx}px (X search-space gap; audit §1.4)`,
                pull.placement,
              )
            : undefined;
          if (!pull) {
            softFailures.push("acct04-pull: no collision-free shift found");
          }

          const dlq = dlqPullIn(recon, engine.placement);
          const dlqPull = dlq
            ? addArm(
                recon,
                cfg,
                "AUDIT:dlq-pull",
                `DLQ pure-sink pull-in (${dlq.moved} moved; engine-objective STRICTLY better; audit §1.5)`,
                dlq.placement,
              )
            : undefined;
          if (!dlq) {
            softFailures.push("dlq-pull: no movable pure-sink DLQ found");
          }

          const r4Hint =
            "account 000000000004 / region us-east-1 — row ordering inside this region differs";
          const push = (
            p: Omit<PairSpec, "cfg" | "pairId">,
            id: number,
          ): void => {
            // cfg derives from the arms themselves (C/B pairs are pushed from
            // nested blocks below — do NOT capture the AUDIT constant).
            pairs.push({
              ...p,
              cfg: arms.get(p.left)!.cfg,
              pairId: `P${String(id).padStart(2, "0")}`,
            });
          };
          let n = 1;
          if (alt142) {
            push(
              {
                left: engine.ref,
                right: alt142.ref,
                focusHint: r4Hint,
                rationale:
                  "chord-proxy sign-inversion case: engine kept +3 chord crossings that render as -7; +11 pierce vs shorter/less-sharp",
              },
              n++,
            );
          }
          if (alt146) {
            push(
              {
                left: engine.ref,
                right: alt146.ref,
                focusHint: r4Hint,
                rationale:
                  "crossings-dominant axis: -26 chord / -15% rendered crossings at +17 pen, similar length",
              },
              n++,
            );
          }
          if (alt142 && alt146) {
            push(
              {
                left: alt142.ref,
                right: alt146.ref,
                focusHint: r4Hint,
                rationale: "crossings vs pen/sharpness within the same frontier",
              },
              n++,
            );
          }
          if (acctPull) {
            push(
              {
                left: engine.ref,
                right: acctPull.ref,
                focusHint:
                  "horizontal position of the whole account 000000000004 block (dead gap vs crossings)",
                rationale:
                  "THE exchange-rate case: +7 chord crossings / +6 pen buys -5.5% TEL, -11% max edge, -10% area (audit Account-04)",
              },
              n++,
            );
          }
          if (dlqPull) {
            push(
              {
                left: engine.ref,
                right: dlqPull.ref,
                focusHint:
                  "the ingress/egress DLQ queue cards (top area) — horizontal distance from their sources",
                rationale:
                  "pure length axis: crossings and pen UNCHANGED, only edge length differs — anchors the length coefficient at zero crossings cost",
              },
              n++,
            );
          }
          if (r1alt) {
            push(
              {
                left: engine.ref,
                right: r1alt.ref,
                focusHint:
                  "account 000000000001 / region us-east-1 — row ordering inside this region differs",
                rationale: "cross-hull sample: crossings-improving alternative",
              },
              n++,
            );
          }
          if (r2alt) {
            push(
              {
                left: engine.ref,
                right: r2alt.ref,
                focusHint:
                  "account 000000000002 / region us-east-1 — row ordering inside this region differs",
                expectedDominated: "right",
                rationale:
                  "attention check: alternative is worse on crossings AND pen for a negligible length win — engine arm should be preferred by an attentive rater",
              },
              n++,
            );
          }
          if (r3alt120) {
            push(
              {
                left: engine.ref,
                right: r3alt120.ref,
                focusHint:
                  "account 000000000003 / region us-east-1 — row ordering inside this region differs",
                rationale: "cross-hull sample: crossings-improving alternative",
              },
              n++,
            );
          }
          if (r3alt1080) {
            push(
              {
                left: engine.ref,
                right: r3alt1080.ref,
                focusHint:
                  "account 000000000003 / region us-east-1 — row ordering inside this region differs",
                expectedDominated: "right",
                rationale:
                  "attention check / extreme point: +73 chord crossings for -1.2% TEL — the trade the objective correctly refuses",
              },
              n++,
            );
          }

          // ── CONFIG C (eps=1): us-west-2 cand33-class vs cand13-class ──────
          {
            const cCfg: CfgName = "C";
            const recon2 = recons.get(cCfg)!;
            const region = regionHullByName(recon2.model, "us-west-2");
            if (!region) {
              softFailures.push("C: us-west-2 region hull not found");
            } else {
              const classify = classifyRegionUnits(recon2.model, region);
              const orderParams = buildOrderParams(recon2, region);
              const cands = strataPackedCandidateSequences(
                orderParams as Parameters<
                  typeof strataPackedCandidateSequences
                >[0],
              );
              const counts2 = candidateCounts(recon2);
              const prodCount = counts2.get(region.id) ?? 0;
              const engIdx = recon2.packedScored.selections.get(region.id);
              const engine2 = addArm(
                recon2,
                cCfg,
                "C:engine",
                `engine pick, full pipeline (eps=1) — region us-west-2 selection=${
                  engIdx ?? "legacy"
                }`,
                finalizeOrchestrator(recon2),
              );
              const finalKey = (s: StrataPackedScore): number =>
                strataWeightedCross(s, 1, 1) * 1e7 + s.lengthL1;
              // prod-optimum(final) — the "cand33"-class order
              let bestIdx = -1;
              let bestScore: number | undefined;
              const nScan = Math.min(prodCount, cands.length);
              for (let i = 0; i < nScan; i++) {
                const fin = finalOf(
                  recon2,
                  placeWithHull(recon2, region.id, i),
                );
                const sc = finalKey(chordOf(recon2, fin));
                if (bestScore === undefined || sc < bestScore) {
                  bestScore = sc;
                  bestIdx = i;
                }
              }
              const seqOf = (idx: number): string =>
                cands[idx]!
                  .map((u) => classify.get(strataUnitId(u)) ?? "?")
                  .join(" > ");
              const prodOpt =
                bestIdx >= 0
                  ? addArm(
                      recon2,
                      cCfg,
                      `C:uswest2#${bestIdx}`,
                      `us-west-2 prod-optimum(final) cand#${bestIdx} (cand33-class; S3 exiled) [${seqOf(
                        bestIdx,
                      )}]`,
                      finalOf(recon2, placeWithHull(recon2, region.id, bestIdx)),
                    )
                  : undefined;
              // owner VPC-swap (Va above V5) of the ENGINE order — cand13-class
              const engSeq =
                engIdx === undefined
                  ? orderStrataUnits(
                      orderParams as Parameters<typeof orderStrataUnits>[0],
                    )
                  : cands[Math.min(engIdx, cands.length - 1)]!;
              const engIds = engSeq.map(strataUnitId);
              const roleOf = (id: string) => classify.get(id) ?? "?";
              const v5i = engIds.findIndex((id) => roleOf(id).startsWith("V5"));
              const vai = engIds.findIndex((id) => roleOf(id).startsWith("Va"));
              let ownerSwap: Arm | undefined;
              if (v5i >= 0 && vai >= 0) {
                const sw = [...engIds];
                [sw[v5i], sw[vai]] = [sw[vai]!, sw[v5i]!];
                const oi = cands.findIndex(
                  (c) => c.map(strataUnitId).join("") === sw.join(""),
                );
                if (oi >= 0 && oi < prodCount) {
                  ownerSwap = addArm(
                    recon2,
                    cCfg,
                    `C:uswest2#${oi}`,
                    `us-west-2 owner VPC-swap (Va above V5, S3 kept high) cand#${oi} (cand13-class) [${seqOf(
                      oi,
                    )}]`,
                    finalOf(recon2, placeWithHull(recon2, region.id, oi)),
                  );
                } else {
                  softFailures.push(
                    `C: owner VPC-swap sequence not reachable (idx=${oi}, count=${prodCount})`,
                  );
                }
              } else {
                softFailures.push("C: V5/Va units not found in us-west-2");
              }
              const wHint =
                "region us-west-2 — vertical order of the two VPCs and the S3 bucket differs";
              if (prodOpt && prodOpt.placementSig !== engine2.placementSig) {
                push(
                  {
                    left: engine2.ref,
                    right: prodOpt.ref,
                    focusHint: wHint,
                    rationale:
                      "descent non-convergence case: crossings-optimal order the engine failed to return",
                  },
                  n++,
                );
              }
              if (ownerSwap) {
                push(
                  {
                    left: engine2.ref,
                    right: ownerSwap.ref,
                    focusHint: wHint,
                    rationale:
                      "owner's eyeballed swap vs engine: semantic placement (S3 high) at +1 rendered crossing",
                  },
                  n++,
                );
              }
              if (
                prodOpt &&
                ownerSwap &&
                prodOpt.placementSig !== ownerSwap.placementSig
              ) {
                push(
                  {
                    left: prodOpt.ref,
                    right: ownerSwap.ref,
                    focusHint: wHint,
                    rationale:
                      "THE owner-tension pair (cand33 vs cand13): crossings-optimal exiles S3 to the bottom; owner order keeps S3 high at +1 crossing — directly prices semantic placement in crossings",
                  },
                  n++,
                );
              }
            }
          }

          // ── CONFIG B (eps=0): us-west-2 owner S3-lift (cand9-class) ───────
          {
            const bCfg: CfgName = "B";
            const recon3 = recons.get(bCfg)!;
            const region = regionHullByName(recon3.model, "us-west-2");
            if (!region) {
              softFailures.push("B: us-west-2 region hull not found");
            } else {
              const classify = classifyRegionUnits(recon3.model, region);
              const orderParams = buildOrderParams(recon3, region);
              const cands = strataPackedCandidateSequences(
                orderParams as Parameters<
                  typeof strataPackedCandidateSequences
                >[0],
              );
              const counts3 = candidateCounts(recon3);
              const prodCount = counts3.get(region.id) ?? 0;
              const engine3 = addArm(
                recon3,
                bCfg,
                "B:engine",
                "engine pick, full pipeline (eps=0)",
                finalizeOrchestrator(recon3),
              );
              const finalKey = (s: StrataPackedScore): number =>
                strataWeightedCross(s, 1, 1) * 1e7 + s.lengthL1;
              const s3Unit = unitsOf(region).find((u) =>
                classify.get(strataUnitId(u))?.startsWith("S3"),
              );
              if (!s3Unit) {
                softFailures.push("B: no S3 unit in us-west-2");
              } else {
                const s3Id = strataUnitId(s3Unit);
                let liftIdx = -1;
                let liftScore: number | undefined;
                const nScan = Math.min(prodCount, cands.length);
                for (let i = 0; i < nScan; i++) {
                  const seq = cands[i]!.map(strataUnitId);
                  if (seq[seq.length - 1] === s3Id) {
                    continue;
                  }
                  const fin = finalOf(
                    recon3,
                    placeWithHull(recon3, region.id, i),
                  );
                  const sc = finalKey(chordOf(recon3, fin));
                  if (liftScore === undefined || sc < liftScore) {
                    liftScore = sc;
                    liftIdx = i;
                  }
                }
                if (liftIdx >= 0) {
                  const s3lift = addArm(
                    recon3,
                    bCfg,
                    `B:uswest2#${liftIdx}`,
                    `us-west-2 owner S3-lift best-final cand#${liftIdx} (cand9-class; wins only post-relocation)`,
                    finalOf(recon3, placeWithHull(recon3, region.id, liftIdx)),
                  );
                  if (s3lift.placementSig !== engine3.placementSig) {
                    push(
                      {
                        left: engine3.ref,
                        right: s3lift.ref,
                        focusHint:
                          "region us-west-2 — position of the S3 bucket row differs",
                        rationale:
                          "selection-surface staleness case: order that lifts S3 off the bottom, a tradeoff (crossings/L1 slightly worse)",
                      },
                      n++,
                    );
                  } else {
                    softFailures.push(
                      "B: s3-lift arm identical to engine arm — pair skipped",
                    );
                  }
                }
              }
            }
          }
        }

        report.push(`pairs assembled: ${pairs.length}`);
        expect(pairs.length, "at least 8 pairs required").toBeGreaterThanOrEqual(
          8,
        );

        // ── render + rendered metrics per unique arm ──────────────────────
        const usedRefs = new Set<string>();
        for (const p of pairs) {
          usedRefs.add(p.left);
          usedRefs.add(p.right);
        }
        for (const ref of usedRefs) {
          const arm = arms.get(ref)!;
          const recon = recons.get(arm.cfg)!;
          try {
            const scene = await buildStrataScene({
              prep: recon.prep,
              model: recon.model,
              placement: arm.placement,
              nodes: recon.nodes,
              generation: 1,
            });
            arm.rendered = renderedMetrics(scene.elements);
            const svg = await sceneToSvg(scene.elements);
            arm.svgSha1 = sha1(svg);
            const file = `arm-${sha1(ref)}.svg`; // opaque name (no identity leak)
            arm.svgFile = file;
            writeFileSync(path.join(outDir, file), svg);
            report.push(
              `arm ${ref}: rendered ${JSON.stringify(arm.rendered)} svg=${file} (${Math.round(
                svg.length / 1024,
              )}kB)`,
            );
            if (/crossings|penetration|candidate/i.test(svg)) {
              softFailures.push(`arm ${ref}: SVG leaks score-ish text`);
            }
          } catch (e) {
            softFailures.push(
              `arm ${ref}: scene/svg build failed: ${String(
                (e as Error).message,
              ).slice(0, 120)}`,
            );
          }
        }

        // ── sheet + key (seeded A/B randomization; double-run determinism) ─
        const built = buildSheetAndKey(pairs, arms);
        const again = buildSheetAndKey(pairs, arms);
        expect(
          JSON.stringify(again),
          "sheet+key builder not deterministic",
        ).toEqual(JSON.stringify(built));

        // blinding: sheet rows must not leak identity/scores
        const forbidden = [
          "armRef",
          "chord",
          "rendered",
          "crossings",
          "cfg",
          "note",
          "deltas",
          "expectedDominated",
          "rationale",
        ];
        for (const r of built.sheet) {
          const keys = new Set(Object.keys(r));
          for (const f of forbidden) {
            if (keys.has(f)) {
              softFailures.push(`sheet row ${r.pairId} leaks "${f}"`);
            }
          }
          if (r.raterChoice !== "" || r.confidence !== "") {
            softFailures.push(`sheet row ${r.pairId} not blank`);
          }
        }
        // key integrity: slots must map to real arms; svg files must exist
        const images = new Map<string, { a: string; b: string }>();
        for (const e of built.key) {
          const a = arms.get(e.slotA.armRef);
          const b = arms.get(e.slotB.armRef);
          if (!a || !b) {
            softFailures.push(`key ${e.pairId}: unknown arm ref`);
            continue;
          }
          if (a.svgFile === undefined || b.svgFile === undefined) {
            softFailures.push(`key ${e.pairId}: arm without svg`);
            continue;
          }
          if (a.placementSig === b.placementSig) {
            softFailures.push(
              `key ${e.pairId}: identical placements on both sides`,
            );
          }
          // per-pair copies so shared arms don't leak via filenames
          const dir = path.join(outDir, "pairs", e.pairId);
          mkdirSync(dir, { recursive: true });
          const aSvg = path.join(outDir, a.svgFile);
          const bSvg = path.join(outDir, b.svgFile);
          writeFileSync(path.join(dir, "A.svg"), readFileSync(aSvg));
          writeFileSync(path.join(dir, "B.svg"), readFileSync(bSvg));
          images.set(e.pairId, {
            a: `pairs/${e.pairId}/A.svg`,
            b: `pairs/${e.pairId}/B.svg`,
          });
        }
        // remove the shared arm files — only per-pair copies remain
        for (const ref of usedRefs) {
          const arm = arms.get(ref)!;
          if (arm.svgFile) {
            rmSync(path.join(outDir, arm.svgFile), { force: true });
          }
        }

        // ── diversity shit-test: can the pair set identify the exchange rate? ─
        const withRendered = built.key.filter(
          (e) => e.deltas.renderedCrossings !== undefined,
        );
        const dCr = withRendered.map((e) => e.deltas.renderedCrossings!);
        const dTll = withRendered.map((e) => e.deltas.renderedTll!);
        const hasLengthOnly = withRendered.some(
          (e) =>
            Math.abs(e.deltas.renderedCrossings!) <= 1 &&
            Math.abs(e.deltas.renderedTll!) > 2000,
        );
        const hasCrossingsOnly = withRendered.some(
          (e) => Math.abs(e.deltas.renderedCrossings!) >= 5,
        );
        const rho = Math.abs(pearson(dCr, dTll));
        report.push(
          `diversity: pairs=${built.key.length} rendered=${withRendered.length} lengthOnly=${hasLengthOnly} crossingsHeavy=${hasCrossingsOnly} |rho(dCr,dTll)|=${
            Math.round(rho * 100) / 100
          }`,
        );
        if (!hasLengthOnly) {
          softFailures.push(
            "diversity: no pair varies length at (near-)constant crossings — length coefficient unidentifiable",
          );
        }
        if (!hasCrossingsOnly) {
          softFailures.push(
            "diversity: no pair with a large crossings delta — crossings coefficient weakly identified",
          );
        }
        if (rho > 0.95) {
          softFailures.push(
            `diversity: |rho(dCrossings,dTll)|=${rho} — deltas collinear, exchange rate unidentifiable`,
          );
        }

        // ── emit artifacts ────────────────────────────────────────────────
        writeFileSync(
          path.join(outDir, "PREF_PAIRS_SHEET.json"),
          JSON.stringify(
            {
              preset: PRESET,
              seed: STRATA_PREF_SEED,
              proposition: PROPOSITION,
              rows: built.sheet,
            },
            null,
            2,
          ),
        );
        writeFileSync(
          path.join(outDir, "PREF_PAIRS_SHEET.md"),
          sheetMarkdown(built.sheet),
        );
        writeFileSync(
          path.join(outDir, "PREF_PAIRS_KEY.json"),
          JSON.stringify(
            {
              preset: PRESET,
              seed: STRATA_PREF_SEED,
              proposition: PROPOSITION,
              sealed:
                "DO NOT OPEN before all raters have submitted labels. Never feed these scores into any optimizer or default decision — fit the exchange rate via scripts/strata-pref-fit.mjs only.",
              configs: CFG,
              entries: built.key,
            },
            null,
            2,
          ),
        );
        writeFileSync(
          path.join(outDir, "index.html"),
          viewerHtml(built.sheet, images),
        );
        mkdirSync(path.join(outDir, "labels"), { recursive: true });
        // eslint-disable-next-line no-console -- artifact emission IS the deliverable
        console.log(`\n[PREF-PAIRS]\n${report.join("\n")}\nwritten to ${outDir}`);

        expect(
          softFailures,
          `harness structure failures:\n${softFailures.join("\n")}`,
        ).toEqual([]);
      },
      TIMEOUT,
    );
  },
);
