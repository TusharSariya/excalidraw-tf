import type { ExcalidrawElement } from "@excalidraw/element/types";

import { restoreElements } from "../data/restore";

import { applyTerraformRelationshipFocus } from "./terraformRelationshipFocus";
import {
  buildTerraformReconcileOptionsForAppState,
  reconcileTerraformVisibility,
  repairTerraformEdgeBindings,
} from "./terraformVisibility";
import {
  DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS,
  type TerraformModuleLayoutOptions,
} from "./terraformModuleLayoutOptions";
import { fetchPresetLayoutCache } from "./terraformLayoutCacheClient";
import { layoutTerraformViaWorkers } from "./terraformLayoutWorkerClient";
import { computeStrataTombstones } from "./terraformPipelineStrataFinalize";

import {
  type TerraformImportWarning,
  type TerraformPlanParsingSources,
} from "./terraformPlanParsing";
import { loadTerraformImportPresetSources } from "./terraformImportPresetLoader";
import { terraformImportPrepFingerprint } from "./terraformImportPrepCache";
import { TERRAFORM_LOD_DEFAULT_PRESET } from "./terraformLod";
import {
  cloneTerraformElementsForSnapshot,
  getTerraformImportSession,
  setTerraformImportSession,
} from "./terraformImportSession";
import {
  TERRAFORM_COLOR_MODE_DEFAULT,
  applyTerraformColorModeToElements,
  type TerraformColorMode,
} from "./terraformPrimaryVisibility";

import type { TerraformLayoutProgress } from "./terraformLayoutWorkerTypes";

import type React from "react";

import type { TerraformImportPreset } from "./terraformImportPresetsTypes";
import type { TerraformImportSession } from "./terraformImportSession";
import type { TerraformView } from "./terraformImportDialogUtils";
import type { AppClassProperties, AppState, BinaryFileData } from "../types";

type SetAppState = React.Component<any, AppState>["setState"];

export type TerraformExcalidrawScenePayload = {
  elements?: unknown;
  files?: Record<string, BinaryFileData>;
  meta?: {
    importWarnings?: TerraformImportWarning[];
    /** Strata A6 generation echo (OD-7) — consumed by the tombstone pass. */
    strataGeneration?: number;
  };
};

export type ApplyTerraformExcalidrawSceneOptions = {
  enableDeclaredDataFlow?: boolean;
  terraformEdgeLayerPins?: AppState["terraformEdgeLayerPins"];
  terraformLodEnabled?: boolean;
  terraformLodPreset?: AppState["terraformLodPreset"];
  scrollToContent?: boolean;
};

const defaultTerraformEdgeLayerPins = (
  enableDeclaredDataFlow: boolean,
): NonNullable<AppState["terraformEdgeLayerPins"]> => ({
  dependency: false,
  dataFlow: false,
  declaredDataFlow: enableDeclaredDataFlow,
  networking: false,
  topologyFrameFlow: false,
});

