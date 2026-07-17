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
import { TERRAFORM_STRATA_LAYOUT_DEFAULTS } from "./terraformStrataDefaults";

import { isValidTerraformFocusHopCount } from "./terraformRelationshipFocus";

import type { TerraformImportSession } from "./terraformImportSession";
import type { TerraformLodPreset } from "./terraformLod";
import type { TerraformView } from "./terraformImportDialogUtils";

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
  // S5-9: fall back to the strata view DEFAULT (ON), not `false`. A strata
  // session that somehow lacks the retained field must round-trip to the
  // layout it was imported with — a `false` fallback here emitted an
  // explicit `privateApiRegional=0` that silently flipped the geometry on
  // re-import. (Non-strata shares never read this field; only the strata
  // collect-branch emits it.)
  pipelinePrivateApiRegional:
    session.pipelinePrivateApiRegional ??
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.pipelinePrivateApiRegional,
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
  // S5-9: sweeps + coordinate-refine fall back to the SDEC-54 validated
  // strata defaults (K=4 + A7 ON), not `0`/`false`. The old inverted
  // fallbacks would, for a field-absent session, emit `strataSweeps=0` /
  // `strataCoordRefine=0` — the worst-arm K=0 config the share URL is meant
  // to reproduce faithfully.
  strataSweeps:
    session.strataSweeps ?? TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataSweeps,
  strataCoordinateRefine:
    session.strataCoordinateRefine ??
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataCoordinateRefine,
  strataRankSeparate:
    session.strataRankSeparate ??
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataRankSeparate,
  // owner-decisions.md 2026-07-17: packedScoring/ε/sift/transpose default ON.
  // Fall back to the strata view DEFAULT (like sweeps/coordRefine/privateApi
  // above), not `false`/`0` — a field-absent strata session must round-trip to
  // the layout it was imported with, and the strata collect-branch now emits
  // these both-states, so a `false` fallback would emit an explicit OFF that
  // silently flips the geometry on re-import.
  strataPackedScoring:
    session.strataPackedScoring ??
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataPackedScoring,
  strataPackedScoringEpsilon:
    session.strataPackedScoringEpsilon ??
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataPackedScoringEpsilon,
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
  strataSiftRelocate:
    session.strataSiftRelocate ??
    TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataSiftRelocate,
  strataCrossWeightPenetration: session.strataCrossWeightPenetration ?? 1,
  strataCrossWeightEdge: session.strataCrossWeightEdge ?? 1,
  ...(session.strataEdgeCrossCap !== undefined
    ? { strataEdgeCrossCap: session.strataEdgeCrossCap }
    : {}),
  strataPackedConverge: session.strataPackedConverge ?? false,
  strataTransitiveAdopt: session.strataTransitiveAdopt ?? false,
  strataBlockClamp: session.strataBlockClamp ?? false,
  strataTranspose:
    session.strataTranspose ?? TERRAFORM_STRATA_LAYOUT_DEFAULTS.strataTranspose,
  strataHeightGate: session.strataHeightGate ?? false,
  // C19 fix (share-url-drops-leaf-shift): the session retains strataLeafShift
  // and collectTerraformDemoParams emits it truthy-only, but the bridge here
  // never forwarded it — a canvas imported with strataLeafShift=1 lost the flag
  // on share and reopened with default-off geometry. `?? false` is byte-
  // identical for field-absent sessions (false ⇒ never emitted).
  strataLeafShift: session.strataLeafShift ?? false,
  // De-band ladder: omit at the default `"none"` (a TRUTHY string — the
  // explicit compare is load-bearing) so a shared URL of a default scene is
  // byte-identical to today's.
  ...(session.strataDeBandLevel !== undefined &&
  session.strataDeBandLevel !== "none"
    ? { strataDeBandLevel: session.strataDeBandLevel }
    : {}),
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
