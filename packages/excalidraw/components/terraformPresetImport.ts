import {
  DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
  resolveTerraformModuleLayoutOptions,
  type TerraformModuleLayoutOptions,
} from "./terraformModuleLayoutOptions";
import { loadTerraformImportPresetSources } from "./terraformImportPresetLoader";
import {
  runTerraformImportFromSources,
  type RunTerraformImportFromSourcesResult,
} from "./terraformSceneApply";

import type {
  TerraformLayoutMode,
  TerraformView,
} from "./terraformImportDialogUtils";
import type { TerraformPlanParsingSources } from "./terraformPlanParsing";
import type { TerraformImportPreset } from "./terraformImportPresetsTypes";
import type { TerraformImportPresetWarning } from "./terraformImportPresetsTypes";
import type { TerraformLayoutProgress } from "./terraformLayoutWorkerTypes";
import type { AppClassProperties, AppState } from "../types";
import type React from "react";

type SetAppState = React.Component<any, AppState>["setState"];

export type { TerraformLayoutMode };

export const deriveLayoutModeFromView = (
  view: TerraformView,
  sources: Pick<TerraformPlanParsingSources, "planDotBundles" | "states">,
): TerraformLayoutMode => {
  const canUseSemanticView =
    sources.planDotBundles.length > 0 || sources.states.length > 0;
  if (view === "rcll" && canUseSemanticView) {
    return "rcll";
  }
  if (view === "strata" && canUseSemanticView) {
    return "strata";
  }
  if (view === "pipeline" && canUseSemanticView) {
    return "pipeline";
  }
  if (view === "semantic" && canUseSemanticView) {
    return "semantic";
  }
  return "module";
};

export type RunTerraformImportFromSourcesArgs = {
  app: AppClassProperties;
  setAppState: SetAppState;
  sources: TerraformPlanParsingSources;
  view: TerraformView;
  moduleLayoutOptions?: TerraformModuleLayoutOptions;
  /** Pipeline view: start with satellites hidden (true, default) or all visible (false). */
  pipelineCompact?: boolean;
  pipelineLayoutVariant?: import("./terraformImportDialogUtils").PipelineLayoutVariant;
  pipelinePacked?: boolean;
  pipelinePackedPullLeft?: boolean;
  pipelineIncludeAncillary?: boolean;
  pipelinePrivateApiRegional?: boolean;
  pipelineSemanticPlacement?: boolean;
  pipelineSwimlaneLaneRise?: boolean;
  pipelineReorder?: boolean;
  pipelineCrossingMin?: boolean;
  pipelineDeBandLevel?: import("./terraformPipelineLayoutProfiles").DeBandLevel;
  pipelineSubnetDeBand?: boolean;
  pipelineRankSeparate?: boolean;
  pipelineStraighten?: boolean;
  pipelineCoordRepack?: boolean;
  pipelineDeDensify?: boolean;
  pipelineColumnPacking?: "spread" | "none" | "compact" | "shorten";
  pipelineLayoutProfile?: import("./terraformPipelineLayoutProfiles").RcllLayoutProfile;
  pipelineStaircaseBandOverlap?: boolean;
  /** Strata (rcll-v2) OD-1: X-axis network-simplex rank refinement. S0a: accepted +
   * threaded, unused until the engine lands (M1). Default off. */
  strataNetworkSimplexRank?: boolean;
  /** Strata OD-2: directional sweep count for A2 ordering. S0a: accepted + threaded,
   * unused until the engine lands (M1). Default 0. */
  strataSweeps?: number;
  /** Strata A7: slice-A coordinate refinement. S0a: accepted + threaded, unused
   * until the engine lands (M1). Default off. */
  strataCoordinateRefine?: boolean;
  /** Strata OD-14: whole-model sibling-separation ranking (the height lever).
   * Default off. */
  strataRankSeparate?: boolean;
  /** Strata round 9 (SDEC-57): packed-hull whole-layout candidate scoring.
   * Default off. */
  strataPackedScoring?: boolean;
  /** Strata W8b: ε-constraint crossings budget for the packed scorer.
   * Default 0 (strict rule). */
  strataPackedScoringEpsilon?: number;
  /** Strata G-DESCENT converge: return the packed scorer's best-seen adopted
   * snapshot instead of the last rolling incumbent. Default off; inert unless
   * `strataPackedScoringEpsilon` >= 1. */
  strataPackedConverge?: boolean;
  /** Strata transitive-adopt: strict total-order adoption gate replacing the
   * ε adoption gate. Default off. */
  strataTransitiveAdopt?: boolean;
  /** P1 leaf-sink pull-in: pull degree-1 sink leaves toward source. Default off. */
  strataSinkPullIn?: boolean;
  /** P4 pure-sink account block clamp: rigid-translate a dead-end account subtree
   * left toward its sources. Default off. */
  strataBlockClamp?: boolean;
  /** Strata Package C spike (W9): post-A7 obstacle-avoiding edge routing.
   * Default off. */
  strataEdgeRouting?: boolean;
  /** Strata W10 (SDEC-63): banded row-share compaction lever. Default off;
   * primarily effective with rankSeparate. LEGACY ALIAS for
   * `strataBandDepth: "root"`. */
  strataBandCompact?: boolean;
  /** Strata v3.2: band-depth slider cut — the deepest role still banded.
   * Default "account" (today's fixed role→policy map, byte-identical). */
  strataBandDepth?: import("./terraformPipelineStrataTypes").StrataHullRole;
  /** OD-15 crossings-≻-length relocate. Default off. */
  strataSiftRelocate?: boolean;
  /** Relocate objective weight on penetrations. Default 1. */
  strataCrossWeightPenetration?: number;
  /** Relocate objective weight on edge-edge crossings. Default 1. */
  strataCrossWeightEdge?: number;
  /** Edge-edge regression cap. Optional — absent inherits
   * `strataPackedScoringEpsilon`. */
  strataEdgeCrossCap?: number;
  importedTfdTexts?: string[];
  preset?: TerraformImportPreset | null;
  signal?: AbortSignal;
  onLayoutProgress?: (progress: TerraformLayoutProgress) => void;
};