export const applyTerraformExcalidrawScene = (
  app: AppClassProperties,
  setAppState: SetAppState,
  scene: TerraformExcalidrawScenePayload,
  options: ApplyTerraformExcalidrawSceneOptions = {},
) => {
  const files = scene.files;
  if (files && typeof files === "object") {
    const list = Object.values(files).filter((entry): entry is BinaryFileData =>
      Boolean(
        entry &&
          typeof entry === "object" &&
          typeof entry.id === "string" &&
          typeof entry.dataURL === "string",
      ),
    );
    if (list.length > 0) {
      app.addFiles(list);
    }
  }

  const enableDeclaredDataFlow = Boolean(options.enableDeclaredDataFlow);
  const terraformEdgeLayerPins =
    options.terraformEdgeLayerPins ??
    defaultTerraformEdgeLayerPins(enableDeclaredDataFlow);

  const elements = restoreElements(
    scene.elements as readonly ExcalidrawElement[] | null | undefined,
    null,
    {
      repairBindings: true,
    },
  );
  // W11 WP1: 4th-arg options are behavior-neutral here — `focusNodePath` is
  // null, so `getTerraformRelationshipFocus` short-circuits before any
  // direction/hop-cap branch is reached. Explicit `undefined` kept for call-site
  // signature consistency with the runtime-effect callers.
  const focus = applyTerraformRelationshipFocus(
    elements,
    null,
    app.state.viewBackgroundColor ?? "#ffffff",
    undefined,
  );
  const pinReconcile = buildTerraformReconcileOptionsForAppState(
    terraformEdgeLayerPins,
    null,
  );
  let nextElements = focus.elements;
  if (pinReconcile) {
    nextElements = reconcileTerraformVisibility(
      focus.shouldRepairBindings
        ? repairTerraformEdgeBindings(nextElements)
        : nextElements,
      pinReconcile,
    );
  } else if (focus.shouldRepairBindings) {
    nextElements = repairTerraformEdgeBindings(nextElements);
  }
  // Strata A6 tombstones (STRATA-SCOPED ONLY, spec §6-A6): when the incoming
  // scene is a finalized strata scene (canonical ids present),
  // removed = prevSceneAddresses − newAddresses is materialized as tombstones
  // (canonical id, isDeleted: true, version = G) appended to the
  // replaceAllElements payload; they persist one generation window. For every
  // non-strata scene `computeStrataTombstones` returns [] and the payload is
  // byte-unchanged (D2′). The pre-regenerate scene is in hand — no store
  // needed. (Optional call: some embedding tests mock a minimal scene.)
  const tombstones = computeStrataTombstones(
    app.scene.getElementsIncludingDeleted?.() ?? [],
    nextElements,
    scene.meta?.strataGeneration,
  );
  if (tombstones.length > 0) {
    nextElements = [...nextElements, ...tombstones];
  }
  app.scene.replaceAllElements(nextElements);
  setAppState({
    terraformEdgeLayerPins,
    terraformEdgeHoverPeekKey: null,
    terraformLodEnabled: options.terraformLodEnabled ?? true,
    terraformLodPreset:
      options.terraformLodPreset ?? TERRAFORM_LOD_DEFAULT_PRESET,
  });
  if (options.scrollToContent !== false) {
    app.scrollToContent();
  }

  return {
    elements: nextElements,
    terraformEdgeLayerPins,
    enableDeclaredDataFlow,
  };
};

