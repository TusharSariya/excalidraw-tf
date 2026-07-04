import graphlibDot from "@dagrejs/graphlib-dot";

import { hashString } from "@excalidraw/element";

import {
  mergeDotAdjacency,
  mergePlanJsons,
  namespacePlanDotBundles,
} from "./terraformImportMerge";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
  type TerraformPlanParsingSources,
} from "./terraformPlanParsing";

import type { EnrichedTopologyPlacements } from "./terraformTopologyPlacementBuild";
import type { TerraformLayoutOptions } from "./terraformLayoutCore";
import type { TerraformPlanNodesMap } from "./terraformPlanParsing";

export type TerraformImportPrepCache = {
  fingerprint: string;
  mergedPlan: unknown;
  adjacency: Record<string, string[]>;
  stackIds: string[];
  addressToStack: Record<string, string>;
  importWarnings: import("./terraformImportMerge").TerraformImportWarning[];
  sourcePlans: unknown[];
  nodes: TerraformPlanNodesMap;
  /**
   * Pipeline-only enriched placements, built lazily on first pipeline access and
   * memoized here so a later semantic→pipeline switch reuses it. The semantic path
   * never reads this (it runs its own placement reconcile), so it is not built
   * eagerly — keeping it off the semantic critical path.
   */
  enrichedPlacements?: EnrichedTopologyPlacements;
};

let sessionCache: TerraformImportPrepCache | null = null;

/**
 * Session-cache fingerprint for `sources`. Two distinct inputs must never
 * produce the same fingerprint (a collision silently serves stale/wrong prep
 * data to a later, genuinely different import).
 *
 * The former scheme joined fields with bare `:`/`|` separators and only hashed
 * a *truncated* 40-char prefix of each `.tfd` text (`tfd:${length}:${slice(0,
 * 40)}`) — two texts sharing a length and a 40-char prefix but differing later
 * fingerprinted identically, and unescaped separator characters inside a label
 * or address could make distinct `(label, first, last)` triples join to the
 * same string. Fixed with `JSON.stringify` (each field is quoted/escaped, so
 * concatenation is unambiguous — no separator collision is possible) plus a
 * full-content `hashString` (djb2, @excalidraw/element) instead of a prefix, so
 * every byte of a `.tfd` text participates instead of just the first 40.
 */
export function terraformImportPrepFingerprint(
  sources: TerraformPlanParsingSources,
): string {
  const bundleFingerprints = sources.planDotBundles.map((b) => {
    const label = b.label ?? "";
    const rc = (b.plan as { resource_changes?: unknown[] })?.resource_changes;
    const n = Array.isArray(rc) ? rc.length : 0;
    const first =
      Array.isArray(rc) && rc[0] && typeof rc[0] === "object"
        ? String((rc[0] as { address?: string }).address ?? "")
        : "";
    const last =
      Array.isArray(rc) && rc.length > 0 && rc[rc.length - 1]
        ? String((rc[rc.length - 1] as { address?: string }).address ?? "")
        : "";
    return [label, n, first, last] as const;
  });
  const tfdFingerprints = sources.tfdTexts.map((t) => [
    t.length,
    hashString(t),
  ]);
  return JSON.stringify([bundleFingerprints, tfdFingerprints]);
}

export function getTerraformImportPrepCache(): TerraformImportPrepCache | null {
  return sessionCache;
}

export function clearTerraformImportPrepCache(): void {
  sessionCache = null;
}

export function buildTerraformImportPrepCache(
  sources: TerraformPlanParsingSources,
  options?: TerraformLayoutOptions,
): TerraformImportPrepCache {
  const fingerprint = terraformImportPrepFingerprint(sources);
  if (sessionCache?.fingerprint === fingerprint) {
    return sessionCache;
  }

  let bundles = sources.planDotBundles;
  let stackIds: string[] = [];
  let addressToStack: Record<string, string> = {};
  if (bundles.length > 1) {
    const namespaced = namespacePlanDotBundles(bundles);
    bundles = namespaced.bundles;
    stackIds = namespaced.stackIds;
    addressToStack = namespaced.addressToStack;
  }

  const merged = mergePlanJsons(
    bundles.map((b) => b.plan),
    bundles.map((b) => b.label),
  );
  const adjacency = mergeDotAdjacency(
    bundles.map((b) => b.dotText),
    stackIds.length > 0 ? stackIds : undefined,
  );

  const graph = graphlibDot.read("digraph G {}\n");
  const nodes = buildTerraformLocalImportNodesMap(merged.plan, graph, [], {
    adjacency,
    priorStatePlans: merged.sourcePlans,
    stackIds,
  });

  applyTfdOverlayToNodes(
    nodes,
    sources.tfdTexts,
    sources.tfdLabels,
    options?.dataflowLinks,
  );

  // Prep only computes what is shared across views (merged plan, dependency
  // nodes, adjacency). The AWS layout context was dead (never read), and enriched
  // placements are pipeline-only — the semantic path recomputes its own placement
  // reconcile — so both are left to the pipeline path to build on demand.
  sessionCache = {
    fingerprint,
    mergedPlan: merged.plan,
    adjacency,
    stackIds,
    addressToStack,
    importWarnings: merged.warnings,
    sourcePlans: merged.sourcePlans,
    nodes,
  };
  return sessionCache;
}
