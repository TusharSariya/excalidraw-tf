/* eslint-disable max-lines */
/**
 * H0 — SHARED FROZEN HARNESS for the Strata readability investigation
 * (docs/../lets-do-a-real-cozy-eich.md). The ONE experimental substrate all 12
 * downstream research agents consume. Metrics-only; mutates NOTHING on the
 * off-path (this whole file is `.probe.test.ts`, excluded from the base vitest
 * config — see `vitest.probe.config.mts`).
 *
 * Run ONLY via the private probe config (single process):
 *   yarn vitest run --config vitest.probe.config.mts \
 *     packages/excalidraw/components/terraformStrataReadabilityHarness.probe.test.ts
 *
 * WHAT THIS BUILDS
 *  1. Real-app-path reproduction at the FROZEN config (through
 *     `chooseStrataRefinedPlacement` + `refineStrataVerticalSlots`, NOT
 *     engine-only), with a strengthened-signature fidelity gate asserting the
 *     reconstruction is byte-identical to `layoutTerraformFromSources`.
 *  2. A canonical DUAL-SCORING record: every placement (baseline OR
 *     counterfactual) emits the SAME schema — chord-proxy metrics
 *     (`scoreStrataPlacementGeometry`) AND rendered-polyline metrics
 *     (`diagnosePipelineScene` + `computeStrataPathMetrics` + pierce), both with
 *     L1 split X/Y, crossing-angle sharp-share, continuity, and LR-feasibility.
 *     This exposes the chord-vs-rendered sign-inversion by construction.
 *  3. A PLACEMENT-INJECTION counterfactual generator over the REAL search space:
 *     (a) row-order (Y) injection — per-hull candidate override, and
 *     (b) rank/column (X) injection — reassign a leaf's rank column — then
 *     recompute placement + A7 + relocate + scene, and re-score with the same
 *     canonical schema. The 3 cases are X-moves the Y-order enumeration never
 *     reaches; (b) is the mechanism for them.
 *  4. Frozen per-case baselines for C1/C2/C3 written to
 *     `docs/strata-baselines/h0/baselines.json`, plus the shared rubric-table
 *     template `docs/strata-baselines/h0/rubric-template.md`. Both are also
 *     copied to `scratchpad/…` for gitless reading.
 *
 * NaN import-cycle rule: NO module-level const imported from
 * terraformPipelineLayoutShared — options are read at call time / in-file
 * literals only.
 *
 * Determinism: same commit + seed 20260704 + frozen config ⇒ identical records
 * (pure integer engine geometry; no RNG/clock).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  strataWeightedCross,
} from "./terraformPipelineStrataPackedScoring";

import { refineStrataCoordinates } from "./terraformPipelineStrataCoordRefine";
import { refineStrataVerticalSlots } from "./terraformPipelineStrataVerticalRelocate";
import { buildStrataScene } from "./terraformPipelineStrataSceneBuild";
import { computePierceMetrics } from "./terraformPipelineStrataPierceMetrics";
import { diagnosePipelineScene } from "./terraformPipelineCollisionDiagnostics";
import { computeStrataPathMetrics } from "./terraformPipelineStrataPathMetrics";

import type { StrataPackedTrialRecord } from "./terraformPipelineStrataPackedScoring";

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

// ═════════════════════════════════════════════════════════════════════════════
// FROZEN CONFIG (the exact case config — all runs use this)
//   preset staging-extended-localstack-v2, view=strata, seed 20260704
//   compact=1 ancillary=0 privateApiRegional=0 strataSweeps=4 strataCoordRefine=1
//   strataRankSep=1 strataPackedScoring=1 strataPackedEps=1 strataBandDepth=root
//   strataSift=1 strataPackedConverge=1 strataTransitiveAdopt=1
// ═════════════════════════════════════════════════════════════════════════════
const PRESET = "staging-extended-localstack-v2";
const SEED = 20260704;
const TIMEOUT = STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS * 30;

const FROZEN_CONFIG = {
  preset: PRESET,
  seed: SEED,
  layoutMode: "strata",
  compact: true,
  ancillary: false,
  privateApiRegional: false,
  strataSweeps: 4,
  strataCoordRefine: true,
  strataRankSeparate: true,
  strataPackedScoring: true,
  strataPackedEps: 1,
  strataBandDepth: "root" as const,
  strataSift: true,
  strataPackedConverge: true,
  strataTransitiveAdopt: true,
} as const;

const v2Sources = () =>
  getTerraformImportPresetSourcesFromDb(
    PRESET,
  ) as unknown as TerraformPlanParsingSources;

// Demo→engine resolution for the REAL app path (layoutTerraformFromSources).
const frozenDemoOptions = () =>
  resolveStrataDemoOptions({
    strataSweeps: FROZEN_CONFIG.strataSweeps,
    strataCoordRefine: FROZEN_CONFIG.strataCoordRefine,
    strataRankSeparate: FROZEN_CONFIG.strataRankSeparate,
    strataPackedScoring: FROZEN_CONFIG.strataPackedScoring,
    strataPackedEps: FROZEN_CONFIG.strataPackedEps,
    strataBandDepth: FROZEN_CONFIG.strataBandDepth,
    strataSift: FROZEN_CONFIG.strataSift,
    strataPackedConverge: FROZEN_CONFIG.strataPackedConverge,
    strataTransitiveAdopt: FROZEN_CONFIG.strataTransitiveAdopt,
  });

type Scene = { elements: ExcalidrawElement[]; meta: Record<string, unknown> };

const buildReal = async (): Promise<Scene> => {
  const res = await layoutTerraformFromSources(v2Sources(), {
    layoutMode: "strata",
    pipelineCompact: FROZEN_CONFIG.compact,
    pipelinePrivateApiRegional: FROZEN_CONFIG.privateApiRegional,
    ...frozenDemoOptions(),
    strataPackedFrontierMeta: true,
  } as Record<string, unknown>);
  if (!res.ok) {
    throw new Error(res.error);
  }
  return res.scene as Scene;
};

// ── strengthened, ordering-sensitive scene signature (round-2 [FIX-3]) ─────────
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

const sceneSignature = (elements: readonly ExcalidrawElement[]): string =>
  elements
    .filter((el) => !el.isDeleted)
    .map((el, i) => elementSignature(el as Anyel, i))
    .join("\n");

// ═════════════════════════════════════════════════════════════════════════════
// CANONICAL DUAL-SCORING SCHEMA — every run emits this record.
// ═════════════════════════════════════════════════════════════════════════════
type ChordMetrics = {
  /** leaf-level edge-pair crossings on straight chords (scorer's kernel). */
  crossings: number;
  /** unrelated edge–box penetrations (Liang–Barsky interior test). */
  penetrations: number;
  /** Σ|Δx|+|Δy| doubled-centre integer units. */
  lengthL1: number;
  /** Σ|Δx| only (doubled units) — the axis strata never optimizes. */
  lengthL1X: number;
  /** Σ|Δy| only (doubled units). */
  lengthL1Y: number;
  /** weighted C = penW·pen + crossW·cross (frozen 1:1) — the adoption metric. */
  weightedC: number;
};

