/**
 * Registry: satellite kind catalog + per-primary layout attachments.
 */

import { albSatelliteStackHeightPx } from "./terraformTopologyAlbLinks";
import { buildAlbListenerTargetCluster } from "./terraformTopologyAlbLinks";
import {
  buildResourceCloudWatchCluster,
  cloudWatchSatelliteStackHeightPx,
} from "./terraformTopologyCloudWatchLinks";
import {
  buildEcsClusterCompanionCluster,
  buildEcsEc2CapacityCompanionCluster,
  buildEcsServiceCompanionCluster,
  ecsClusterSatelliteStackHeightPx,
  ecsEc2SatelliteStackHeightPx,
  ecsSatelliteStackHeightPx,
} from "./terraformTopologyEcsLinks";
import {
  buildEksCompanionCluster,
  eksCompanionSatelliteStackHeightPx,
} from "./terraformTopologyEksLinks";
import {
  buildPrimaryIamCluster,
  iamSatelliteStackHeightPx,
  type TopologyIamEdge,
} from "./terraformTopologyIamLinks";
import {
  apiGatewaySatelliteStackHeightPx,
  buildApiGatewayCompanionCluster,
  buildApiGatewayVpcLinkCluster,
} from "./terraformTopologyApiGatewayLinks";
import { buildTransitGatewayCompanionCluster } from "./terraformTopologyTransitGatewayLinks";
import { transitGatewaySatelliteStackHeightPx } from "./terraformTopologyTransitGatewayLinks";
import { sgSatelliteStackHeightPx } from "./terraformTopologySgLinks";
import { buildPrimarySgCluster } from "./terraformTopologySgLinks";
import {
  buildS3CompanionCluster,
  s3SatelliteStackHeightPx,
} from "./terraformTopologyS3Links";
import {
  buildSqsCompanionCluster,
  sqsSatelliteStackHeightPx,
} from "./terraformTopologySqsLinks";
import {
  auroraSatelliteStackHeightPx,
  buildAuroraCompanionCluster,
  buildRdsCompanionCluster,
  rdsSatelliteStackHeightPx,
} from "./terraformTopologyDatastoreLinks";

import { buildLambdaPermissionCluster } from "./terraformTopologyLambdaPermissionLinks";
import { getTerraformCardResourceType } from "./terraformResourceCardLabel";
import { getTopologyPrimaryLayoutJson } from "./terraformTopologyPrimaryLayoutLoader";

import {
  buildNodesByTypeIndex,
  buildSatelliteClusterForKind,
  collectSatelliteAddressesForKind,
  getAllCatalogPluginIds,
  getMemoizedNodesByTypeIndex,
  type SatelliteBuildContext,
} from "./terraformTopologySatelliteEngine";

import { installSatellitePlugins } from "./terraformTopologySatellitePlugins";

import type { ResolvedPrimaryLayoutConfig } from "./terraformTopologyPrimaryLayoutConfig";
import type { TopologySatelliteKind } from "./terraformTopologyPrimaryLayoutTypes";
import type { buildKmsKeyPolicyCluster } from "./terraformTopologyKmsLinks";

import type {
  TerraformPlanGraphNode,
  TerraformPlanNodesMap,
} from "./terraformPlanParsing";

export function assertAllCatalogPluginsRegistered(): void {
  installSatellitePlugins();
  const registered = new Set([
    "cloudwatch_resource",
    "iam_execution_role",
    "security_groups",
    "alb_companions",
    "eks_companions",
    "ecs_companions",
    "ecs_cluster_companions",
    "ecs_ec2_capacity_companions",
    "api_gateway_companions",
    "api_gateway_vpc_links",
    "tgw_companions",
    "s3_companions",
    "sqs_companions",
    "aurora_companions",
    "rds_companions",
  ]);
  for (const id of getAllCatalogPluginIds()) {
    if (!registered.has(id)) {
      throw new Error(`Missing plugin registration for ${id}`);
    }
  }
}

