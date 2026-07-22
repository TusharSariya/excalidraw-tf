import { TERRAFORM_MODULE_TREE_KEY } from "./terraformPlanMeta";
import {
  buildDataFlowEdges,
  buildNetworkingEdges,
  type PlanNodesMap,
} from "./terraformDataFlowEdges";
import {
  applyDeclaredDataFlow,
  applyDeclaredDataFlowFromMany,
  type DeclaredDataFlowEdge,
} from "./terraformDeclaredDataFlow";
import { parseRawStateJson } from "./terraformImportMerge";
import {
  collectKnownStackIdsFromNodes,
  isStackQualifiedAddress,
  parseStackAddress,
  preferTopologyNodeKeyAmongAliases,
  prefixStackAddress,
  stackGroupModulePath,
  stackQualifiedModulePath,
  topologyBareAddressKey,
} from "./terraformStackAddress";
import { dedupeTerraformPlanNodesByBareAddress } from "./terraformTopologyAddress";

import type { DECLARED_DATAFLOW_ORDERED_KEY } from "./terraformDeclaredDataFlow";

import type { TerraformModuleLayoutOptions } from "./terraformModuleLayoutOptions";

import type { Graph } from "@dagrejs/graphlib";
import type {
  TerraformImportWarning,
  TerraformPlanDotBundle,
} from "./terraformImportMerge";

import type {
  TerraformImportPresetWarning,
  TerraformImportStackCatalogEntry,
} from "./terraformImportPresetsTypes";

export type { TerraformImportWarning, TerraformPlanDotBundle };

export type TerraformPlanParsingSources = {
  planDotBundles: TerraformPlanDotBundle[];
  states: unknown[];
  stateLabels?: (string | undefined)[];
  tfdTexts: string[];
  tfdLabels?: (string | undefined)[];
  repoName?: string;
  stackCatalog?: TerraformImportStackCatalogEntry[];
  warnings?: TerraformImportPresetWarning[];
};

export { TERRAFORM_MODULE_TREE_KEY };

const TERRAFORM_MODULE_RESOURCE_TYPE = "terraform_module";

/** One node in the module tree: child modules + resource addresses declared in this module. */
export type TerraformModuleTreeNode = {
  path: string;
  modules: Record<string, TerraformModuleTreeNode>;
  resourceAddresses: string[];
};

/** Nodes map may include {@link TERRAFORM_MODULE_TREE_KEY} alongside per-address graph nodes. */
export type TerraformPlanNodesMap = Record<string, TerraformPlanGraphNode> & {
  [TERRAFORM_MODULE_TREE_KEY]?: TerraformModuleTreeNode;
  [DECLARED_DATAFLOW_ORDERED_KEY]?: DeclaredDataFlowEdge[];
};

/** One semantic data-flow edge (mirrors backend `edges_data_flow` object shape). */
export type TerraformPlanDataFlowEdge = {
  target: string;
  type?: string;
  label?: string;
  origin?: string;
  detail?: string | null;
};

/** Matches backend pipeline nodes: resources plus mutable edge buckets (see `ensureEdgeLists`). */
export type TerraformPlanGraphNode = {
  resources: Record<string, unknown>;
  edges_new?: string[];
  edges_existing?: string[];
  edges_data_flow?: Array<string | TerraformPlanDataFlowEdge>;
  edges_networking?: Array<string | TerraformPlanDataFlowEdge>;
};

/** Subset of `terraform show -json` prior_state.values.root_module shape used by `buildExistingEdges`. */
type TerraformPriorStateModule = {
  resources?: TerraformPriorStateResource[];
  child_modules?: TerraformPriorStateModule[];
};

type TerraformPriorStateResource = {
  address?: string;
  mode?: string;
  type?: string;
  depends_on?: string[];
};

// O4 floor (Track B, overnight-20260717): hoist the instance-index RegExp to
// module scope (compiled once, not re-created per call). `replace(re, "")` resets
// the `g`-flag `lastIndex` to 0 on each call, so a shared module-level regex is
// behaviorally identical to a fresh literal. This function is on both the
// plan-parse head and the scene-apply tail of the canonical trace.
const TERRAFORM_INSTANCE_INDEX_RE = /\[[^\]]+\]/g;

/** Strip `count` / `for_each` instance keys so graph ids match `terraform graph` / `depends_on` variants. */
const stripTerraformAddressIndexes = (address = "") =>
  address.replace(TERRAFORM_INSTANCE_INDEX_RE, "");

