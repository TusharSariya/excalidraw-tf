/**
 * Perf-loop E02 — byte-identity + engagement gate for the memoized `nodesByType` index
 * threaded through `buildSatelliteContext` (TODO-3).
 *
 * `buildSatelliteContext` now attaches a per-`nodes` memoized type index to every satellite
 * build context, and the satellite-bundle / stack-height / ancillary-collect paths thread
 * it into their per-kind scans instead of falling back to an O(all-nodes) `Object.keys`
 * walk per kind per address.
 *
 * Two guarantees, both on the satellite-heavy staging-extended-localstack-v2 fixture:
 *
 *  1. BYTE-IDENTITY: building every pipeline primary cluster with the index ON (production
 *     default) produces deep-equal skeletons/edges to building them with the index forcibly
 *     OFF (`setNodesByTypeIndexDisabledForTest(true)` → exact legacy full-scan path). Run
 *     for BOTH the full and compact `preparePipelineLayout` prep, and for the
 *     `collectSatelliteAddressesForKind` owner-set path.
 *  2. ENGAGEMENT: with the index ON, the pipeline cluster-build path records ZERO
 *     `nodesByType` fallback scans (every threaded scan site received the index); with the
 *     index OFF the same path records many. A nonzero ON count would mean a scan site never
 *     received the index and is silently still doing the full O(N) walk.
 *
 * Run:
 *   yarn vitest run \
 *     packages/excalidraw/components/terraformPipelineNodesByTypeIndexEquivalence.test.ts
 */
import graphlibDot from "@dagrejs/graphlib-dot";
import { afterEach, describe, expect, it } from "vitest";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import { DECLARED_DATAFLOW_ORDERED_KEY } from "./terraformDeclaredDataFlow";
import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import { preparePipelineLayout } from "./terraformPipelineLayoutShared";
import {
  applyTfdOverlayToNodes,
  buildTerraformLocalImportNodesMap,
  withTerraformPlanNodeKeyIndex,
} from "./terraformPlanParsing";
import { isPrimaryVisibleResourceType } from "./terraformPrimaryVisibility";
import {
  getFallbackScanCount,
  getMemoizedNodesByTypeIndex,
  resetFallbackScanCount,
  setNodesByTypeIndexDisabledForTest,
} from "./terraformTopologySatelliteEngine";
import { buildArnIndexForTopology } from "./terraformTopologyIamLinks";
import {
  isAlbCompanionConsumedAsSatellite,
  isAlbTopologySatelliteResourceType,
} from "./terraformTopologyAlbLinks";
import {
  isApiGatewayCompanionConsumedAsSatellite,
  isApiGatewayTopologySatelliteResourceType,
} from "./terraformTopologyApiGatewayLinks";
import {
  isEcsCompanionConsumedAsSatellite,
  isEcsTopologySatelliteResourceType,
} from "./terraformTopologyEcsLinks";
import {
  isDatastoreCompanionConsumedAsSatellite,
  isDatastoreTopologySatelliteResourceType,
} from "./terraformTopologyDatastoreLinks";
import {
  buildTopologyPrimaryClusterSkeletonForPipeline,
  withTopologyLayoutMemoScope,
  type TopologyPrimaryClusterPlacement,
} from "./terraformTopologyLayout";
import {
  buildAllSatellitePrimaryMappings,
  collectTopologySatelliteAddressesFromRegistry,
} from "./terraformTopologySatelliteRegistry";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";
import type { TerraformPlanNodesMap } from "./terraformPlanParsing";

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

function resourceTypeForNode(
  nodes: TerraformPlanNodesMap,
  address: string,
): string {
  const node = nodes[address] as
    | { resources?: Record<string, { type?: unknown }> }
    | undefined;
  const first = Object.values(node?.resources ?? {})[0];
  return typeof first?.type === "string" ? first.type : "";
}

/**
 * Build every pipeline primary cluster for `prep` inside the topology memo scope, exactly
 * like production materialization. Returns the built skeletons + the fallback-scan count
 * accrued during the build (0 when the index is engaged everywhere).
 */