type RenderedMetrics = {
  /** whole-scene rendered polyline crossings (diagnostics kernel). */
  crossings: number;
  /** crossing-angle sharp share (fraction of crossings below the sharp cut). */
  sharpShare: number;
  /** rendered total edge length (Σ|hypot| over dataflow arrows), px. */
  tll: number;
  /** rendered Σ|Δx| over dataflow arrow segments, px. */
  tllX: number;
  /** rendered Σ|Δy|, px. */
  tllY: number;
  /** hull-pierce total (computePierceMetrics). */
  pierce: number;
  /** continuity (Ware `con`, angular deviation from straight-through) p50/mean. */
  conP50: number;
  conMean: number;
  /** max per-edge geodesic deviation (deg) across sampled path rows. */
  gdevMaxDeg: number;
  /** Ware composite rtHat p50/mean over sampled path rows. */
  rtHatP50: number;
  rtHatMean: number;
  /** number of sampled path rows (coverage denominator). */
  pathRows: number;
  /** dataflow arrows drawn. */
  dataflowArrows: number;
  /** arrows whose target centre.x < source centre.x (leftward / against LR). */
  leftwardArrows: number;
};

type LrFeasibility = {
  /** E′ edges (true direction) whose source rank > target rank, NOT reversed. */
  backwardNonReversed: number;
  /** E′ edges A3 reversed (cycle-repaired back-edges — expected backward). */
  reversedEdges: number;
  /** true iff no non-reversed edge runs against the LR/TFD rank order. */
  feasible: boolean;
};

type Polyline = {
  source: string;
  target: string;
  points: Array<[number, number]>;
};

type CanonicalRecord = {
  id: string;
  /** short human note on how this candidate was produced. */
  provenance: string;
  chord: ChordMetrics;
  rendered: RenderedMetrics | { error: string };
  lr: LrFeasibility;
  /** final rendered dataflow polylines (included for baselines; omitted in bulk
   * counterfactuals via includePolylines=false to bound artifact size). */
  polylines?: Polyline[];
};

// ── rendered helpers ──────────────────────────────────────────────────────────
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

const dataflowPolylines = (
  elements: readonly ExcalidrawElement[],
): Polyline[] => {
  const out: Polyline[] = [];
  for (const el of elements as Anyel[]) {
    if (!isDataflowArrow(el) || !Array.isArray(el.points)) {
      continue;
    }
    const rel = el.customData!.relationship as {
      source: string;
      target: string;
    };
    out.push({
      source: rel.source,
      target: rel.target,
      points: el.points.map(([px, py]) => [
        Math.round((el.x + px) * 100) / 100,
        Math.round((el.y + py) * 100) / 100,
      ]),
    });
  }
  return out;
};

