/* eslint-disable max-lines */
/**
 * Worker-safe Terraform layout: merge plans, run semantic / module layout,
 * return a plain scene payload (no Response, no DOM).
 */
import graphlibDot from "@dagrejs/graphlib-dot";

import { buildTerraformElkExcalidrawScene } from "./terraformElkLayout";
import {
  extractTerraformTopologyFromPlan,
  mergeTopologyModelWithPlacementZones,
  mergeTopologyModelWithRegionalBuckets,
  mergeTopologyModelWithVpcEndpoints,
  mergeTopologyModelWithRouteTables,
  mergeTopologyModelWithVpcDefaults,
  pickResourceValuesForTopologyPlacement,
} from "./terraformTopologyExtract";
import {
  computeInterfaceVpcEndpointZonePlacements,
  collectRouteAddressesFromBottomPlacements,
  computeRouteTableBottomEdgePlacements,
  extractInterfaceEndpointSecurityGroupBuckets,
  extractRegionalTopologyPrimaries,
  extractRouteTablesByVpc,
  extractVpcEndpointsByVpc,
  extractVpcFlowLogBundles,
  filterVpcEndpointBucketsRemovingZonePlacedAddresses,
} from "./terraformTopologyPlacement";
import {
  buildMergedTopologyZones,
  buildVpcDefaultPlumbingWithNat,
  collectTopologyPreplacedAddresses,
  enrichAndReconcileTopologyPlacements,
} from "./terraformTopologyPlacementBuild";
import { buildTerraformTopologyExcalidrawScene } from "./terraformTopologyLayout";
import {
  buildTerraformCompoundPipelineExcalidrawScene,
  buildTerraformPipelineExcalidrawScene,
} from "./terraformPipelineLayout";
import { buildTerraformPipelineV2ExcalidrawScene } from "./terraformPipelineLayoutV2";
import { buildTerraformPipelineRcllExcalidrawScene } from "./terraformPipelineLayoutRcll";
import { buildTerraformStrataExcalidrawScene } from "./terraformPipelineStrata";
import { applyRcllToggleGuards } from "./terraformPipelineToggleGuards";
import {
  resolveRcllLayoutProfile,
  type DeBandLevel,
  type RcllLayoutProfile,
} from "./terraformPipelineLayoutProfiles";
import { TERRAFORM_MODULE_TREE_KEY } from "./terraformPlanMeta";
import { DECLARED_DATAFLOW_ORDERED_KEY } from "./terraformDeclaredDataFlow";
import {
  filterPlanByProviderFamily,
  getProviderFamilyLabel,
  hasManagedResourcesForSemantic,
  partitionResourceChangesByProviderFamily,
  sortedNonAwsProviderFamilies,
} from "./terraformProviderClassification";
import {
  buildProviderFamilyScene,
  composeMultiProviderTopologyScene,
  type ProviderTopologyBlock,
} from "./terraformProviderLayout";
import {
  mergeDotAdjacency,
  mergePlanJsons,
  mergePlanWithStates,
  mergeSyntheticPlans,
  namespacePlanDotBundles,
  type TerraformImportWarning,
} from "./terraformImportMerge";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
  type TerraformPlanParsingOptions,
  type TerraformPlanParsingSources,
} from "./terraformPlanParsing";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import {
  buildTerraformImportPrepCache,
  clearTerraformImportPrepCache,
  getTerraformImportPrepCache,
  terraformImportPrepFingerprint,
} from "./terraformImportPrepCache";
import {
  terraformImportProfilerMeasure,
  terraformImportProfilerMeasureAsync,
} from "./terraformImportProfiler";

import {
  TERRAFORM_COLOR_MODE_DEFAULT,
  withTerraformLayoutColorModeAsync,
  type TerraformColorMode,
} from "./terraformPrimaryVisibility";

import type { TerraformModuleLayoutOptions } from "./terraformModuleLayoutOptions";
import type { StrataHullRole } from "./terraformPipelineStrataTypes";

export type TerraformLayoutOptions = TerraformPlanParsingOptions;

export type { TerraformPlanParsingSources } from "./terraformPlanParsing";

export type LayoutTerraformResult =
  | { ok: true; scene: Record<string, unknown> }
  | { ok: false; error: string; status?: number };

const EMPTY_TERRAFORM_EXCALIDRAW_SCENE = {
  type: "excalidraw" as const,
  version: 2,
  source: "terraform-local-parse",
  elements: [] as unknown[],
  appState: {
    viewBackgroundColor: "#ffffff",
    gridSize: null as number | null,
  },
};

const DEBUG_PREFIX = "[terraform:local-parse]";
const SEMANTIC_LAYOUT_OMITTED_TYPES = new Set(["terraform_data"]);

function emitLocalParseDebug(payload: Record<string, unknown>) {
  if (!import.meta.env.DEV) {
    return;
  }
  // eslint-disable-next-line no-console -- intentional dev-only parse tracing
  console.log(DEBUG_PREFIX, payload);
}

function addRepresentedAddressesFromElement(
  represented: Set<string>,
  representedSubnetIds: Set<string>,
  element: { customData?: Record<string, unknown> },
) {
  const cd = element.customData || {};
  if (typeof cd.nodePath === "string") {
    represented.add(cd.nodePath);
  }
  if (Array.isArray(cd.terraformMergedSubnetAddresses)) {
    for (const addr of cd.terraformMergedSubnetAddresses) {
      if (typeof addr === "string") {
        represented.add(addr);
      }
    }
  }
  if (Array.isArray(cd.terraformSubnetIds)) {
    for (const subnetId of cd.terraformSubnetIds) {
      if (typeof subnetId === "string") {
        representedSubnetIds.add(subnetId);
      }
    }
  }
  if (Array.isArray(cd.terraformResources)) {
    for (const resource of cd.terraformResources) {
      const address = (resource as { address?: unknown })?.address;
      if (typeof address === "string") {
        represented.add(address);
      }
    }
  }
}

function addRepresentedAddressesFromPlan(
  represented: Set<string>,
  representedSubnetIds: Set<string>,
  plan: { resource_changes?: Array<{ address?: string; type?: string }> },
) {
  for (const rc of plan.resource_changes || []) {
    if (rc.type === "aws_vpc" && typeof rc.address === "string") {
      represented.add(rc.address);
    }
    if (rc.type === "aws_subnet" && typeof rc.address === "string") {
      const values = pickResourceValuesForTopologyPlacement(rc as any);
      const subnetId =
        values && typeof values.id === "string" ? values.id : null;
      if (subnetId && representedSubnetIds.has(subnetId)) {
        represented.add(rc.address);
      }
    }
    if (
      rc.type === "aws_iam_policy_document" &&
      typeof rc.address === "string"
    ) {
      represented.add(rc.address);
    }
  }
}

function collectSemanticRepresentedResourceAddresses(
  elements: Array<{ customData?: Record<string, any> }>,
  plan: { resource_changes?: Array<{ address?: string; type?: string }> },
): Set<string> {
  const represented = new Set<string>();
  const representedSubnetIds = new Set<string>();
  for (const element of elements) {
    addRepresentedAddressesFromElement(
      represented,
      representedSubnetIds,
      element,
    );
  }
  addRepresentedAddressesFromPlan(represented, representedSubnetIds, plan);
  return represented;
}