export type RunTerraformImportFromSourcesOptions = {
  semanticLayout: boolean;
  layoutMode?: import("./terraformImportDialogUtils").TerraformLayoutMode;
  moduleLayoutOptions?: TerraformModuleLayoutOptions;
  /** Pipeline compact mode — primary-card-only clusters, satellites added on click. Default true. */
  pipelineCompact?: boolean;
  /** Zoom LOD — hide labels/satellites when zoomed out. Default true. */
  terraformLodEnabled?: boolean;
  terraformLodPreset?: AppState["terraformLodPreset"];
  pipelineLayoutVariant?: import("./terraformImportDialogUtils").PipelineLayoutVariant;
  /** Pipeline packed mode — push sink-only groups right and re-pack lanes in Y. Default false. */
  pipelinePacked?: boolean;
  /** Packed only — pull slack clusters to their leftmost TFD-feasible column. Default false. */
  pipelinePackedPullLeft?: boolean;
  /** Pipeline — draw non-TFD resources in per-hull "Unconnected" strips. Default false. */
  pipelineIncludeAncillary?: boolean;
  /** Pipeline — private VPC-endpoint-bound REST APIs placed at region level. Default false. */
  pipelinePrivateApiRegional?: boolean;
  /** Pipeline — nesting-aware semantic placement (forced bands + straightening). Default false. */
  pipelineSemanticPlacement?: boolean;
  /** RCLL M4 — X-disjoint swimlane lanes rise to share Y rows. Default false. */
  pipelineSwimlaneLaneRise?: boolean;
  /** RCLL M6 — per-container barycenter crossing-min reorder. Default false. */
  pipelineReorder?: boolean;
  /** RCLL M6c — container-aware crossing minimization (superset of reorder). Default false. */
  pipelineCrossingMin?: boolean;
  /** RCLL de-band depth — dissolve the chosen container level + all deeper levels into one
   * shared column stack. Default "none" (today's boxed layout). */
  pipelineDeBandLevel?: import("./terraformPipelineLayoutProfiles").DeBandLevel;
  /** Back-compat alias for `pipelineDeBandLevel: "subnet"`. `pipelineDeBandLevel` wins. */
  pipelineSubnetDeBand?: boolean;
  /** RCLL M8r — whole-model-global sibling-separation ranking (needs lane-rise). Default false. */
  pipelineRankSeparate?: boolean;
  /** RCLL M5 — Brandes–Köpf leaf straightening. Default false. */
  pipelineStraighten?: boolean;
  /** RCLL M5b — coordinated per-column permutation re-pack (refines straighten). Default false. */
  pipelineCoordRepack?: boolean;
  /** RCLL M5b — de-density: spread crowded columns. Default false. */
  pipelineDeDensify?: boolean;
  /** RCLL "Column packing" tri-state: `spread` (M5b) / `none` / `compact` (M5c). */
  pipelineColumnPacking?: "spread" | "none" | "compact" | "shorten";
  /** RCLL "Layout" profile — `readable | balanced | compact` (expands into the RCLL flags;
   * `balanced` = today's defaults). An explicit individual flag overrides it. */
  pipelineLayoutProfile?: import("./terraformPipelineLayoutProfiles").RcllLayoutProfile;
  /** RCLL M3b / DEC-1 — X-disjoint cycle groups rise to share Y. Default on (undefined). */
  pipelineStaircaseBandOverlap?: boolean;
  /** Strata (rcll-v2) OD-1 — X-axis network-simplex rank refinement. S0a: accepted +
   * threaded, unused until the engine lands (M1). Default off. */
  strataNetworkSimplexRank?: boolean;
  /** Strata OD-2 — directional sweep count for A2 ordering. S0a: accepted + threaded,
   * unused until the engine lands (M1). Default 0. */
  strataSweeps?: number;
  /** Strata A7 — slice-A coordinate refinement. S0a: accepted + threaded, unused
   * until the engine lands (M1). Default off. */
  strataCoordinateRefine?: boolean;
  /** Strata OD-14 — whole-model sibling-separation ranking (the height lever).
   * Default off. */
  strataRankSeparate?: boolean;
  /** Strata round 9 (SDEC-57): packed-hull whole-layout candidate scoring.
   * Default off. */
  strataPackedScoring?: boolean;
  /** Strata W8b: ε-constraint crossings budget for the packed scorer.
   * Default 0 (strict rule; inert without `strataPackedScoring`). */
  strataPackedScoringEpsilon?: number;
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
  /** G-DESCENT remedy: the packed-scoring descent returns the best-seen
   * ADOPTED snapshot instead of the rolling incumbent. Default off; inert at
   * ε=0. */
  strataPackedConverge?: boolean;
  /** Transitive-adopt remedy: strict total-order adoption gate replacing the
   * ε adoption gate. Default off. */
  strataTransitiveAdopt?: boolean;
  /** P1 leaf-sink pull-in: pull degree-1 sink leaves toward source. Default off. */
  strataSinkPullIn?: boolean;
  /** P4 pure-sink account block clamp: rigid-translate a dead-end account subtree
   * left toward its sources. Default off. */
  strataBlockClamp?: boolean;
  /** P2 within-column transpose: swap Y-adjacent X-overlapping sibling pairs to
   * remove leftover diagonal crossings. Default off. */
  strataTranspose?: boolean;
  /** Frame tint mode for pipeline/semantic topology views. */
  colorMode?: TerraformColorMode;
  importedTfdTexts?: string[];
  preset?: TerraformImportPreset | null;
  updateSession?: boolean;
  scrollToContent?: boolean;
  onLayoutProgress?: (progress: TerraformLayoutProgress) => void;
  signal?: AbortSignal;
};

export type RunTerraformImportFromSourcesResult = {
  importWarnings?: TerraformImportWarning[];
  /** Strata (rcll-v2) failure-contract fallback marker (v3.0 §8.4 / v3.1 §5). Not
   * yet emitted by any engine at S0a (the failure-contract wrapper lands with the
   * engine in W2) — the field + demo-UI badge are wired ahead of that landing. */
  rcllV2Degraded?: { stage: string; reason: string } | null;
};

