/**
 * Build a shareable `/demo?…` URL that reconstructs the *current* Terraform canvas: the
 * originating preset + its layout (from the in-memory import session) plus the live runtime
 * view settings (LOD, minimap, edge layers, dev canvas-performance). Opening the URL cold
 * re-imports the preset and then applies the settings — see {@link TerraformDemoAutoImport}.
 *
 * Only preset-backed scenes are shareable: an uploaded-file import has no stable URL source,
 * so {@link buildTerraformCanvasShareUrl} returns `null` when the session has no preset.
 */
import {
  buildTerraformDemoUrl,
  collectTerraformDemoParams,
  type TerraformDemoSettingsSnapshot,
  type TerraformDemoUrlParams,
  type TerraformEdgeLayerPins,
} from "./terraformDemoUrlParams";
import {
  TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS,
  type TerraformRuntimePerformanceSettings,
} from "./terraformRuntimePerformance";

import type { TerraformImportSession } from "./terraformImportSession";
import type { TerraformLodPreset } from "./terraformLod";
import type { TerraformView } from "./terraformImportDialogUtils";
import { isValidTerraformFocusHopCount } from "./terraformRelationshipFocus";

import type { TerraformFocusDirection } from "./terraformRelationshipFocus";

/** The live runtime view settings the share URL captures alongside the session's layout. */
export type TerraformCanvasViewSettings = {
  terraformLodEnabled: boolean;
  terraformLodPreset: TerraformLodPreset;
  terraformMinimapEnabled: boolean;
  terraformEdgeLayerPins: TerraformEdgeLayerPins | null;
  runtimePerformance: TerraformRuntimePerformanceSettings;
  /** W11 WP1 — mirrors `AppState["terraformFocusDirection"]`. */
  terraformFocusDirection: TerraformFocusDirection;
  /** W11 WP1 — mirrors `AppState["terraformFocusMaxHops"]`. */
  terraformFocusMaxHops: number | null;
};

/**
 * Recover the view the session was imported with: `layoutMode` is only retained for the
 * pipeline family, so semantic/module are distinguished by the `semanticLayout` flag.
 */
export const deriveViewFromSession = (
  session: TerraformImportSession,
): TerraformView => {
  if (
    session.layoutMode === "pipeline" ||
    session.layoutMode === "rcll" ||
    session.layoutMode === "strata"
  ) {
    return session.layoutMode;
  }
  return session.semanticLayout ? "semantic" : "module";
};

/** Map the import session's retained layout fields onto the demo-URL settings snapshot. */
const sessionToDemoSnapshot = (
  session: TerraformImportSession,
  presetId: string,
): TerraformDemoSettingsSnapshot => ({
  presetId,
  view: deriveViewFromSession(session),
  pipelineCompact: session.pipelineCompact ?? true,
  pipelineLayoutVariant: session.pipelineLayoutVariant ?? "classic",
  pipelinePacked: session.pipelinePacked ?? false,
  pipelinePackedPullLeft: session.pipelinePackedPullLeft ?? false,
  pipelineIncludeAncillary: session.pipelineIncludeAncillary ?? false,
  pipelinePrivateApiRegional: session.pipelinePrivateApiRegional ?? false,
  pipelineSemanticPlacement: session.pipelineSemanticPlacement ?? false,
  pipelineSwimlaneLaneRise: session.pipelineSwimlaneLaneRise ?? false,
  pipelineReorder: session.pipelineReorder ?? false,
  pipelineCrossingMin: session.pipelineCrossingMin ?? false,
  pipelineDeBandLevel:
    session.pipelineDeBandLevel ??
    (session.pipelineSubnetDeBand ? "subnet" : "none"),
  pipelineRankSeparate: session.pipelineRankSeparate ?? false,
  pipelineStraighten: session.pipelineStraighten ?? false,
  pipelineCoordRepack: session.pipelineCoordRepack ?? false,
  pipelineColumnPacking:
    session.pipelineColumnPacking ??
    (session.pipelineDeDensify ? "spread" : "none"),
  // No retained profile ⇒ the explicit flags above are authoritative (treated as "custom").
  pipelineLayoutProfile: session.pipelineLayoutProfile ?? "custom",
  pipelineStaircaseBandOverlap: session.pipelineStaircaseBandOverlap ?? true,
  strataNetworkSimplexRank: session.strataNetworkSimplexRank ?? false,
  strataSweeps: session.strataSweeps ?? 0,
  strataCoordinateRefine: session.strataCoordinateRefine ?? false,
  strataRankSeparate: session.strataRankSeparate ?? false,
  strataPackedScoring: session.strataPackedScoring ?? false,
  strataPackedScoringEpsilon: session.strataPackedScoringEpsilon ?? 0,
  strataEdgeRouting: session.strataEdgeRouting ?? false,
  strataBorderRoute: session.strataBorderRoute ?? false,
  strataBandCompact: session.strataBandCompact ?? false,
  // Raw forward — omit at default ("account")/absent so the demo snapshot (and
  // the URL built from it) never carries a default cut key, matching
  // hand-built/legacy snapshots that omit it. Non-default cuts forward.
  ...(session.strataBandDepth !== undefined &&
  session.strataBandDepth !== "account"
    ? { strataBandDepth: session.strataBandDepth }
    : {}),
  strataSiftRelocate: session.strataSiftRelocate ?? false,
  strataCrossWeightPenetration: session.strataCrossWeightPenetration ?? 1,
  strataCrossWeightEdge: session.strataCrossWeightEdge ?? 1,
  ...(session.strataEdgeCrossCap !== undefined
    ? { strataEdgeCrossCap: session.strataEdgeCrossCap }
    : {}),
  strataPackedConverge: session.strataPackedConverge ?? false,
  strataTransitiveAdopt: session.strataTransitiveAdopt ?? false,
  strataSinkPullIn: session.strataSinkPullIn ?? false,
  strataBlockClamp: session.strataBlockClamp ?? false,
  strataTranspose: session.strataTranspose ?? false,
  strataHeightGate: session.strataHeightGate ?? false,
  strataSinkLadder: session.strataSinkLadder ?? false,
  moduleLayoutMode: session.moduleLayoutOptions.mode,
});