function formatImportWarnings(
  warnings: TerraformImportWarning[],
  tfdWarnings: string[],
  tfdErrors: string[] = [],
): TerraformImportWarning[] {
  const out = [...warnings];
  for (const message of tfdErrors) {
    out.push({ code: "tfd_error", message });
  }
  for (const message of tfdWarnings) {
    out.push({ code: "duplicate_tfd_bind", message });
  }
  return out;
}

function appendImportMeta(
  meta: Record<string, unknown>,
  sources: TerraformPlanParsingSources,
  importWarnings: TerraformImportWarning[],
  stackMeta?: { stackIds: string[]; addressToStack: Record<string, string> },
) {
  return {
    ...meta,
    importBundleCount: sources.planDotBundles.length,
    importStateCount: sources.states.length,
    importTfdCount: sources.tfdTexts.filter((t) => t.trim()).length,
    ...(stackMeta?.stackIds.length
      ? {
          stackIds: stackMeta.stackIds,
          addressToStack: stackMeta.addressToStack,
        }
      : {}),
    ...(importWarnings.length > 0 ? { importWarnings } : {}),
  };
}

function applyTfdCompositionToLayoutSources(
  sources: TerraformPlanParsingSources,
  options?: TerraformLayoutOptions,
):
  | { ok: false; error: string; status?: number }
  | { sources: TerraformPlanParsingSources } {
  const hasTfd = sources.tfdTexts.some((text) => text?.trim());
  if (!hasTfd) {
    return { sources };
  }

  const resolved = resolveSourcesWithTfdComposition(
    {
      planDotBundles: sources.planDotBundles,
      states: sources.states ?? [],
      stateLabels: (sources.stateLabels ?? []).map((label) => String(label)),
      tfdTexts: sources.tfdTexts,
      tfdLabels: (sources.tfdLabels ?? []).map((label) => String(label)),
      warnings: sources.warnings ?? [],
      repoName: sources.repoName,
      stackCatalog: sources.stackCatalog,
    },
    options?.artifactLoader,
  );

  if (resolved.compositionErrors?.length) {
    return {
      ok: false,
      status: 400,
      error: resolved.compositionErrors.join("\n"),
    };
  }

  return {
    sources: {
      ...sources,
      planDotBundles: resolved.planDotBundles,
      states: resolved.states,
      stateLabels: resolved.stateLabels,
      warnings: resolved.warnings,
    },
  };
}

type LayoutPlanResolution =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      plan: unknown;
      adjacency: Record<string, string[]>;
      importSource: "plan" | "state-only";
      sourcePlans: unknown[];
      stackIds: string[];
      addressToStack: Record<string, string>;
      importWarnings: TerraformImportWarning[];
    };

function resolveLayoutPlanFromSources(
  sources: TerraformPlanParsingSources,
): LayoutPlanResolution {
  if (sources.planDotBundles.length > 0) {
    const cache = getTerraformImportPrepCache();
    if (
      cache &&
      cache.fingerprint === terraformImportPrepFingerprint(sources)
    ) {
      return {
        ok: true,
        plan: cache.mergedPlan,
        adjacency: cache.adjacency,
        importSource: "plan",
        sourcePlans: cache.sourcePlans,
        stackIds: cache.stackIds,
        addressToStack: cache.addressToStack,
        importWarnings: cache.importWarnings,
      };
    }
  }

  const importWarnings: TerraformImportWarning[] = [];
  const states = sources.states ?? [];
  let plan: unknown;
  let adjacency: Record<string, string[]> = {};
  let importSource: "plan" | "state-only" = "plan";
  let sourcePlans: unknown[] = [];
  let stackIds: string[] = [];
  let addressToStack: Record<string, string> = {};

  if (sources.planDotBundles.length === 0) {
    if (states.length === 0) {
      return {
        ok: false,
        status: 400,
        error:
          "Upload at least one plan JSON + graph DOT pair, or one or more raw Terraform state files.",
      };
    }
    const merged = mergeSyntheticPlans(
      states,
      sources.stateLabels ?? states.map((_, i) => `state ${i + 1}`),
    );
    plan = merged.plan;
    importWarnings.push(...merged.warnings);
    sourcePlans = merged.sourcePlans;
    adjacency = {};
    importSource = "state-only";
  } else {
    let bundles = sources.planDotBundles;
    if (bundles.length > 1) {
      const namespaced = namespacePlanDotBundles(bundles);
      bundles = namespaced.bundles;
      stackIds = namespaced.stackIds;
      addressToStack = namespaced.addressToStack;
    }
    const plans = bundles.map((b) => b.plan);
    const labels = bundles.map((b) => b.label);
    const merged = mergePlanJsons(plans, labels);
    plan = merged.plan;
    importWarnings.push(...merged.warnings);
    sourcePlans = merged.sourcePlans;
    adjacency = mergeDotAdjacency(
      bundles.map((b) => b.dotText),
      stackIds.length > 0 ? stackIds : undefined,
    );
    if (states.length > 0 && sources.planDotBundles.length === 1) {
      const mergedWithState = mergePlanWithStates(
        plan as Parameters<typeof mergePlanWithStates>[0],
        sourcePlans,
        states,
        sources.stateLabels ?? states.map((_, i) => `state ${i + 1}`),
        importWarnings,
      );
      plan = mergedWithState.plan;
      sourcePlans = mergedWithState.sourcePlans;
    }
  }

  return {
    ok: true,
    plan,
    adjacency,
    importSource,
    sourcePlans,
    stackIds,
    addressToStack,
    importWarnings,
  };
}

function validateLayoutPlanForMode(
  plan: unknown,
  semanticLayout: boolean,
  pipelineLayout: boolean,
): { ok: false; status: number; error: string } | { ok: true } {
  if (!semanticLayout && !pipelineLayout) {
    return { ok: true };
  }
  const rc = (plan as { resource_changes?: unknown[] }).resource_changes;
  if (
    !Array.isArray(rc) ||
    rc.length === 0 ||
    !hasManagedResourcesForSemantic(
      plan as { resource_changes?: Array<{ mode?: string; type?: string }> },
    )
  ) {
    return {
      ok: false,
      status: 400,
      error: pipelineLayout
        ? "Pipeline view requires at least one managed resource in the plan or state file."
        : "Semantic layout requires at least one managed resource in the plan or state file.",
    };
  }
  return { ok: true };
}