export const runTerraformImportWithView = async ({
  app,
  setAppState,
  sources,
  view,
  moduleLayoutOptions = DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
  pipelineCompact,
  pipelineLayoutVariant,
  pipelinePacked,
  pipelinePackedPullLeft,
  pipelineIncludeAncillary,
  pipelinePrivateApiRegional,
  pipelineSemanticPlacement,
  pipelineSwimlaneLaneRise,
  pipelineReorder,
  pipelineCrossingMin,
  pipelineDeBandLevel,
  pipelineSubnetDeBand,
  pipelineRankSeparate,
  pipelineStraighten,
  pipelineCoordRepack,
  pipelineDeDensify,
  pipelineColumnPacking,
  pipelineLayoutProfile,
  pipelineStaircaseBandOverlap,
  strataNetworkSimplexRank,
  strataSweeps,
  strataCoordinateRefine,
  strataRankSeparate,
  strataPackedScoring,
  strataPackedScoringEpsilon,
  strataPackedConverge,
  strataTransitiveAdopt,
  strataSinkPullIn,
  strataBlockClamp,
  strataEdgeRouting,
  strataBandCompact,
  strataBandDepth,
  strataSiftRelocate,
  strataCrossWeightPenetration,
  strataCrossWeightEdge,
  strataEdgeCrossCap,
  importedTfdTexts,
  preset = null,
  signal,
  onLayoutProgress,
}: RunTerraformImportFromSourcesArgs): Promise<RunTerraformImportFromSourcesResult> => {
  const layoutMode = deriveLayoutModeFromView(view, sources);
  const semanticLayout = layoutMode === "semantic";
  const isPipelineFamily =
    layoutMode === "pipeline" ||
    layoutMode === "rcll" ||
    layoutMode === "strata";
  return runTerraformImportFromSources(app, setAppState, sources, {
    semanticLayout,
    layoutMode: isPipelineFamily ? layoutMode : undefined,
    moduleLayoutOptions:
      layoutMode === "module" ? moduleLayoutOptions : undefined,
    ...(isPipelineFamily
      ? {
          pipelineCompact,
          pipelineLayoutVariant,
          pipelinePacked,
          pipelinePackedPullLeft,
          pipelineIncludeAncillary,
          // View-scoping (the SINGLE place non-strata forces the flag off):
          // the private-API regional placement is only wired for the strata
          // view — turning it on for the v2/rcll/compound/classic pipelines
          // introduces collisions/gate failures. So non-strata views ALWAYS
          // pass false regardless of the seed/URL, keeping them byte-identical
          // to today; the strata view passes the caller's value and, when that
          // is absent (a bare `view=strata` demo URL), defaults ON.
          pipelinePrivateApiRegional:
            layoutMode === "strata"
              ? pipelinePrivateApiRegional ?? true
              : false,
          pipelineSemanticPlacement,
          pipelineSwimlaneLaneRise,
          pipelineReorder,
          pipelineCrossingMin,
          pipelineDeBandLevel,
          pipelineSubnetDeBand,
          pipelineRankSeparate,
          pipelineStraighten,
          pipelineCoordRepack,
          pipelineDeDensify,
          pipelineColumnPacking,
          pipelineLayoutProfile,
          pipelineStaircaseBandOverlap,
          strataNetworkSimplexRank,
          strataSweeps,
          strataCoordinateRefine,
          strataRankSeparate,
          strataPackedScoring,
          strataPackedScoringEpsilon,
          strataPackedConverge,
          strataTransitiveAdopt,
          strataSinkPullIn,
          strataBlockClamp,
          strataEdgeRouting,
          strataBandCompact,
          strataBandDepth,
          strataSiftRelocate,
          strataCrossWeightPenetration,
          strataCrossWeightEdge,
          // Optional-only forward: no explicit `undefined` key (absent ⇒ engine
          // inherits `strataPackedScoringEpsilon`).
          ...(strataEdgeCrossCap !== undefined ? { strataEdgeCrossCap } : {}),
        }
      : {}),
    importedTfdTexts,
    preset,
    signal,
    onLayoutProgress,
  });
};