const runtimePerformanceIsDefault = (
  settings: TerraformRuntimePerformanceSettings,
): boolean =>
  (
    Object.keys(TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS) as Array<
      keyof TerraformRuntimePerformanceSettings
    >
  ).every(
    (key) => settings[key] === TERRAFORM_RUNTIME_PERFORMANCE_DEFAULTS[key],
  );

/**
 * Compose the full canvas-share URL. Returns `null` when there is no preset-backed session
 * to reconstruct the scene from (the only case the URL cannot represent).
 */
export const buildTerraformCanvasShareUrl = (
  session: TerraformImportSession | null,
  view: TerraformCanvasViewSettings,
  options?: { origin?: string; pathname?: string },
): string | null => {
  const presetId = session?.preset?.id;
  if (!session || !presetId) {
    return null;
  }

  const params: TerraformDemoUrlParams = {
    ...collectTerraformDemoParams(sessionToDemoSnapshot(session, presetId)),
    // Live runtime view settings — always emit LOD + minimap so the URL is self-describing;
    // edge pins only when set (null = legacy "infer from elements"); dev perf only when
    // it diverges from defaults (keeps the URL clean for the common case).
    lodEnabled: view.terraformLodEnabled,
    lodPreset: view.terraformLodPreset,
    minimap: view.terraformMinimapEnabled,
    ...(view.terraformEdgeLayerPins
      ? { edgeLayerPins: view.terraformEdgeLayerPins }
      : {}),
    ...(runtimePerformanceIsDefault(view.runtimePerformance)
      ? {}
      : { runtimePerformance: view.runtimePerformance }),
    // W11 WP1 — omitted at default ("both" / null), mirroring edgeLayerPins.
    ...(view.terraformFocusDirection !== "both"
      ? { focusDirection: view.terraformFocusDirection }
      : {}),
    // `-1` is the stored AppState sentinel for "unlimited"; a runtime Infinity
    // (API misuse, tolerated at the traversal boundary) shares identically.
    // Finite non-null caps (W11 F5) are emitted verbatim so API-set caps
    // survive the share round-trip instead of silently reverting to 3.
    // W13 F3: only validator-passing caps (`isValidTerraformFocusHopCount` —
    // non-negative SAFE integer) or the unlimited sentinel are emitted; junk
    // AppState values (e.g. `1e21`, NaN) are omitted, matching the ingress
    // guard's fallback to the default (URL omission = default 3).
    ...(view.terraformFocusMaxHops === -1 ||
    view.terraformFocusMaxHops === Infinity
      ? { focusMaxHops: Infinity }
      : view.terraformFocusMaxHops != null &&
        isValidTerraformFocusHopCount(view.terraformFocusMaxHops)
      ? { focusMaxHops: view.terraformFocusMaxHops }
      : {}),
  };

  return buildTerraformDemoUrl(params, options);
};