export const terraformPipelineReplayOptionsFromSession = (
  session: TerraformImportSession,
): Pick<
  RunTerraformImportFromSourcesOptions,
  | "pipelineLayoutVariant"
  | "pipelinePacked"
  | "pipelinePackedPullLeft"
  | "pipelineIncludeAncillary"
  | "pipelinePrivateApiRegional"
  | "pipelineSemanticPlacement"
  | "pipelineSwimlaneLaneRise"
  | "pipelineReorder"
  | "pipelineCrossingMin"
  | "pipelineDeBandLevel"
  | "pipelineRankSeparate"
  | "pipelineStraighten"
  | "pipelineCoordRepack"
  | "pipelineDeDensify"
  | "pipelineColumnPacking"
  | "pipelineLayoutProfile"
  | "pipelineStaircaseBandOverlap"
  | "strataNetworkSimplexRank"
  | "strataSweeps"
  | "strataCoordinateRefine"
  | "strataRankSeparate"
  | "strataPackedScoring"
  | "strataPackedScoringEpsilon"
  | "strataEdgeRouting"
  | "strataBandCompact"
  | "strataBandDepth"
  | "strataSiftRelocate"
  | "strataCrossWeightPenetration"
  | "strataCrossWeightEdge"
  | "strataEdgeCrossCap"
  | "strataPackedConverge"
  | "strataTransitiveAdopt"
  | "strataSinkPullIn"
  | "strataBlockClamp"
  | "strataTranspose"
> => ({
  pipelineLayoutVariant:
    session.layoutMode === "rcll"
      ? "rcll"
      : session.layoutMode === "strata"
      ? "strata"
      : session.pipelineLayoutVariant ?? "classic",
  pipelinePacked: session.pipelinePacked === true,
  pipelinePackedPullLeft: session.pipelinePackedPullLeft === true,
  pipelineIncludeAncillary: session.pipelineIncludeAncillary === true,
  pipelinePrivateApiRegional: session.pipelinePrivateApiRegional === true,
  pipelineSemanticPlacement: session.pipelineSemanticPlacement === true,
  pipelineSwimlaneLaneRise: session.pipelineSwimlaneLaneRise === true,
  pipelineReorder: session.pipelineReorder === true,
  pipelineCrossingMin: session.pipelineCrossingMin === true,
  pipelineDeBandLevel:
    session.pipelineDeBandLevel ??
    (session.pipelineSubnetDeBand ? "subnet" : "none"),
  pipelineRankSeparate: session.pipelineRankSeparate === true,
  pipelineStraighten: session.pipelineStraighten === true,
  pipelineCoordRepack: session.pipelineCoordRepack === true,
  pipelineDeDensify: session.pipelineDeDensify === true,
  pipelineColumnPacking: session.pipelineColumnPacking,
  pipelineLayoutProfile: session.pipelineLayoutProfile,
  pipelineStaircaseBandOverlap: session.pipelineStaircaseBandOverlap,
  strataNetworkSimplexRank: session.strataNetworkSimplexRank === true,
  strataSweeps: session.strataSweeps ?? 0,
  strataCoordinateRefine: session.strataCoordinateRefine === true,
  strataRankSeparate: session.strataRankSeparate === true,
  strataPackedScoring: session.strataPackedScoring === true,
  strataPackedScoringEpsilon: session.strataPackedScoringEpsilon ?? 0,
  strataEdgeRouting: session.strataEdgeRouting === true,
  strataBandCompact: session.strataBandCompact === true,
  // Raw forward — omit at default ("account")/absent so a replayed session
  // never re-materializes a default cut. A bare `strataBandCompact` session
  // (no enum) thus reaches the engine as bandCompact-only, and the engine
  // alias resolves it to "root". Non-default cuts forward.
  ...(session.strataBandDepth !== undefined &&
  session.strataBandDepth !== "account"
    ? { strataBandDepth: session.strataBandDepth }
    : {}),
  strataSiftRelocate: session.strataSiftRelocate === true,
  strataCrossWeightPenetration: session.strataCrossWeightPenetration ?? 1,
  strataCrossWeightEdge: session.strataCrossWeightEdge ?? 1,
  // Optional-only forward: no default materialized (absent ⇒ engine
  // inherits `strataPackedScoringEpsilon`).
  ...(session.strataEdgeCrossCap !== undefined
    ? { strataEdgeCrossCap: session.strataEdgeCrossCap }
    : {}),
  strataPackedConverge: session.strataPackedConverge === true,
  strataTransitiveAdopt: session.strataTransitiveAdopt === true,
  strataSinkPullIn: session.strataSinkPullIn === true,
  strataBlockClamp: session.strataBlockClamp === true,
  strataTranspose: session.strataTranspose === true,
});