export type TerraformPlanParsingOptions = {
  /** When true, emit nested AWS topology frames (local import only); otherwise ELK module graph. */
  semanticLayout?: boolean;
  /** Preferred layout mode. `semanticLayout` is retained as a backwards-compatible input. */
  layoutMode?: import("./terraformImportDialogUtils").TerraformLayoutMode;
  /** Optional `.tfd` arrow-only dataflow overlay (single file; prefer `tfdTexts` on sources). */
  dataflowLinks?: string;
  /** Module-view intra-module packing (ignored when semanticLayout is true). */
  moduleLayoutOptions?: TerraformModuleLayoutOptions;
  /** Resolve TFD `use` artifact refs from the global artifact library. */
  artifactLoader?: (
    ref: { repoName: string; relativePath: string },
    kind: "plan" | "dot" | "state",
  ) => { content: string } | null | undefined;
  /** Experimental: skip icon/glyph decoration during first semantic pass. */
  deferDecorations?: boolean;
  /**
   * Pipeline view: when true (default) each cluster renders only the primary card.
   * Satellites are added on demand when the user clicks the card.
   */
  pipelineCompact?: boolean;
  /** Pipeline layout: classic global grid or compound hierarchy containers. */
  pipelineLayoutVariant?: import("./terraformImportDialogUtils").PipelineLayoutVariant;
  /** Pipeline layout: enable cross-lane column slack packing (experimental). */
  pipelinePacked?: boolean;
  /** Packed only: pull slack clusters to their leftmost TFD-feasible column. */
  pipelinePackedPullLeft?: boolean;
  /** Pipeline: also draw non-TFD resources in per-hull "Unconnected" strips. */
  pipelineIncludeAncillary?: boolean;
  /**
   * Pipeline (opt-in, default off): private VPC-endpoint-bound REST APIs
   * (`aws_api_gateway_rest_api` with `endpoint_configuration.types = ["PRIVATE"]`)
   * are placed at ACCOUNT+REGION level with a companion-inferred owning account,
   * instead of nested inside a VPC/subnet. OFF ⇒ byte-identical topology extraction.
   */
  pipelinePrivateApiRegional?: boolean;
  /**
   * Pipeline (opt-in, default off): nesting-aware semantic placement —
   * role-based forced topology bands + deterministic dataflow straightening.
   */
  pipelineSemanticPlacement?: boolean;
  /**
   * RCLL M4 (opt-in, default off): inside a swimlane, X-disjoint lanes rise to
   * share Y rows (DEC-1 extended to swimlane interiors), reclaiming height while
   * keeping the shared column axis (CON-12-safe).
   */
  pipelineSwimlaneLaneRise?: boolean;
  /** RCLL M6: per-container barycenter crossing-min reorder (A/B toggle). */
  pipelineReorder?: boolean;
  /** RCLL M6c: container-aware crossing minimization (hierarchical superset of reorder). */
  pipelineCrossingMin?: boolean;
  /** RCLL de-band depth: dissolve the chosen container level + all deeper levels into one
   * shared column stack (frames → rails). `none` = today's boxed layout. */
  pipelineDeBandLevel?: import("./terraformPipelineLayoutProfiles").DeBandLevel;
  /** Back-compat alias for `pipelineDeBandLevel: "subnet"`. `pipelineDeBandLevel` wins. */
  pipelineSubnetDeBand?: boolean;
  /** RCLL M8r: whole-model-global sibling-separation ranking (needs lane-rise). */
  pipelineRankSeparate?: boolean;
  /** RCLL M5: Brandes–Köpf leaf straightening (Y-only spine alignment). */
  pipelineStraighten?: boolean;
  /** RCLL M5b: coordinated per-column permutation re-pack (refines straighten). */
  pipelineCoordRepack?: boolean;
  /** RCLL M5b: de-density — spread crowded columns one column right. */
  pipelineDeDensify?: boolean;
  /** RCLL "Column packing" tri-state: `spread` = M5b de-density (pull-right), `compact`
   * = M5c column compaction (pull-left), `none` = neither. The single front-door enum;
   * supersedes `pipelineDeDensify` (kept as a legacy alias ⇒ `spread`). Default `none`. */
  pipelineColumnPacking?: "spread" | "none" | "compact" | "shorten";
  /** RCLL "Layout" profile — outcome-first preset (`readable | balanced | compact`) that
   * expands into the RCLL flags above. `balanced` = today's defaults (byte-identical). An
   * explicitly-set individual flag overrides the profile. See terraformPipelineLayoutProfiles. */
  pipelineLayoutProfile?: import("./terraformPipelineLayoutProfiles").RcllLayoutProfile;
  /** RCLL M3b / DEC-1: X-disjoint cycle groups rise to share Y. Default on; only `=false` is meaningful. */
  pipelineStaircaseBandOverlap?: boolean;
  /** Strata (rcll-v2) OD-1: X-axis network-simplex rank refinement. S0a: accepted +
   * threaded, unused until the engine lands (M1). Default off. */
  strataNetworkSimplexRank?: boolean;
  /** Strata OD-14: whole-model sibling-separation ranking (the height lever). When
   * on the separated floor REPLACES the A1 rank; mutually exclusive with
   * `strataNetworkSimplexRank` (rankSeparate wins). Default off. */
  strataRankSeparate?: boolean;
  /** EXPERIMENTAL W5b probe (round-8 R8-F9): joint constrained-NS refinement of
   * the separated floor. Harness-only, default off; inert without rankSeparate. */
  strataJointNsRank?: boolean;
  /** Strata round 9 (SDEC-57): whole-layout candidate-set scoring for packed-hull
   * ordering (real-skyline trials; lexicographic crossings → penetrations →
   * length). Default off. */
  strataPackedScoring?: boolean;
  /** Strata W8b: ε-constraint crossings budget for the packed scorer (0 = strict). */
  strataPackedScoringEpsilon?: number;
  /** Strata W8b frontier instrumentation (report-only dev seam; harness-only). */
  strataPackedFrontierMeta?: boolean;
  /** Strata Package C spike (W9): post-A7 obstacle-avoiding edge routing
   * ("penetrating-only" scene-build detours). Default off. */
  strataEdgeRouting?: boolean;
  /** Strata P3-pierce: clean single-side container-exit routing. Default off. */
  strataBorderRoute?: boolean;
  /** Strata W10 (SDEC-63): banded row-share compaction lever. Default off;
   * primarily effective with rankSeparate. LEGACY ALIAS for
   * `strataBandDepth: "root"`. */
  strataBandCompact?: boolean;
  /** Strata v3.2: band-depth slider cut — the deepest role still banded.
   * Default "account" (today's fixed role→policy map, byte-identical). */
  strataBandDepth?: import("./terraformPipelineStrataTypes").StrataHullRole;
  /** Strata OD-2: directional sweep count for A2 ordering. S0a: accepted + threaded,
   * unused until the engine lands (M1). Default 0 (M1a; 4 in M1b). */
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
  /** P4 pure-sink account block clamp: rigid-translate a dead-end account subtree
   * left toward its sources. Default off. */
  strataBlockClamp?: boolean;
  /** P2 within-column transpose: swap Y-adjacent X-overlapping sibling pairs to
   * remove leftover diagonal crossings. Default off. */
  strataTranspose?: boolean;
  /** Exclusive-downstream chain relocate: rigid Y co-translation of a unit and
   * its exclusive downstream group. Default off. */
  strataChainRelocate?: boolean;
  /** A7 tie-cascade (extends coordinateRefine): let a net-zero fixed-point column
   * escape to its two-sided median and chase chord-connected downstreams. Default
   * off. */
  strataCoordCascade?: boolean;
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
   *  `pipelineIncludeAncillary` is also on, so it cannot affect the default
   *  ("Connected only") scene. */
  strataAncillaryAllocator?: boolean;
  /** OD-15 de-band port: dissolve this hierarchy level and every deeper one at
   * the Strata model build (structure phase). Default "none" (byte-identical).
   * Suppressed when the absorbing parent stays banded under `strataBandDepth`. */
  strataDeBandLevel?: import("./terraformPipelineLayoutProfiles").DeBandLevel;
  /** Frame tint mode for pipeline/semantic topology views. */
  colorMode?: import("./terraformPrimaryVisibility").TerraformColorMode;
};

type BuildNodesMapOptions = {
  priorStatePlans?: unknown[];
  adjacency?: Record<string, string[]>;
  /** Parallel to `tfstate` files when multi-stack; used to avoid unqualified ghost nodes. */
  stackIds?: string[];
};

const DATA_SOURCE_GRAPH_ALLOWLIST = new Set(["aws_iam_policy_document"]);