export type RunTerraformPresetImportOptions = {
  view?: TerraformView;
  moduleLayoutOptions?: TerraformModuleLayoutOptions;
  pipelineCompact?: boolean;
  pipelineLayoutVariant?: import("./terraformImportDialogUtils").PipelineLayoutVariant;
  pipelinePacked?: boolean;
  pipelinePackedPullLeft?: boolean;
  pipelineIncludeAncillary?: boolean;
  pipelinePrivateApiRegional?: boolean;
  pipelineSemanticPlacement?: boolean;
  pipelineSwimlaneLaneRise?: boolean;
  pipelineReorder?: boolean;
  pipelineCrossingMin?: boolean;
  pipelineDeBandLevel?: import("./terraformPipelineLayoutProfiles").DeBandLevel;
  pipelineSubnetDeBand?: boolean;
  pipelineRankSeparate?: boolean;
  pipelineStraighten?: boolean;
  pipelineCoordRepack?: boolean;
  pipelineDeDensify?: boolean;
  pipelineColumnPacking?: "spread" | "none" | "compact" | "shorten";
  pipelineLayoutProfile?: import("./terraformPipelineLayoutProfiles").RcllLayoutProfile;
  pipelineStaircaseBandOverlap?: boolean;
  /** Strata (rcll-v2) OD-1/OD-2/A7 flags. S0a: accepted + threaded, unused until
   * the engine lands (M1). All default off/0. */
  strataNetworkSimplexRank?: boolean;
  strataSweeps?: number;
  strataCoordinateRefine?: boolean;
  strataRankSeparate?: boolean;
  strataPackedScoring?: boolean;
  strataPackedScoringEpsilon?: number;
  /** Strata G-DESCENT converge: best-seen adopted snapshot. Default off;
   * inert unless `strataPackedScoringEpsilon` >= 1. */
  strataPackedConverge?: boolean;
  /** Strata transitive-adopt: strict total-order adoption gate. Default off. */
  strataTransitiveAdopt?: boolean;
  /** P1 leaf-sink pull-in: pull degree-1 sink leaves toward source. Default off. */
  strataSinkPullIn?: boolean;
  /** P4 pure-sink account block clamp. Default off. */
  strataBlockClamp?: boolean;
  strataEdgeRouting?: boolean;
  /** LEGACY ALIAS for `strataBandDepth: "root"`. */
  strataBandCompact?: boolean;
  /** Strata v3.2: band-depth slider cut — the deepest role still banded.
   * Default "account" (today's fixed role→policy map, byte-identical). */
  strataBandDepth?: import("./terraformPipelineStrataTypes").StrataHullRole;
  /** OD-15 crossings-≻-length relocate. Default off. */
  strataSiftRelocate?: boolean;
  /** Relocate objective weight on penetrations. Default 1. */
  strataCrossWeightPenetration?: number;
  /** Relocate objective weight on edge-edge crossings. Default 1. */
  strataCrossWeightEdge?: number;
  /** Edge-edge regression cap. Optional — absent inherits
   * `strataPackedScoringEpsilon`. */
  strataEdgeCrossCap?: number;
  signal?: AbortSignal;
  onLayoutProgress?: (progress: TerraformLayoutProgress) => void;
};