type LayoutSceneContext = {
  sources: TerraformPlanParsingSources;
  plan: unknown;
  nodes5: ReturnType<typeof buildTerraformLocalImportNodesMap>;
  importSource: "plan" | "state-only";
  importWarnings: TerraformImportWarning[];
  tfdErrors: string[];
  tfdWarnings: string[];
  stackIds: string[];
  addressToStack: Record<string, string>;
  deferDecorations?: boolean;
  pipelineCompact?: boolean;
  pipelineLayoutVariant?: import("./terraformImportDialogUtils").PipelineLayoutVariant;
  pipelinePacked?: boolean;
  pipelinePackedPullLeft?: boolean;
  pipelineIncludeAncillary?: boolean;
  /** Opt-in (default off): private VPC-endpoint-bound REST APIs placed at region level. */
  pipelinePrivateApiRegional?: boolean;
  pipelineSemanticPlacement?: boolean;
  /** RCLL M4: X-disjoint swimlane lanes rise to share Y rows. */
  pipelineSwimlaneLaneRise?: boolean;
  /** RCLL M6: per-container barycenter crossing-min reorder. */
  pipelineReorder?: boolean;
  /** RCLL M6c: container-aware crossing minimization (supersedes the leaf reorder). */
  pipelineCrossingMin?: boolean;
  /** RCLL de-band depth: dissolve the chosen container level + all deeper levels into one
   * shared column stack (frames → rails). `none` = today's boxed layout. */
  pipelineDeBandLevel?: DeBandLevel;
  /** Back-compat alias for `pipelineDeBandLevel: "subnet"`. `pipelineDeBandLevel` wins. */
  pipelineSubnetDeBand?: boolean;
  /** RCLL M8r: whole-model-global sibling-separation ranking (needs lane-rise). */
  pipelineRankSeparate?: boolean;
  /** RCLL M5: Brandes–Köpf leaf straightening (Y-only spine alignment). */
  pipelineStraighten?: boolean;
  /** RCLL M5b: coordinated per-column permutation re-pack (refines straighten, within band). */
  pipelineCoordRepack?: boolean;
  /** RCLL M5b: de-density — spread crowded columns (dial defaulted by the guard). */
  pipelineDeDensify?: boolean;
  /** RCLL "Column packing" tri-state: `spread` = M5b pull-right, `compact` = M5c pull-left,
   * `none` = neither. Front-door enum; supersedes `pipelineDeDensify` (legacy ⇒ `spread`). */
  pipelineColumnPacking?: "spread" | "none" | "compact" | "shorten";
  /** RCLL "Layout" profile, echoed into meta (when not `balanced`). The flag expansion is
   * done at the `sceneContext` literal; this field is only carried for the meta echo. */
  pipelineLayoutProfile?: RcllLayoutProfile;
  /** RCLL M3b / DEC-1: X-disjoint cycle groups rise to share Y. Default true (undefined ⇒ on). */
  pipelineStaircaseBandOverlap?: boolean;
  /** Strata (rcll-v2) OD-1: X-axis network-simplex rank refinement. S0a: accepted +
   * threaded, unused until the engine lands (M1). Default off. */
  strataNetworkSimplexRank?: boolean;
  /** Strata OD-14: whole-model sibling-separation ranking (the height lever); the
   * separated floor REPLACES the A1 rank, mutually exclusive with NS. Default off. */
  strataRankSeparate?: boolean;
  /** EXPERIMENTAL W5b probe (round-8 R8-F9): joint constrained-NS refinement of
   * the separated floor. Harness-only, default off; inert without rankSeparate. */
  strataJointNsRank?: boolean;
  /** Strata round 9 (SDEC-57): packed-hull whole-layout candidate scoring.
   * Default off. */
  strataPackedScoring?: boolean;
  /** Strata W8b: ε-constraint crossings budget for the packed scorer.
   * Default 0 (strict rule; inert without `strataPackedScoring`). */
  strataPackedScoringEpsilon?: number;
  /** Strata W10 (SDEC-63): banded row-share compaction lever. Default off;
   * primarily effective with rankSeparate. LEGACY ALIAS for
   * `strataBandDepth: "root"`. */
  strataBandCompact?: boolean;
  /** Strata v3.2: band-depth slider cut — the deepest role still banded.
   * Default "account" (today's fixed role→policy map, byte-identical). */
  strataBandDepth?: StrataHullRole;
  /** Strata W8b frontier instrumentation (report-only dev seam; harness-only). */
  strataPackedFrontierMeta?: boolean;
  /** Strata Package C spike (W9): post-A7 obstacle-avoiding edge routing.
   * Default off. */
  strataEdgeRouting?: boolean;
  /** Strata P3-pierce: clean single-side container-exit routing. Default off. */
  strataBorderRoute?: boolean;
  /** Strata OD-2: directional sweep count for A2 ordering. S0a: accepted + threaded,
   * unused until the engine lands (M1). Default 0. */
  strataSweeps?: number;
  /** Strata A7: slice-A coordinate refinement. S0a: accepted + threaded, unused
   * until the engine lands (M1). Default off. */
  strataCoordinateRefine?: boolean;
  /** OD-15 crossings-≻-length relocate (cross-hull sift + post-A7 vertical
   * slots). Default off. */
  strataSiftRelocate?: boolean;
  /** Relocate objective weight on penetrations. Default 1. */
  strataCrossWeightPenetration?: number;
  /** Relocate objective weight on edge-edge crossings. Default 1. */
  strataCrossWeightEdge?: number;
  /** Edge-edge regression cap for the relocate descent. Optional — absent
   * inherits `strataPackedScoringEpsilon`. */
  strataEdgeCrossCap?: number;
  /** G-DESCENT remedy: the packed-scoring descent returns the best-seen
   * ADOPTED snapshot instead of the rolling incumbent. Default off; inert at
   * ε=0. */
  strataPackedConverge?: boolean;
  /** P0.2: transitive adoption relation for the packed descent. Default off. */
  strataTransitiveAdopt?: boolean;
  /** P4 pure-sink account block clamp (post-A7): rigid-translate a whole
   * dead-end account subtree left toward its sources. Default off. */
  strataBlockClamp?: boolean;
  /** P2 within-column transpose (post-A7): swap Y-adjacent X-overlapping sibling
   * pairs to remove leftover diagonal crossings. Default off. */
  strataTranspose?: boolean;
  /** Exclusive-downstream chain relocate (post-A7): rigid Y co-translation of a
   * unit and its exclusive downstream group. Default off. */
  strataChainRelocate?: boolean;
  /** P5 (Lever C) per-hull height maintain-or-decrease acceptance gate for the
   * sink-pull-in / block-clamp passes. Default off. */
  strataHeightGate?: boolean;
  /** A01 leaf X-shift (post-A7): pull degree-1 pure-sink leaves left onto a grid
   * column between source and current rank, Y-redrop, grow ancestor chain. Default
   * off. Carries the mandatory right-edge column guard. */
  strataLeafShift?: boolean;
  /** A01 slack height gate absolute px budget (default 150). */
  strataLeafShiftHeightBudgetPx?: number;
  /** A01 slack height gate relative budget fraction (default 0.01). */
  strataLeafShiftHeightBudgetFrac?: number;
  /** A01 max target ranks tried per leaf (default 8). */
  strataLeafShiftRankBudget?: number;
  /** A01 right-edge column guard px (default 300). */
  strataLeafShiftRightEdgeGuardPx?: number;
  /** §3o ancillary greedy right-slack allocator. Default ON; inert unless
   *  `pipelineIncludeAncillary` is also on. */
  strataAncillaryAllocator?: boolean;
  /** OD-15 de-band: dissolve this hierarchy level and every deeper one at the
   * Strata model build. Default `"none"` (byte-identical). */
  strataDeBandLevel?: DeBandLevel;
  colorMode?: TerraformColorMode;
};