/**
 * Pipeline/RCLL/Strata option-forwarding literal shared by the engine-layout
 * request (`layoutTerraformSceneFromSources`) and the session-snapshot
 * request (`runTerraformImportFromSources`, on `updateSession`). Both call
 * sites must forward byte-identical option sets — this is the single source
 * of truth. Returns `{}` outside the pipeline family; every field here is
 * optional on `RunTerraformImportFromSourcesOptions`, so `{}` is a valid
 * value of the return type.
 */
function buildPipelineFamilyLayoutOptions(
  layoutMode: import("./terraformImportDialogUtils").TerraformLayoutMode,
  options: RunTerraformImportFromSourcesOptions,
): Pick<
  RunTerraformImportFromSourcesOptions,
  | "pipelineCompact"
  | "pipelineLayoutVariant"
  | "pipelinePacked"
  | "pipelinePackedPullLeft"
  | "pipelineIncludeAncillary"
  | "pipelinePrivateApiRegional"
  | "pipelineSemanticPlacement"
  | "pipelineSwimlaneLaneRise"
  | "pipelineReorder"
  | "pipelineCrossingMin"
  | "pipelineDeBandLevel"
  | "pipelineRankSeparate"
  | "pipelineStraighten"
  | "pipelineCoordRepack"
  | "pipelineDeDensify"
  | "pipelineColumnPacking"
  | "pipelineLayoutProfile"
  | "pipelineStaircaseBandOverlap"
  | "strataNetworkSimplexRank"
  | "strataSweeps"
  | "strataCoordinateRefine"
  | "strataRankSeparate"
  | "strataPackedScoring"
  | "strataPackedScoringEpsilon"
  | "strataEdgeRouting"
  | "strataBandCompact"
  | "strataBandDepth"
  | "strataSiftRelocate"
  | "strataCrossWeightPenetration"
  | "strataCrossWeightEdge"
  | "strataEdgeCrossCap"
  | "strataPackedConverge"
  | "strataTransitiveAdopt"
  | "strataSinkPullIn"
  | "strataBlockClamp"
  | "strataTranspose"
> {
  if (
    layoutMode !== "pipeline" &&
    layoutMode !== "rcll" &&
    layoutMode !== "strata"
  ) {
    return {};
  }
  return {
    pipelineCompact: options.pipelineCompact !== false,
    pipelineLayoutVariant:
      layoutMode === "rcll"
        ? "rcll"
        : layoutMode === "strata"
        ? "strata"
        : options.pipelineLayoutVariant ?? "classic",
    pipelinePacked: options.pipelinePacked === true,
    pipelinePackedPullLeft: options.pipelinePackedPullLeft === true,
    pipelineIncludeAncillary: options.pipelineIncludeAncillary === true,
    pipelinePrivateApiRegional: options.pipelinePrivateApiRegional === true,
    pipelineSemanticPlacement: options.pipelineSemanticPlacement === true,
    pipelineSwimlaneLaneRise: options.pipelineSwimlaneLaneRise === true,
    pipelineReorder: options.pipelineReorder === true,
    pipelineCrossingMin: options.pipelineCrossingMin === true,
    pipelineDeBandLevel:
      options.pipelineDeBandLevel ??
      (options.pipelineSubnetDeBand ? "subnet" : "none"),
    pipelineRankSeparate: options.pipelineRankSeparate === true,
    pipelineStraighten: options.pipelineStraighten === true,
    pipelineCoordRepack: options.pipelineCoordRepack === true,
    pipelineDeDensify: options.pipelineDeDensify === true,
    pipelineColumnPacking: options.pipelineColumnPacking,
    pipelineLayoutProfile: options.pipelineLayoutProfile,
    // Default-on: undefined ⇒ engine default (true). Only an explicit
    // false (Stacked) flows through.
    pipelineStaircaseBandOverlap: options.pipelineStaircaseBandOverlap,
    strataNetworkSimplexRank: options.strataNetworkSimplexRank === true,
    strataSweeps: options.strataSweeps ?? 0,
    strataCoordinateRefine: options.strataCoordinateRefine === true,
    strataRankSeparate: options.strataRankSeparate === true,
    strataPackedScoring: options.strataPackedScoring === true,
    strataPackedScoringEpsilon: options.strataPackedScoringEpsilon ?? 0,
    strataEdgeRouting: options.strataEdgeRouting === true,
    strataBandCompact: options.strataBandCompact === true,
    // Raw forward — omit at default ("account")/absent so neither the engine
    // request nor the persisted session snapshot carries a default cut key.
    // Non-default cuts forward.
    ...(options.strataBandDepth !== undefined &&
    options.strataBandDepth !== "account"
      ? { strataBandDepth: options.strataBandDepth }
      : {}),
    strataSiftRelocate: options.strataSiftRelocate === true,
    strataCrossWeightPenetration: options.strataCrossWeightPenetration ?? 1,
    strataCrossWeightEdge: options.strataCrossWeightEdge ?? 1,
    // Optional-only forward: no default materialized (absent ⇒ engine
    // inherits `strataPackedScoringEpsilon`).
    ...(options.strataEdgeCrossCap !== undefined
      ? { strataEdgeCrossCap: options.strataEdgeCrossCap }
      : {}),
    strataPackedConverge: options.strataPackedConverge === true,
    strataTransitiveAdopt: options.strataTransitiveAdopt === true,
    strataSinkPullIn: options.strataSinkPullIn === true,
    strataBlockClamp: options.strataBlockClamp === true,
    strataTranspose: options.strataTranspose === true,
  };
}

