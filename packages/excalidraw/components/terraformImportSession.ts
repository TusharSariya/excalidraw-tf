import type { ExcalidrawElement } from "@excalidraw/element/types";

import { clearTerraformImportPrepCache } from "./terraformImportPrepCache";

import type { TerraformImportPreset } from "./terraformImportPresetsTypes";
import type { TerraformPlanParsingSources } from "./terraformPlanParsing";

import type { AppState } from "../types";

import type { TerraformModuleLayoutOptions } from "./terraformModuleLayoutOptions";
import type { TerraformColorMode } from "./terraformPrimaryVisibility";

export type TerraformImportSessionSnapshot = {
  elements: readonly ExcalidrawElement[];
  terraformEdgeLayerPins: AppState["terraformEdgeLayerPins"];
  enableDeclaredDataFlow: boolean;
};

export type TerraformImportSession = {
  sources: TerraformPlanParsingSources;
  sourceFingerprint?: string;
  semanticLayout: boolean;
  layoutMode?: import("./terraformImportDialogUtils").TerraformLayoutMode;
  moduleLayoutOptions: TerraformModuleLayoutOptions;
  /** Pipeline compact mode — primary-card-only clusters, satellites added on click. */
  pipelineCompact?: boolean;
  /** Zoom LOD — hide labels/satellites when zoomed out. Default true. */
  terraformLodEnabled?: boolean;
  /** LOD preset — performance / balanced / detailed. Default balanced. */
  terraformLodPreset?: import("./terraformLod").TerraformLodPreset;
  /** Overview minimap for large scenes. Default false (feature flag). */
  terraformMinimapEnabled?: boolean;
  /** Surviving engine variant — `"v2"` (Strata substrate) or `"strata"`. */
  pipelineLayoutVariant?: import("./terraformImportDialogUtils").PipelineLayoutVariant;
  /** Pipeline — draw non-TFD resources in per-hull "Unconnected" strips. */
  pipelineIncludeAncillary?: boolean;
  /** Pipeline — private VPC-endpoint-bound REST APIs placed at region level. */
  pipelinePrivateApiRegional?: boolean;
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
  /** Strata round 9 (SDEC-57): packed-hull whole-layout candidate scoring. */
  strataPackedScoring?: boolean;
  /** Strata W8b: ε-constraint crossings budget for the packed scorer (0 = strict). */
  strataPackedScoringEpsilon?: number;
  /** Strata probe P2 edge render style. Default "straight" (byte-identical). */
  strataEdgeStyle?: "straight" | "curve";
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
  /** P4 pure-sink account block clamp: rigid-translate a whole dead-end account
   * subtree left toward its sources. Default off. */
  strataBlockClamp?: boolean;
  /** P2 within-column transpose: swap Y-adjacent X-overlapping sibling pairs to
   * remove leftover diagonal crossings. Default off. */
  strataTranspose?: boolean;
  /** Box-endpoint anchoring (M5 threading + M6 geometry): edge endpoints
   * terminate on the labeled leaf-cluster frame border instead of the resource
   * card. Default off. */
  strataBoxEndpoints?: boolean;
  /** Exclusive-downstream chain relocate: post-A7 rigid Y co-translation of a
   * unit with its incoming-dominated downstream group. Default off. */
  strataChainRelocate?: boolean;
  /** A7 tie-cascade: net-zero column escape + chase inside coordinate refine.
   * Default off. */
  strataCoordCascade?: boolean;
  strataHeightGate?: boolean;
  /** A01 post-A7 degree-1 pure-sink leaf X-shift toward its source. Default off. */
  strataLeafShift?: boolean;
  /** A01 leaf-shift absolute per-hull slack height budget (px). Default 150. */
  strataLeafShiftHeightBudgetPx?: number;
  /** A01 leaf-shift relative per-hull slack height budget (fraction). Default 0.01. */
  strataLeafShiftHeightBudgetFrac?: number;
  /** A01 leaf-shift max ranks a leaf may move toward its source. Default 8. */
  strataLeafShiftRankBudget?: number;
  /** A01 leaf-shift right-edge column guard (px), floored at the cohort distance. */
  strataLeafShiftRightEdgeGuardPx?: number;
  /** OD-15 de-band port: dissolve this hierarchy level and every deeper one at
   * the Strata model build (structure phase). Default "none" (byte-identical);
   * suppressed when the absorbing parent stays banded under `strataBandDepth`. */
  strataDeBandLevel?: import("./terraformPipelineLayoutProfiles").DeBandLevel;
  /** E3.3 inter-column gutter override (px). Default off ⇒ 150. */
  strataColumnGap?: number;
  /** E3.3 row-gap scale factor. Default off ⇒ 1. */
  strataRowGap?: number;
  /** Frame tint mode: category/hierarchy vs plan-action default frames. */
  colorMode?: TerraformColorMode;
  preset: TerraformImportPreset | null;
  importedTfdTexts: string[];
  snapshot: TerraformImportSessionSnapshot;
};

let activeSession: TerraformImportSession | null = null;

export const cloneTerraformElementsForSnapshot = (
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] => structuredClone(elements) as ExcalidrawElement[];

export const setTerraformImportSession = (session: TerraformImportSession) => {
  activeSession = {
    ...session,
    snapshot: {
      ...session.snapshot,
      elements: cloneTerraformElementsForSnapshot(session.snapshot.elements),
    },
  };
};

export const getTerraformImportSession = (): TerraformImportSession | null =>
  activeSession;

export const clearTerraformImportSession = () => {
  activeSession = null;
  clearTerraformImportPrepCache();
};

export const hasTerraformImportSession = (): boolean => activeSession != null;

export const updateTerraformImportSessionColorMode = (
  colorMode: TerraformColorMode,
) => {
  if (activeSession) {
    activeSession = { ...activeSession, colorMode };
  }
};

export const updateTerraformImportSessionLodEnabled = (
  terraformLodEnabled: boolean,
) => {
  if (activeSession) {
    activeSession = { ...activeSession, terraformLodEnabled };
  }
};

export const updateTerraformImportSessionLodPreset = (
  terraformLodPreset: import("./terraformLod").TerraformLodPreset,
) => {
  if (activeSession) {
    activeSession = { ...activeSession, terraformLodPreset };
  }
};

export const updateTerraformImportSessionMinimapEnabled = (
  terraformMinimapEnabled: boolean,
) => {
  if (activeSession) {
    activeSession = { ...activeSession, terraformMinimapEnabled };
  }
};