async function buildPipelineLayoutSceneBody(
  ctx: LayoutSceneContext,
): Promise<Record<string, unknown>> {
  return withTerraformLayoutColorModeAsync(
    ctx.colorMode ?? TERRAFORM_COLOR_MODE_DEFAULT,
    // eslint-disable-next-line sonarjs/cognitive-complexity
    async () => {
      // Shared as a variable (not a literal) so v2 — which reads only `compact`
      // / `includeAncillary` — tolerates the extra classic/compound keys.
      // RCLL toggle coupling is enforced once here (the dialog gates the UI; this is
      // the backstop for URL/programmatic imports): `applyRcllToggleGuards` drops
      // rankSeparate when the lane-rise is off (solo = taller/wider) and supplies the
      // de-density width dial. `staircaseBandOverlap` is passthrough (undefined ⇒
      // engine default true ⇒ OFF byte-identical).
      // "Column packing" tri-state is the single front-door; derive the two mutually
      // exclusive engine flags from it (legacy `pipelineDeDensify` ⇒ `spread`).
      const columnPacking: "spread" | "none" | "compact" | "shorten" =
        ctx.pipelineColumnPacking ??
        (ctx.pipelineDeDensify ? "spread" : "none");
      const { options: pipelineOptions, suppressions: rcllSuppressions } =
        applyRcllToggleGuards({
          compact: ctx.pipelineCompact !== false,
          includeAncillary: ctx.pipelineIncludeAncillary === true,
          packed: ctx.pipelinePacked === true,
          packedPullLeft: ctx.pipelinePackedPullLeft === true,
          semanticPlacement: ctx.pipelineSemanticPlacement === true,
          swimlaneLaneRise: ctx.pipelineSwimlaneLaneRise === true,
          reorder: ctx.pipelineReorder === true,
          crossingMin: ctx.pipelineCrossingMin === true,
          deBandLevel: ctx.pipelineDeBandLevel ?? "none",
          rankSeparate: ctx.pipelineRankSeparate === true,
          straighten: ctx.pipelineStraighten === true,
          coordRepack: ctx.pipelineCoordRepack === true,
          deDensify: columnPacking === "spread",
          // "shorten" is a BUNDLE: the X-axis network-simplex depth-floor ranker PLUS
          // column compaction (the proven additive config — NS shortens cross-column
          // edges, compact pulls leaves left). So compact is on for both "compact" and
          // "shorten"; only "shorten" also turns on the NS ranker.
          columnCompact:
            columnPacking === "compact" || columnPacking === "shorten",
          networkSimplexRank: columnPacking === "shorten",
          staircaseBandOverlap: ctx.pipelineStaircaseBandOverlap,
        });
      const rankSeparateSuppressed = rcllSuppressions.includes(
        "rankSeparate-needs-rise",
      );
      const coordRepackSuppressed = rcllSuppressions.includes(
        "coord-repack-needs-straighten",
      );
      const columnPackingConflict = rcllSuppressions.includes(
        "column-packing-conflict-compact-wins",
      );
      const orderingConflict = rcllSuppressions.includes(
        "ordering-conflict-crossing-min-wins",
      );
      // "shorten" (NS) was DROPPED because a live rankSeparate (the dominant height
      // lever) wins the mutually-exclusive column axis. Observable so the user learns
      // their "shorten" pick was a safe no-op, not a silent one.
      const networkSimplexSuppressedByRankSeparate = rcllSuppressions.includes(
        "rank-floor-conflict-rankseparate-wins-network-simplex",
      );
      // "shorten" (NS, when it survived) dropped a conflicting `deDensify`.
      const networkSimplexRankConflict = rcllSuppressions.includes(
        "rank-floor-conflict-network-simplex-wins-dedensify",
      );
      // The applied packing arm after the guard (a conflict drops `deDensify`).
      // "shorten" (NS bundle) wins the echo over plain "compact" — it sets BOTH
      // networkSimplexRank and columnCompact, so test for the discriminating flag first.
      const appliedColumnPacking: "spread" | "none" | "compact" | "shorten" =
        pipelineOptions.networkSimplexRank
          ? "shorten"
          : pipelineOptions.columnCompact
          ? "compact"
          : pipelineOptions.deDensify
          ? "spread"
          : "none";
      const buildPipeline =
        ctx.pipelineLayoutVariant === "rcll"
          ? buildTerraformPipelineRcllExcalidrawScene
          : ctx.pipelineLayoutVariant === "strata"
          ? buildTerraformStrataExcalidrawScene
          : ctx.pipelineLayoutVariant === "v2"
          ? buildTerraformPipelineV2ExcalidrawScene
          : ctx.pipelineLayoutVariant === "compound"
          ? buildTerraformCompoundPipelineExcalidrawScene
          : buildTerraformPipelineExcalidrawScene;
      // Merged into a variable (not passed as a literal) for the same reason the
      // v2 comment above gives: assigning to a `const` first (rather than
      // literal-in-call) skips TS's excess-property check, so every builder in
      // the ternary — including Strata's three extra future-engine flags —
      // tolerates the keys it doesn't read.
      const builderOptions = {
        ...pipelineOptions,
        pipelinePrivateApiRegional: ctx.pipelinePrivateApiRegional,
        strataNetworkSimplexRank: ctx.strataNetworkSimplexRank,
        strataRankSeparate: ctx.strataRankSeparate,
        strataJointNsRank: ctx.strataJointNsRank,
        strataPackedScoring: ctx.strataPackedScoring,
        strataPackedScoringEpsilon: ctx.strataPackedScoringEpsilon,
        strataBandCompact: ctx.strataBandCompact,
        // Raw forward — omit at default/absent so builderOptions never carries
        // an explicit "account"/undefined cut into the engine (which would
        // defeat the bandCompact alias). Non-default cuts forward.
        ...(ctx.strataBandDepth !== undefined &&
        ctx.strataBandDepth !== "account"
          ? { strataBandDepth: ctx.strataBandDepth }
          : {}),
        strataPackedFrontierMeta: ctx.strataPackedFrontierMeta,
        strataEdgeRouting: ctx.strataEdgeRouting,
        strataBorderRoute: ctx.strataBorderRoute,
        strataSweeps: ctx.strataSweeps,
        strataCoordinateRefine: ctx.strataCoordinateRefine,
        strataSiftRelocate: ctx.strataSiftRelocate,
        strataPackedConverge: ctx.strataPackedConverge,
        strataTransitiveAdopt: ctx.strataTransitiveAdopt,
        strataBlockClamp: ctx.strataBlockClamp,
        strataTranspose: ctx.strataTranspose,
        strataChainRelocate: ctx.strataChainRelocate,
        strataHeightGate: ctx.strataHeightGate,
        strataLeafShift: ctx.strataLeafShift,
        // A01 leaf-shift budget knobs: optional-only forward (no default
        // materialized — absent ⇒ engine defaults 150/0.01/8/300).
        ...(ctx.strataLeafShiftHeightBudgetPx !== undefined
          ? { strataLeafShiftHeightBudgetPx: ctx.strataLeafShiftHeightBudgetPx }
          : {}),
        ...(ctx.strataLeafShiftHeightBudgetFrac !== undefined
          ? {
              strataLeafShiftHeightBudgetFrac:
                ctx.strataLeafShiftHeightBudgetFrac,
            }
          : {}),
        ...(ctx.strataLeafShiftRankBudget !== undefined
          ? { strataLeafShiftRankBudget: ctx.strataLeafShiftRankBudget }
          : {}),
        ...(ctx.strataLeafShiftRightEdgeGuardPx !== undefined
          ? {
              strataLeafShiftRightEdgeGuardPx:
                ctx.strataLeafShiftRightEdgeGuardPx,
            }
          : {}),
        strataAncillaryAllocator: ctx.strataAncillaryAllocator,
        // OD-15 de-band — SEAM 2. This fan-in is a second silent-drop point the
        // trap-#4 comment on the sceneContext literal does not mention: a key
        // present there but missing HERE never reaches the builder, and this
        // object is a `const` precisely to defeat TS's excess-property check, so
        // the miss compiles green. Omit at the default/absent so no explicit
        // `"none"` is ever carried in (byte-identity).
        ...(ctx.strataDeBandLevel !== undefined &&
        ctx.strataDeBandLevel !== "none"
          ? { strataDeBandLevel: ctx.strataDeBandLevel }
          : {}),
        strataCrossWeightPenetration: ctx.strataCrossWeightPenetration,
        strataCrossWeightEdge: ctx.strataCrossWeightEdge,
        // Optional-only forward: no default materialized (absent ⇒ engine
        // inherits `strataPackedScoringEpsilon`).
        ...(ctx.strataEdgeCrossCap !== undefined
          ? { strataEdgeCrossCap: ctx.strataEdgeCrossCap }
          : {}),
      };
      const pipelineScene = await buildPipeline(
        ctx.nodes5,
        ctx.plan,
        builderOptions,
      );
      emitLocalParseDebug({
        phase: "pipelineLayout",
        meta: pipelineScene.meta,
        elementCount: pipelineScene.elements.length,
      });
      return {
        ...EMPTY_TERRAFORM_EXCALIDRAW_SCENE,
        elements: pipelineScene.elements,
        meta: appendImportMeta(
          {
            ...pipelineScene.meta,
            ...(ctx.pipelinePacked ? { pipelinePacked: true } : {}),
            ...(ctx.pipelinePacked && ctx.pipelinePackedPullLeft
              ? { pipelinePackedPullLeft: true }
              : {}),
            ...(ctx.pipelineIncludeAncillary
              ? { pipelineIncludeAncillary: true }
              : {}),
            ...(ctx.pipelineSemanticPlacement
              ? { pipelineSemanticPlacement: true }
              : {}),
            ...(ctx.pipelineSwimlaneLaneRise
              ? { pipelineSwimlaneLaneRise: true }
              : {}),
            // Echo the POST-guard reorder arm (the guard drops it when crossingMin
            // wins) so the meta never claims an ordering pass the engine didn't run.
            ...(pipelineOptions.reorder ? { pipelineReorder: true } : {}),
            ...(pipelineOptions.crossingMin
              ? { pipelineCrossingMin: true }
              : {}),
            // Observable backstop: both ordering passes were requested; the guard kept
            // the hierarchical crossing-min and dropped the leaf reorder (superset wins).
            ...(orderingConflict ? { pipelineOrderingConflict: true } : {}),
            // De-band depth echo — omit "none" (the identity ⇒ OFF byte-identical). Echo the
            // legacy `pipelineSubnetDeBand` boolean too when the level is "subnet" (back-compat
            // for existing assertions / the dev plugin's boolean-flag view).
            ...((ctx.pipelineDeBandLevel ?? "none") !== "none"
              ? { pipelineDeBandLevel: ctx.pipelineDeBandLevel }
              : {}),
            ...((ctx.pipelineDeBandLevel ?? "none") === "subnet"
              ? { pipelineSubnetDeBand: true }
              : {}),
            ...(pipelineOptions.rankSeparate
              ? { pipelineRankSeparate: true }
              : {}),
            // Observable footgun backstop: the user asked for rankSeparate but it
            // was dropped because the lane-rise was off (URL/programmatic path).
            ...(rankSeparateSuppressed
              ? { pipelineRankSeparateSuppressed: true }
              : {}),
            ...(ctx.pipelineStraighten ? { pipelineStraighten: true } : {}),
            // Echo the POST-guard coordRepack arm (the guard drops it when straighten
            // is off) so the meta never claims a re-pack the engine didn't run.
            ...(pipelineOptions.coordRepack
              ? { pipelineCoordRepack: true }
              : {}),
            // Observable footgun backstop: the user asked for coordRepack but it was
            // dropped because straighten was off (URL/programmatic path).
            ...(coordRepackSuppressed
              ? { pipelineCoordRepackSuppressed: true }
              : {}),
            // "Column packing": echo the applied arm, plus the legacy `pipelineDeDensify`
            // flag when spread (back-compat for existing M5b assertions / dev plugin).
            ...(appliedColumnPacking !== "none"
              ? { pipelineColumnPacking: appliedColumnPacking }
              : {}),
            ...(appliedColumnPacking === "spread"
              ? { pipelineDeDensify: true }
              : {}),
            // Honest packing meta (owner decision SDEC-26): "Column packing" is only
            // CONSUMED by the rcll builder (columnCompact / networkSimplexRank /
            // deDensify are rcll-only options) — every other variant, INCLUDING the
            // Strata S0a passthrough, silently ignores it. Surface that so the meta
            // never implies a packing pass ran when the active variant can't run one.
            ...(appliedColumnPacking !== "none" &&
            ctx.pipelineLayoutVariant !== "rcll"
              ? { pipelineColumnPackingInert: true }
              : {}),
            // Observable backstop: both packing arms requested at the engine level; the
            // guard kept Compact and dropped Spread.
            ...(columnPackingConflict
              ? { pipelineColumnPackingConflict: true }
              : {}),
            // Observable backstop: "shorten" (NS) dropped a conflicting `deDensify`.
            ...(networkSimplexRankConflict
              ? { pipelineNetworkSimplexRankConflict: true }
              : {}),
            // Observable footgun backstop: the user asked for "shorten" (NS) but it was
            // dropped because a live rankSeparate (the dominant height lever) owns the
            // column axis — the layout is the rankSeparate one, NOT a regressed NS one.
            ...(networkSimplexSuppressedByRankSeparate
              ? { pipelineNetworkSimplexRankSuppressed: true }
              : {}),
            ...(ctx.pipelineStaircaseBandOverlap === false
              ? { pipelineStaircaseBandOverlap: false }
              : {}),
            // "Layout" profile echo — omit `balanced` (the identity ⇒ OFF byte-identical,
            // like `columnPacking:"none"` / `staircaseBandOverlap:true` are omitted).
            ...(ctx.pipelineLayoutProfile &&
            ctx.pipelineLayoutProfile !== "balanced"
              ? { pipelineLayoutProfile: ctx.pipelineLayoutProfile }
              : {}),
            importSource: ctx.importSource,
            plannedChanges: ctx.importSource !== "state-only",
          },
          ctx.sources,
          formatImportWarnings(
            [...ctx.importWarnings, ...pipelineScene.warnings],
            ctx.tfdWarnings,
            ctx.tfdErrors,
          ),
          { stackIds: ctx.stackIds, addressToStack: ctx.addressToStack },
        ),
      };
    },
  );
}