function isExcludedDataSourceAddressForGraph(address: string): boolean {
  const parts = stripTerraformAddressIndexes(address).split(".");
  const di = parts.indexOf("data");
  if (di === -1 || di >= parts.length - 2) {
    return false;
  }
  const sourceType = parts[di + 1] || "";
  return !DATA_SOURCE_GRAPH_ALLOWLIST.has(sourceType);
}

type TerraformStateResource = {
  module?: string;
  mode?: string;
  type?: string;
  name?: string;
  provider?: string;
  instances?: Array<{
    index_key?: unknown;
    attributes?: Record<string, unknown>;
    schema_version?: number;
    private?: unknown;
    dependencies?: string[];
  }>;
};

/** Builds the Terraform state address for one resource instance (mirrors backend `getStateResourceAddress`). */
function getStateResourceAddress(
  resource: TerraformStateResource,
  instance: NonNullable<TerraformStateResource["instances"]>[number],
): string {
  const parts: string[] = [];
  if (resource.module) {
    parts.push(resource.module);
  }
  if (resource.mode === "data") {
    parts.push("data");
  }
  parts.push(resource.type || "", resource.name || "");
  let address = parts.join(".");
  if (Object.prototype.hasOwnProperty.call(instance, "index_key")) {
    const key = instance.index_key;
    address +=
      typeof key === "number" ? `[${key}]` : `[${JSON.stringify(key)}]`;
  }
  return address;
}

const STATE_MERGE_PLACEHOLDER_ACTIONS = new Set(["existing", "read"]);

/** Keep real plan `change.actions` when enriching nodes from raw tfstate. */
function preferPlanChangeForStateMerge(existingChange: unknown): {
  actions: string[];
} {
  const change = existingChange as { actions?: unknown } | undefined;
  const actions = Array.isArray(change?.actions)
    ? change.actions.filter(
        (action): action is string =>
          typeof action === "string" && action.length > 0,
      )
    : [];
  if (
    actions.length > 0 &&
    !actions.every((action) => STATE_MERGE_PLACEHOLDER_ACTIONS.has(action))
  ) {
    return change as { actions: string[] };
  }
  return { actions: ["existing"] };
}

/** Merges raw tfstate `resources` into nodes (same semantics as backend `mergeTerraformState`). */
function mergeRawTerraformStateIntoNodes(
  nodes: Record<string, TerraformPlanGraphNode>,
  state: unknown,
  stackId?: string,
): Record<string, TerraformPlanGraphNode> {
  if (!state || typeof state !== "object") {
    return nodes;
  }
  const resources = (state as { resources?: unknown }).resources;
  if (!Array.isArray(resources)) {
    return nodes;
  }

  for (const resource of resources as TerraformStateResource[]) {
    if (
      resource.mode === "data" &&
      resource.type &&
      !DATA_SOURCE_GRAPH_ALLOWLIST.has(resource.type)
    ) {
      continue;
    }

    for (const instance of resource.instances || []) {
      const rawAddress = getStateResourceAddress(resource, instance);
      const address =
        stackId?.trim() && !isStackQualifiedAddress(rawAddress)
          ? prefixStackAddress(stackId.trim(), rawAddress)
          : rawAddress;
      const nodePath = address;

      if (!nodes[nodePath]) {
        nodes[nodePath] = { resources: {} };
      }

      const existingResource = (nodes[nodePath].resources[address] ||
        {}) as Record<string, unknown>;
      nodes[nodePath].resources[address] = {
        ...existingResource,
        address,
        mode: resource.mode,
        type: resource.type,
        name: resource.name,
        provider_name: resource.provider,
        values: {
          ...((instance.attributes || {}) as Record<string, unknown>),
          ...(existingResource.values as Record<string, unknown> | undefined),
        },
        change: preferPlanChangeForStateMerge(existingResource.change),
        terraform_state: {
          schema_version: instance.schema_version,
          private: Boolean(instance.private),
          dependencies: instance.dependencies || [],
        },
      };

      nodes[nodePath].edges_existing ||= [];
      for (const dependency of instance.dependencies || []) {
        if (!dependency || isExcludedDataSourceAddressForGraph(dependency)) {
          continue;
        }
        const qualifiedDep =
          stackId?.trim() && !isStackQualifiedAddress(dependency)
            ? prefixStackAddress(stackId.trim(), dependency)
            : dependency;
        const target = resolveTerraformPlanNodeKey(nodes, qualifiedDep);
        if (
          target &&
          target !== nodePath &&
          !nodes[nodePath].edges_existing!.includes(target)
        ) {
          nodes[nodePath].edges_existing!.push(target);
        }
      }
    }
  }

  return nodes;
}

/**
 * Builds the same `nodes` map as local import (`loadPlan` → edges → `attachModuleTree`), for
 * tooling/tests that need vertex keys without rendering a scene.
 */
function normalizeTfstateList(tfstate?: unknown | null | unknown[]): unknown[] {
  if (Array.isArray(tfstate)) {
    return tfstate;
  }
  if (tfstate != null) {
    return [tfstate];
  }
  return [];
}

export function buildTerraformLocalImportNodesMap(
  plan: unknown,
  graph: Graph,
  tfstate?: unknown | null | unknown[],
  options?: BuildNodesMapOptions,
): TerraformPlanNodesMap {
  const adjacency = options?.adjacency ?? getAdjacencyListFromDot(graph);
  const planTyped = plan as {
    resource_changes: { address: string }[];
    prior_state?: { values: { root_module: unknown } };
  };
  let nodes = loadPlan(planTyped);
  const stackIds = options?.stackIds ?? [];
  const stateList = normalizeTfstateList(tfstate);
  for (let si = 0; si < stateList.length; si++) {
    const stackId = stackIds[si]?.trim();
    nodes = mergeRawTerraformStateIntoNodes(
      nodes,
      stateList[si]!,
      stackId || undefined,
    );
  }
  nodes = dedupeTerraformPlanNodesByBareAddress(nodes);
  const nodes2 = sanitizeTerraformPlanNodes(ensureEdgeLists(nodes));
  const nodes3 = buildNewEdges(nodes2, adjacency);
  let nodes4 = nodes3;
  const priorPlans = options?.priorStatePlans?.length
    ? options.priorStatePlans
    : [planTyped];
  for (const priorPlan of priorPlans) {
    const root = (
      priorPlan as { prior_state?: { values?: { root_module?: unknown } } }
    )?.prior_state?.values?.root_module;
    if (root) {
      nodes4 = buildExistingEdges(
        nodes4,
        priorPlan as { prior_state: { values: { root_module: unknown } } },
      );
    }
  }
  const sanitizedNodes = sanitizeTerraformPlanNodes(nodes4);
  const withTree = attachModuleTree(sanitizedNodes);
  buildDataFlowEdges(withTree as PlanNodesMap);
  buildNetworkingEdges(withTree as PlanNodesMap);
  return withTree;
}