export type RunTerraformPresetImportResult =
  RunTerraformImportFromSourcesResult & {
    presetSources: Awaited<ReturnType<typeof loadTerraformImportPresetSources>>;
  };

export const runTerraformPresetImport = async (
  app: AppClassProperties,
  setAppState: SetAppState,
  preset: TerraformImportPreset,
  options: RunTerraformPresetImportOptions = {},
): Promise<RunTerraformPresetImportResult> => {
  const presetSources = await loadTerraformImportPresetSources(preset, {
    allowDirectoryHandleFallback: true,
  });
  const view = options.view ?? preset.view;
  const moduleLayoutOptions =
    options.moduleLayoutOptions ?? DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS;
  const sources: TerraformPlanParsingSources = {
    planDotBundles: presetSources.planDotBundles,
    states: presetSources.states,
    stateLabels: presetSources.stateLabels,
    tfdTexts: presetSources.tfdTexts,
    tfdLabels: presetSources.tfdLabels,
    repoName: presetSources.repoName,
    stackCatalog: presetSources.stackCatalog,
    warnings: presetSources.warnings,
  };
  const result = await runTerraformImportWithView({
    app,
    setAppState,
    sources,
    view,
    moduleLayoutOptions,
    pipelineCompact: options.pipelineCompact,
    pipelineLayoutVariant: options.pipelineLayoutVariant,
    pipelinePacked: options.pipelinePacked,
    pipelinePackedPullLeft: options.pipelinePackedPullLeft,
    pipelineIncludeAncillary: options.pipelineIncludeAncillary,
    pipelinePrivateApiRegional: options.pipelinePrivateApiRegional,
    pipelineSemanticPlacement: options.pipelineSemanticPlacement,
    pipelineSwimlaneLaneRise: options.pipelineSwimlaneLaneRise,
    pipelineReorder: options.pipelineReorder,
    pipelineCrossingMin: options.pipelineCrossingMin,
    pipelineDeBandLevel: options.pipelineDeBandLevel,
    pipelineSubnetDeBand: options.pipelineSubnetDeBand,
    pipelineRankSeparate: options.pipelineRankSeparate,
    pipelineStraighten: options.pipelineStraighten,
    pipelineCoordRepack: options.pipelineCoordRepack,
    pipelineDeDensify: options.pipelineDeDensify,
    pipelineColumnPacking: options.pipelineColumnPacking,
    pipelineLayoutProfile: options.pipelineLayoutProfile,
    pipelineStaircaseBandOverlap: options.pipelineStaircaseBandOverlap,
    strataNetworkSimplexRank: options.strataNetworkSimplexRank,
    strataSweeps: options.strataSweeps,
    strataCoordinateRefine: options.strataCoordinateRefine,
    strataRankSeparate: options.strataRankSeparate,
    strataPackedScoring: options.strataPackedScoring,
    strataPackedScoringEpsilon: options.strataPackedScoringEpsilon,
    strataPackedConverge: options.strataPackedConverge,
    strataTransitiveAdopt: options.strataTransitiveAdopt,
    strataSinkPullIn: options.strataSinkPullIn,
    strataBlockClamp: options.strataBlockClamp,
    strataEdgeRouting: options.strataEdgeRouting,
    strataBandCompact: options.strataBandCompact,
    strataBandDepth: options.strataBandDepth,
    strataSiftRelocate: options.strataSiftRelocate,
    strataCrossWeightPenetration: options.strataCrossWeightPenetration,
    strataCrossWeightEdge: options.strataCrossWeightEdge,
    // Optional-only forward: no explicit `undefined` key (absent ⇒ engine
    // inherits `strataPackedScoringEpsilon`).
    ...(options.strataEdgeCrossCap !== undefined
      ? { strataEdgeCrossCap: options.strataEdgeCrossCap }
      : {}),
    importedTfdTexts: presetSources.tfdTexts,
    preset,
    signal: options.signal,
    onLayoutProgress: options.onLayoutProgress,
  });
  return { ...result, presetSources };
};

export type TerraformPresetImportSideEffects = {
  extraWarnings?: TerraformImportPresetWarning[];
};

export const resolveModuleLayoutOptionsForDemo = (
  pack?: TerraformModuleLayoutOptions["mode"],
): TerraformModuleLayoutOptions =>
  pack
    ? resolveTerraformModuleLayoutOptions({ mode: pack })
    : DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS;