function getPrimaryResource(
  node: TerraformPlanGraphNode | undefined,
): Record<string, unknown> | undefined {
  const first = Object.values(node?.resources || {})[0];
  return first && typeof first === "object"
    ? (first as Record<string, unknown>)
    : undefined;
}

function layoutAttachmentsForPrimary(
  primaryType: string,
): TopologySatelliteKind[] {
  return getTopologyPrimaryLayoutJson(primaryType).attachments;
}

export function enabledKindsForPrimaryType(
  primaryType: string,
): ReadonlySet<TopologySatelliteKind> {
  return new Set(layoutAttachmentsForPrimary(primaryType));
}

export function isKindEnabledForPrimary(
  primaryType: string,
  kind: TopologySatelliteKind,
): boolean {
  return enabledKindsForPrimaryType(primaryType).has(kind);
}

export function buildSatelliteContext(
  nodes: TerraformPlanNodesMap,
  primaryAddress: string,
  arnIndex: Map<string, string>,
  plan?: unknown,
): SatelliteBuildContext {
  const node = nodes[primaryAddress] as TerraformPlanGraphNode | undefined;
  const pr = getPrimaryResource(node);
  const primaryType =
    typeof pr?.type === "string"
      ? pr.type
      : getTerraformCardResourceType(primaryAddress, pr);
  const planChanges = Array.isArray(
    (plan as { resource_changes?: unknown })?.resource_changes,
  )
    ? (plan as { resource_changes: Array<{ address?: string; type?: string }> })
        .resource_changes ?? []
    : undefined;
  return {
    nodes,
    primaryAddress,
    primaryType,
    arnIndex,
    plan,
    planChanges,
    // Perf-loop E02: attach the memoized per-`nodes` type index (TODO-3). Built once and
    // shared across every context, it lets every reverse-ref / companion / plugin scan
    // resolve candidates by type instead of falling back to an O(all-nodes) `Object.keys`
    // walk per kind per address. `undefined` only under the test kill switch.
    nodesByType: getMemoizedNodesByTypeIndex(nodes),
  };
}

export type TopologyPrimarySatelliteBundles = {
  primaryType: string;
  iam: ReturnType<typeof buildPrimaryIamCluster>;
  kms: ReturnType<typeof buildKmsKeyPolicyCluster>;
  sg: ReturnType<typeof buildPrimarySgCluster>;
  s3: ReturnType<typeof buildS3CompanionCluster>;
  alb: ReturnType<typeof buildAlbListenerTargetCluster>;
  ecs: ReturnType<typeof buildEcsServiceCompanionCluster>;
  ecsCluster: ReturnType<typeof buildEcsClusterCompanionCluster>;
  eks: ReturnType<typeof buildEksCompanionCluster>;
  ecsEc2: ReturnType<typeof buildEcsEc2CapacityCompanionCluster>;
  api: ReturnType<typeof buildApiGatewayCompanionCluster>;
  apiVpc: ReturnType<typeof buildApiGatewayVpcLinkCluster>;
  tgw: ReturnType<typeof buildTransitGatewayCompanionCluster>;
  lambdaPermission: ReturnType<typeof buildLambdaPermissionCluster>;
  sqs: ReturnType<typeof buildSqsCompanionCluster>;
  aurora: ReturnType<typeof buildAuroraCompanionCluster>;
  rds: ReturnType<typeof buildRdsCompanionCluster>;
  cloudWatch: ReturnType<typeof buildResourceCloudWatchCluster>;
};