/** Apply `.tfd` overlay after the nodes map is built; returns warning messages. */
export function applyTfdOverlayToNodes(
  nodes: TerraformPlanNodesMap,
  tfdTexts: string[],
  tfdLabels?: (string | undefined)[],
  legacySingleText?: string,
): { errors: string[]; warnings: string[] } {
  const texts = [
    ...tfdTexts.filter((t) => t.trim()),
    ...(legacySingleText?.trim() ? [legacySingleText] : []),
  ];
  if (texts.length === 0) {
    return { errors: [], warnings: [] };
  }
  // W14 WP2 (always-on, byte-identical): the .tfd overlay resolves every declared
  // dataflow endpoint against `nodes` via resolveTerraformPlanNodeKey
  // (applyDeclaredDataFlow / applyDeclaredDataFlowFromMany). By the time overlay
  // runs the `nodes` map is fully built and its resource-key set is frozen — the
  // only key these writers add is the `__`-prefixed DECLARED_DATAFLOW_ORDERED_KEY,
  // which the index excludes — so wrapping the whole synchronous overlay lets every
  // resolution take the O(1) indexed path. Ref-equality holds: applyDeclaredDataFlow*
  // thread this exact `nodes` object straight through to the resolver. This wrap
  // covers both call sites (terraformLayoutCore `parse.tfd` and the prep-cache build),
  // each of which passes the frozen post-build map.
  return withTerraformPlanNodeKeyIndex(
    nodes as Record<string, TerraformPlanGraphNode>,
    () => {
      if (texts.length === 1 && tfdTexts.length === 0 && legacySingleText) {
        const { errors, warnings } = applyDeclaredDataFlow(
          nodes as Record<string, TerraformPlanGraphNode>,
          texts[0],
        );
        return { errors, warnings };
      }
      const { errors, warnings } = applyDeclaredDataFlowFromMany(
        nodes as Record<string, TerraformPlanGraphNode>,
        texts,
        tfdLabels,
      );
      return { errors, warnings };
    },
  );
}