async function buildSemanticLayoutSceneBody(
  ctx: LayoutSceneContext,
): Promise<Record<string, unknown>> {
  return withTerraformLayoutColorModeAsync(
    ctx.colorMode ?? TERRAFORM_COLOR_MODE_DEFAULT,
    async () => {
      type SemanticPlan = Parameters<
        typeof extractTerraformTopologyFromPlan
      >[0];
      const semPlan = ctx.plan as SemanticPlan;
      const awsPlan = filterPlanByProviderFamily(semPlan, "aws");
      const providerBuckets = partitionResourceChangesByProviderFamily(semPlan);

      const providerBlocks: ProviderTopologyBlock[] = [];
      let topoMeta: Record<string, unknown> = {
        layoutEngine: "topology",
        accountCount: 0,
        regionCount: 0,
        vpcCount: 0,
        subnetCount: 0,
        primaryResourceCount: 0,
        regionalPrimaryCount: 0,
        vpcEndpointCount: 0,
        routeTableCount: 0,
        dependencyEdgeCount: 0,
      };
      let layoutFiles: Record<string, unknown> | undefined;

      const awsChanges = providerBuckets.get("aws") ?? [];
      if (awsChanges.length > 0) {
        const privateApiRegionalOpts = {
          privateApiRegional: ctx.pipelinePrivateApiRegional,
        };
        const topoModel = extractTerraformTopologyFromPlan(awsPlan);
        const zones = buildMergedTopologyZones(awsPlan, privateApiRegionalOpts);
        const regionalBuckets = extractRegionalTopologyPrimaries(
          awsPlan,
          privateApiRegionalOpts,
        );
        const vpcEndpointBucketsRaw = extractVpcEndpointsByVpc(awsPlan);
        const {
          byZone: interfaceVpcEndpointZonePlacements,
          zonePlacedAddresses,
        } = computeInterfaceVpcEndpointZonePlacements(awsPlan, zones);
        const vpcEndpointBuckets =
          filterVpcEndpointBucketsRemovingZonePlacedAddresses(
            vpcEndpointBucketsRaw,
            zonePlacedAddresses,
          );
        const routeTableBuckets = extractRouteTablesByVpc(awsPlan);
        const { vpcDefaultPlumbingBuckets, natZonePlacements } =
          buildVpcDefaultPlumbingWithNat(awsPlan, zones);
        const vpcFlowLogBuckets = extractVpcFlowLogBundles(awsPlan);
        const endpointSecurityGroupBuckets =
          extractInterfaceEndpointSecurityGroupBuckets(
            awsPlan,
            vpcEndpointBucketsRaw,
          );
        const routeTableBottomPlacements =
          computeRouteTableBottomEdgePlacements(zones, awsPlan);
        mergeTopologyModelWithPlacementZones(topoModel, zones);
        mergeTopologyModelWithRegionalBuckets(topoModel, regionalBuckets);
        mergeTopologyModelWithVpcEndpoints(topoModel, vpcEndpointBuckets);
        mergeTopologyModelWithRouteTables(topoModel, routeTableBuckets);
        mergeTopologyModelWithVpcDefaults(topoModel, vpcDefaultPlumbingBuckets);
        mergeTopologyModelWithRouteTables(topoModel, vpcFlowLogBuckets);
        mergeTopologyModelWithRouteTables(
          topoModel,
          endpointSecurityGroupBuckets,
        );

        const enrichPreplaced = collectTopologyPreplacedAddresses([
          ...zones,
          ...regionalBuckets,
          ...vpcEndpointBuckets,
          ...routeTableBuckets,
          ...vpcDefaultPlumbingBuckets,
          ...vpcFlowLogBuckets,
          ...endpointSecurityGroupBuckets,
        ]);
        for (const address of natZonePlacements.consumedAddresses) {
          enrichPreplaced.add(address);
        }
        for (const address of zonePlacedAddresses) {
          enrichPreplaced.add(address);
        }
        for (const address of collectRouteAddressesFromBottomPlacements(
          routeTableBottomPlacements,
        )) {
          enrichPreplaced.add(address);
        }
        enrichAndReconcileTopologyPlacements(
          {
            zones,
            regionalBuckets,
            vpcDefaultPlumbingBuckets,
            natZonePlacements,
          },
          awsPlan,
          ctx.nodes5,
          enrichPreplaced,
        );

        if (topoModel.accounts.size > 0) {
          const topoScene = await buildTerraformTopologyExcalidrawScene(
            topoModel,
            zones,
            regionalBuckets,
            ctx.nodes5,
            awsPlan,
            vpcEndpointBuckets,
            routeTableBottomPlacements,
            vpcDefaultPlumbingBuckets,
            vpcFlowLogBuckets,
            endpointSecurityGroupBuckets,
            natZonePlacements,
            interfaceVpcEndpointZonePlacements,
            ctx.deferDecorations,
          );
          if (topoScene.elements.length > 0) {
            providerBlocks.push({
              family: "aws",
              label: "AWS",
              elements: topoScene.elements,
            });
          }
          topoMeta = { ...topoScene.meta };
          if (topoScene.files && Object.keys(topoScene.files).length > 0) {
            layoutFiles = topoScene.files;
          }
        }
      }

      for (const family of sortedNonAwsProviderFamilies(providerBuckets)) {
        const changes = providerBuckets.get(family)!;
        const providerScene = await buildProviderFamilyScene(
          family,
          getProviderFamilyLabel(family),
          changes,
          ctx.nodes5,
          semPlan,
        );
        if (providerScene.elements.length > 0) {
          providerBlocks.push({
            family,
            label: getProviderFamilyLabel(family),
            elements: providerScene.elements,
          });
        }
      }

      const composedElements =
        composeMultiProviderTopologyScene(providerBlocks);
      const represented = collectSemanticRepresentedResourceAddresses(
        composedElements as Array<{ customData?: Record<string, any> }>,
        semPlan as {
          resource_changes?: Array<{ address?: string; type?: string }>;
        },
      );
      const omittedSemanticResources = (semPlan.resource_changes || []).filter(
        (rc: { address?: string; type?: string }) =>
          typeof rc.address === "string" &&
          !represented.has(rc.address) &&
          SEMANTIC_LAYOUT_OMITTED_TYPES.has(rc.type || ""),
      );
      emitLocalParseDebug({
        phase: "topologyLayout",
        meta: topoMeta,
        elementCount: composedElements.length,
        providerBlockCount: providerBlocks.length,
      });
      return {
        ...EMPTY_TERRAFORM_EXCALIDRAW_SCENE,
        elements: composedElements,
        ...(layoutFiles ? { files: layoutFiles } : {}),
        meta: appendImportMeta(
          {
            ...topoMeta,
            importSource: ctx.importSource,
            plannedChanges: ctx.importSource !== "state-only",
            representedResourceCount: represented.size,
            omittedResourceCount: omittedSemanticResources.length,
            providerBlockCount: providerBlocks.length,
          },
          ctx.sources,
          formatImportWarnings(
            ctx.importWarnings,
            ctx.tfdWarnings,
            ctx.tfdErrors,
          ),
          { stackIds: ctx.stackIds, addressToStack: ctx.addressToStack },
        ),
      };
    },
  );
}