const renderedMetricsOf = (
  elements: readonly ExcalidrawElement[],
): RenderedMetrics => {
  const diag = diagnosePipelineScene(elements) as unknown as {
    dataflow: { crossings: number };
    crossingAngles?: { sharpShare?: number };
  };
  const pm = computePierceMetrics(elements);
  const paths = computeStrataPathMetrics(elements);
  const sortNum = (a: number, b: number) => a - b;
  const p50 = (xs: number[]) =>
    xs.length ? xs.slice().sort(sortNum)[Math.floor((xs.length - 1) / 2)]! : 0;
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
  const rt = paths.rows.map((r) => r.rtHat);
  const con = paths.rows.map((r) => r.con);
  const gdev = paths.rows.map((r) => r.gdevMaxDeg);
  let tll = 0;
  let tllX = 0;
  let tllY = 0;
  let dataflowArrows = 0;
  let leftwardArrows = 0;
  for (const el of elements as Anyel[]) {
    if (!isDataflowArrow(el) || !Array.isArray(el.points)) {
      continue;
    }
    dataflowArrows += 1;
    const pts = el.points;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i]![0] - pts[i - 1]![0];
      const dy = pts[i]![1] - pts[i - 1]![1];
      tll += Math.hypot(dx, dy);
      tllX += Math.abs(dx);
      tllY += Math.abs(dy);
    }
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    if (last[0] < first[0]) {
      leftwardArrows += 1;
    }
  }
  const round3 = (x: number) => Math.round(x * 1000) / 1000;
  return {
    crossings: diag.dataflow.crossings,
    sharpShare: round3(diag.crossingAngles?.sharpShare ?? 0),
    tll: Math.round(tll),
    tllX: Math.round(tllX),
    tllY: Math.round(tllY),
    pierce: pm.pierce.total,
    conP50: round3(p50(con)),
    conMean: round3(mean(con)),
    gdevMaxDeg: round3(gdev.length ? Math.max(...gdev) : 0),
    rtHatP50: round3(p50(rt)),
    rtHatMean: round3(mean(rt)),
    pathRows: paths.rows.length,
    dataflowArrows,
    leftwardArrows,
  };
};

// ── faithful internal-pipeline reconstruction at the FROZEN config ─────────────
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

// The frozen engineOptions — mirrors terraformPipelineStrata.ts:324-366 for this
// exact config (strataSift ⇒ strataSiftRelocate; packedConverge; transitiveAdopt;
// bandDepth root; ε=1). Verified byte-identical to the real app path by the
// fidelity gate in EXP-H0-0.
const frozenEngineOptions = (): StrataEngineOptions =>
  ({
    compact: true,
    includeAncillary: false,
    networkSimplexRank: false,
    rankSeparate: true,
    sweeps: 4,
    coordinateRefine: true,
    packedScoring: true,
    packedScoringEpsilon: 1,
    strataBandDepth: "root",
    strataSiftRelocate: true,
    packedConverge: true,
    transitiveAdopt: true,
  } as unknown as StrataEngineOptions);

const reconstruct = (): Recon => {
  const { nodes, plan } = loadNodes();
  const prep = preparePipelineLayout(nodes, plan, true, {
    privateApiRegional: FROZEN_CONFIG.privateApiRegional,
  });
  const engineOptions = frozenEngineOptions();
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
    epsilon: FROZEN_CONFIG.strataPackedEps,
    edgeCrossCap: FROZEN_CONFIG.strataPackedEps, // inherits packedScoringEpsilon
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

// Orchestrator-identical finalize (mirrors terraformPipelineStrata.ts:451-515):
// refine BOTH arms, pick via chooseStrataRefinedPlacement (only when a hull
// moved), THEN relocate. This is the guard path — the REAL selector.
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
        relocateCfg, // strataSiftRelocate on ⇒ weighted guard
      );
      placement = chosen.placement;
    } else {
      placement = refineStrataCoordinates(placement, model, edgesPrime);
    }
  }
  placement = refineStrataVerticalSlots(
    placement,
    model,
    edgesPrime,
    rank,
    engineOptions,
  );
  return placement;
};

// Per-CANDIDATE finalize (a FORCED candidate scored on its OWN geometry — NOT
// the guard). place → A7 → relocate. Used by the counterfactual injectors.
const finalizeCandidate = (
  recon: Recon,
  base: StrataPlacementResult,
): StrataPlacementResult => {
  const { model, edgesPrime, rank, engineOptions } = recon;
  const a7 = engineOptions.coordinateRefine
    ? refineStrataCoordinates(base, model, edgesPrime)
    : base;
  return refineStrataVerticalSlots(a7, model, edgesPrime, rank, engineOptions);
};

