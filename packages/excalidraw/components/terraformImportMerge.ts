/**
 * Pure merge helpers for multi-file Terraform import (plans, graphs, state, .tfd).
 */

import graphlibDot from "@dagrejs/graphlib-dot";

import {
  prefixStackAddress,
  stackIdFromBundleLabel,
} from "./terraformStackAddress";
import { buildSyntheticPlanFromTfstate } from "./terraformStateToPlan";

export type TerraformImportWarning = {
  code:
    | "duplicate_address"
    | "variable_mismatch"
    | "duplicate_tfd_bind"
    | "tfd_error"
    | "pipeline_cycle"
    // RCLL M3a: a dependency cycle between sibling topology hulls (the
    // up-projected D_H). Distinct from "pipeline_cycle" (cluster-level D).
    | "pipeline_cycle_container";
  message: string;
  address?: string;
  source?: string;
};

export type TerraformPlanDotBundle = {
  plan: unknown;
  dotText: string;
  label?: string;
};

export type MergePlanJsonsResult = {
  plan: {
    resource_changes: unknown[];
    variables?: Record<string, { value: unknown }>;
    prior_state?: unknown;
    configuration?: unknown;
  };
  warnings: TerraformImportWarning[];
  /** Original plans (for per-plan prior_state edge building). */
  sourcePlans: unknown[];
};

const sanitizeDotNodeId = (nodeId = "") => {
  const parts = String(nodeId).trim().split(" ");
  const raw = parts.length >= 2 ? parts[1] : parts[0] || "";
  return raw.replace(/["\\]/g, "");
};

/** Parse raw Terraform state JSON (`terraform state pull` shape). */
export function parseRawStateJson(
  text: string,
):
  | { ok: true; state: { resources: unknown[] } }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "State file must be valid JSON." };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { resources?: unknown }).resources)
  ) {
    return {
      ok: false,
      error:
        'State file must be raw Terraform state JSON (top-level "resources" array), e.g. terraform state pull.',
    };
  }
  return { ok: true, state: parsed as { resources: unknown[] } };
}

function sourceLabel(label: string | undefined, index: number): string {
  return label?.trim() || `import ${index + 1}`;
}

/**
 * E11: fast line-scan edge extractor for `terraform graph` DOT exports.
 *
 * `mergeDotAdjacency` only ever reads the edge (v,w) pairs of the parsed DOT —
 * it never touches node attributes, subgraphs, labels, or ranks. But
 * `graphlibDot.read()` parses the ENTIRE 5MB DOT (11.9k nodes, 28k edges) into a
 * full graphlib `Graph` with every node attribute, which measured ~514ms — ~75%
 * of the whole prep.cache span. A `terraform graph` export writes exactly one
 * edge statement per line in the strict shape `"<src>" -> "<dst>"` (verified: no
 * multi-hop chains, no edge attributes, no semicolons across the import presets),
 * so the (v,w) set can be recovered by a single linear pass over the lines.
 *
 * Byte-identical guarantee: every consumer of an extracted id passes it straight
 * to {@link sanitizeDotNodeId}, which strips ALL `"` and `\` characters and then
 * takes the space-delimited token. graphlib unescapes `\"`→`"` / `\\`→`\` before
 * we sanitize; the fast path leaves the escapes in place and lets `sanitize`
 * strip them instead — the stripped result is identical because sanitize removes
 * exactly those characters, and escapes never introduce/remove spaces (so token
 * splitting is unaffected). Edge insertion order equals DOT textual order in both
 * paths (graphlib `edges()` yields setEdge order = statement order), so the
 * resulting adjacency arrays match element-for-element.
 *
 * Correctness fallback: any line that contains `->` but does NOT match the strict
 * single-edge shape (edge attributes, unquoted ids, multiple edges per line,
 * a label containing `->`, a wrapped statement) makes the fast path return `null`
 * for that whole DOT text, and the caller re-parses it with graphlib. The output
 * can therefore never diverge — it is either the identical fast result or the
 * original graphlib result.
 */