export function buildTopologyPrimarySatelliteBundles(
  nodes: TerraformPlanNodesMap,
  address: string,
  arnIndex: Map<string, string>,
  plan?: unknown,
): TopologyPrimarySatelliteBundles {
  installSatellitePlugins();
  const ctx = buildSatelliteContext(nodes, address, arnIndex, plan);
  const { primaryType } = ctx;
  const enabled = enabledKindsForPrimaryType(primaryType);
  const empty = { cluster: null, edges: [] as TopologyIamEdge[] };

  // Perf-loop E02: thread the memoized type index into every direct builder call so the
  // satellite-bundle path (skeleton.satelliteBundles, nested in skeleton.resourceRects)
  // resolves by type instead of full-scanning. `aurora`/`rds` take no index — they read
  // the primary node directly and never scan by type — so they are intentionally omitted.
  const { nodesByType } = ctx;
  return {
    primaryType,
    iam: enabled.has("iam")
      ? buildPrimaryIamCluster(nodes, address, arnIndex, undefined, nodesByType)
      : empty,
    kms: enabled.has("kms_policies")
      ? (buildSatelliteClusterForKind("kms_policies", ctx) as ReturnType<
          typeof buildKmsKeyPolicyCluster
        >)
      : empty,
    sg: enabled.has("security_groups")
      ? buildPrimarySgCluster(nodes, address, arnIndex, plan, nodesByType)
      : empty,
    s3: enabled.has("s3_companions")
      ? buildS3CompanionCluster(nodes, address, arnIndex, nodesByType)
      : empty,
    alb: enabled.has("alb_companions")
      ? buildAlbListenerTargetCluster(nodes, address, arnIndex, nodesByType)
      : empty,
    ecs: enabled.has("ecs_companions")
      ? buildEcsServiceCompanionCluster(nodes, address, arnIndex, nodesByType)
      : empty,
    eks: enabled.has("eks_companions")
      ? buildEksCompanionCluster(nodes, address, arnIndex, nodesByType)
      : empty,
    ecsCluster: enabled.has("ecs_cluster_companions")
      ? buildEcsClusterCompanionCluster(nodes, address, plan, nodesByType)
      : empty,
    ecsEc2: enabled.has("ecs_ec2_capacity_companions")
      ? buildEcsEc2CapacityCompanionCluster(
          nodes,
          address,
          arnIndex,
          plan,
          nodesByType,
        )
      : empty,
    api: enabled.has("api_gateway_companions")
      ? buildApiGatewayCompanionCluster(nodes, address, plan, nodesByType)
      : empty,
    apiVpc: enabled.has("api_gateway_vpc_links")
      ? buildApiGatewayVpcLinkCluster(nodes, address, plan, nodesByType)
      : empty,
    tgw:
      enabled.has("tgw_companions") && primaryType === "aws_ec2_transit_gateway"
        ? buildTransitGatewayCompanionCluster(
            nodes,
            address,
            ctx.planChanges,
            nodesByType,
          )
        : empty,
    lambdaPermission: enabled.has("lambda_permission")
      ? buildLambdaPermissionCluster(
          nodes,
          address,
          arnIndex,
          plan,
          nodesByType,
        )
      : empty,
    sqs: enabled.has("sqs_companions")
      ? buildSqsCompanionCluster(nodes, address, arnIndex, nodesByType)
      : empty,
    aurora: enabled.has("aurora_companions")
      ? buildAuroraCompanionCluster(nodes, address)
      : empty,
    rds: enabled.has("rds_companions")
      ? buildRdsCompanionCluster(nodes, address)
      : empty,
    cloudWatch:
      enabled.has("cloudwatch_alarms") || enabled.has("cloudwatch_log_groups")
        ? buildResourceCloudWatchCluster(nodes, address, nodesByType)
        : empty,
  };
}