async function layoutTerraformSceneFromSources(
  sources: TerraformPlanParsingSources,
  options: RunTerraformImportFromSourcesOptions,
  layoutMode: import("./terraformImportDialogUtils").TerraformLayoutMode,
  moduleLayoutOptions: TerraformModuleLayoutOptions,
): Promise<TerraformExcalidrawScenePayload> {
  const presetId = options.preset?.id?.trim();
  // Packed and ancillary pipeline scenes are not part of the KV layout cache
  // key yet; skip the cache so such imports never return the default layout.
  // RCLL and Strata are never cached (RCLL M0 delegates + Strata S0a
  // passthrough; neither has a cache key for its dials yet).
  const skipLayoutCache =
    layoutMode === "rcll" ||
    layoutMode === "strata" ||
    (layoutMode === "pipeline" &&
      (options.pipelineLayoutVariant === "v2" ||
        options.pipelinePacked === true ||
        options.pipelinePackedPullLeft === true ||
        options.pipelineIncludeAncillary === true ||
        options.pipelinePrivateApiRegional === true ||
        options.pipelineSemanticPlacement === true));
  if (presetId && !skipLayoutCache) {
    const cached = await fetchPresetLayoutCache(
      presetId,
      layoutMode as TerraformView,
      layoutMode === "module" ? moduleLayoutOptions : undefined,
      { signal: options.signal },
    );
    if (cached) {
      return cached;
    }
  }

  return layoutTerraformViaWorkers(
    sources,
    {
      semanticLayout: options.semanticLayout,
      ...(options.layoutMode ? { layoutMode } : {}),
      moduleLayoutOptions:
        layoutMode === "module" ? moduleLayoutOptions : undefined,
      ...buildPipelineFamilyLayoutOptions(layoutMode, options),
      colorMode: options.colorMode ?? TERRAFORM_COLOR_MODE_DEFAULT,
    },
    {
      onProgress: options.onLayoutProgress,
      signal: options.signal,
    },
  );
}