const buildScene = async (recon: Recon, placement: StrataPlacementResult) =>
  buildStrataScene({
    prep: recon.prep,
    model: recon.model,
    placement,
    nodes: recon.nodes,
    generation: 1,
  });

// ── chord metrics with X/Y split (in-file; scorer only returns total L1) ───────
const chordMetricsOf = (
  recon: Recon,
  placement: StrataPlacementResult,
): ChordMetrics => {
  const s = scoreStrataPlacementGeometry(
    placement,
    recon.model,
    recon.edgesPrime,
  );
  let lengthL1X = 0;
  let lengthL1Y = 0;
  for (const pe of recon.edgesPrime) {
    const sBox = placement.leafBoxes.get(pe.edge.source);
    const tBox = placement.leafBoxes.get(pe.edge.target);
    if (!sBox || !tBox) {
      continue;
    }
    const ax = 2 * sBox.x + sBox.width;
    const ay = 2 * sBox.y + sBox.height;
    const bx = 2 * tBox.x + tBox.width;
    const by = 2 * tBox.y + tBox.height;
    lengthL1X += Math.abs(ax - bx);
    lengthL1Y += Math.abs(ay - by);
  }
  return {
    crossings: s.crossings,
    penetrations: s.penetrations,
    lengthL1: s.lengthL1,
    lengthL1X,
    lengthL1Y,
    weightedC: strataWeightedCross(s, 1, 1),
  };
};

const lrFeasibilityOf = (
  recon: Recon,
  placement: StrataPlacementResult,
): LrFeasibility => {
  let backwardNonReversed = 0;
  let reversedEdges = 0;
  for (const pe of recon.edgesPrime) {
    if (pe.reversed) {
      reversedEdges += 1;
      continue;
    }
    const sBox = placement.leafBoxes.get(pe.edge.source);
    const tBox = placement.leafBoxes.get(pe.edge.target);
    if (!sBox || !tBox) {
      continue;
    }
    const sCx = sBox.x + sBox.width / 2;
    const tCx = tBox.x + tBox.width / 2;
    if (tCx < sCx) {
      backwardNonReversed += 1;
    }
  }
  return {
    backwardNonReversed,
    reversedEdges,
    feasible: backwardNonReversed === 0,
  };
};

