import { describe, expect, it } from "vitest";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import {
  buildTerraformImportPrepCache,
  clearTerraformImportPrepCache,
} from "./terraformImportPrepCache";

import { buildPlacementMap } from "./terraformPipelineLayoutShared";

import { filterPlanByProviderFamily } from "./terraformProviderClassification";
import {
  extractPrimaryTopologyZones,
  extractRegionalTopologyPrimaries,
  extractVpcEndpointsByVpc,
  mergePrimaryTopologyZonesByTier,
} from "./terraformTopologyPlacement";
import {
  asTerraformTopologyPlan,
  extractTerraformTopologyFromPlan,
  type ResourceChange,
} from "./terraformTopologyExtract";

import type { TerraformPlanParsingSources } from "./terraformPlanParsing";
import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";

/**
 * End-to-end regression for the private-REST-API topology correctness fix on the
 * `staging-extended-localstack-v2` preset (the real multi-account fixture where a
 * VPC was previously split across two account hulls):
 *
 *  - `module.api8/9/10/11.aws_api_gateway_rest_api.private` emit at
 *    account `000000000002`, region `us-west-2`, with NO VPC nesting.
 *  - `vpc-5b587bc4a0510e356` appears under EXACTLY ONE account.
 *  - A private-API satellite (stage/deployment) follows the API into the same
 *    regional bucket.
 *  - The bound interface `aws_vpc_endpoint` node stays independently VPC-scoped.
 */