/** Multi-file local import (plans, states, `.tfd` overlays). */
export const terraformPlanParsingFromSources = async (
  sources: TerraformPlanParsingSources,
  options?: TerraformPlanParsingOptions,
) => {
  const { layoutTerraformFromSources } = await import("./terraformLayoutCore");
  const result = await layoutTerraformFromSources(sources, options);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: result.status ?? 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify(result.scene), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export { layoutTerraformFromSources } from "./terraformLayoutCore";
export type {
  LayoutTerraformResult,
  TerraformLayoutOptions,
} from "./terraformLayoutCore";

/** Single-file import API (delegates to {@link terraformPlanParsingFromSources}). */
export const terraformPlanParsing = async (
  planFile: File | null,
  dotFile: File | null,
  stateFile: File | null,
  options?: TerraformPlanParsingOptions,
) => {
  const planDotBundles: TerraformPlanDotBundle[] = [];
  const states: unknown[] = [];

  if (planFile && dotFile) {
    const [planText, dotText] = await Promise.all([
      planFile.text(),
      dotFile.text(),
    ]);
    try {
      planDotBundles.push({
        plan: JSON.parse(planText),
        dotText,
        label: planFile.name,
      });
    } catch {
      return new Response(
        JSON.stringify({ error: "planFile must be valid JSON." }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
  } else if (planFile || dotFile) {
    return new Response(
      JSON.stringify({
        error:
          "Plan JSON and graph DOT must be selected together, or clear both and upload state file(s) alone.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  if (stateFile) {
    const stateText = await stateFile.text();
    const parsed = parseRawStateJson(stateText);
    if (!parsed.ok) {
      return new Response(JSON.stringify({ error: parsed.error }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    states.push(parsed.state);
  }

  if (planDotBundles.length === 0 && states.length === 0) {
    return new Response(
      JSON.stringify({
        error:
          "Upload plan JSON + DOT together, or one or more raw Terraform state files.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  return terraformPlanParsingFromSources(
    {
      planDotBundles,
      states,
      stateLabels: states.length ? [stateFile?.name] : undefined,
      tfdTexts: [],
    },
    options,
  );
};

const sanitizeDotNodeId = (nodeId = "") => {
  const parts = String(nodeId).trim().split(" ");
  const raw = parts.length >= 2 ? parts[1] : parts[0] || "";
  return raw.replace(/["\\]/g, "");
};

function getAdjacencyListFromDot(graph: Graph) {
  const adjacency: Record<string, string[]> = {};

  for (const { v, w } of graph.edges()) {
    const source = sanitizeDotNodeId(v);
    const target = sanitizeDotNodeId(w);
    if (!adjacency[source]) {
      adjacency[source] = [];
    }
    if (!adjacency[source].includes(target)) {
      adjacency[source].push(target);
    }
  }

  return adjacency;
}

/**
 * Scoped, per-build index of `nodes` keys for {@link resolveTerraformPlanNodeKey}, keyed two ways
 * (`byBareKey` via {@link topologyBareAddressKey}, `byGraphId` via `stripTerraformAddressIndexes`) plus a
 * precomputed `knownStackIds` list (mirrors {@link collectKnownStackIdsFromNodes}). Built once per
 * {@link withTerraformPlanNodeKeyIndex} scope to avoid repeated O(N) `Object.keys(nodes)` scans across the
 * ~12,000 resolver calls in a single pipeline-prep build. See
 * `docs/terraform-pipeline-import-stateful-newell.md`-style perf plans for the rationale; the two maps must stay
 * separate (`topologyBareAddressKey` strips the stack prefix before stripping indexes, `stripTerraformAddressIndexes`
 * does not strip the stack prefix at all — merging them would change ambiguity resolution).
 */
type TerraformPlanNodeKeyIndex = {
  byBareKey: Map<string, string[]>;
  byGraphId: Map<string, string[]>;
  knownStackIds: string[];
};

function buildTerraformPlanNodeKeyIndex(
  nodes: Record<string, TerraformPlanGraphNode>,
): TerraformPlanNodeKeyIndex {
  const byBareKey = new Map<string, string[]>();
  const byGraphId = new Map<string, string[]>();
  const stackIds = new Set<string>();
  const knownStackIds: string[] = [];

  for (const k of Object.keys(nodes)) {
    if (k === TERRAFORM_MODULE_TREE_KEY || k.startsWith("__")) {
      continue;
    }

    const bareKey = topologyBareAddressKey(k);
    const bareGroup = byBareKey.get(bareKey);
    if (bareGroup) {
      bareGroup.push(k);
    } else {
      byBareKey.set(bareKey, [k]);
    }

    const graphId = stripTerraformAddressIndexes(k);
    const graphGroup = byGraphId.get(graphId);
    if (graphGroup) {
      graphGroup.push(k);
    } else {
      byGraphId.set(graphId, [k]);
    }

    const parsed = parseStackAddress(k);
    if (parsed && !stackIds.has(parsed.stackId)) {
      stackIds.add(parsed.stackId);
      knownStackIds.push(parsed.stackId);
    }
  }

  return { byBareKey, byGraphId, knownStackIds };
}

/**
 * Incrementally fold a single newly-created `nodes` key `k` into an existing
 * {@link TerraformPlanNodeKeyIndex}, mirroring the per-key body of
 * {@link buildTerraformPlanNodeKeyIndex} exactly (same `__`/module-tree skip, same
 * `byBareKey` / `byGraphId` append order, same `knownStackIds` first-seen dedupe).
 *
 * This exists so a {@link withTerraformPlanNodeKeyIndex} scope can stay valid across a
 * key-*mutating* parse region (currently only {@link buildExistingEdges}, whose L1367
 * `nodes[nodePath] ||= …` can add a key the index didn't see at build time). Appending
 * to the tail of each bucket reproduces what a fresh rebuild would yield at that moment:
 * a new key lands last in `Object.keys(nodes)` insertion order, and the un-indexed
 * fallback scan iterates that same order — so a *later* resolve sees the new key in the
 * identical position whether it rescans `Object.keys` or reads this incrementally-grown
 * index. Register each key at most once (callers gate on genuine key creation), matching
 * the once-per-key visit of the initial build.
 */
function registerTerraformPlanNodeKeyIntoIndex(
  index: TerraformPlanNodeKeyIndex,
  k: string,
): void {
  if (k === TERRAFORM_MODULE_TREE_KEY || k.startsWith("__")) {
    return;
  }

  const bareKey = topologyBareAddressKey(k);
  const bareGroup = index.byBareKey.get(bareKey);
  if (bareGroup) {
    bareGroup.push(k);
  } else {
    index.byBareKey.set(bareKey, [k]);
  }

  const graphId = stripTerraformAddressIndexes(k);
  const graphGroup = index.byGraphId.get(graphId);
  if (graphGroup) {
    graphGroup.push(k);
  } else {
    index.byGraphId.set(graphId, [k]);
  }

  const parsed = parseStackAddress(k);
  if (parsed && !index.knownStackIds.includes(parsed.stackId)) {
    index.knownStackIds.push(parsed.stackId);
  }
}

let activePlanNodeKeyIndex: {
  nodes: object;
  index: TerraformPlanNodeKeyIndex;
} | null = null;

/**
 * Register a newly-created `nodePath` into the active {@link withTerraformPlanNodeKeyIndex}
 * scope, if one is active and was built on this exact `nodes` reference. Same ref-equality
 * guard as {@link resolveTerraformPlanNodeKey}: if no scope is active (or it belongs to a
 * different `nodes` object) this is a no-op, because that resolver path rescans
 * `Object.keys(nodes)` fresh anyway and would observe the new key without help.
 *
 * Callers MUST invoke this only for keys that genuinely did not exist in `nodes` before
 * (i.e. `Object.keys(nodes)` actually grew), so each key is folded in exactly once.
 */
function registerActiveTerraformPlanNodeKey(
  nodes: Record<string, TerraformPlanGraphNode>,
  nodePath: string,
): void {
  if (
    activePlanNodeKeyIndex === null ||
    activePlanNodeKeyIndex.nodes !== (nodes as unknown as object)
  ) {
    return;
  }
  registerTerraformPlanNodeKeyIntoIndex(activePlanNodeKeyIndex.index, nodePath);
}

/**
 * W14 WP2 fallback-scan observability (dev/profiler-only). Counts how often
 * {@link resolveTerraformPlanNodeKey} still pays the original O(N) `Object.keys(nodes)`
 * scan path instead of the O(1) indexed path:
 *   - `scanWithoutScope`: no {@link withTerraformPlanNodeKeyIndex} scope was active
 *     (e.g. the deliberately-unwrapped, key-mutating parse region
 *     `mergeRawTerraformStateIntoNodes`). NOTE: {@link buildExistingEdges} used to live
 *     here too, but is now wrapped — its lone key-mutating site (`nodes[nodePath] ||= …`)
 *     folds each newly-created key into the live scope via
 *     {@link registerActiveTerraformPlanNodeKey}, so its ~O(N²) fallback scans are gone.
 *   - `scopeRefMismatch`: a scope WAS active but was built on a different `nodes`
 *     object reference than the one the resolver received (the ref-equality guard
 *     defends against silent misresolution and falls back to scan).
 * Pure integer increments — no logging, no allocation. Read/reset via the exported
 * helpers below for tests and the W14 WP4 browser trace.
 */
let planNodeKeyScanWithoutScope = 0;
let planNodeKeyScopeRefMismatch = 0;

export function getTerraformPlanNodeKeyScanStats(): {
  scanWithoutScope: number;
  scopeRefMismatch: number;
} {
  return {
    scanWithoutScope: planNodeKeyScanWithoutScope,
    scopeRefMismatch: planNodeKeyScopeRefMismatch,
  };
}

export function resetTerraformPlanNodeKeyScanStats(): void {
  planNodeKeyScanWithoutScope = 0;
  planNodeKeyScopeRefMismatch = 0;
}

/**
 * Activate a scoped {@link TerraformPlanNodeKeyIndex} for `nodes` for the synchronous extent of `fn`, so every
 * {@link resolveTerraformPlanNodeKey} call inside `fn` (directly or transitively) can use O(1)-average indexed
 * lookups instead of the original O(N) scans. Restores the previous context (supports nested/re-entrant calls)
 * in a `finally`, even if building the index or running `fn` throws.
 */
export function withTerraformPlanNodeKeyIndex<T>(
  nodes: Record<string, TerraformPlanGraphNode>,
  fn: () => T,
): T {
  const previous = activePlanNodeKeyIndex;
  try {
    activePlanNodeKeyIndex = {
      nodes: nodes as unknown as object,
      index: buildTerraformPlanNodeKeyIndex(nodes),
    };
    return fn();
  } finally {
    activePlanNodeKeyIndex = previous;
  }
}

/**
 * Map a Terraform address (plan / prior_state / `depends_on`) to a key in `nodes`.
 * Plan keys often include instance keys (`[0]`, `["a"]`) while `prior_state.depends_on` may omit them;
 * matches backend `packages/backend/pipeline.js` `resolveCanonicalNodePath`.
 */
export function resolveTerraformPlanNodeKey(
  nodes: Record<string, TerraformPlanGraphNode>,
  address: string,
): string | null {
  if (
    !address ||
    typeof address !== "string" ||
    address === TERRAFORM_MODULE_TREE_KEY
  ) {
    return null;
  }

  if (
    activePlanNodeKeyIndex !== null &&
    activePlanNodeKeyIndex.nodes === (nodes as unknown as object)
  ) {
    return resolveTerraformPlanNodeKeyIndexed(
      nodes,
      address,
      activePlanNodeKeyIndex.index,
    );
  }

  // W14 WP2: falling through to the O(N) scan path — record why (no scope vs.
  // scope present but ref-mismatch) for the fallback-scan observability counter.
  // W14 F6: gate the increments behind `import.meta.env.DEV` so production builds
  // pay nothing (the only consumers are dev tests + the WP4 dev-build trace, both
  // of which run with DEV=true; prod skips the writes entirely).
  if (import.meta.env.DEV) {
    if (activePlanNodeKeyIndex !== null) {
      planNodeKeyScopeRefMismatch += 1;
    } else {
      planNodeKeyScanWithoutScope += 1;
    }
  }

  const parsed = parseStackAddress(address);
  const bareKey = topologyBareAddressKey(address);

  if (parsed) {
    const stackAliases: string[] = [];
    const exactMatches: string[] = [];
    for (const k of Object.keys(nodes)) {
      if (k === TERRAFORM_MODULE_TREE_KEY || k.startsWith("__")) {
        continue;
      }
      const kParsed = parseStackAddress(k);
      if (
        kParsed?.stackId === parsed.stackId &&
        topologyBareAddressKey(k) === bareKey
      ) {
        stackAliases.push(k);
        if (kParsed.address === parsed.address) {
          exactMatches.push(k);
        }
      } else if (!kParsed && topologyBareAddressKey(k) === bareKey) {
        stackAliases.push(k);
        if (k === parsed.address) {
          exactMatches.push(k);
        }
      }
    }
    if (exactMatches.length === 1) {
      return exactMatches[0]!;
    }
    if (stackAliases.length > 0) {
      return preferTopologyNodeKeyAmongAliases(stackAliases);
    }
  } else {
    const qualifiedMatches: string[] = [];
    for (const k of Object.keys(nodes)) {
      if (k === TERRAFORM_MODULE_TREE_KEY || k.startsWith("__")) {
        continue;
      }
      const kParsed = parseStackAddress(k);
      if (kParsed && topologyBareAddressKey(k) === bareKey) {
        qualifiedMatches.push(k);
      }
    }
    if (qualifiedMatches.length === 1) {
      return qualifiedMatches[0]!;
    }
    if (qualifiedMatches.length > 1) {
      return null;
    }
    if (nodes[address]) {
      return address;
    }
  }

  const graphId = stripTerraformAddressIndexes(address);

  const knownStackIds = collectKnownStackIdsFromNodes(nodes);
  if (knownStackIds.length > 0 && !address.includes("::")) {
    const qualifiedMatches: string[] = [];
    for (const stackId of knownStackIds) {
      const qualified = prefixStackAddress(stackId, address);
      if (nodes[qualified]) {
        qualifiedMatches.push(qualified);
      }
      const qualifiedStripped = prefixStackAddress(stackId, graphId);
      if (nodes[qualifiedStripped]) {
        qualifiedMatches.push(qualifiedStripped);
      }
    }
    const uniqueQualified = [...new Set(qualifiedMatches)];
    if (uniqueQualified.length === 1) {
      return uniqueQualified[0]!;
    }
    if (uniqueQualified.length > 1) {
      return null;
    }
  }

  const matches: string[] = [];
  for (const k of Object.keys(nodes)) {
    if (k === TERRAFORM_MODULE_TREE_KEY || k.startsWith("__")) {
      continue;
    }
    if (stripTerraformAddressIndexes(k) === graphId) {
      matches.push(k);
    }
  }
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    return null;
  }
  return null;
}

/**
 * Indexed counterpart of {@link resolveTerraformPlanNodeKey}'s body — same semantics, but reads from a
 * precomputed {@link TerraformPlanNodeKeyIndex} (`byBareKey` / `byGraphId` / `knownStackIds`) instead of
 * rescanning `Object.keys(nodes)` per call. Only ever invoked from inside an active
 * {@link withTerraformPlanNodeKeyIndex} scope, where `index` was built from the exact same `nodes` ref.
 */
function resolveTerraformPlanNodeKeyIndexed(
  nodes: Record<string, TerraformPlanGraphNode>,
  address: string,
  index: TerraformPlanNodeKeyIndex,
): string | null {
  const parsed = parseStackAddress(address);
  const bareKey = topologyBareAddressKey(address);
  const bareKeyCandidates = index.byBareKey.get(bareKey) ?? [];

  if (parsed) {
    const stackAliases: string[] = [];
    const exactMatches: string[] = [];
    for (const k of bareKeyCandidates) {
      const kParsed = parseStackAddress(k);
      if (kParsed?.stackId === parsed.stackId) {
        stackAliases.push(k);
        if (kParsed.address === parsed.address) {
          exactMatches.push(k);
        }
      } else if (!kParsed) {
        stackAliases.push(k);
        if (k === parsed.address) {
          exactMatches.push(k);
        }
      }
    }
    if (exactMatches.length === 1) {
      return exactMatches[0]!;
    }
    if (stackAliases.length > 0) {
      return preferTopologyNodeKeyAmongAliases(stackAliases);
    }
  } else {
    const qualifiedMatches: string[] = [];
    for (const k of bareKeyCandidates) {
      const kParsed = parseStackAddress(k);
      if (kParsed) {
        qualifiedMatches.push(k);
      }
    }
    if (qualifiedMatches.length === 1) {
      return qualifiedMatches[0]!;
    }
    if (qualifiedMatches.length > 1) {
      return null;
    }
    if (nodes[address]) {
      return address;
    }
  }

  const graphId = stripTerraformAddressIndexes(address);

  const knownStackIds = index.knownStackIds;
  if (knownStackIds.length > 0 && !address.includes("::")) {
    const qualifiedMatches: string[] = [];
    for (const stackId of knownStackIds) {
      const qualified = prefixStackAddress(stackId, address);
      if (nodes[qualified]) {
        qualifiedMatches.push(qualified);
      }
      const qualifiedStripped = prefixStackAddress(stackId, graphId);
      if (nodes[qualifiedStripped]) {
        qualifiedMatches.push(qualifiedStripped);
      }
    }
    const uniqueQualified = [...new Set(qualifiedMatches)];
    if (uniqueQualified.length === 1) {
      return uniqueQualified[0]!;
    }
    if (uniqueQualified.length > 1) {
      return null;
    }
  }

  const matches = index.byGraphId.get(graphId) ?? [];
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    return null;
  }
  return null;
}

const IAM_POLICY_DOCUMENT_DATA_TYPE = "aws_iam_policy_document";

const MEANINGFUL_POLICY_FIELDS = [
  "json",
  "minified_json",
  "policy",
  "source_json",
  "override_json",
  "source_policy_documents",
  "override_policy_documents",
] as const;

function primaryTerraformResource(node: TerraformPlanGraphNode) {
  return Object.values(node.resources || {})[0] as
    | Record<string, unknown>
    | undefined;
}

function isNonEmptyValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (value && typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return value != null;
}

function hasMeaningfulIamPolicyDocumentContent(
  resource: Record<string, unknown>,
) {
  const change = resource.change as
    | { after?: Record<string, unknown> }
    | undefined;
  const candidates = [
    resource.values as Record<string, unknown> | undefined,
    change?.after,
  ].filter(Boolean) as Record<string, unknown>[];

  for (const values of candidates) {
    for (const field of MEANINGFUL_POLICY_FIELDS) {
      if (isNonEmptyValue(values[field])) {
        return true;
      }
    }
    if (Array.isArray(values.statement) && values.statement.length > 0) {
      return true;
    }
  }

  return false;
}

function shouldPruneTerraformDataNode(node: TerraformPlanGraphNode) {
  const resource = primaryTerraformResource(node);
  if (!resource || resource.mode !== "data") {
    return false;
  }

  if (resource.type !== IAM_POLICY_DOCUMENT_DATA_TYPE) {
    return true;
  }

  return !hasMeaningfulIamPolicyDocumentContent(resource);
}

function pruneEdgeList(edges: string[] | undefined, pruned: Set<string>) {
  return (edges || []).filter((edge) => !pruned.has(edge));
}

function pruneDataFlowEdges(edges: unknown, pruned: Set<string>) {
  if (!Array.isArray(edges)) {
    return [];
  }
  return edges.filter((edge) => {
    if (typeof edge === "string") {
      return !pruned.has(edge);
    }
    if (edge && typeof edge === "object") {
      const target = (edge as { target?: unknown }).target;
      return typeof target !== "string" || !pruned.has(target);
    }
    return true;
  }) as string[];
}

export function sanitizeTerraformPlanNodes<
  T extends Record<string, TerraformPlanGraphNode>,
>(nodes: T): T {
  const pruned = new Set<string>();

  for (const [nodePath, node] of Object.entries(nodes)) {
    if (nodePath === TERRAFORM_MODULE_TREE_KEY || nodePath.startsWith("__")) {
      continue;
    }
    if (shouldPruneTerraformDataNode(node)) {
      pruned.add(nodePath);
    }
  }

  if (pruned.size === 0) {
    return nodes;
  }

  for (const nodePath of pruned) {
    delete nodes[nodePath];
  }

  for (const [nodePath, node] of Object.entries(nodes)) {
    if (nodePath === TERRAFORM_MODULE_TREE_KEY || nodePath.startsWith("__")) {
      continue;
    }
    node.edges_new = pruneEdgeList(node.edges_new, pruned);
    node.edges_existing = pruneEdgeList(node.edges_existing, pruned);
    node.edges_data_flow = pruneDataFlowEdges(node.edges_data_flow, pruned);
  }

  return nodes;
}

function loadPlan(plan: { resource_changes: { address: string }[] }) {
  const nodes: Record<string, TerraformPlanGraphNode> = {};
  const resourceChanges = plan.resource_changes || [];

  for (const resourceChange of resourceChanges) {
    const address = resourceChange.address;
    const nodePath = address;
    if (!nodes[nodePath]) {
      nodes[nodePath] = { resources: {} };
    }
    nodes[nodePath].resources[address] = resourceChange;
  }

  return nodes;
}

function getModulePathChainFromAddress(nodePath = "") {
  const parsed = parseStackAddress(nodePath);
  const parts = (parsed?.address ?? nodePath).split(".");
  const chain: string[] = [];
  if (parsed?.stackId) {
    chain.push(stackGroupModulePath(parsed.stackId));
  }
  let cursor = "";

  for (let index = 0; index < parts.length - 1; ) {
    if (parts[index] !== "module" || !parts[index + 1]) {
      break;
    }
    const segment = `module.${parts[index + 1]}`;
    cursor = cursor ? `${cursor}.${segment}` : segment;
    chain.push(stackQualifiedModulePath(parsed?.stackId, cursor));
    index += 2;
  }

  return chain;
}

function emptyModuleTreeNode(path: string): TerraformModuleTreeNode {
  return { path, modules: {}, resourceAddresses: [] };
}

/**
 * Deepest Terraform module path that owns this address, or `"root"` for the root module.
 * Example: `module.vpc.aws_subnet.a` → `module.vpc`; `aws_instance.x` → `root`.
 */
function getContainingModulePathForAddress(address: string): string {
  const parsed = parseStackAddress(address);
  const parts = (parsed?.address ?? address).split(".");
  let index = 0;
  let modulePath = "";
  while (
    index < parts.length &&
    parts[index] === "module" &&
    parts[index + 1]
  ) {
    const segment = `module.${parts[index + 1]}`;
    modulePath = modulePath ? `${modulePath}.${segment}` : segment;
    index += 2;
  }
  return stackQualifiedModulePath(parsed?.stackId, modulePath || "root");
}

/**
 * Walks/creates `module.a` → `module.a.module.b` under `root` and returns the deepest node.
 * `fullModulePath` is a Terraform module path (no resource suffix), e.g. `module.network`.
 */
function ensureModulePathInTree(
  root: TerraformModuleTreeNode,
  fullModulePath: string,
): TerraformModuleTreeNode {
  if (!fullModulePath || fullModulePath === "root") {
    return root;
  }
  const parsed = parseStackAddress(fullModulePath);
  if (parsed?.address === "root") {
    const stackGroup = stackGroupModulePath(parsed.stackId);
    if (!root.modules[stackGroup]) {
      root.modules[stackGroup] = emptyModuleTreeNode(stackGroup);
    }
    const stackNode = root.modules[stackGroup]!;
    if (!stackNode.modules[fullModulePath]) {
      stackNode.modules[fullModulePath] = emptyModuleTreeNode(fullModulePath);
    }
    return stackNode.modules[fullModulePath]!;
  }
  const sentinel = `${fullModulePath}.aws_instance.__module_tree__`;
  const chain = getModulePathChainFromAddress(sentinel);
  let cursor = root;
  for (const segment of chain) {
    if (!cursor.modules[segment]) {
      cursor.modules[segment] = emptyModuleTreeNode(segment);
    }
    cursor = cursor.modules[segment]!;
  }
  return cursor;
}

function isTerraformModuleStubNode(
  nodes: Record<string, TerraformPlanGraphNode>,
  key: string,
): boolean {
  const resource = nodes[key]?.resources?.[key] as
    | { type?: string }
    | undefined;
  return Boolean(resource && resource.type === TERRAFORM_MODULE_RESOURCE_TYPE);
}

/**
 * Builds a module → children / resources tree and stores it on the nodes map under
 * {@link TERRAFORM_MODULE_TREE_KEY}. Root is `{ path: "root", … }`.
 */
export function buildTerraformModuleTree(
  nodes: Record<string, TerraformPlanGraphNode>,
): TerraformModuleTreeNode {
  const root = emptyModuleTreeNode("root");

  const keys = Object.keys(nodes).filter((k) => !k.startsWith("__"));
  for (const key of keys) {
    if (isTerraformModuleStubNode(nodes, key)) {
      ensureModulePathInTree(root, key);
      continue;
    }

    const parentPath = getContainingModulePathForAddress(key);
    const parent =
      parentPath === "root" ? root : ensureModulePathInTree(root, parentPath);
    if (!parent.resourceAddresses.includes(key)) {
      parent.resourceAddresses.push(key);
    }
  }

  const sortRecursive = (node: TerraformModuleTreeNode) => {
    node.resourceAddresses.sort();
    for (const child of Object.values(node.modules)) {
      sortRecursive(child);
    }
    const sortedKeys = Object.keys(node.modules).sort();
    const next: Record<string, TerraformModuleTreeNode> = {};
    for (const k of sortedKeys) {
      next[k] = node.modules[k];
    }
    node.modules = next;
  };
  sortRecursive(root);

  return root;
}

function attachModuleTree(
  nodes: Record<string, TerraformPlanGraphNode>,
): TerraformPlanNodesMap {
  const map = nodes as TerraformPlanNodesMap;
  map[TERRAFORM_MODULE_TREE_KEY] = buildTerraformModuleTree(nodes);
  return map;
}

function buildNewEdges(
  nodes: Record<string, TerraformPlanGraphNode>,
  adjacency: Record<string, string[]>,
) {
  //iterate over every node
  for (const nodePath of Object.keys(nodes)) {
    if (nodePath === TERRAFORM_MODULE_TREE_KEY) {
      continue;
    }
    const visited = new Set<string>([nodePath]);
    const queue = [nodePath];
    const connectedNodes: string[] = [];

    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      const graphKey = stripTerraformAddressIndexes(current);
      //due to being a raw parse there is a chance that that entry has no outgoign edges
      const neighbors = adjacency[graphKey] || [];

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) {
          continue;
        }
        visited.add(neighbor);

        if (neighbor.startsWith("provider")) {
          continue;
        }

        if (nodes[neighbor]) {
          connectedNodes.push(neighbor);
          continue;
        }

        queue.push(neighbor);
      }
    }

    nodes[nodePath].edges_new = connectedNodes;
  }

  return nodes;
}

function ensureEdgeLists(nodes: Record<string, TerraformPlanGraphNode>) {
  for (const [key, node] of Object.entries(nodes)) {
    if (key === TERRAFORM_MODULE_TREE_KEY) {
      continue;
    }
    node.edges_new ||= [];
    node.edges_existing ||= [];
    node.edges_data_flow ||= [];
  }
  return nodes;
}

export function buildExistingEdges(
  nodes: Record<string, TerraformPlanGraphNode>,
  plan: { prior_state: { values: { root_module: unknown } } },
) {
  const rootModule = plan?.prior_state?.values?.root_module;
  if (!rootModule) {
    return nodes;
  }

  // W14 E07: buildExistingEdges resolves an address per prior-state resource plus once
  // per edge source/target — historically ~O(N²) because it ran OUTSIDE any index scope
  // and each resolveTerraformPlanNodeKey rescanned Object.keys(nodes). It was left
  // unwrapped only because its `nodes[nodePath] ||= …` site can create keys the index
  // didn't see at build time. We now wrap it AND register each genuinely-new key into
  // the live scope (registerActiveTerraformPlanNodeKey), so every resolve takes the O(1)
  // indexed path while staying byte-identical to the fresh-rescan behavior: a new key is
  // appended to the buckets' tails, exactly where a later Object.keys scan would find it.
  return withTerraformPlanNodeKeyIndex(nodes, () => {
    const existingEdges: Record<string, Set<string>> = {};
    const addEdge = (from: string, to: string) => {
      if (!existingEdges[from]) {
        existingEdges[from] = new Set();
      }
      existingEdges[from].add(to);
    };

    const stack: TerraformPriorStateModule[] = [
      rootModule as TerraformPriorStateModule,
    ];
    while (stack.length) {
      const currentModule = stack.pop();
      if (currentModule == null) {
        continue;
      }

      for (const resource of currentModule.resources || []) {
        const address = resource.address;
        if (!address) {
          continue;
        }

        const nodePath = resolveTerraformPlanNodeKey(nodes, address) ?? address;
        // Fold a genuinely-new key into the active index BEFORE any later resolve can
        // observe it — mirrors the fresh Object.keys scan the unwrapped path would run.
        const isNewNodeKey = !Object.prototype.hasOwnProperty.call(
          nodes,
          nodePath,
        );
        nodes[nodePath] ||= { resources: {} };
        if (isNewNodeKey) {
          registerActiveTerraformPlanNodeKey(nodes, nodePath);
        }

        if (!nodes[nodePath].resources[address]) {
          nodes[nodePath].resources[address] = {
            ...resource,
            change: { actions: ["existing"] },
          };
        }

        for (const dependency of resource.depends_on || []) {
          if (!dependency) {
            continue;
          }
          addEdge(address, dependency);
        }
      }

      for (const childModule of currentModule.child_modules || []) {
        stack.push(childModule);
      }
    }

    for (const [rawSource, targets] of Object.entries(existingEdges)) {
      const source = resolveTerraformPlanNodeKey(nodes, rawSource);
      if (!source) {
        continue;
      }
      nodes[source].edges_existing ||= [];

      for (const rawTarget of targets) {
        const target = resolveTerraformPlanNodeKey(nodes, rawTarget);
        if (!target) {
          continue;
        }
        if (!nodes[source].edges_existing.includes(target)) {
          nodes[source].edges_existing.push(target);
        }
      }
    }

    return nodes;
  });
}
