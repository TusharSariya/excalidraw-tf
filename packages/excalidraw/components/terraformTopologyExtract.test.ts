import { describe, expect, it } from "vitest";

import {
  buildModuleCompanionAccountIndex,
  extractDefaultAwsProviderAccountRegion,
  extractTerraformTopologyFromPlan,
  mergeTerraformTopologyAccountRegionFromSameRegionSubnets,
  mergeWithDefaultAwsProviderAccountRegion,
  parseAwsArnLocation,
  pickResourceChangeValues,
  pickResourceValuesForTopologyPlacement,
  resolveModuleCompanionAccount,
  resolveTerraformDeployRoleIamArnFromPlan,
  TERRAFORM_TOPOLOGY_UNKNOWN_ACCOUNT,
  TERRAFORM_TOPOLOGY_UNKNOWN_REGION,
} from "./terraformTopologyExtract";

import type { ResourceChange } from "./terraformTopologyExtract";

describe("resolveTerraformDeployRoleIamArnFromPlan", () => {
  it("prefers explicit terraform_deploy_role_arn variable", () => {
    const arn = resolveTerraformDeployRoleIamArnFromPlan({
      variables: {
        terraform_deploy_role_arn: {
          value: " arn:aws:iam::111111111111:role/Custom ",
        },
        aws_account_id: { value: "222222222222" },
      },
    });
    expect(arn).toBe("arn:aws:iam::111111111111:role/Custom");
  });

  it("builds IAM role ARN from aws_account_id and terraform_deploy_role_name", () => {
    expect(
      resolveTerraformDeployRoleIamArnFromPlan({
        variables: {
          terraform_deploy_role_arn: { value: "" },
          aws_account_id: { value: "992382747916" },
          terraform_deploy_role_name: { value: "TerraformDeploy" },
        },
      }),
    ).toBe("arn:aws:iam::992382747916:role/TerraformDeploy");
  });
});

describe("extractDefaultAwsProviderAccountRegion", () => {
  const providerAws = {
    name: "aws",
    expressions: {
      region: { references: ["var.aws_region"] },
      assume_role: [
        {
          role_arn: { references: ["local.terraform_deploy_role_arn"] },
          session_name: { constant_value: "terraform-excalidraw-tf" },
        },
      ],
    },
  };

  it("resolves region and account from variables and assume_role local reference", () => {
    const hint = extractDefaultAwsProviderAccountRegion({
      configuration: { provider_config: { aws: providerAws } },
      variables: {
        aws_region: { value: "us-east-1" },
        aws_account_id: { value: "992382747916" },
        terraform_deploy_role_arn: { value: "" },
        terraform_deploy_role_name: { value: "TerraformDeploy" },
      },
    });
    expect(hint).toEqual({ account: "992382747916", region: "us-east-1" });
  });

  it("resolves account from constant IAM role ARN on provider", () => {
    const hint = extractDefaultAwsProviderAccountRegion({
      configuration: {
        provider_config: {
          aws: {
            name: "aws",
            expressions: {
              region: { constant_value: "eu-west-1" },
              assume_role: [
                {
                  role_arn: {
                    constant_value: "arn:aws:iam::444444444444:role/Deploy",
                  },
                },
              ],
            },
          },
        },
      },
    });
    expect(hint).toEqual({ account: "444444444444", region: "eu-west-1" });
  });

  it("returns null when default aws provider block is absent", () => {
    expect(
      extractDefaultAwsProviderAccountRegion({ configuration: {} }),
    ).toBeNull();
  });

  it("resolves account and region from synthetic plan variables", () => {
    const hint = extractDefaultAwsProviderAccountRegion({
      variables: {
        aws_account_id: { value: "123456789012" },
        aws_region: { value: "us-west-2" },
      },
    });
    expect(hint).toEqual({ account: "123456789012", region: "us-west-2" });
  });
});

describe("mergeWithDefaultAwsProviderAccountRegion", () => {
  it("fills only unknown placeholders", () => {
    const plan = {
      configuration: {
        provider_config: {
          aws: {
            expressions: {
              region: { constant_value: "ap-south-1" },
              assume_role: [
                {
                  role_arn: {
                    constant_value: "arn:aws:iam::121212121212:role/R",
                  },
                },
              ],
            },
          },
        },
      },
    };
    expect(
      mergeWithDefaultAwsProviderAccountRegion(plan, {
        account: TERRAFORM_TOPOLOGY_UNKNOWN_ACCOUNT,
        region: TERRAFORM_TOPOLOGY_UNKNOWN_REGION,
      }),
    ).toEqual({ account: "121212121212", region: "ap-south-1" });
    expect(
      mergeWithDefaultAwsProviderAccountRegion(plan, {
        account: "999999999999",
        region: "us-east-1",
      }),
    ).toEqual({ account: "999999999999", region: "us-east-1" });
  });
});