export const runTerraformImportFromSources = async (
  app: AppClassProperties,
  setAppState: SetAppState,
  sources: TerraformPlanParsingSources,
  options: RunTerraformImportFromSourcesOptions,
): Promise<RunTerraformImportFromSourcesResult> => {
  const moduleLayoutOptions =
    options.moduleLayoutOptions ?? DEFAULT_TERRAFORM_MODULE_LAYOUT_OPTIONS;
  const layoutMode: import("./terraformImportDialogUtils").TerraformLayoutMode =
    options.layoutMode ?? (options.semanticLayout ? "semantic" : "module");
  const sourceFingerprint = terraformImportPrepFingerprint(sources);
  const importedTfdTexts = options.importedTfdTexts ?? [];
  const enableDeclaredDataFlow = importedTfdTexts.some((t) => t.trim());

  const scene = await layoutTerraformSceneFromSources(
    sources,
    options,
    layoutMode,
    moduleLayoutOptions,
  );

  const { elements, terraformEdgeLayerPins } = applyTerraformExcalidrawScene(
    app,
    setAppState,
    scene,
    {
      enableDeclaredDataFlow,
      scrollToContent: options.scrollToContent,
      terraformLodEnabled: options.terraformLodEnabled !== false,
      terraformLodPreset:
        options.terraformLodPreset ?? TERRAFORM_LOD_DEFAULT_PRESET,
    },
  );

  if (options.updateSession !== false) {
    const nextSnapshot = {
      elements: cloneTerraformElementsForSnapshot(elements),
      terraformEdgeLayerPins,
      enableDeclaredDataFlow,
    };
    setTerraformImportSession({
      sources,
      sourceFingerprint,
      semanticLayout: options.semanticLayout,
      ...(options.layoutMode ? { layoutMode } : {}),
      moduleLayoutOptions,
      terraformLodEnabled: options.terraformLodEnabled !== false,
      terraformLodPreset:
        options.terraformLodPreset ?? TERRAFORM_LOD_DEFAULT_PRESET,
      ...buildPipelineFamilyLayoutOptions(layoutMode, options),
      colorMode: options.colorMode ?? TERRAFORM_COLOR_MODE_DEFAULT,
      preset: options.preset ?? null,
      importedTfdTexts,
      snapshot: nextSnapshot,
    });
  }

  const sceneMeta = (
    scene as {
      meta?: {
        importWarnings?: TerraformImportWarning[];
        rcllV2Degraded?: { stage: string; reason: string };
      };
    }
  ).meta;

  return {
    importWarnings: sceneMeta?.importWarnings,
    rcllV2Degraded: sceneMeta?.rcllV2Degraded ?? null,
  };
};

export const resetTerraformLayout = (
  app: AppClassProperties,
  setAppState: SetAppState,
): boolean => {
  const session = getTerraformImportSession();
  if (!session) {
    return false;
  }

  const { snapshot } = session;
  const colorMode = session.colorMode ?? TERRAFORM_COLOR_MODE_DEFAULT;
  const elements = applyTerraformColorModeToElements(
    cloneTerraformElementsForSnapshot(snapshot.elements),
    colorMode,
  );
  applyTerraformExcalidrawScene(
    app,
    setAppState,
    { elements },
    {
      enableDeclaredDataFlow: snapshot.enableDeclaredDataFlow,
      terraformEdgeLayerPins: snapshot.terraformEdgeLayerPins,
      terraformLodEnabled: session.terraformLodEnabled !== false,
      terraformLodPreset:
        session.terraformLodPreset ?? TERRAFORM_LOD_DEFAULT_PRESET,
    },
  );
  return true;
};

export const refreshTerraformLayout = async (
  app: AppClassProperties,
  setAppState: SetAppState,
): Promise<RunTerraformImportFromSourcesResult> => {
  const session = getTerraformImportSession();
  if (!session) {
    throw new Error("No Terraform import session — import a scene first.");
  }

  let sources = session.sources;
  let importedTfdTexts = session.importedTfdTexts;

  if (session.preset) {
    const presetSources = await loadTerraformImportPresetSources(
      session.preset,
      { allowDirectoryHandleFallback: true },
    );
    sources = {
      planDotBundles: presetSources.planDotBundles,
      states: presetSources.states,
      stateLabels: presetSources.stateLabels,
      tfdTexts: presetSources.tfdTexts,
      tfdLabels: presetSources.tfdLabels,
    };
    importedTfdTexts = presetSources.tfdTexts;
  }

  return runTerraformImportFromSources(app, setAppState, sources, {
    semanticLayout: session.semanticLayout,
    layoutMode: session.layoutMode,
    moduleLayoutOptions: session.moduleLayoutOptions,
    pipelineCompact: session.pipelineCompact,
    ...terraformPipelineReplayOptionsFromSession(session),
    colorMode: session.colorMode,
    terraformLodEnabled: session.terraformLodEnabled,
    terraformLodPreset:
      session.terraformLodPreset ?? TERRAFORM_LOD_DEFAULT_PRESET,
    importedTfdTexts,
    preset: session.preset,
  });
};