describe("staging-extended-localstack-v2 private API regional placement", () => {
  const AUTH_ACCOUNT = "000000000002";
  const WEST_REGION = "us-west-2";
  const SHARED_VPC = "vpc-5b587bc4a0510e356";
  const WEST_APIS = [
    "module.api8.aws_api_gateway_rest_api.private",
    "module.api9.aws_api_gateway_rest_api.private",
    "module.api10.aws_api_gateway_rest_api.private",
    "module.api11.aws_api_gateway_rest_api.private",
  ];

  function loadPlan() {
    const raw = getTerraformImportPresetSourcesFromDb(
      "staging-extended-localstack-v2",
    );
    expect(raw).not.toBeNull();
    const sources = resolveSourcesWithTfdComposition(
      raw as TerraformImportPresetSources,
    );
    expect(sources.compositionErrors ?? []).toEqual([]);
    const bundle = sources.planDotBundles[0]!;
    const awsPlan = filterPlanByProviderFamily(bundle.plan as never, "aws");
    return asTerraformTopologyPlan(awsPlan);
  }

  it("emits api8-11 private REST APIs at account 000000000002 / us-west-2 with vpcId null", () => {
    const plan = loadPlan();
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

    for (const apiAddr of WEST_APIS) {
      // Not nested in any VPC zone.
      expect(zones.some((z) => z.addresses.includes(apiAddr))).toBe(false);
      // Placed in the account/region bucket (VPC-less: buckets carry no vpcId).
      const bucket = regional.find((b) => b.addresses.includes(apiAddr));
      expect(bucket, `${apiAddr} should be in a regional bucket`).toBeDefined();
      expect(bucket!.accountId).toBe(AUTH_ACCOUNT);
      expect(bucket!.region).toBe(WEST_REGION);
      expect(
        (bucket as { vpcId?: unknown }).vpcId,
        "regional buckets are vpc-less",
      ).toBeUndefined();
    }
  });

  it("keeps vpc-5b587bc4a0510e356 under exactly one account", () => {
    const plan = loadPlan();
    const model = extractTerraformTopologyFromPlan(plan);
    const owningAccounts: string[] = [];
    for (const [accountId, acc] of model.accounts) {
      for (const [, reg] of acc.regions) {
        if (reg.vpcs.has(SHARED_VPC)) {
          owningAccounts.push(accountId);
        }
      }
    }
    expect(owningAccounts).toEqual([AUTH_ACCOUNT]);
  });

  it("routes a private-API satellite (stage + deployment) to the same regional bucket", () => {
    const plan = loadPlan();
    const regional = extractRegionalTopologyPrimaries(plan, {
      privateApiRegional: true,
    });
    const apiBucket = regional.find((b) =>
      b.addresses.includes("module.api8.aws_api_gateway_rest_api.private"),
    );
    expect(apiBucket).toBeDefined();
    expect(apiBucket!.accountId).toBe(AUTH_ACCOUNT);
    expect(apiBucket!.region).toBe(WEST_REGION);

    const satelliteTypes = new Set([
      "aws_api_gateway_stage",
      "aws_api_gateway_deployment",
    ]);
    const api8Satellites = (plan.resource_changes ?? []).filter(
      (rc: ResourceChange) =>
        typeof rc.type === "string" &&
        satelliteTypes.has(rc.type) &&
        typeof rc.address === "string" &&
        rc.address.startsWith("module.api8."),
    );
    expect(api8Satellites.length).toBeGreaterThanOrEqual(2);
    for (const sat of api8Satellites) {
      const addr = sat.address as string;
      // Satellite follows the API into the regional bucket, single-homed.
      expect(apiBucket!.addresses).toContain(addr);
      const otherBuckets = regional.filter(
        (b) => b !== apiBucket && b.addresses.includes(addr),
      );
      expect(otherBuckets).toHaveLength(0);
    }
  });

  it("keeps the bound execute-api interface endpoint VPC/subnet-scoped", () => {
    const plan = loadPlan();
    const regional = extractRegionalTopologyPrimaries(plan, {
      privateApiRegional: true,
    });
    const zones = mergePrimaryTopologyZonesByTier(
      extractPrimaryTopologyZones(plan, { privateApiRegional: true }).map(
        (z) => ({
          ...z,
          topologyZoneSource: "primary" as const,
        }),
      ),
      plan,
    );
    const vpceBuckets = extractVpcEndpointsByVpc(plan);
    const westExecuteApi = vpceBuckets.find(
      (b) =>
        b.vpcId === SHARED_VPC &&
        b.addresses.some((a) => a.includes("west_execute_api")),
    );
    // The interface endpoint stays a VPC-scoped node under the shared VPC...
    expect(westExecuteApi).toBeDefined();
    expect(westExecuteApi!.accountId).toBe(AUTH_ACCOUNT);
    expect(westExecuteApi!.region).toBe(WEST_REGION);
    // ...and is NOT hoisted to a regional bucket or a primary zone.
    const endpointAddr = westExecuteApi!.addresses.find((a) =>
      a.includes("west_execute_api"),
    )!;
    expect(regional.some((b) => b.addresses.includes(endpointAddr))).toBe(
      false,
    );
    expect(zones.some((z) => z.addresses.includes(endpointAddr))).toBe(false);
  });

  // Regression: the pipeline prep cache memoizes ONE `enrichedPlacements` per
  // session/worker. It must key on `privateApiRegional` so that, for the same
  // sources, toggling the flag never serves the other value's placements —
  // otherwise ON after OFF is silently inert, and OFF after ON is not legacy.
  it("prep cache does not alias placements across privateApiRegional toggles (OFF→ON→OFF)", () => {
    const raw = getTerraformImportPresetSourcesFromDb(
      "staging-extended-localstack-v2",
    );
    expect(raw).not.toBeNull();
    const resolved = resolveSourcesWithTfdComposition(
      raw as TerraformImportPresetSources,
    );
    expect(resolved.compositionErrors ?? []).toEqual([]);
    const sources: TerraformPlanParsingSources = {
      planDotBundles: resolved.planDotBundles,
      tfdTexts: resolved.tfdTexts ?? [],
      tfdLabels: resolved.tfdLabels ?? [],
      states: [],
      stateLabels: [],
    };

    // One session/worker: a single populated prep cache reused across all three
    // placement builds (nodes + merged plan come from that same cache).
    clearTerraformImportPrepCache();
    const cache = buildTerraformImportPrepCache(sources);
    const { nodes, mergedPlan } = cache;
    const apiAddr = "module.api8.aws_api_gateway_rest_api.private";

    const vpcIdFor = (privateApiRegional: boolean): string | null => {
      const placements = buildPlacementMap(
        nodes,
        mergedPlan,
        undefined,
        undefined,
        {
          privateApiRegional,
        },
      );
      const placement = placements.get(apiAddr);
      expect(placement, `${apiAddr} should be placed`).toBeDefined();
      return placement!.vpcId;
    };

    const off1 = vpcIdFor(false);
    const on1 = vpcIdFor(true);
    const off2 = vpcIdFor(false);
    clearTerraformImportPrepCache();

    // ON: private API hoisted to the account/region bucket -> VPC-less.
    expect(on1).toBeNull();
    // OFF: legacy VPC nesting (a real `vpc-*` id), NOT contaminated by the ON
    // build that ran between the two OFF builds.
    expect(off1).not.toBeNull();
    expect(off1).toMatch(/^vpc-/);
    // OFF-after-ON reproduces the legacy placement exactly (no ON-cache alias).
    expect(off2).toBe(off1);
  }, 60_000);
});