async function buildModuleLayoutSceneBody(
  ctx: LayoutSceneContext,
  moduleLayoutOptions?: TerraformLayoutOptions["moduleLayoutOptions"],
): Promise<Record<string, unknown>> {
  const elkScene = await buildTerraformElkExcalidrawScene(
    ctx.nodes5,
    ctx.plan,
    moduleLayoutOptions,
  );
  emitLocalParseDebug({
    phase: "elkLayout",
    meta: elkScene.meta,
    elementCount: elkScene.elements.length,
  });
  return {
    ...EMPTY_TERRAFORM_EXCALIDRAW_SCENE,
    elements: elkScene.elements,
    meta: appendImportMeta(
      {
        ...elkScene.meta,
        importSource: ctx.importSource,
        plannedChanges: ctx.importSource !== "state-only",
      },
      ctx.sources,
      formatImportWarnings(ctx.importWarnings, ctx.tfdWarnings, ctx.tfdErrors),
    ),
  };
}

/** Sequential layout (main-thread fallback and single-bundle paths). */
// eslint-disable-next-line sonarjs/cognitive-complexity
export async function layoutTerraformFromSources(
  sources: TerraformPlanParsingSources,
  options?: TerraformLayoutOptions,
): Promise<LayoutTerraformResult> {
  const compositionResult = applyTfdCompositionToLayoutSources(
    sources,
    options,
  );
  if ("ok" in compositionResult) {
    return compositionResult;
  }
  sources = compositionResult.sources;

  const layoutMode =
    options?.layoutMode ??
    (options?.semanticLayout === true ? "semantic" : "module");
  const semanticLayout = layoutMode === "semantic";
  // RCLL and Strata view ride the pipeline family (need TFD edges, same
  // validation + routing); RCLL M0 delegates to the compound builder via the
  // §27 fallback rung, Strata S0a delegates to the v2 builder (passthrough).
  const pipelineLayout =
    layoutMode === "pipeline" ||
    layoutMode === "rcll" ||
    layoutMode === "strata";
  if (sources.planDotBundles.length > 0) {
    terraformImportProfilerMeasure("prep.cache", () => {
      buildTerraformImportPrepCache(sources, options);
    });
  } else {
    clearTerraformImportPrepCache();
  }

  const planResolution = terraformImportProfilerMeasure("merge.plans", () =>
    resolveLayoutPlanFromSources(sources),
  );
  if (!planResolution.ok) {
    return planResolution;
  }
  const {
    plan,
    adjacency,
    importSource,
    sourcePlans,
    stackIds,
    addressToStack,
    importWarnings,
  } = planResolution;
  const states = sources.states ?? [];

  const layoutValidation = validateLayoutPlanForMode(
    plan,
    semanticLayout,
    pipelineLayout,
  );
  if (!layoutValidation.ok) {
    return layoutValidation;
  }

  const graph = graphlibDot.read("digraph G {}\n");

  emitLocalParseDebug({
    phase: "init",
    plan,
    states,
    bundleCount: sources.planDotBundles.length,
  });

  const tfdTexts = [
    ...sources.tfdTexts.filter((t) => t.trim()),
    ...(options?.dataflowLinks?.trim() ? [options.dataflowLinks] : []),
  ];

  const prepCache = getTerraformImportPrepCache();
  const useCachedNodes =
    prepCache &&
    prepCache.fingerprint === terraformImportPrepFingerprint(sources) &&
    states.length === 0;

  let nodes5: ReturnType<typeof buildTerraformLocalImportNodesMap>;
  let tfdErrors: string[] = [];
  let tfdWarnings: string[] = [];
  if (useCachedNodes) {
    nodes5 = prepCache.nodes;
  } else {
    nodes5 = terraformImportProfilerMeasure("parse.nodes", () =>
      buildTerraformLocalImportNodesMap(plan, graph, states, {
        adjacency,
        priorStatePlans: sourcePlans,
        stackIds,
      }),
    );
    ({ errors: tfdErrors, warnings: tfdWarnings } =
      terraformImportProfilerMeasure("parse.tfd", () =>
        applyTfdOverlayToNodes(
          nodes5,
          sources.tfdTexts,
          sources.tfdLabels,
          options?.dataflowLinks,
        ),
      ));
  }

  const hasTfdEdgeSyntax = tfdTexts.some((t) => /\S+\s*->\s*\S+/.test(t));
  const declaredEdges = nodes5[DECLARED_DATAFLOW_ORDERED_KEY];
  if (hasTfdEdgeSyntax && (!declaredEdges || declaredEdges.length === 0)) {
    return {
      ok: false,
      status: 400,
      error:
        "Dataflow links (.tfd) could not be resolved to any resources in the merged import.",
    };
  }
  if (pipelineLayout && (!declaredEdges || declaredEdges.length === 0)) {
    return {
      ok: false,
      status: 400,
      error: "Pipeline view requires at least one resolved .tfd dataflow edge.",
    };
  }

  emitLocalParseDebug({
    phase: "planParsed_through_moduleTree",
    nodes: nodes5,
    moduleTree: nodes5[TERRAFORM_MODULE_TREE_KEY],
  });

  // "Layout" profile expansion — one place the outcome-first profile becomes the seven RCLL
  // flags. An explicitly-set individual option (`options.pipelineX`) overrides the profile;
  // absent ⇒ the profile's value; no profile ⇒ today's defaults (false / undefined). The
  // dialog fans the profile into the flags itself, so on that path `pf` is absent and the
  // explicit flags carry the choice (byte-identical to pre-profile behavior).
  const pf = options?.pipelineLayoutProfile
    ? resolveRcllLayoutProfile(options.pipelineLayoutProfile)
    : undefined;

  const sceneContext: LayoutSceneContext = {
    sources,
    plan,
    nodes5,
    importSource,
    importWarnings,
    tfdErrors,
    tfdWarnings,
    stackIds,
    addressToStack,
    deferDecorations: options?.deferDecorations === true,
    pipelineCompact: options?.pipelineCompact,
    // Engine-core clamp (load-bearing, enforced regardless of entry path —
    // direct/worker/dialog/demo/semantic): private-API regional placement is a
    // strata-only, ALWAYS-ON property. owner-decisions.md 2026-07-17 (Q9):
    // "remove that button, default is ON, private apis are regional." So strata
    // FORCES the flag true here — the caller's value is IGNORED (a strata URL
    // carrying the legacy `privateApiRegional=0` param can no longer turn it
    // off; the param is still parsed for reversibility but is inert for strata).
    // Every non-strata layoutMode forces it false (it collides/gate-fails on
    // v2/rcll/compound/pipeline/semantic), so those stay byte-identical no
    // matter what the caller passed. sceneContext is the single fan-in —
    // builderOptions (:601) and the meta echo (:782) both read
    // `ctx.pipelinePrivateApiRegional`, so clamping here covers every consumer.
    pipelinePrivateApiRegional: layoutMode === "strata",
    // Force the variant for RCLL / Strata so a stale-session/default variant
    // can't mis-route to the plain pipeline builder (dispatch keys on the
    // variant). Strata rides its own layoutMode (not the `pipelineVariant`
    // URL/dialog enum), so this clobber must win over any stale value there too.
    pipelineLayoutVariant:
      layoutMode === "rcll"
        ? "rcll"
        : layoutMode === "strata"
        ? "strata"
        : options?.pipelineLayoutVariant,
    pipelinePacked: options?.pipelinePacked === true,
    pipelinePackedPullLeft: options?.pipelinePackedPullLeft === true,
    pipelineIncludeAncillary: options?.pipelineIncludeAncillary === true,
    pipelineSemanticPlacement: options?.pipelineSemanticPlacement === true,
    pipelineSwimlaneLaneRise:
      options?.pipelineSwimlaneLaneRise ?? pf?.swimlaneLaneRise ?? false,
    pipelineReorder: options?.pipelineReorder ?? pf?.reorder ?? false,
    pipelineCrossingMin:
      options?.pipelineCrossingMin ?? pf?.crossingMin ?? false,
    // De-band depth: explicit enum wins, then the legacy `subnetDeBand` boolean alias,
    // then the profile's level, defaulting to "none" (today's boxed layout).
    pipelineDeBandLevel:
      options?.pipelineDeBandLevel ??
      (options?.pipelineSubnetDeBand ? "subnet" : undefined) ??
      pf?.deBandLevel ??
      "none",
    // These four were declared on the context + consumed by the pipeline body but
    // never forwarded here, so they were silently dropped on the worker/headless
    // path (`layoutTerraformFromSources`) — rankSeparate/straighten/deDensify/
    // staircaseBandOverlap did nothing from the dialog/URL. Forward them.
    pipelineRankSeparate:
      options?.pipelineRankSeparate ?? pf?.rankSeparate ?? false,
    pipelineStraighten: options?.pipelineStraighten ?? pf?.straighten ?? false,
    pipelineCoordRepack:
      options?.pipelineCoordRepack ?? pf?.coordRepack ?? false,
    pipelineDeDensify: options?.pipelineDeDensify === true,
    // "Column packing" tri-state (M5b spread / M5c compact) — same silent-drop hazard:
    // forward it or the dialog/URL toggle does nothing on the worker/headless path.
    pipelineColumnPacking: options?.pipelineColumnPacking ?? pf?.columnPacking,
    pipelineLayoutProfile: options?.pipelineLayoutProfile,
    pipelineStaircaseBandOverlap:
      options?.pipelineStaircaseBandOverlap ?? pf?.staircaseBandOverlap,
    // Strata (rcll-v2) OD-1/OD-2/A7 flags (C6′ seam 1 — the literal is the one place
    // options not listed here are silently dropped, per trap #4). S0a: accepted +
    // threaded through to the builder's meta echo; unused until the engine lands.
    strataNetworkSimplexRank: options?.strataNetworkSimplexRank === true,
    strataRankSeparate: options?.strataRankSeparate === true,
    strataJointNsRank: options?.strataJointNsRank === true,
    strataPackedScoring: options?.strataPackedScoring === true,
    strataPackedScoringEpsilon: options?.strataPackedScoringEpsilon ?? 0,
    strataBandCompact: options?.strataBandCompact === true,
    // Forward the band-depth cut RAW — omit at the default ("account") or when
    // absent, so this sceneContext literal never materializes a default own
    // key and the engine's `strataBandCompact` alias
    // (terraformPipelineStrata.ts) still resolves to "root" when only the
    // legacy boolean arrives. A non-default cut forwards unchanged.
    ...(options?.strataBandDepth !== undefined &&
    options?.strataBandDepth !== "account"
      ? { strataBandDepth: options.strataBandDepth }
      : {}),
    strataPackedFrontierMeta: options?.strataPackedFrontierMeta === true,
    strataEdgeRouting: options?.strataEdgeRouting === true,
    strataBorderRoute: options?.strataBorderRoute === true,
    strataSweeps: options?.strataSweeps ?? 0,
    strataCoordinateRefine: options?.strataCoordinateRefine === true,
    strataSiftRelocate: options?.strataSiftRelocate === true,
    strataPackedConverge: options?.strataPackedConverge === true,
    strataTransitiveAdopt: options?.strataTransitiveAdopt === true,
    strataBlockClamp: options?.strataBlockClamp === true,
    strataTranspose: options?.strataTranspose === true,
    // Chain relocate — MUST be listed in THIS sceneContext literal or it is
    // silently dropped on the real app path (RCLL threading boundary), however
    // correctly it is threaded everywhere else.
    strataChainRelocate: options?.strataChainRelocate === true,
    strataHeightGate: options?.strataHeightGate === true,
    // A01 leaf X-shift — MUST be listed in THIS literal or it is silently dropped
    // on the real app path (RCLL threading boundary), however correctly it is
    // threaded everywhere else. Budget knobs are optional-only forwards (absent ⇒
    // engine defaults 150/0.01/8/300), so the default shape is byte-identical.
    strataLeafShift: options?.strataLeafShift === true,
    ...(options?.strataLeafShiftHeightBudgetPx !== undefined
      ? { strataLeafShiftHeightBudgetPx: options.strataLeafShiftHeightBudgetPx }
      : {}),
    ...(options?.strataLeafShiftHeightBudgetFrac !== undefined
      ? {
          strataLeafShiftHeightBudgetFrac:
            options.strataLeafShiftHeightBudgetFrac,
        }
      : {}),
    ...(options?.strataLeafShiftRankBudget !== undefined
      ? { strataLeafShiftRankBudget: options.strataLeafShiftRankBudget }
      : {}),
    ...(options?.strataLeafShiftRightEdgeGuardPx !== undefined
      ? {
          strataLeafShiftRightEdgeGuardPx:
            options.strataLeafShiftRightEdgeGuardPx,
        }
      : {}),
    // Default ON (`!== false`), unlike every neighbour here: the allocator is
    // already gated behind `pipelineIncludeAncillary`. Must be listed in THIS
    // literal — an option absent from the sceneContext is silently dropped on
    // the real app path, however correctly it is threaded everywhere else.
    strataAncillaryAllocator: options?.strataAncillaryAllocator !== false,
    // OD-15 de-band — SEAM 1 (this literal; see the trap-#4 note above). Omit at
    // the default `"none"` / when absent, so the literal never materializes a
    // default own key. `"none"` is a TRUTHY string: an `&&`-truthy gate here
    // would change the sceneContext shape on every default run.
    ...(options?.strataDeBandLevel !== undefined &&
    options?.strataDeBandLevel !== "none"
      ? { strataDeBandLevel: options.strataDeBandLevel }
      : {}),
    strataCrossWeightPenetration: options?.strataCrossWeightPenetration ?? 1,
    strataCrossWeightEdge: options?.strataCrossWeightEdge ?? 1,
    // Optional-only forward: no default materialized (absent ⇒ engine
    // inherits `strataPackedScoringEpsilon`).
    ...(options?.strataEdgeCrossCap !== undefined
      ? { strataEdgeCrossCap: options.strataEdgeCrossCap }
      : {}),
    colorMode: options?.colorMode,
  };

  const sceneBody = pipelineLayout
    ? await terraformImportProfilerMeasureAsync("layout.pipeline", () =>
        buildPipelineLayoutSceneBody(sceneContext),
      )
    : semanticLayout
    ? await terraformImportProfilerMeasureAsync("layout.semantic", () =>
        buildSemanticLayoutSceneBody(sceneContext),
      )
    : await terraformImportProfilerMeasureAsync("layout.elk", () =>
        buildModuleLayoutSceneBody(sceneContext, options?.moduleLayoutOptions),
      );

  return { ok: true, scene: sceneBody };
}

export type { TerraformModuleLayoutOptions };