describe("parseAwsArnLocation", () => {
  it("parses regional ARN", () => {
    expect(
      parseAwsArnLocation(
        "arn:aws:ec2:us-east-1:992382747916:subnet/subnet-0a342e3606f8ce4e8",
      ),
    ).toEqual({ region: "us-east-1", account: "992382747916" });
  });
});

describe("pickResourceChangeValues", () => {
  it("prefers after over before", () => {
    const rc = {
      change: {
        before: { id: "old" },
        after: { id: "subnet-1", vpc_id: "vpc-1" },
      },
    };
    expect(pickResourceChangeValues(rc)).toEqual({
      id: "subnet-1",
      vpc_id: "vpc-1",
    });
  });
});

describe("mergeTerraformTopologyAccountRegionFromSameRegionSubnets", () => {
  it("fills unknown account when region matches a subnet hint", () => {
    const subnetOwners = new Map([
      ["subnet-a", { account: "111122223333", region: "eu-west-1" }],
    ]);
    expect(
      mergeTerraformTopologyAccountRegionFromSameRegionSubnets(
        { account: TERRAFORM_TOPOLOGY_UNKNOWN_ACCOUNT, region: "eu-west-1" },
        subnetOwners,
      ),
    ).toEqual({ account: "111122223333", region: "eu-west-1" });
  });

  it("leaves unknown account when no subnet hint shares the region", () => {
    const subnetOwners = new Map([
      ["subnet-a", { account: "111122223333", region: "eu-west-1" }],
    ]);
    expect(
      mergeTerraformTopologyAccountRegionFromSameRegionSubnets(
        {
          account: TERRAFORM_TOPOLOGY_UNKNOWN_ACCOUNT,
          region: "us-east-1",
        },
        subnetOwners,
      ).account,
    ).toBe(TERRAFORM_TOPOLOGY_UNKNOWN_ACCOUNT);
  });

  it("does not override an explicit account", () => {
    const subnetOwners = new Map([
      ["subnet-a", { account: "111122223333", region: "eu-west-1" }],
    ]);
    expect(
      mergeTerraformTopologyAccountRegionFromSameRegionSubnets(
        { account: "999988887777", region: "eu-west-1" },
        subnetOwners,
      ),
    ).toEqual({ account: "999988887777", region: "eu-west-1" });
  });

  it("does nothing when region is unknown", () => {
    expect(
      mergeTerraformTopologyAccountRegionFromSameRegionSubnets(
        {
          account: TERRAFORM_TOPOLOGY_UNKNOWN_ACCOUNT,
          region: TERRAFORM_TOPOLOGY_UNKNOWN_REGION,
        },
        new Map([
          ["subnet-a", { account: "111122223333", region: "eu-west-1" }],
        ]),
      ).account,
    ).toBe(TERRAFORM_TOPOLOGY_UNKNOWN_ACCOUNT);
  });

  it("P2.2 guard: fills in a single-account region but stays UNKNOWN in a multi-account region", () => {
    // Single distinct account in eu-west-1 -> the guess is applied.
    const singleAccountRegion = new Map([
      ["subnet-a", { account: "111122223333", region: "eu-west-1" }],
      ["subnet-b", { account: "111122223333", region: "eu-west-1" }],
    ]);
    expect(
      mergeTerraformTopologyAccountRegionFromSameRegionSubnets(
        { account: TERRAFORM_TOPOLOGY_UNKNOWN_ACCOUNT, region: "eu-west-1" },
        singleAccountRegion,
        { privateApiRegional: true },
      ),
    ).toEqual({ account: "111122223333", region: "eu-west-1" });

    // Two distinct accounts share eu-west-1 -> guessing the first-sorted subnet
    // would split a VPC across accounts, so the account is left UNKNOWN.
    const multiAccountRegion = new Map([
      ["subnet-a", { account: "111122223333", region: "eu-west-1" }],
      ["subnet-b", { account: "444455556666", region: "eu-west-1" }],
    ]);
    expect(
      mergeTerraformTopologyAccountRegionFromSameRegionSubnets(
        { account: TERRAFORM_TOPOLOGY_UNKNOWN_ACCOUNT, region: "eu-west-1" },
        multiAccountRegion,
        { privateApiRegional: true },
      ).account,
    ).toBe(TERRAFORM_TOPOLOGY_UNKNOWN_ACCOUNT);
  });
});