export function satelliteStackHeightPxForKind(
  kind: TopologySatelliteKind,
  config: ResolvedPrimaryLayoutConfig,
  ctx: SatelliteBuildContext,
): number {
  if (!config.enabledKinds.has(kind)) {
    return 0;
  }

  const { nodes, primaryAddress, arnIndex, plan, primaryType, nodesByType } =
    ctx;
  const tier1H = config.tiers.tier1H;
  const tier2H = config.tiers.tier2H;
  const gap = config.gaps.satellite;

  switch (kind) {
    case "cloudwatch_alarms":
    case "cloudwatch_log_groups":
      return cloudWatchSatelliteStackHeightPx(
        nodes,
        primaryAddress,
        tier1H,
        gap,
        nodesByType,
      );
    case "iam":
      return iamSatelliteStackHeightPx(
        nodes,
        primaryAddress,
        arnIndex,
        tier1H,
        tier2H,
        gap,
        ctx.plan,
        nodesByType,
      );
    case "kms_policies": {
      installSatellitePlugins();
      const { cluster } = buildSatelliteClusterForKind("kms_policies", ctx);
      const policies =
        cluster &&
        typeof cluster === "object" &&
        cluster !== null &&
        "policies" in cluster &&
        Array.isArray((cluster as { policies: string[] }).policies)
          ? (cluster as { policies: string[] }).policies
          : [];
      return policies.length > 0 ? gap + policies.length * (tier1H + gap) : 0;
    }
    case "security_groups":
      return sgSatelliteStackHeightPx(
        nodes,
        primaryAddress,
        arnIndex,
        tier1H,
        tier2H,
        gap,
        plan,
        nodesByType,
      );
    case "s3_companions":
      return s3SatelliteStackHeightPx(
        nodes,
        primaryAddress,
        arnIndex,
        tier1H,
        tier2H,
        gap,
        nodesByType,
      );
    case "alb_companions":
      return albSatelliteStackHeightPx(
        nodes,
        primaryAddress,
        arnIndex,
        tier1H,
        tier2H,
        gap,
        nodesByType,
      );
    case "ecs_companions":
      return primaryType === "aws_ecs_service"
        ? ecsSatelliteStackHeightPx(
            nodes,
            primaryAddress,
            arnIndex,
            tier1H,
            tier2H,
            gap,
            nodesByType,
          )
        : 0;
    case "eks_companions":
      return primaryType === "aws_eks_cluster"
        ? eksCompanionSatelliteStackHeightPx(
            nodes,
            primaryAddress,
            arnIndex,
            tier1H,
            tier2H,
            gap,
            nodesByType,
          )
        : 0;
    case "ecs_cluster_companions":
      return primaryType === "aws_ecs_service"
        ? ecsClusterSatelliteStackHeightPx(
            nodes,
            primaryAddress,
            tier1H,
            tier2H,
            gap,
            ctx.plan,
            nodesByType,
          )
        : 0;
    case "ecs_ec2_capacity_companions":
      return primaryType === "aws_ecs_service"
        ? ecsEc2SatelliteStackHeightPx(
            nodes,
            primaryAddress,
            arnIndex,
            tier1H,
            tier2H,
            gap,
            ctx.plan,
            nodesByType,
          )
        : 0;
    case "api_gateway_companions":
      return primaryType === "aws_api_gateway_rest_api"
        ? apiGatewaySatelliteStackHeightPx(
            nodes,
            primaryAddress,
            tier1H,
            tier2H,
            gap,
            nodesByType,
          )
        : 0;
    case "api_gateway_vpc_links":
      /** Left column; width handled by {@link primaryLeftMarginPx}. */
      return 0;
    case "tgw_companions":
      return primaryType === "aws_ec2_transit_gateway"
        ? transitGatewaySatelliteStackHeightPx(
            nodes,
            primaryAddress,
            tier1H,
            tier2H,
            gap,
            ctx.planChanges,
            nodesByType,
          )
        : 0;
    case "lambda_permission": {
      installSatellitePlugins();
      const { cluster } = buildSatelliteClusterForKind(
        "lambda_permission",
        ctx,
      );
      const stack =
        cluster &&
        typeof cluster === "object" &&
        cluster !== null &&
        "stack" in cluster &&
        Array.isArray((cluster as { stack: string[] }).stack)
          ? (cluster as { stack: string[] }).stack
          : [];
      if (stack.length === 0) {
        return 0;
      }
      return gap + stack.length * (tier2H + gap);
    }
    case "sqs_companions":
      return sqsSatelliteStackHeightPx(
        nodes,
        primaryAddress,
        arnIndex,
        tier1H,
        tier2H,
        gap,
        nodesByType,
      );
    case "aurora_companions":
      return primaryType === "aws_rds_cluster"
        ? auroraSatelliteStackHeightPx(
            nodes,
            primaryAddress,
            tier1H,
            tier2H,
            gap,
          )
        : 0;
    case "rds_companions":
      return primaryType === "aws_db_instance"
        ? rdsSatelliteStackHeightPx(nodes, primaryAddress, tier1H, tier2H, gap)
        : 0;
    default:
      return 0;
  }
}

