/**
 * Perf-loop E01 — byte-identity gate for `withTopologyLayoutMemoScope`.
 *
 * `preparePipelineLayout` now runs its cluster-build materialization inside
 * the topology layout memo scope (footprints, margins, satellite-height
 * contexts, satellite bundles, layout configs, per-(address, kind) satellite
 * clusters). This test proves the scope is a pure cache: building every
 * pipeline primary cluster with the memo scope forcibly ON must produce
 * deep-equal output to building each cluster with the scope OFF, on the
 * satellite-heavy staging-extended-localstack-v2 fixture. It also checks the
 * production `preparePipelineLayout` output against the scope-free reference
 * builds directly.
 *
 * Run:
 *   yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineTopologyMemoScopeEquivalence.test.ts
 */
import graphlibDot from "@dagrejs/graphlib-dot";
import { describe, expect, it } from "vitest";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import { DECLARED_DATAFLOW_ORDERED_KEY } from "./terraformDeclaredDataFlow";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { preparePipelineLayout } from "./terraformPipelineLayoutShared";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
  withTerraformPlanNodeKeyIndex,
} from "./terraformPlanParsing";
import {
  buildTopologyPrimaryClusterSkeletonForPipeline,
  withTopologyLayoutMemoScope,
  type TopologyPrimaryClusterPlacement,
} from "./terraformTopologyLayout";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

const TIMEOUT_MS = 240_000;

async function loadFixtureNodesAndPlan() {
  const raw = getTerraformImportPresetSourcesFromDb(
    "staging-extended-localstack-v2",
  );
  const sources = resolveSourcesWithTfdComposition(
    raw! as TerraformImportPresetSources,
  );
  const bundle = sources.planDotBundles[0]!;
  const graph = graphlibDot.read("digraph G {}\n");
  const nodes = buildTerraformLocalImportNodesMap(bundle.plan, graph, [], {});
  applyTfdOverlayToNodes(nodes, sources.tfdTexts, sources.tfdLabels);
  expect(nodes[DECLARED_DATAFLOW_ORDERED_KEY]?.length ?? 0).toBeGreaterThan(0);
  return { nodes, plan: bundle.plan };
}

/** The exact placement subset production hands the cluster builder. */
function clusterPlacementOf(placement: {
  accountId: string;
  region: string;
  vpcId: string | null;
  subnetTier?: string;
  subnetSignature?: string;
}): TopologyPrimaryClusterPlacement {
  return {
    accountId: placement.accountId,
    region: placement.region,
    vpcId: placement.vpcId,
    subnetTier: placement.subnetTier,
    subnetSignature: placement.subnetSignature,
  };
}

describe("pipeline topology memo scope equivalence (perf-loop E01)", () => {
  it(
    "memo scope ON vs OFF: full-mode cluster builds are deep-equal on staging-extended-localstack-v2",
    async () => {
      const { nodes, plan } = await loadFixtureNodesAndPlan();
      const prep = preparePipelineLayout(nodes, plan, false);

      // Non-vacuous: a meaningful number of clusters, with satellite content.
      expect(prep.clusters.length).toBeGreaterThan(20);

      const buildAll = () =>
        prep.clusters.map((cluster) =>
          buildTopologyPrimaryClusterSkeletonForPipeline(
            cluster.primaryAddress,
            nodes,
            plan,
            clusterPlacementOf(cluster.placement),
          ),
        );

      // Reference: memo scope OFF (no ctx active at module level).
      const offBuilds = buildAll();
      // Candidate: memo scope forcibly ON, composed with the plan-node-key
      // index exactly like the production materialize block.
      const onBuilds = withTerraformPlanNodeKeyIndex(nodes, () =>
        withTopologyLayoutMemoScope(buildAll),
      );

      // Satellite-bearing clusters exist, so the satellite memos are exercised.
      expect(offBuilds.some((b) => b.skeleton.length > 2)).toBe(true);
      expect(onBuilds).toEqual(offBuilds);
    },
    TIMEOUT_MS,
  );

  it(
    "production preparePipelineLayout (memo scope active) matches scope-free reference builds",
    async () => {
      const { nodes, plan } = await loadFixtureNodesAndPlan();
      const prep = preparePipelineLayout(nodes, plan, false);

      let compared = 0;
      for (const cluster of prep.clusters) {
        const reference = buildTopologyPrimaryClusterSkeletonForPipeline(
          cluster.primaryAddress,
          nodes,
          plan,
          clusterPlacementOf(cluster.placement),
        );
        if (
          reference.skeleton.length === 0 ||
          reference.width <= 0 ||
          reference.height <= 0
        ) {
          // Production replaced this build with the fallback cluster; the
          // fallback path is memo-independent, so skip it here.
          continue;
        }
        expect(cluster.build).toEqual(reference);
        compared += 1;
      }
      expect(compared).toBeGreaterThan(20);
    },
    TIMEOUT_MS,
  );
});