function buildAllPipelineClusters(
  nodes: TerraformPlanNodesMap,
  plan: unknown,
  clusters: Array<{
    primaryAddress: string;
    placement: Parameters<typeof clusterPlacementOf>[0];
  }>,
) {
  resetFallbackScanCount();
  const builds = withTerraformPlanNodeKeyIndex(nodes, () =>
    withTopologyLayoutMemoScope(() =>
      clusters.map((cluster) =>
        buildTopologyPrimaryClusterSkeletonForPipeline(
          cluster.primaryAddress,
          nodes,
          plan,
          clusterPlacementOf(cluster.placement),
        ),
      ),
    ),
  );
  return { builds, fallbackScans: getFallbackScanCount() };
}

describe("nodesByType index threaded through buildSatelliteContext (perf-loop E02)", () => {
  afterEach(() => {
    // Never leak the kill switch into other suites.
    setNodesByTypeIndexDisabledForTest(false);
  });

  for (const compact of [false, true] as const) {
    it(
      `index ON vs OFF: pipeline cluster builds are byte-identical (compact=${compact})`,
      async () => {
        const { nodes, plan } = await loadFixtureNodesAndPlan();
        const prep = preparePipelineLayout(nodes, plan, compact);
        expect(prep.clusters.length).toBeGreaterThan(20);

        // Index OFF: exact legacy full-scan path.
        setNodesByTypeIndexDisabledForTest(true);
        const off = buildAllPipelineClusters(nodes, plan, prep.clusters);

        // Index ON: production default.
        setNodesByTypeIndexDisabledForTest(false);
        const on = buildAllPipelineClusters(nodes, plan, prep.clusters);

        // Non-vacuous: real satellite content is built.
        expect(on.builds.some((b) => b.skeleton.length > 2)).toBe(true);
        // Byte-identity of the whole cluster-build output.
        expect(on.builds).toEqual(off.builds);

        // Engagement: OFF must fall back a lot; ON must not fall back at all on this path.
        expect(off.fallbackScans).toBeGreaterThan(0);
        expect(on.fallbackScans).toBe(0);
      },
      TIMEOUT_MS,
    );
  }

  it(
    "index ON vs OFF: collectSatelliteAddressesForKind owner-set path is identical and fallback-free",
    async () => {
      const { nodes, plan } = await loadFixtureNodesAndPlan();
      const primaryAddresses = Object.keys(nodes)
        .filter((key) => !key.startsWith("__"))
        .filter((addr) =>
          isPrimaryVisibleResourceType(resourceTypeForNode(nodes, addr)),
        )
        .sort();
      expect(primaryAddresses.length).toBeGreaterThan(20);

      const run = () =>
        withTerraformPlanNodeKeyIndex(nodes, () => {
          const arnIndex = buildArnIndexForTopology(nodes);
          resetFallbackScanCount();
          const owners = collectTopologySatelliteAddressesFromRegistry(
            nodes,
            arnIndex,
            primaryAddresses,
            plan,
          );
          const mappings = buildAllSatellitePrimaryMappings(
            nodes,
            arnIndex,
            primaryAddresses,
            plan,
          );
          return {
            owners: [...owners].sort(),
            mappings: Object.fromEntries(mappings),
            fallbackScans: getFallbackScanCount(),
          };
        });

      setNodesByTypeIndexDisabledForTest(true);
      const off = run();
      setNodesByTypeIndexDisabledForTest(false);
      const on = run();

      expect(on.owners.length).toBeGreaterThan(20);
      expect(on.owners).toEqual(off.owners);
      expect(on.mappings).toEqual(off.mappings);
      expect(off.fallbackScans).toBeGreaterThan(0);
      expect(on.fallbackScans).toBe(0);
    },
    TIMEOUT_MS,
  );
});

/**
 * Perf-loop E06 — the four `appendTopologyResourceRectangles` companion-consumed predicates
 * (`isAlb/isApiGateway/isEcs/isDatastore CompanionConsumedAsSatellite`) now resolve their
 * driver-type candidates via the threaded `nodesByType` index instead of an O(all-nodes)
 * `Object.keys` walk per address. For each predicate this asserts, on every satellite-typed
 * address of the pinned fixture:
 *
 *  1. BYTE/BEHAVIOR IDENTITY — the boolean is identical whether the index is threaded in
 *     (fast path) or omitted (`undefined` → exact legacy full scan).
 *  2. ENGAGEMENT — the omitted-index run records exactly one extra outer fallback scan per
 *     call vs the threaded run (which contributes zero), i.e. the index is truly consulted.
 */
