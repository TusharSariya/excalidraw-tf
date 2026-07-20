import { describe, expect, it } from "vitest";

import { loadStagingMultiStatePlanDotBundlesFromDb } from "../test-fixtures/terraformPresetFixtures";

import {
  namespacePlanDotBundles,
  mergePlanJsons,
} from "./terraformImportMerge";
import {
  buildTopologySubnetNameMap,
  extractPrimaryTopologyZones,
  extractRegionalTopologyPrimaries,
  mergePrimaryTopologyZonesByTier,
  topologySubnetTierFromZone,
} from "./terraformTopologyPlacement";
import {
  isPrivateVpcEndpointBoundRestApi,
  resolveVpcPlacementFromPrivateRestApi,
} from "./terraformTopologyApiGatewayLinks";
import {
  asTerraformTopologyPlan,
  buildSubnetToVpcMapFromPlan,
  pickResourceValuesForTopologyPlacement,
  type ResourceChange,
} from "./terraformTopologyExtract";

describe("staging private API VPC placement", () => {
  it("places module.api private REST APIs at region level (not VPC zones)", () => {
    const bundles = loadStagingMultiStatePlanDotBundlesFromDb();
    const { bundles: namespaced } = namespacePlanDotBundles(bundles);
    const merged = mergePlanJsons(
      namespaced.map((b) => b.plan),
      namespaced.map((b) => b.label),
    );
    const plan = asTerraformTopologyPlan(merged.plan);
    const subnetToVpc = buildSubnetToVpcMapFromPlan(plan);
    const zones = mergePrimaryTopologyZonesByTier(
      extractPrimaryTopologyZones(plan, { privateApiRegional: true }).map(
        (z) => ({
          ...z,
          topologyZoneSource: "primary" as const,
        }),
      ),
      plan,
    );
    const regional = extractRegionalTopologyPrimaries(plan, {
      privateApiRegional: true,
    });
    const subnetNameById = buildTopologySubnetNameMap(plan);

    const apiRcs = (plan.resource_changes ?? []).filter(
      (rc: ResourceChange) =>
        rc.type === "aws_api_gateway_rest_api" &&
        typeof rc.address === "string" &&
        rc.address.includes("module.api.aws_api_gateway_rest_api.private"),
    );
    expect(apiRcs.length).toBeGreaterThanOrEqual(5);

    for (const rc of apiRcs) {
      const values = pickResourceValuesForTopologyPlacement(rc);
      expect(values).toBeTruthy();
      expect(isPrivateVpcEndpointBoundRestApi(values!)).toBe(true);
      // The execute-api VPCE binding is still detectable — it is what MARKS the
      // API as private — but the API itself no longer nests into that VPC zone.
      const vpce = resolveVpcPlacementFromPrivateRestApi(
        plan,
        values!,
        subnetToVpc,
      );
      expect(vpce).toBeTruthy();
      const addr = rc.address as string;

      // Private API is placed at the account/region bucket, NOT in a VPC zone.
      expect(zones.some((z) => z.addresses.includes(addr))).toBe(false);
      expect(regional.some((b) => b.addresses.includes(addr))).toBe(true);

      // Regional bucket is at the authoritative single account for this preset.
      const apiBucket = regional.find((b) => b.addresses.includes(addr));
      expect(apiBucket).toBeDefined();
      expect(apiBucket!.accountId).toBe("992382747916");

      const stackPrefix = addr.split("::")[0]!;
      // The Lambda companion is untouched — it stays in its private-tier VPC zone.
      const lambdaAddr = (plan.resource_changes ?? []).find(
        (r: ResourceChange) =>
          r.type === "aws_lambda_function" &&
          typeof r.address === "string" &&
          r.address.startsWith(`${stackPrefix}::module.api.`),
      )?.address;
      if (!lambdaAddr) {
        continue;
      }
      const lambdaZone = zones.find((z) => z.addresses.includes(lambdaAddr));
      expect(lambdaZone).toBeDefined();
      // API is not co-located with the Lambda zone (it is not in any zone).
      expect(zones.some((z) => z.addresses.includes(addr))).toBe(false);
      expect(topologySubnetTierFromZone(lambdaZone!, subnetNameById)).toBe(
        "private",
      );
    }
  });
});