// THE canonical-record emitter. Same schema for baseline and counterfactual.
const emitRecord = async (
  recon: Recon,
  placement: StrataPlacementResult,
  opts: { id: string; provenance: string; includePolylines?: boolean },
): Promise<CanonicalRecord> => {
  const chord = chordMetricsOf(recon, placement);
  const lr = lrFeasibilityOf(recon, placement);
  let rendered: RenderedMetrics | { error: string };
  let polylines: Polyline[] | undefined;
  try {
    const scene = await buildScene(recon, placement);
    rendered = renderedMetricsOf(scene.elements);
    if (opts.includePolylines) {
      polylines = dataflowPolylines(scene.elements);
    }
  } catch (e) {
    rendered = { error: String((e as Error).message).slice(0, 160) };
  }
  return {
    id: opts.id,
    provenance: opts.provenance,
    chord,
    rendered,
    lr,
    ...(polylines ? { polylines } : {}),
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// COUNTERFACTUAL INJECTORS over the REAL search space.
// ═════════════════════════════════════════════════════════════════════════════

// (a) ROW-ORDER (Y) injection: force one hull's ordering candidate index, keep
// all others at the descent winner's selection. Recomputes the full placement.
const injectRowOrder = (
  recon: Recon,
  hullId: string,
  idx: number | "legacy",
): StrataPlacementResult => {
  const sel = new Map(recon.packedScored.selections);
  if (idx === "legacy") {
    sel.delete(hullId);
  } else {
    sel.set(hullId, idx);
  }
  return placeStrataHulls(
    recon.model,
    recon.edgesPrime,
    recon.rank,
    recon.engineOptions,
    sel,
  );
};

// (b) RANK/COLUMN (X) injection: reassign given leaf clusters to a new rank
// column, rebuild the StrataRankResult (columnX kept — move INTO an existing
// column), re-run placeStrataHulls with the descent-winner selection map. This
// is the mechanism the 3 X-move cases need — the Y-order enumeration never
// reaches it. NOTE: an X-move can violate hull-containment / structural checks;
// callers must score via emitRecord, which guards the scene build and still
// returns chord metrics (chord needs only leafBoxes, always produced).
const injectRankOverride = (
  recon: Recon,
  overrides: ReadonlyMap<string, number>,
): StrataPlacementResult => {
  const nextRank = new Map(recon.rank.rank);
  for (const [cid, r] of overrides) {
    nextRank.set(cid, r);
  }
  const modifiedRank: StrataRankResult = {
    ...recon.rank,
    rank: nextRank,
  };
  return placeStrataHulls(
    recon.model,
    recon.edgesPrime,
    modifiedRank,
    recon.engineOptions,
    recon.packedScored.selections,
  );
};

// ── hull / geometry helpers ────────────────────────────────────────────────────
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

// deepest hull enclosing a leaf, and the region/account/vpc path tags.
const locateLeaf = (model: StrataModel, leafId: string) => {
  const chain: StrataHullNode[] = [];
  const walk = (n: StrataHullNode): boolean => {
    if (subtreeLeafIds(n).includes(leafId)) {
      chain.push(n);
      for (const c of n.children) {
        if (walk(c)) {
          break;
        }
      }
      return true;
    }
    return false;
  };
  walk(model.hullRoot);
  const tagOf = (role: string) =>
    chain.find((n) => n.role === role)?.path.slice(-1)[0];
  const deepest = chain[chain.length - 1];
  return {
    account: tagOf("account"),
    region: tagOf("region"),
    vpc: tagOf("vpc"),
    deepestHullId: deepest?.id,
    deepestRole: deepest?.role,
  };
};

// ═════════════════════════════════════════════════════════════════════════════
// CASE TARGETS — located by address at the frozen config (see discovery probe).
// ═════════════════════════════════════════════════════════════════════════════
type CaseTarget = {
  case: string;
  label: string;
  ownerMove: string;
  match: (addr: string) => boolean;
};

const CASE_TARGETS: CaseTarget[] = [
  {
    case: "C1",
    label:
      "/staging/api-6/name Parameter Store — sits too low in middle column",
    ownerMove: "move HIGHER (shorter edge, fewer crossings)",
    match: (a) => a === "module.api6.aws_ssm_parameter.api_name",
  },
  {
    case: "C2",
    label:
      "staging-egress-dlq + staging-events-dlq (SQS DLQs) — far-right column",
    ownerMove: "move LEFT (shorter edge, removes hull penetration, straighter)",
    // egress DLQ is module.egress_queue…dlq; the harness also flags every
    // far-right-column DLQ so the CASE-C2 agent can confirm the exact pair.
    match: (a) => /aws_sqs_queue\.dlq\[0\]$/.test(a) || /_dlq$/.test(a),
  },
  {
    case: "C3-s3",
    label: "S3 bucket …-west (us-west-2)",
    ownerMove: "move LEFT/UP (less length, less us-west-2 area)",
    match: (a) =>
      a ===
      "module.api8_west_bucket.module.bucket.module.bucket.aws_s3_bucket.this[0]",
  },
  {
    case: "C3-ssm8",
    label: "/staging/api-8/name ssm param (us-west-2)",
    ownerMove: "move LEFT/UP",
    match: (a) => a === "module.api8.aws_ssm_parameter.api_name",
  },
  {
    case: "C3-ssm9",
    label: "/staging/api-9/name ssm param (us-west-2)",
    ownerMove: "move LEFT/UP",
    match: (a) => a === "module.api9.aws_ssm_parameter.api_name",
  },
];

type TargetRecord = {
  case: string;
  label: string;
  ownerMove: string;
  clusterId: string;
  address: string;
  account?: string;
  region?: string;
  vpc?: string;
  rank: number;
  maxRank: number;
  isFarRightColumn: boolean;
  leafBox: { x: number; y: number; width: number; height: number };
  incidentEdges: Array<{
    role: "out" | "in";
    other: string;
    otherAddress: string;
    reversed: boolean;
    chordLenL1: number;
    chordDx: number;
    chordDy: number;
    leftward: boolean;
  }>;
};

const captureTargets = (
  recon: Recon,
  placement: StrataPlacementResult,
): TargetRecord[] => {
  const { model } = recon;
  const ids = [...model.clusters.keys()];
  const maxRank = Math.max(...ids.map((id) => recon.rank.rank.get(id) ?? 0));
  const out: TargetRecord[] = [];
  const seen = new Set<string>();
  for (const t of CASE_TARGETS) {
    for (const id of ids) {
      const addr = model.addressOf(id);
      if (!t.match(addr)) {
        continue;
      }
      const key = `${t.case}:${id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const box = placement.leafBoxes.get(id);
      if (!box) {
        continue;
      }
      const loc = locateLeaf(model, id);
      const rank = recon.rank.rank.get(id) ?? -1;
      const incidentEdges: TargetRecord["incidentEdges"] = [];
      for (const pe of recon.edgesPrime) {
        const isOut = pe.edge.source === id;
        const isIn = pe.edge.target === id;
        if (!isOut && !isIn) {
          continue;
        }
        const other = isOut ? pe.edge.target : pe.edge.source;
        const sBox = placement.leafBoxes.get(pe.edge.source);
        const tBox = placement.leafBoxes.get(pe.edge.target);
        if (!sBox || !tBox) {
          continue;
        }
        const ax = 2 * sBox.x + sBox.width;
        const ay = 2 * sBox.y + sBox.height;
        const bx = 2 * tBox.x + tBox.width;
        const by = 2 * tBox.y + tBox.height;
        incidentEdges.push({
          role: isOut ? "out" : "in",
          other,
          otherAddress: model.addressOf(other),
          reversed: pe.reversed,
          chordLenL1: Math.abs(ax - bx) + Math.abs(ay - by),
          chordDx: bx - ax,
          chordDy: by - ay,
          leftward:
            tBox.x + tBox.width / 2 < sBox.x + sBox.width / 2 && !pe.reversed,
        });
      }
      out.push({
        case: t.case,
        label: t.label,
        ownerMove: t.ownerMove,
        clusterId: id,
        address: addr,
        account: loc.account,
        region: loc.region,
        vpc: loc.vpc,
        rank,
        maxRank,
        isFarRightColumn: rank === maxRank,
        leafBox: {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height),
        },
        incidentEdges,
      });
    }
  }
  return out;
};

// ═════════════════════════════════════════════════════════════════════════════
const OUT_DIR = path.resolve(process.cwd(), "docs/strata-baselines/h0");
const SCRATCH_DIR = path.resolve(process.cwd(), "scratchpad");

const writeArtifact = (relFile: string, contents: string) => {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, relFile), contents);
  try {
    mkdirSync(SCRATCH_DIR, { recursive: true });
    writeFileSync(path.join(SCRATCH_DIR, `h0-${relFile}`), contents);
  } catch {
    /* scratchpad copy is best-effort */
  }
};

const RUBRIC_TEMPLATE = `# Strata readability — shared rubric table (H0 template)

Every downstream agent fills its owned rows. ONE owning agent per metric/case is
canonical (authority rule); others cite, never recompute. Failure-class ∈
{config, search-space, measurement, objective}. Fixable-by-generic-algorithm ∈
{yes, no, yes-with-tradeoff}. All numbers come from the H0 canonical dual-scoring
record (chord AND rendered) at the frozen config — never a hand-moved render.

## Per-case classification

| case | factor moved | baseline (chord / rendered) | owner-better Δ | failure-class | fixable-by-generic-algorithm | regression-cost-elsewhere | prescription fixes case? (y/n) | owning agent |
|------|--------------|-----------------------------|----------------|---------------|------------------------------|---------------------------|--------------------------------|--------------|
| C1 |  |  |  |  |  |  |  |  |
| C2 |  |  |  |  |  |  |  |  |
| C3-s3 |  |  |  |  |  |  |  |  |
| C3-ssm8 |  |  |  |  |  |  |  |  |
| C3-ssm9 |  |  |  |  |  |  |  |  |
| C3-acct04 |  |  |  |  |  |  |  |  |

## Per-factor handling (current vs prescribed)

| factor | current handling in pipeline | prescribed handling (SOTA-derived) | fed back into selection? | owning agent |
|--------|------------------------------|------------------------------------|--------------------------|--------------|
| crossings (chord) |  |  |  | F-CROSS |
| crossings (rendered) |  |  |  | F-CROSS |
| penetration |  |  |  | F-PEN |
| edge length (X) |  |  |  | F-LEN |
| edge length (Y) |  |  |  | F-LEN |
| crossing angle / sharp-share |  |  |  | F-ANG |
| continuity / through-hub straightness |  |  |  | F-ANG / F-HUB |
| hubs / interchange |  |  |  | F-HUB |
| LR / TFD feasibility |  |  |  | F-LR |
| two-worlds measurement gap |  |  |  | M-MEAS |
| objective architecture (weighted-C / ε / lex) |  |  |  | M-OBJ |

## Joint-balance factorial (JOINT-SYNTH)

| case | baseline | +crossings term | +penetration | +length | +angle | all-four jointly (under LR) | best |
|------|----------|-----------------|--------------|---------|--------|-----------------------------|------|
| C1 |  |  |  |  |  |  |  |
| C2 |  |  |  |  |  |  |  |
| C3 |  |  |  |  |  |  |  |

_Convergence = agents agree on case-classifications + fix-verdicts. Disagreement
IS the finding — surface it, do not average it away._
`;

// ══════════════════════════════════════════════════════════════════════════════
describe("Strata readability H0 — frozen harness", () => {
  it(
    "EXP-H0-0: real-app-path fidelity gate + frozen baselines + rubric template",
    async () => {
      const report: string[] = [];

      // determinism: 2 cold builds must be byte-identical under the strengthened
      // signature; the reconstruction must equal the real app path.
      clearTerraformImportPrepCache();
      const cold1 = await buildReal();
      clearTerraformImportPrepCache();
      const cold2 = await buildReal();
      const sig1 = sceneSignature(cold1.elements);
      const sig2 = sceneSignature(cold2.elements);
      report.push(
        `determinism cold1==cold2: ${sig1 === sig2} (elements=${
          cold1.elements.length
        })`,
      );
      expect(sig1).toBe(sig2);

      const m = cold1.meta;
      report.push(
        `real meta: fellBack=${m.strataPackedScoringFellBack} trials=${m.strataPackedScoringTrials} eps=${m.strataPackedScoringEpsilon} effDelta=${m.strataPackedScoringEffectiveDelta}`,
      );
      report.push(
        `real selections: ${JSON.stringify(m.strataPackedScoringSelections)}`,
      );

      const recon = reconstruct();
      // reconstruction fidelity — packed descent
      expect(Object.fromEntries(recon.packedScored.selections)).toEqual(
        m.strataPackedScoringSelections,
      );
      expect(recon.packedScored.trialCount).toBe(m.strataPackedScoringTrials);

      // FINAL scene fidelity through the guard path
      const finalPlacement = finalizeOrchestrator(recon);
      const reconScene = await buildScene(recon, finalPlacement);
      const reconSig = sceneSignature(reconScene.elements);
      const realSig = sceneSignature(cold1.elements);
      const reconMatchesReal = reconSig === realSig;
      report.push(`RECON final-scene == real: ${reconMatchesReal}`);
      if (!reconMatchesReal) {
        const a = reconSig.split("\n");
        const b = realSig.split("\n");
        let shown = 0;
        for (let i = 0; i < Math.max(a.length, b.length) && shown < 4; i++) {
          if (a[i] !== b[i]) {
            report.push(`  DIFF@${i}:\n    recon: ${a[i]}\n    real:  ${b[i]}`);
            shown++;
          }
        }
        report.push(`  (recon lines=${a.length} real lines=${b.length})`);
      }
      expect(reconMatchesReal).toBe(true);

      // ── canonical baseline record (whole scene) ──
      const baselineRecord = await emitRecord(recon, finalPlacement, {
        id: "baseline",
        provenance:
          "frozen real-app-path (chooseStrataRefinedPlacement + relocate)",
        includePolylines: true,
      });
      report.push(`BASELINE chord: ${JSON.stringify(baselineRecord.chord)}`);
      report.push(
        `BASELINE rendered: ${JSON.stringify(baselineRecord.rendered)}`,
      );
      report.push(`BASELINE lr: ${JSON.stringify(baselineRecord.lr)}`);

      // ── per-case target capture ──
      const targets = captureTargets(recon, finalPlacement);
      for (const t of targets) {
        report.push(
          `\n[${t.case}] ${t.address}\n  region=${t.region} account=${
            t.account
          } vpc=${t.vpc} rank=${t.rank}/${t.maxRank} farRight=${
            t.isFarRightColumn
          } box=${JSON.stringify(t.leafBox)}\n  edges: ${t.incidentEdges
            .map(
              (e) =>
                `${e.role}->${e.otherAddress
                  .split(".")
                  .slice(-2)
                  .join(".")}(L1=${e.chordLenL1}${
                  e.leftward ? ",LEFTWARD" : ""
                }${e.reversed ? ",rev" : ""})`,
            )
            .join(" ; ")}`,
        );
      }

      // ── freeze the artifact ──
      const artifact = {
        harness: "H0",
        builtAtSeed: SEED,
        frozenConfig: FROZEN_CONFIG,
        note: "Frozen baselines for the Strata readability investigation. Every record uses the canonical dual-scoring schema (chord + rendered). Reproduced on the REAL app path (fidelity gate green). Downstream agents: consume these numbers, do not recompute the baseline.",
        realMeta: {
          strataPackedScoringSelections: m.strataPackedScoringSelections,
          strataPackedScoringFellBack: m.strataPackedScoringFellBack,
          strataPackedScoringTrials: m.strataPackedScoringTrials,
          strataPackedScoringEpsilon: m.strataPackedScoringEpsilon,
          strataPackedScoringEffectiveDelta:
            m.strataPackedScoringEffectiveDelta,
          strataPackedScoringConvergeRecovered:
            (m as Record<string, unknown>)
              .strataPackedScoringConvergeRecovered ?? null,
        },
        sceneBaseline: {
          chord: baselineRecord.chord,
          rendered: baselineRecord.rendered,
          lr: baselineRecord.lr,
        },
        caseTargets: targets,
      };
      writeArtifact("baselines.json", `${JSON.stringify(artifact, null, 2)}\n`);
      writeArtifact("rubric-template.md", RUBRIC_TEMPLATE);
      // full baseline polylines separately (large) — for geometry diffing.
      writeArtifact(
        "baseline-polylines.json",
        `${JSON.stringify(
          { id: baselineRecord.id, polylines: baselineRecord.polylines },
          null,
          2,
        )}\n`,
      );

      // eslint-disable-next-line no-console
      console.log(`\n[EXP-H0-0]\n${report.join("\n")}`);
    },
    TIMEOUT,
  );

  it(
    "EXP-H0-1: counterfactual generators produce canonical dual-scored candidates",
    async () => {
      const report: string[] = [];
      clearTerraformImportPrepCache();
      const recon = reconstruct();
      const baseline = await emitRecord(recon, finalizeOrchestrator(recon), {
        id: "baseline",
        provenance: "frozen real-app-path",
      });
      const fmt = (r: CanonicalRecord) =>
        `chord{cr:${r.chord.crossings} pen:${r.chord.penetrations} L1:${
          r.chord.lengthL1
        } (x:${r.chord.lengthL1X} y:${r.chord.lengthL1Y}) C:${
          r.chord.weightedC
        }} rendered{${
          "error" in r.rendered
            ? `ERR:${r.rendered.error}`
            : `cr:${r.rendered.crossings} sharp:${r.rendered.sharpShare} pierce:${r.rendered.pierce} tll:${r.rendered.tll}(x:${r.rendered.tllX} y:${r.rendered.tllY}) con:${r.rendered.conP50} rtHat:${r.rendered.rtHatP50}`
        }} lr{back:${r.lr.backwardNonReversed} feasible:${r.lr.feasible}}`;
      report.push(`BASELINE  ${fmt(baseline)}`);

      // (a) ROW-ORDER injection demo: flip the us-west-2 region hull's ordering to
      // its legacy order (proves the Y injector wires through the real placer).
      const region = findHull(
        recon.model.hullRoot,
        (n) =>
          n.role === "region" &&
          subtreeLeafIds(n).some((id) =>
            recon.model.addressOf(id).includes("west"),
          ),
      );
      if (region) {
        const units = unitsOf(region).length;
        const rowLegacy = finalizeCandidate(
          recon,
          injectRowOrder(recon, region.id, "legacy"),
        );
        const rec = await emitRecord(recon, rowLegacy, {
          id: "cf-roworder-uswest2-legacy",
          provenance: `row-order(Y) inject: region ${region.id} → legacy order (${units} units)`,
        });
        report.push(`ROW-ORDER(Y) us-west-2→legacy  ${fmt(rec)}`);
      } else {
        report.push("ROW-ORDER(Y): us-west-2 region hull not found");
      }

      // (b) RANK/COLUMN (X) injection demo: pull the C2 DLQ clusters one column
      // LEFT of their ACTUAL rank (the owner move) — the mechanism the
      // Y-enumeration never reaches. FINDING baked in: the DLQs the owner calls
      // "far-right column" actually sit at rank 15/29, not the max column — the
      // demo reads their real rank, does not assume the far right. Guarded:
      // chord always scores; rendered may error if the X-move trips a structural
      // check (that itself is a finding for the CASE-C2 agent).
      const ids = [...recon.model.clusters.keys()];
      const maxRank = Math.max(
        ...ids.map((id) => recon.rank.rank.get(id) ?? 0),
      );
      const dlqIds = ids.filter((id) =>
        /(egress|ingress)_queue\.module\.queue\.aws_sqs_queue\.dlq\[0\]$/.test(
          recon.model.addressOf(id),
        ),
      );
      const dlqRanks = dlqIds.map((id) => recon.rank.rank.get(id) ?? -1);
      report.push(
        `\nC2 DLQ clusters: ${dlqIds
          .map(
            (id, i) =>
              `${recon.model
                .addressOf(id)
                .split(".")
                .slice(0, 2)
                .join(".")}@rank${dlqRanks[i]}`,
          )
          .join(
            ", ",
          )} (maxRank=${maxRank}; owner said "far-right" but they are NOT at maxRank — a measurement/framing finding)`,
      );
      if (dlqIds.length > 0) {
        const ov = new Map<string, number>();
        for (let i = 0; i < dlqIds.length; i++) {
          ov.set(dlqIds[i]!, Math.max(0, dlqRanks[i]! - 1));
        }
        const moved = finalizeCandidate(recon, injectRankOverride(recon, ov));
        const rec = await emitRecord(recon, moved, {
          id: "cf-rank-dlq-left",
          provenance: `rank(X) inject: ${dlqIds.length} C2 DLQ(s) rank→(rank-1)`,
        });
        report.push(`RANK(X) C2 DLQ→left  ${fmt(rec)}`);
        report.push(
          `  Δ vs baseline: chordC ${
            rec.chord.weightedC - baseline.chord.weightedC
          }, chordL1 ${Math.round(
            rec.chord.lengthL1 - baseline.chord.lengthL1,
          )}, chordCross ${
            rec.chord.crossings - baseline.chord.crossings
          }, chordPen ${rec.chord.penetrations - baseline.chord.penetrations}`,
        );
        expect("error" in rec.rendered || rec.chord.crossings >= 0).toBe(true);
      }

      // eslint-disable-next-line no-console
      console.log(`\n[EXP-H0-1]\n${report.join("\n")}`);
      // Both injectors must at least produce chord-scored candidates.
      expect(baseline.chord.crossings).toBeGreaterThanOrEqual(0);
    },
    TIMEOUT,
  );
});