describe("companion-consumed predicates use the threaded nodesByType index (perf-loop E06)", () => {
  afterEach(() => {
    setNodesByTypeIndexDisabledForTest(false);
  });

  it(
    "indexed == scan for each of the four predicates + outer fallback drops per call",
    async () => {
      const { nodes, plan } = await loadFixtureNodesAndPlan();

      await withTerraformPlanNodeKeyIndex(nodes, async () => {
        const arnIndex = buildArnIndexForTopology(nodes);
        const nodesByType = getMemoizedNodesByTypeIndex(nodes);
        expect(nodesByType).toBeDefined();

        const nonMeta = Object.keys(nodes).filter((k) => !k.startsWith("__"));

        // Per-predicate: the addresses the driver would actually route through it, its
        // indexed / scan callers, and the driver type it walks (one outer fallback / call).
        const specs = [
          {
            name: "alb",
            match: (addr: string) =>
              isAlbTopologySatelliteResourceType(
                resourceTypeForNode(nodes, addr),
              ),
            indexed: (addr: string) =>
              isAlbCompanionConsumedAsSatellite(
                nodes,
                arnIndex,
                addr,
                nodesByType,
              ),
            scan: (addr: string) =>
              isAlbCompanionConsumedAsSatellite(
                nodes,
                arnIndex,
                addr,
                undefined,
              ),
          },
          {
            name: "apiGateway",
            match: (addr: string) =>
              isApiGatewayTopologySatelliteResourceType(
                resourceTypeForNode(nodes, addr),
              ),
            indexed: (addr: string) =>
              isApiGatewayCompanionConsumedAsSatellite(
                nodes,
                addr,
                nodesByType,
              ),
            scan: (addr: string) =>
              isApiGatewayCompanionConsumedAsSatellite(nodes, addr, undefined),
          },
          {
            name: "ecs",
            match: (addr: string) =>
              isEcsTopologySatelliteResourceType(
                resourceTypeForNode(nodes, addr),
              ),
            indexed: (addr: string) =>
              isEcsCompanionConsumedAsSatellite(
                nodes,
                arnIndex,
                addr,
                plan,
                nodesByType,
              ),
            scan: (addr: string) =>
              isEcsCompanionConsumedAsSatellite(
                nodes,
                arnIndex,
                addr,
                plan,
                undefined,
              ),
          },
          {
            name: "datastore",
            match: (addr: string) =>
              isDatastoreTopologySatelliteResourceType(
                resourceTypeForNode(nodes, addr),
              ),
            indexed: (addr: string) =>
              isDatastoreCompanionConsumedAsSatellite(nodes, addr, nodesByType),
            scan: (addr: string) =>
              isDatastoreCompanionConsumedAsSatellite(nodes, addr, undefined),
          },
        ] as const;

        let anyCandidates = false;
        let anyTrue = false;

        for (const spec of specs) {
          const addrs = nonMeta.filter(spec.match).sort();
          if (addrs.length === 0) {
            continue;
          }
          anyCandidates = true;

          // Warm every per-`nodes` memo touched by this predicate BEFORE measuring, so any
          // one-time inner fallback (recorded once on first cache miss) is excluded from both
          // measured runs and the outer-walk delta stays exact.
          addrs.forEach(spec.indexed);

          resetFallbackScanCount();
          const indexed = addrs.map(spec.indexed);
          const indexedFallback = getFallbackScanCount();

          resetFallbackScanCount();
          const scan = addrs.map(spec.scan);
          const scanFallback = getFallbackScanCount();

          // 1. Behavior identity across every candidate address.
          expect(indexed, `${spec.name}: indexed == scan`).toEqual(scan);

          // 2. Engagement: the outer walk contributes exactly one fallback per scan-mode
          //    call and zero per indexed-mode call; inner-helper fallbacks (identical in
          //    both modes) cancel in the delta.
          expect(
            scanFallback - indexedFallback,
            `${spec.name}: one outer fallback dropped per call`,
          ).toBe(addrs.length);

          if (indexed.some(Boolean)) {
            anyTrue = true;
          }
        }

        // Non-vacuous: the fixture exercises at least one predicate, and at least one
        // address is genuinely consumed (so we are not just comparing all-false).
        expect(anyCandidates).toBe(true);
        expect(anyTrue).toBe(true);
      });
    },
    TIMEOUT_MS,
  );
});