export function collectTopologySatelliteAddressesFromRegistry(
  nodes: TerraformPlanNodesMap,
  arnIndex: Map<string, string>,
  primaryAddresses: readonly string[],
  plan?: unknown,
): Set<string> {
  installSatellitePlugins();
  const out = new Set<string>();

  for (const primaryAddress of primaryAddresses) {
    const ctx = buildSatelliteContext(nodes, primaryAddress, arnIndex, plan);
    const kinds = enabledKindsForPrimaryType(ctx.primaryType);

    for (const kind of kinds) {
      for (const addr of collectSatelliteAddressesForKind(
        kind,
        [primaryAddress],
        nodes,
        arnIndex,
        plan,
        // Perf-loop E02: `ctx.nodesByType` is the memoized index (attached by
        // `buildSatelliteContext`); passing it here stops the per-kind ancillary scans
        // (strata.ancillary) from full-walking `Object.keys(nodes)`.
        ctx.nodesByType,
      )) {
        out.add(addr);
      }
    }
  }

  return out;
}

/**
 * Batch satellite→primary resolution across all primaries in one structured pass.
 * Contested satellites resolve to the primary that sorts first (first-claim-wins),
 * matching the semantics of the per-primary loop this replaces. Centralizing the
 * map here lets callers (placement enrichment) reuse it instead of re-deriving
 * the same satellite set with a second scan.
 */
export function buildAllSatellitePrimaryMappings(
  nodes: TerraformPlanNodesMap,
  arnIndex: Map<string, string>,
  primaryAddresses: readonly string[],
  plan?: unknown,
): Map<string, string> {
  installSatellitePlugins();
  // Perf-loop E02: reuse the shared per-`nodes` memoized index (same instance the
  // `buildSatelliteContext` paths use) so the cluster memo's `nodesByType` reference guard
  // sees one identity across bundles / collect / owner-map. Falls back to a direct build
  // when the test kill switch is set. `?? buildNodesByTypeIndex(nodes)` keeps the batch
  // resolver's own scans indexed even under that switch.
  const nodesByType =
    getMemoizedNodesByTypeIndex(nodes) ?? buildNodesByTypeIndex(nodes);
  const sortedPrimaries = [...primaryAddresses].sort();
  const out = new Map<string, string>();

  for (const primaryAddress of sortedPrimaries) {
    const ctx = buildSatelliteContext(nodes, primaryAddress, arnIndex, plan);
    const kinds = enabledKindsForPrimaryType(ctx.primaryType);
    for (const kind of kinds) {
      for (const sat of collectSatelliteAddressesForKind(
        kind,
        [primaryAddress],
        nodes,
        arnIndex,
        plan,
        nodesByType,
      )) {
        if (!out.has(sat)) {
          out.set(sat, primaryAddress);
        }
      }
    }
  }

  return out;
}

export function filterAddressesExcludingRegistrySatellites(
  nodes: TerraformPlanNodesMap,
  arnIndex: Map<string, string>,
  addresses: readonly string[],
  plan?: unknown,
  precomputedSatelliteAddresses?: ReadonlySet<string>,
): string[] {
  const consumed =
    precomputedSatelliteAddresses ??
    (() => {
      const primaries = addresses.filter((addr) => {
        const node = nodes[addr] as TerraformPlanGraphNode | undefined;
        const pr = getPrimaryResource(node);
        const t = typeof pr?.type === "string" ? pr.type : "";
        return Boolean(t && !t.startsWith("data."));
      });
      return collectTopologySatelliteAddressesFromRegistry(
        nodes,
        arnIndex,
        primaries,
        plan,
      );
    })();
  return addresses.filter((a) => !consumed.has(a));
}