const DOT_EDGE_LINE_RE =
  /^[ \t]*"((?:[^"\\]|\\.)*)"[ \t]*->[ \t]*"((?:[^"\\]|\\.)*)"[ \t]*$/;

// DEV-gated observability (E02 pattern): how often the fast path served a DOT
// text vs. bailed to graphlib. Tests read these to prove the fast path engages.
let dotAdjacencyFastPathHits = 0;
let dotAdjacencyFastPathBails = 0;
let dotAdjacencyFastPathDisabled = false;

/** Tests: force the graphlib path (kill-switch) to compare against the fast path. */
export function setDotAdjacencyFastPathDisabledForTest(value: boolean): void {
  dotAdjacencyFastPathDisabled = value;
}

export function resetDotAdjacencyFastPathStats(): void {
  dotAdjacencyFastPathHits = 0;
  dotAdjacencyFastPathBails = 0;
}

export function getDotAdjacencyFastPathStats(): {
  hits: number;
  bails: number;
} {
  return {
    hits: dotAdjacencyFastPathHits,
    bails: dotAdjacencyFastPathBails,
  };
}

/**
 * Recover the ordered edge (v,w) pairs from a `terraform graph` DOT text without
 * building a full graphlib graph. Returns `null` (bail) on any deviation from the
 * strict one-edge-per-line shape, signalling the caller to fall back to graphlib.
 */
function extractDotEdgePairsFast(
  dotText: string,
): Array<readonly [string, string]> | null {
  const edges: Array<readonly [string, string]> = [];
  let start = 0;
  const len = dotText.length;
  while (start <= len) {
    let end = dotText.indexOf("\n", start);
    if (end === -1) {
      end = len;
    }
    // Only lines carrying "->" can be edge statements; skip the rest (node
    // statements, subgraph braces, graph attributes — none create edges).
    const line = dotText.slice(start, end);
    start = end + 1;
    if (line.indexOf("->") === -1) {
      continue;
    }
    const m = DOT_EDGE_LINE_RE.exec(line);
    if (!m) {
      return null;
    }
    edges.push([m[1]!, m[2]!] as const);
  }
  return edges;
}

/** Union dependency-graph adjacency from multiple `terraform graph` DOT exports. */
export function mergeDotAdjacency(
  dotTexts: string[],
  stackIds?: (string | undefined)[],
): Record<string, string[]> {
  const targetSets = new Map<string, Set<string>>();

  const addEdge = (rawV: string, rawW: string, stackId: string | undefined) => {
    const rawSource = sanitizeDotNodeId(rawV);
    const rawTarget = sanitizeDotNodeId(rawW);
    const source = stackId ? prefixStackAddress(stackId, rawSource) : rawSource;
    const target = stackId ? prefixStackAddress(stackId, rawTarget) : rawTarget;
    let set = targetSets.get(source);
    if (!set) {
      set = new Set();
      targetSets.set(source, set);
    }
    set.add(target);
  };

  for (let i = 0; i < dotTexts.length; i++) {
    const dotText = dotTexts[i]!;
    const stackId = stackIds?.[i]?.trim();
    const fastPairs = dotAdjacencyFastPathDisabled
      ? null
      : extractDotEdgePairsFast(dotText);
    if (fastPairs) {
      if (import.meta.env.DEV) {
        dotAdjacencyFastPathHits += 1;
      }
      for (const [v, w] of fastPairs) {
        addEdge(v, w, stackId);
      }
    } else {
      if (import.meta.env.DEV && !dotAdjacencyFastPathDisabled) {
        dotAdjacencyFastPathBails += 1;
      }
      const graph = graphlibDot.read(dotText);
      for (const { v, w } of graph.edges()) {
        addEdge(v, w, stackId);
      }
    }
  }

  const adjacency: Record<string, string[]> = {};
  for (const [source, set] of targetSets) {
    adjacency[source] = [...set];
  }
  return adjacency;
}

function prefixDependsOnList(
  deps: unknown,
  stackId: string,
): string[] | undefined {
  if (!Array.isArray(deps)) {
    return undefined;
  }
  return deps.map((dep) =>
    typeof dep === "string" ? prefixStackAddress(stackId, dep) : String(dep),
  );
}

function namespacePriorStateModule(
  module: Record<string, unknown>,
  stackId: string,
): void {
  for (const resource of (module.resources as unknown[]) || []) {
    if (!resource || typeof resource !== "object") {
      continue;
    }
    const res = resource as Record<string, unknown>;
    if (typeof res.address === "string") {
      res.address = prefixStackAddress(stackId, res.address);
    }
    const prefixed = prefixDependsOnList(res.depends_on, stackId);
    if (prefixed) {
      res.depends_on = prefixed;
    }
  }
  for (const child of (module.child_modules as unknown[]) || []) {
    if (child && typeof child === "object") {
      namespacePriorStateModule(child as Record<string, unknown>, stackId);
    }
  }
}

/** Prefix all Terraform addresses in one plan JSON object for multi-stack merge. */
export function namespacePlanForStack(plan: unknown, stackId: string): unknown {
  if (!plan || typeof plan !== "object") {
    return plan;
  }
  const cloned = structuredClone(plan) as Record<string, unknown>;
  const resourceChanges = cloned.resource_changes;
  if (Array.isArray(resourceChanges)) {
    for (const rc of resourceChanges) {
      if (
        rc &&
        typeof rc === "object" &&
        typeof (rc as { address?: string }).address === "string"
      ) {
        const entry = rc as { address: string };
        entry.address = prefixStackAddress(stackId, entry.address);
      }
    }
  }
  const priorState = cloned.prior_state as
    | { values?: { root_module?: Record<string, unknown> } }
    | undefined;
  const rootModule = priorState?.values?.root_module;
  if (rootModule && typeof rootModule === "object") {
    namespacePriorStateModule(rootModule, stackId);
  }
  return cloned;
}

export type NamespacePlanDotBundlesResult = {
  bundles: TerraformPlanDotBundle[];
  stackIds: string[];
  addressToStack: Record<string, string>;
};

/** Apply stack namespace to each bundle when importing multiple Terraform roots. */
export function namespacePlanDotBundles(
  bundles: TerraformPlanDotBundle[],
): NamespacePlanDotBundlesResult {
  if (bundles.length <= 1) {
    return { bundles, stackIds: [], addressToStack: {} };
  }
  const stackIds: string[] = [];
  const addressToStack: Record<string, string> = {};
  const namespaced = bundles.map((bundle, index) => {
    const stackId = stackIdFromBundleLabel(bundle.label, index);
    stackIds.push(stackId);
    const plan = namespacePlanForStack(bundle.plan, stackId) as {
      resource_changes?: Array<{ address?: string }>;
    };
    for (const rc of plan.resource_changes || []) {
      if (typeof rc.address === "string") {
        addressToStack[rc.address] = stackId;
      }
    }
    return { ...bundle, plan, label: stackId };
  });
  return { bundles: namespaced, stackIds, addressToStack };
}

const VARIABLE_KEYS = ["aws_account_id", "aws_region"] as const;

function mergePlanVariables(
  plans: unknown[],
  labels: (string | undefined)[],
  warnings: TerraformImportWarning[],
): Record<string, { value: unknown }> | undefined {
  const merged: Record<string, { value: unknown }> = {};
  const seen: Partial<Record<typeof VARIABLE_KEYS[number], unknown>> = {};

  for (let i = 0; i < plans.length; i++) {
    const variables = (
      plans[i] as { variables?: Record<string, { value: unknown }> }
    )?.variables;
    if (!variables) {
      continue;
    }
    const label = sourceLabel(labels[i], i);
    for (const key of VARIABLE_KEYS) {
      const entry = variables[key];
      if (!entry || entry.value == null || entry.value === "") {
        continue;
      }
      if (seen[key] != null && seen[key] !== entry.value) {
        warnings.push({
          code: "variable_mismatch",
          message: `${key} differs between imports; using value from "${label}".`,
          source: label,
        });
      }
      if (merged[key] == null) {
        merged[key] = entry;
        seen[key] = entry.value;
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergePlanConfigurations(
  plans: unknown[],
  labels: (string | undefined)[],
  warnings: TerraformImportWarning[],
): unknown | undefined {
  const providerConfig: Record<string, unknown> = {};
  let sawConfig = false;

  for (let i = 0; i < plans.length; i++) {
    const configuration = (
      plans[i] as {
        configuration?: { provider_config?: Record<string, unknown> };
      }
    )?.configuration;
    const configs = configuration?.provider_config;
    if (!configs) {
      continue;
    }
    sawConfig = true;
    const label = sourceLabel(labels[i], i);
    for (const [key, value] of Object.entries(configs)) {
      if (providerConfig[key] == null) {
        providerConfig[key] = value;
        continue;
      }
      if (JSON.stringify(providerConfig[key]) !== JSON.stringify(value)) {
        warnings.push({
          code: "variable_mismatch",
          message: `provider_config["${key}"] differs between imports; keeping first value (later from "${label}").`,
          source: label,
        });
      }
    }
  }

  if (!sawConfig) {
    return undefined;
  }
  return { provider_config: providerConfig };
}

export type MergePlanJsonsOptions = {
  /** Emit duplicate_address warnings when later imports overwrite (default true). */
  warnOnOverwrite?: boolean;
};

/** Concatenate `resource_changes` from multiple plan JSON objects (last wins on duplicate address). */
export function mergePlanJsons(
  plans: unknown[],
  labels?: (string | undefined)[],
  options: MergePlanJsonsOptions = {},
): MergePlanJsonsResult {
  const warnOnOverwrite = options.warnOnOverwrite !== false;
  if (plans.length === 1) {
    return {
      plan: plans[0] as MergePlanJsonsResult["plan"],
      warnings: [],
      sourcePlans: plans,
    };
  }

  const warnings: TerraformImportWarning[] = [];
  const resourceChanges: unknown[] = [];
  const addressIndex = new Map<string, number>();
  const labelList = labels ?? plans.map(() => undefined);

  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i] as { resource_changes?: unknown[] };
    const label = sourceLabel(labelList[i], i);
    for (const rc of plan.resource_changes || []) {
      const address = (rc as { address?: string }).address;
      if (typeof address !== "string" || !address) {
        continue;
      }
      const existingIdx = addressIndex.get(address);
      if (existingIdx != null) {
        if (warnOnOverwrite) {
          const prevLabel = sourceLabel(labelList[existingIdx], existingIdx);
          warnings.push({
            code: "duplicate_address",
            message: `Address "${address}" overwritten by "${label}" (was "${prevLabel}").`,
            address,
            source: label,
          });
        }
        resourceChanges[existingIdx] = rc;
      } else {
        addressIndex.set(address, resourceChanges.length);
        resourceChanges.push(rc);
      }
    }
  }

  const variables = mergePlanVariables(plans, labelList, warnings);
  const merged: MergePlanJsonsResult["plan"] = {
    resource_changes: resourceChanges,
  };
  if (variables) {
    merged.variables = variables;
  }

  const configuration = mergePlanConfigurations(plans, labelList, warnings);
  if (configuration) {
    merged.configuration = configuration;
  }

  return {
    plan: merged,
    warnings,
    sourcePlans: plans,
  };
}

/** Merge plan bundles with optional raw state files into one plan-shaped object. */
export function mergePlanWithStates(
  plan: MergePlanJsonsResult["plan"],
  sourcePlans: unknown[],
  states: unknown[],
  stateLabels: (string | undefined)[],
  warnings: TerraformImportWarning[],
): { plan: MergePlanJsonsResult["plan"]; sourcePlans: unknown[] } {
  if (states.length === 0) {
    return { plan, sourcePlans };
  }
  const stateMerged = mergeSyntheticPlans(states, stateLabels, {
    warnOnOverwrite: true,
  });
  // State synthetic plans use `read` for every resource; merge state first so real
  // plan `create` / `update` / `delete` actions win on duplicate addresses.
  const combined = mergePlanJsons(
    [stateMerged.plan, plan],
    [stateLabels[0] ?? "state", "plan"],
    { warnOnOverwrite: false },
  );
  warnings.push(...stateMerged.warnings, ...combined.warnings);
  return {
    plan: combined.plan,
    sourcePlans: [...sourcePlans, ...stateMerged.sourcePlans],
  };
}

/** Build one synthetic plan from multiple raw state files. */
export function mergeSyntheticPlans(
  states: unknown[],
  labels?: (string | undefined)[],
  options: MergePlanJsonsOptions = {},
): MergePlanJsonsResult {
  const syntheticPlans = states.map((state) =>
    buildSyntheticPlanFromTfstate(state),
  );
  return mergePlanJsons(syntheticPlans, labels, options);
}