describe("resolveModuleCompanionAccount", () => {
  const apiAddr = "module.api.aws_api_gateway_rest_api.private";

  /** A companion resource change carrying an owning account via a top-level ARN. */
  const companionWithArn = (address: string, arn: string): ResourceChange =>
    ({
      address,
      mode: "managed",
      type: "aws_cloudwatch_log_group",
      provider_name: "registry.terraform.io/hashicorp/aws",
      change: { actions: ["create"], after: { arn } },
    } as unknown as ResourceChange);

  it("(a) resolves the single distinct companion account in the same module + region", () => {
    const index = buildModuleCompanionAccountIndex([
      companionWithArn(
        "module.api.aws_cloudwatch_log_group.access",
        "arn:aws:logs:us-east-1:111111111111:log-group:/api",
      ),
    ]);
    expect(resolveModuleCompanionAccount(apiAddr, "us-east-1", index)).toBe(
      "111111111111",
    );
  });

  it("(a2) resolves from a descendant-module companion", () => {
    const index = buildModuleCompanionAccountIndex([
      companionWithArn(
        "module.api.module.lambda_service.aws_cloudwatch_log_group.fn",
        "arn:aws:logs:us-east-1:111111111111:log-group:/fn",
      ),
    ]);
    expect(resolveModuleCompanionAccount(apiAddr, "us-east-1", index)).toBe(
      "111111111111",
    );
  });

  it("(b) returns null when no companion shares the module", () => {
    const index = buildModuleCompanionAccountIndex([
      companionWithArn(
        "module.other.aws_cloudwatch_log_group.x",
        "arn:aws:logs:us-east-1:111111111111:log-group:/x",
      ),
    ]);
    expect(
      resolveModuleCompanionAccount(apiAddr, "us-east-1", index),
    ).toBeNull();
  });

  it("(c) returns null when the module has >1 distinct companion account (ambiguous)", () => {
    const index = buildModuleCompanionAccountIndex([
      companionWithArn(
        "module.api.aws_cloudwatch_log_group.a",
        "arn:aws:logs:us-east-1:111111111111:log-group:/a",
      ),
      companionWithArn(
        "module.api.aws_sqs_queue.b",
        "arn:aws:sqs:us-east-1:222222222222:queue-b",
      ),
    ]);
    expect(
      resolveModuleCompanionAccount(apiAddr, "us-east-1", index),
    ).toBeNull();
  });

  it("(d) excludes companions in a different region", () => {
    const index = buildModuleCompanionAccountIndex([
      companionWithArn(
        "module.api.aws_cloudwatch_log_group.access",
        "arn:aws:logs:us-west-2:111111111111:log-group:/api",
      ),
    ]);
    // Same module, but the API's region (us-east-1) has no companion there.
    expect(
      resolveModuleCompanionAccount(apiAddr, "us-east-1", index),
    ).toBeNull();
    // The companion's own region does resolve.
    expect(resolveModuleCompanionAccount(apiAddr, "us-west-2", index)).toBe(
      "111111111111",
    );
  });

  it("(e) keeps two merged stacks with identical module.api paths disambiguated", () => {
    const index = buildModuleCompanionAccountIndex([
      companionWithArn(
        "stack-a::module.api.aws_cloudwatch_log_group.access",
        "arn:aws:logs:us-east-1:111111111111:log-group:/a",
      ),
      companionWithArn(
        "stack-b::module.api.aws_cloudwatch_log_group.access",
        "arn:aws:logs:us-east-1:222222222222:log-group:/b",
      ),
    ]);
    // Each stack's API resolves to its OWN companion account — the identical
    // bare module path must NOT collapse into an ambiguous cross-stack set.
    expect(
      resolveModuleCompanionAccount(`stack-a::${apiAddr}`, "us-east-1", index),
    ).toBe("111111111111");
    expect(
      resolveModuleCompanionAccount(`stack-b::${apiAddr}`, "us-east-1", index),
    ).toBe("222222222222");
  });

  it("(f) resolves an owner_id companion by its own region, and DROPS a region-less one", () => {
    // owner_id + explicit region -> indexed under that region.
    const ownerIdWithRegion = {
      address: "module.api.aws_sqs_queue.q",
      mode: "managed",
      type: "aws_sqs_queue",
      provider_name: "registry.terraform.io/hashicorp/aws",
      change: {
        actions: ["create"],
        after: { owner_id: "111111111111", region: "us-east-1" },
      },
    } as unknown as ResourceChange;
    const index = buildModuleCompanionAccountIndex([ownerIdWithRegion]);
    expect(resolveModuleCompanionAccount(apiAddr, "us-east-1", index)).toBe(
      "111111111111",
    );

    // owner_id but NO region signal -> deliberately DROPPED (not bucketed under a
    // provider default). The implementation prefers "obviously unresolved" over
    // "silently misplaced" via a non-default provider alias, so it resolves null.
    const ownerIdNoRegion = {
      address: "module.api.aws_sqs_queue.q",
      mode: "managed",
      type: "aws_sqs_queue",
      provider_name: "registry.terraform.io/hashicorp/aws",
      change: { actions: ["create"], after: { owner_id: "111111111111" } },
    } as unknown as ResourceChange;
    const droppedIndex = buildModuleCompanionAccountIndex([ownerIdNoRegion]);
    expect(
      resolveModuleCompanionAccount(apiAddr, "us-east-1", droppedIndex),
    ).toBeNull();
  });

  it("(g) indexes a companion being destroyed via its `before` ownership fields", () => {
    const destroyedCompanion = {
      address: "module.api.aws_cloudwatch_log_group.access",
      mode: "managed",
      type: "aws_cloudwatch_log_group",
      provider_name: "registry.terraform.io/hashicorp/aws",
      change: {
        actions: ["delete"],
        before: {
          arn: "arn:aws:logs:us-east-1:111111111111:log-group:/api",
        },
        after: null,
      },
    } as unknown as ResourceChange;
    const index = buildModuleCompanionAccountIndex([destroyedCompanion]);
    expect(resolveModuleCompanionAccount(apiAddr, "us-east-1", index)).toBe(
      "111111111111",
    );
  });
});

describe("pickResourceValuesForTopologyPlacement", () => {
  it("uses before on delete when after is null", () => {
    const rc = {
      change: {
        actions: ["delete"],
        before: { vpc_id: "vpc-x", region: "us-east-1" },
        after: null,
      },
    };
    expect(pickResourceValuesForTopologyPlacement(rc)).toEqual({
      vpc_id: "vpc-x",
      region: "us-east-1",
    });
  });

  it("merges non-empty after onto before for delete", () => {
    const rc = {
      change: {
        actions: ["delete"],
        before: { vpc_id: "vpc-a", region: "us-east-1" },
        after: { tags: { a: "b" } },
      },
    };
    expect(pickResourceValuesForTopologyPlacement(rc)).toEqual({
      vpc_id: "vpc-a",
      region: "us-east-1",
      tags: { a: "b" },
    });
  });

  it("uses before when after is empty object", () => {
    const rc = {
      change: {
        actions: ["update"],
        before: { subnet_ids: ["subnet-1"], region: "eu-west-1" },
        after: {},
      },
    };
    expect(pickResourceValuesForTopologyPlacement(rc)).toEqual({
      subnet_ids: ["subnet-1"],
      region: "eu-west-1",
    });
  });
});

describe("extractTerraformTopologyFromPlan", () => {
  it("indexes aws_subnet id to vpc_id", () => {
    const plan = {
      resource_changes: [
        {
          type: "aws_subnet",
          mode: "managed",
          provider_name: "registry.opentofu.org/hashicorp/aws",
          change: {
            actions: ["no-op"],
            after: {
              id: "subnet-aaa",
              vpc_id: "vpc-bbb",
              arn: "arn:aws:ec2:us-west-2:111111111111:subnet/subnet-aaa",
              region: "us-west-2",
            },
          },
        },
      ],
    };
    const model = extractTerraformTopologyFromPlan(plan);
    expect(model.sawAwsResourceChanges).toBe(true);
    const acc = model.accounts.get("111111111111");
    expect(acc).toBeDefined();
    const reg = acc!.regions.get("us-west-2");
    expect(reg).toBeDefined();
    const vpc = reg!.vpcs.get("vpc-bbb");
    expect(vpc).toBeDefined();
    expect(vpc!.subnets.has("subnet-aaa")).toBe(true);
  });

  it("maps lambda vpc_config subnet_ids through subnet index", () => {
    const plan = {
      resource_changes: [
        {
          type: "aws_subnet",
          mode: "managed",
          provider_name: "hashicorp/aws",
          change: {
            after: {
              id: "subnet-s1",
              vpc_id: "vpc-v1",
              arn: "arn:aws:ec2:eu-west-1:222222222222:subnet/subnet-s1",
              region: "eu-west-1",
            },
          },
        },
        {
          type: "aws_lambda_function",
          mode: "managed",
          provider_name: "hashicorp/aws",
          change: {
            after: {
              arn: "arn:aws:lambda:eu-west-1:222222222222:function:fn",
              region: "eu-west-1",
              vpc_config: [
                {
                  subnet_ids: ["subnet-s1"],
                  security_group_ids: [],
                },
              ],
            },
          },
        },
      ],
    };
    const model = extractTerraformTopologyFromPlan(plan);
    const vpc = model.accounts
      .get("222222222222")
      ?.regions.get("eu-west-1")
      ?.vpcs.get("vpc-v1");
    expect(vpc?.subnets.has("subnet-s1")).toBe(true);
  });

  it("omits topology when account cannot be resolved from subnet row", () => {
    const plan = {
      resource_changes: [
        {
          type: "aws_subnet",
          mode: "managed",
          change: {
            after: {
              id: "subnet-x",
              vpc_id: "vpc-y",
              region: "ap-south-1",
            },
          },
        },
      ],
    };
    const model = extractTerraformTopologyFromPlan(plan);
    expect(model.accounts.has(TERRAFORM_TOPOLOGY_UNKNOWN_ACCOUNT)).toBe(false);
    expect(model.accounts.size).toBe(0);
  });

  it("inherits account from aws_subnet when resource has no parseable ARN but subnet_ids", () => {
    const plan = {
      resource_changes: [
        {
          type: "aws_subnet",
          mode: "managed",
          change: {
            after: {
              id: "subnet-inherit",
              vpc_id: "vpc-same",
              arn: "arn:aws:ec2:eu-west-1:333333333333:subnet/subnet-inherit",
              region: "eu-west-1",
            },
          },
        },
        {
          type: "aws_network_acl_association",
          mode: "managed",
          change: {
            after: {
              subnet_id: "subnet-inherit",
              network_acl_id: "acl-1",
              region: "eu-west-1",
            },
          },
        },
      ],
    };
    const model = extractTerraformTopologyFromPlan(plan);
    expect(model.accounts.has(TERRAFORM_TOPOLOGY_UNKNOWN_ACCOUNT)).toBe(false);
    expect(
      model.accounts
        .get("333333333333")
        ?.regions.get("eu-west-1")
        ?.vpcs.get("vpc-same"),
    ).toBeDefined();
  });

  it("does not emit placeholder topology when plan has AWS but no VPC/subnet signals", () => {
    const plan = {
      resource_changes: [
        {
          type: "aws_s3_bucket",
          mode: "managed",
          provider_name: "hashicorp/aws",
          change: {
            after: { bucket: "b", region: "us-east-1" },
          },
        },
      ],
    };
    const model = extractTerraformTopologyFromPlan(plan);
    expect(model.accounts.size).toBe(0);
    expect(
      model.accounts.get(TERRAFORM_TOPOLOGY_UNKNOWN_ACCOUNT),
    ).toBeUndefined();
  });

  it("uses default aws provider account for standalone VPC placement when resource lacks ARN", () => {
    const plan = {
      configuration: {
        provider_config: {
          aws: {
            expressions: {
              region: { constant_value: "us-east-1" },
              assume_role: [
                {
                  role_arn: {
                    constant_value: "arn:aws:iam::777777777777:role/Deploy",
                  },
                },
              ],
            },
          },
        },
      },
      resource_changes: [
        {
          address: "aws_security_group.app",
          type: "aws_security_group",
          mode: "managed",
          provider_name: "registry.terraform.io/hashicorp/aws",
          change: {
            actions: ["create"],
            after: {
              name: "app",
              vpc_id: "vpc-standalone",
              region: "us-east-1",
            },
          },
        },
      ],
    };
    const model = extractTerraformTopologyFromPlan(plan);
    expect(
      model.accounts
        .get("777777777777")
        ?.regions.get("us-east-1")
        ?.vpcs.get("vpc-standalone"),
    ).toBeDefined();
  });
});
