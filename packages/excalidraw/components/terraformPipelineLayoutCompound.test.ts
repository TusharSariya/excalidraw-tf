import { describe, expect, it } from "vitest";

import { getFrameDescendants } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import {
  buildTerraformCompoundPipelineExcalidrawScene,
  buildTerraformPipelineExcalidrawScene,
} from "./terraformPipelineLayout";
import { DECLARED_DATAFLOW_ORDERED_KEY } from "./terraformDeclaredDataFlow";
import {
  collectCompoundTopologyFrameEdges,
  compareCompoundTopologyFrameEdges,
  resolveSiblingTopologyFramePair,
} from "./terraformPipelineLayoutCompoundSiblingEdges";

import { topologyFrameSkeletonId } from "./terraformPipelineTopologyFrames";
import { reconcileTerraformVisibility } from "./terraformVisibility";

import type { CompoundTopologyFrameEdge } from "./terraformPipelineLayoutCompoundSiblingEdges";

import type { TerraformPlanNodesMap } from "./terraformPlanParsing";

const node = (
  address: string,
  type: string,
): TerraformPlanNodesMap[string] => ({
  resources: {
    [address]: {
      address,
      mode: "managed",
      type,
      name: address.split(".").pop() ?? address,
      change: { actions: ["no-op"], after: {} },
    },
  },
  edges_new: [],
  edges_existing: [],
  edges_data_flow: [],
});

const rc = (
  address: string,
  type: string,
  after: Record<string, unknown> = {},
) => ({
  address,
  mode: "managed",
  type,
  name: address.split(".").pop() ?? address,
  change: { actions: ["no-op"], after },
});

function frameRoleChain(
  elements: readonly ExcalidrawElement[],
  startFrameId: string | null,
): string[] {
  const byId = new Map(elements.map((el) => [el.id, el]));
  const roles: string[] = [];
  let frameId = startFrameId;
  while (frameId) {
    const frame = byId.get(frameId);
    if (!frame || frame.type !== "frame") {
      break;
    }
    const role = (frame as { customData?: { terraformTopologyRole?: string } })
      .customData?.terraformTopologyRole;
    if (role) {
      roles.push(role);
    }
    frameId = frame.frameId ?? null;
  }
  return roles;
}

const edgesByLayer = (elements: readonly ExcalidrawElement[], layer: string) =>
  elements.filter(
    (el) =>
      (el.type === "arrow" || el.type === "line") &&
      (el as { customData?: { terraformEdgeLayer?: string } }).customData
        ?.terraformEdgeLayer === layer,
  );

const awsAccountPlanConfig = {
  configuration: {
    provider_config: {
      aws: {
        expressions: {
          assume_role: [
            {
              role_arn: {
                constant_value: "arn:aws:iam::111111111111:role/Deploy",
              },
            },
          ],
        },
      },
    },
  },
};

const resourceX = (elements: ExcalidrawElement[], address: string) => {
  const el = elements.find(
    (e) =>
      e.type === "rectangle" &&
      (e as { customData?: { nodePath?: string } }).customData?.nodePath ===
        address,
  );
  expect(el).toBeTruthy();
  return el!.x;
};

describe("terraformPipelineLayoutCompound hierarchical post-pass", () => {
  it("emits provider, account, and region context frames without regionalBucket", async () => {
    const nodes = {
      "aws_s3_bucket.a": node("aws_s3_bucket.a", "aws_s3_bucket"),
      "aws_sqs_queue.b": node("aws_sqs_queue.b", "aws_sqs_queue"),
      [DECLARED_DATAFLOW_ORDERED_KEY]: [
        {
          source: "aws_s3_bucket.a",
          target: "aws_sqs_queue.b",
          sequence: 0,
          origin: "tfd",
        },
      ],
    } as unknown as TerraformPlanNodesMap;

    const plan = {
      configuration: {
        provider_config: {
          aws: {
            expressions: {
              assume_role: [
                {
                  role_arn: {
                    constant_value: "arn:aws:iam::999988887777:role/Deploy",
                  },
                },
              ],
            },
          },
        },
      },
      resource_changes: [
        rc("aws_s3_bucket.a", "aws_s3_bucket", { region: "us-east-1" }),
        rc("aws_sqs_queue.b", "aws_sqs_queue", { region: "us-east-1" }),
      ],
    };

    const scene = await buildTerraformCompoundPipelineExcalidrawScene(
      nodes,
      plan,
    );
    expect(scene.meta.pipelineCompoundHierarchical).toBe(true);

    const frameRoles = scene.elements
      .filter((el) => el.type === "frame")
      .map(
        (el) =>
          (el as { customData?: { terraformTopologyRole?: string } }).customData
            ?.terraformTopologyRole,
      )
      .filter(Boolean);

    expect(frameRoles).toContain("provider");
    expect(frameRoles).toContain("account");
    expect(frameRoles).toContain("region");
    expect(frameRoles).not.toContain("regionalBucket");
  });

  it("stamps terraformCompoundLocal on cluster resources", async () => {
    const nodes = {
      "aws_s3_bucket.a": node("aws_s3_bucket.a", "aws_s3_bucket"),
      "aws_sqs_queue.b": node("aws_sqs_queue.b", "aws_sqs_queue"),
      [DECLARED_DATAFLOW_ORDERED_KEY]: [
        {
          source: "aws_s3_bucket.a",
          target: "aws_sqs_queue.b",
          sequence: 0,
          origin: "tfd",
        },
      ],
    } as unknown as TerraformPlanNodesMap;

    const plan = {
      resource_changes: [
        rc("aws_s3_bucket.a", "aws_s3_bucket", { region: "us-east-1" }),
        rc("aws_sqs_queue.b", "aws_sqs_queue", { region: "us-east-1" }),
      ],
    };

    const scene = await buildTerraformCompoundPipelineExcalidrawScene(
      nodes,
      plan,
    );
    const resource = scene.elements.find(
      (el) =>
        el.type === "rectangle" &&
        (el as { customData?: { nodePath?: string } }).customData?.nodePath ===
          "aws_s3_bucket.a",
    );
    const cd = (
      resource as { customData?: Record<string, unknown> } | undefined
    )?.customData;
    expect(cd?.terraformCompoundLayout).toBe(true);
    expect(cd?.terraformCompoundParentKey).toBeTruthy();
    expect(cd?.terraformCompoundLocal).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
    });
  });

  it("parents intra-region TFD arrow under region frame", async () => {
    const nodes = {
      "aws_s3_bucket.a": node("aws_s3_bucket.a", "aws_s3_bucket"),
      "aws_sqs_queue.b": node("aws_sqs_queue.b", "aws_sqs_queue"),
      [DECLARED_DATAFLOW_ORDERED_KEY]: [
        {
          source: "aws_s3_bucket.a",
          target: "aws_sqs_queue.b",
          sequence: 0,
          origin: "tfd",
        },
      ],
    } as unknown as TerraformPlanNodesMap;

    const plan = {
      resource_changes: [
        rc("aws_s3_bucket.a", "aws_s3_bucket", { region: "us-east-1" }),
        rc("aws_sqs_queue.b", "aws_sqs_queue", { region: "us-east-1" }),
      ],
    };

    const scene = await buildTerraformCompoundPipelineExcalidrawScene(
      nodes,
      plan,
    );
    const arrow = scene.elements.find(
      (el) =>
        (el.type === "arrow" || el.type === "line") &&
        (el as { customData?: { terraformEdgeLayer?: string } }).customData
          ?.terraformEdgeLayer === "declaredDataFlow",
    );
    expect(arrow?.frameId).toBeTruthy();

    const roles = frameRoleChain(scene.elements, arrow?.frameId ?? null);
    expect(roles).toContain("region");

    const regionFrame = scene.elements.find(
      (el) =>
        el.type === "frame" &&
        (el as { customData?: { terraformTopologyRole?: string } }).customData
          ?.terraformTopologyRole === "region",
    );
    expect(regionFrame).toBeTruthy();
    const descendants = getFrameDescendants(scene.elements, regionFrame!.id);
    expect(descendants.some((el) => el.id === arrow?.id)).toBe(true);
  });

  it("preserves TFD column order after re-anchor", async () => {
    const nodes = {
      "aws_s3_bucket.a": node("aws_s3_bucket.a", "aws_s3_bucket"),
      "aws_sqs_queue.b": node("aws_sqs_queue.b", "aws_sqs_queue"),
      "aws_dynamodb_table.c": node(
        "aws_dynamodb_table.c",
        "aws_dynamodb_table",
      ),
      [DECLARED_DATAFLOW_ORDERED_KEY]: [
        {
          source: "aws_s3_bucket.a",
          target: "aws_sqs_queue.b",
          sequence: 0,
          origin: "tfd",
        },
        {
          source: "aws_sqs_queue.b",
          target: "aws_dynamodb_table.c",
          sequence: 1,
          origin: "tfd",
        },
      ],
    } as unknown as TerraformPlanNodesMap;

    const plan = {
      resource_changes: [
        rc("aws_s3_bucket.a", "aws_s3_bucket", { region: "us-east-1" }),
        rc("aws_sqs_queue.b", "aws_sqs_queue", { region: "us-east-1" }),
        rc("aws_dynamodb_table.c", "aws_dynamodb_table", {
          region: "us-east-1",
        }),
      ],
    };

    const scene = await buildTerraformCompoundPipelineExcalidrawScene(
      nodes,
      plan,
    );
    expect(resourceX(scene.elements, "aws_s3_bucket.a")).toBeLessThan(
      resourceX(scene.elements, "aws_sqs_queue.b"),
    );
    expect(resourceX(scene.elements, "aws_sqs_queue.b")).toBeLessThan(
      resourceX(scene.elements, "aws_dynamodb_table.c"),
    );
  });

  it("parents cross-region TFD arrow under account frame", async () => {
    const nodes = {
      "aws_lambda_function.a": node(
        "aws_lambda_function.a",
        "aws_lambda_function",
      ),
      "aws_lambda_function.b": node(
        "aws_lambda_function.b",
        "aws_lambda_function",
      ),
      [DECLARED_DATAFLOW_ORDERED_KEY]: [
        {
          source: "aws_lambda_function.a",
          target: "aws_lambda_function.b",
          sequence: 0,
          origin: "tfd",
        },
      ],
    } as unknown as TerraformPlanNodesMap;

    const plan = {
      configuration: {
        provider_config: {
          aws: {
            expressions: {
              assume_role: [
                {
                  role_arn: {
                    constant_value: "arn:aws:iam::111111111111:role/Deploy",
                  },
                },
              ],
            },
          },
        },
      },
      resource_changes: [
        rc("aws_lambda_function.a", "aws_lambda_function", {
          region: "us-east-1",
          vpc_id: "vpc-east",
          subnet_ids: ["subnet-east-a"],
        }),
        rc("aws_lambda_function.b", "aws_lambda_function", {
          region: "us-west-2",
          vpc_id: "vpc-west",
          subnet_ids: ["subnet-west-a"],
        }),
      ],
    };

    const scene = await buildTerraformCompoundPipelineExcalidrawScene(
      nodes,
      plan,
    );
    const arrow = scene.elements.find(
      (el) =>
        (el.type === "arrow" || el.type === "line") &&
        (el as { customData?: { terraformEdgeLayer?: string } }).customData
          ?.terraformEdgeLayer === "declaredDataFlow",
    );
    expect(arrow?.frameId).toBeTruthy();
    const parentFrame = scene.elements.find((el) => el.id === arrow?.frameId);
    expect(
      (parentFrame as { customData?: { terraformTopologyRole?: string } })
        ?.customData?.terraformTopologyRole,
    ).toBe("account");
    const roles = frameRoleChain(scene.elements, arrow?.frameId ?? null);
    expect(roles).toContain("account");
    expect(roles).toContain("provider");
  });

  it("matches classic roleChain after hierarchical re-anchor", async () => {
    const nodes = {
      "aws_s3_bucket.a": node("aws_s3_bucket.a", "aws_s3_bucket"),
      "aws_sqs_queue.b": node("aws_sqs_queue.b", "aws_sqs_queue"),
      "aws_dynamodb_table.c": node(
        "aws_dynamodb_table.c",
        "aws_dynamodb_table",
      ),
      [DECLARED_DATAFLOW_ORDERED_KEY]: [
        {
          source: "aws_s3_bucket.a",
          target: "aws_sqs_queue.b",
          sequence: 0,
          origin: "tfd",
        },
        {
          source: "aws_sqs_queue.b",
          target: "aws_dynamodb_table.c",
          sequence: 1,
          origin: "tfd",
        },
      ],
    } as unknown as TerraformPlanNodesMap;

    const plan = {
      resource_changes: [
        rc("aws_s3_bucket.a", "aws_s3_bucket", { region: "us-east-1" }),
        rc("aws_sqs_queue.b", "aws_sqs_queue", { region: "us-east-1" }),
        rc("aws_dynamodb_table.c", "aws_dynamodb_table", {
          region: "us-east-1",
        }),
      ],
    };

    const classic = await buildTerraformPipelineExcalidrawScene(nodes, plan);
    const compound = await buildTerraformCompoundPipelineExcalidrawScene(
      nodes,
      plan,
    );

    for (const clusterId of [
      "aws_s3_bucket.a",
      "aws_sqs_queue.b",
      "aws_dynamodb_table.c",
    ]) {
      const classicEl = classic.elements.find(
        (e) =>
          (e as { customData?: { nodePath?: string } }).customData?.nodePath ===
          clusterId,
      );
      const compoundEl = compound.elements.find(
        (e) =>
          (e as { customData?: { nodePath?: string } }).customData?.nodePath ===
          clusterId,
      );
      expect(classicEl).toBeTruthy();
      expect(compoundEl).toBeTruthy();
      expect(
        frameRoleChain(compound.elements, compoundEl?.frameId ?? null),
      ).toEqual(frameRoleChain(classic.elements, classicEl?.frameId ?? null));
    }
  });
});

describe("terraformPipelineLayoutCompound sibling topology box edges", () => {
  it("resolveSiblingTopologyFramePair returns subnet siblings under the same VPC", () => {
    const pair = resolveSiblingTopologyFramePair(
      ["aws", "111", "us-east-1", "vpc-a", "subnet-a"],
      ["aws", "111", "us-east-1", "vpc-a", "subnet-b"],
    );
    expect(pair?.role).toBe("subnetZone");
    expect(pair?.parentFrameId).toBe(
      topologyFrameSkeletonId(
        "vpc",
        ["aws", "111", "us-east-1", "vpc-a"].join("\0"),
      ),
    );
    expect(pair?.sourceFrameId).toContain("subnetZone");
    expect(pair?.targetFrameId).toContain("subnetZone");
    expect(pair?.sourceFrameId).not.toBe(pair?.targetFrameId);
  });

  it("resolveSiblingTopologyFramePair skips ancestor/descendant placements", () => {
    expect(
      resolveSiblingTopologyFramePair(
        ["aws", "111", "us-east-1", "vpc-a"],
        ["aws", "111", "us-east-1", "vpc-a", "subnet-a"],
      ),
    ).toBeNull();
  });

  it("emits subnet-to-subnet topologyFrameFlow edge when resources cross subnets", async () => {
    const nodes = {
      "aws_lambda_function.a": node(
        "aws_lambda_function.a",
        "aws_lambda_function",
      ),
      "aws_lambda_function.b": node(
        "aws_lambda_function.b",
        "aws_lambda_function",
      ),
      [DECLARED_DATAFLOW_ORDERED_KEY]: [
        {
          source: "aws_lambda_function.a",
          target: "aws_lambda_function.b",
          sequence: 0,
          origin: "tfd",
        },
      ],
    } as unknown as TerraformPlanNodesMap;

    const plan = {
      ...awsAccountPlanConfig,
      resource_changes: [
        rc("aws_lambda_function.a", "aws_lambda_function", {
          region: "us-east-1",
          vpc_id: "vpc-a",
          subnet_ids: ["subnet-a"],
        }),
        rc("aws_lambda_function.b", "aws_lambda_function", {
          region: "us-east-1",
          vpc_id: "vpc-a",
          subnet_ids: ["subnet-b"],
        }),
      ],
    };

    const scene = await buildTerraformCompoundPipelineExcalidrawScene(
      nodes,
      plan,
    );
    expect(scene.meta.pipelineTopologyFrameEdgeCount).toBe(1);
    expect(edgesByLayer(scene.elements, "declaredDataFlow")).toHaveLength(1);
    expect(edgesByLayer(scene.elements, "topologyFrameFlow")).toHaveLength(1);

    const boxEdge = edgesByLayer(scene.elements, "topologyFrameFlow")[0]!;
    const vpcFrame = scene.elements.find(
      (el) =>
        el.type === "frame" &&
        (el as { customData?: { terraformTopologyRole?: string } }).customData
          ?.terraformTopologyRole === "vpc",
    );
    expect(vpcFrame).toBeTruthy();
    expect(boxEdge.frameId).toBe(vpcFrame?.id);

    const descendants = getFrameDescendants(scene.elements, vpcFrame!.id);
    expect(descendants.some((el) => el.id === boxEdge.id)).toBe(true);
  });

  it("does not emit topologyFrameFlow edge for intra-subnet resource edges", async () => {
    const nodes = {
      "aws_lambda_function.a": node(
        "aws_lambda_function.a",
        "aws_lambda_function",
      ),
      "aws_lambda_function.b": node(
        "aws_lambda_function.b",
        "aws_lambda_function",
      ),
      [DECLARED_DATAFLOW_ORDERED_KEY]: [
        {
          source: "aws_lambda_function.a",
          target: "aws_lambda_function.b",
          sequence: 0,
          origin: "tfd",
        },
      ],
    } as unknown as TerraformPlanNodesMap;

    const plan = {
      ...awsAccountPlanConfig,
      resource_changes: [
        rc("aws_lambda_function.a", "aws_lambda_function", {
          region: "us-east-1",
          vpc_id: "vpc-a",
          subnet_ids: ["subnet-a"],
        }),
        rc("aws_lambda_function.b", "aws_lambda_function", {
          region: "us-east-1",
          vpc_id: "vpc-a",
          subnet_ids: ["subnet-a"],
        }),
      ],
    };

    const scene = await buildTerraformCompoundPipelineExcalidrawScene(
      nodes,
      plan,
    );
    expect(edgesByLayer(scene.elements, "topologyFrameFlow")).toHaveLength(0);
    expect(edgesByLayer(scene.elements, "declaredDataFlow")).toHaveLength(1);
  });

  it("does not emit topologyFrameFlow edge for vpc-direct to subnet placements", async () => {
    const nodes = {
      "aws_nat_gateway.a": node("aws_nat_gateway.a", "aws_nat_gateway"),
      "aws_lambda_function.b": node(
        "aws_lambda_function.b",
        "aws_lambda_function",
      ),
      [DECLARED_DATAFLOW_ORDERED_KEY]: [
        {
          source: "aws_nat_gateway.a",
          target: "aws_lambda_function.b",
          sequence: 0,
          origin: "tfd",
        },
      ],
    } as unknown as TerraformPlanNodesMap;

    const plan = {
      ...awsAccountPlanConfig,
      resource_changes: [
        rc("aws_nat_gateway.a", "aws_nat_gateway", {
          region: "us-east-1",
          vpc_id: "vpc-a",
        }),
        rc("aws_lambda_function.b", "aws_lambda_function", {
          region: "us-east-1",
          vpc_id: "vpc-a",
          subnet_ids: ["subnet-a"],
        }),
      ],
    };

    const scene = await buildTerraformCompoundPipelineExcalidrawScene(
      nodes,
      plan,
    );
    expect(edgesByLayer(scene.elements, "topologyFrameFlow")).toHaveLength(0);
  });

  it("dedupes multiple resource edges into one sibling box edge", async () => {
    const nodes = {
      "aws_lambda_function.a": node(
        "aws_lambda_function.a",
        "aws_lambda_function",
      ),
      "aws_lambda_function.b": node(
        "aws_lambda_function.b",
        "aws_lambda_function",
      ),
      "aws_sqs_queue.c": node("aws_sqs_queue.c", "aws_sqs_queue"),
      [DECLARED_DATAFLOW_ORDERED_KEY]: [
        {
          source: "aws_lambda_function.a",
          target: "aws_lambda_function.b",
          sequence: 0,
          origin: "tfd",
        },
        {
          source: "aws_sqs_queue.c",
          target: "aws_lambda_function.b",
          sequence: 1,
          origin: "tfd",
        },
      ],
    } as unknown as TerraformPlanNodesMap;

    const plan = {
      ...awsAccountPlanConfig,
      resource_changes: [
        rc("aws_lambda_function.a", "aws_lambda_function", {
          region: "us-east-1",
          vpc_id: "vpc-a",
          subnet_ids: ["subnet-a"],
        }),
        rc("aws_lambda_function.b", "aws_lambda_function", {
          region: "us-east-1",
          vpc_id: "vpc-a",
          subnet_ids: ["subnet-b"],
        }),
        rc("aws_sqs_queue.c", "aws_sqs_queue", {
          region: "us-east-1",
          vpc_id: "vpc-a",
          subnet_ids: ["subnet-a"],
        }),
      ],
    };

    const scene = await buildTerraformCompoundPipelineExcalidrawScene(
      nodes,
      plan,
    );
    expect(edgesByLayer(scene.elements, "topologyFrameFlow")).toHaveLength(1);
    expect(scene.meta.pipelineTopologyFrameEdgeCount).toBe(1);
  });

  it("soft-hides topologyFrameFlow edges when the layer pin is off", async () => {
    const nodes = {
      "aws_lambda_function.a": node(
        "aws_lambda_function.a",
        "aws_lambda_function",
      ),
      "aws_lambda_function.b": node(
        "aws_lambda_function.b",
        "aws_lambda_function",
      ),
      [DECLARED_DATAFLOW_ORDERED_KEY]: [
        {
          source: "aws_lambda_function.a",
          target: "aws_lambda_function.b",
          sequence: 0,
          origin: "tfd",
        },
      ],
    } as unknown as TerraformPlanNodesMap;

    const plan = {
      ...awsAccountPlanConfig,
      resource_changes: [
        rc("aws_lambda_function.a", "aws_lambda_function", {
          region: "us-east-1",
          vpc_id: "vpc-a",
          subnet_ids: ["subnet-a"],
        }),
        rc("aws_lambda_function.b", "aws_lambda_function", {
          region: "us-east-1",
          vpc_id: "vpc-a",
          subnet_ids: ["subnet-b"],
        }),
      ],
    };

    const scene = await buildTerraformCompoundPipelineExcalidrawScene(
      nodes,
      plan,
    );
    const reconciled = reconcileTerraformVisibility(scene.elements, {
      pins: {
        dependency: false,
        dataFlow: false,
        declaredDataFlow: true,
        networking: false,
        topologyFrameFlow: false,
      },
      hoverPeekKey: null,
    });

    const boxEdge = reconciled.find(
      (el) =>
        (el.type === "arrow" || el.type === "line") &&
        (el as { customData?: { terraformEdgeLayer?: string } }).customData
          ?.terraformEdgeLayer === "topologyFrameFlow",
    );
    const resourceEdge = reconciled.find(
      (el) =>
        (el.type === "arrow" || el.type === "line") &&
        (el as { customData?: { terraformEdgeLayer?: string } }).customData
          ?.terraformEdgeLayer === "declaredDataFlow",
    );
    expect(boxEdge?.isDeleted).toBe(true);
    expect(resourceEdge?.isDeleted).toBe(false);
  });

  it("collectCompoundTopologyFrameEdges returns stable deduped pairs", () => {
    const clusters = [
      {
        id: "aws_lambda_function.a",
        placement: {
          providerFamily: "aws",
          accountId: "111",
          region: "us-east-1",
          vpcId: "vpc-a",
          subnetSignature: "subnet-a",
        },
      },
      {
        id: "aws_lambda_function.b",
        placement: {
          providerFamily: "aws",
          accountId: "111",
          region: "us-east-1",
          vpcId: "vpc-a",
          subnetSignature: "subnet-b",
        },
      },
    ] as unknown as Parameters<typeof collectCompoundTopologyFrameEdges>[1];

    const edges = collectCompoundTopologyFrameEdges(
      [
        {
          source: "aws_lambda_function.a",
          target: "aws_lambda_function.b",
          sequence: 2,
          original: {
            source: "aws_lambda_function.a",
            target: "aws_lambda_function.b",
            sequence: 2,
            origin: "tfd",
          },
        },
        {
          source: "aws_lambda_function.a",
          target: "aws_lambda_function.b",
          sequence: 0,
          original: {
            source: "aws_lambda_function.a",
            target: "aws_lambda_function.b",
            sequence: 0,
            origin: "tfd",
          },
        },
      ],
      clusters,
    );

    expect(edges).toHaveLength(1);
    expect(edges[0]?.sequence).toBe(0);
  });
});

describe("compareCompoundTopologyFrameEdges (comparator total-order fix)", () => {
  const edge = (
    over: Partial<CompoundTopologyFrameEdge>,
  ): CompoundTopologyFrameEdge => ({
    sourceFrameId: "src",
    targetFrameId: "tgt",
    parentFrameId: "parent",
    role: "vpc",
    sequence: 0,
    weight: 1,
    ...over,
  });

  it("is antisymmetric where the old field-mismatched tiebreak (source vs target) was not", () => {
    // Same sequence. The old comparator compared `a.sourceFrameId` against
    // `b.targetFrameId` — different fields of `a` and `b` — instead of the
    // same field on both sides.
    const a = edge({ sourceFrameId: "b", targetFrameId: "z" });
    const b = edge({ sourceFrameId: "a", targetFrameId: "b" });

    // The old (buggy) formula, reproduced inline to document exactly what
    // regressed: comparing (a, b) says "equal" while comparing (b, a) says
    // "b before a" — contradictory signs, not a valid comparator.
    const oldCompare = (
      x: CompoundTopologyFrameEdge,
      y: CompoundTopologyFrameEdge,
    ) =>
      x.sequence - y.sequence || x.sourceFrameId.localeCompare(y.targetFrameId);
    expect(oldCompare(a, b)).toBe(0);
    expect(oldCompare(b, a)).toBeLessThan(0);

    // The fixed comparator is antisymmetric: forward and backward always have
    // opposite (or both-zero) sign.
    const forward = compareCompoundTopologyFrameEdges(a, b);
    const backward = compareCompoundTopologyFrameEdges(b, a);
    expect(Math.sign(forward)).toBe(-Math.sign(backward));
    // Content-derived: a.sourceFrameId ("b") > b.sourceFrameId ("a") ⇒ a sorts after b.
    expect(forward).toBeGreaterThan(0);
  });

  it("sorts a small crafted array into a stable, content-derived order", () => {
    const edges = [
      edge({ sequence: 1, sourceFrameId: "m", targetFrameId: "a" }),
      edge({ sequence: 0, sourceFrameId: "b", targetFrameId: "z" }),
      edge({ sequence: 0, sourceFrameId: "a", targetFrameId: "b" }),
      edge({ sequence: 0, sourceFrameId: "a", targetFrameId: "a" }),
    ];
    const sorted = [...edges].sort(compareCompoundTopologyFrameEdges);
    expect(
      sorted.map((e) => `${e.sequence}:${e.sourceFrameId}:${e.targetFrameId}`),
    ).toEqual(["0:a:a", "0:a:b", "0:b:z", "1:m:a"]);

    // Reversing the input must not change the result (order-independence —
    // exactly what the old comparator could violate).
    const sortedReversed = [...edges]
      .reverse()
      .sort(compareCompoundTopologyFrameEdges);
    expect(sortedReversed).toEqual(sorted);
  });

  it("is transitive on a small crafted set (spot check)", () => {
    const edges = [
      edge({ sourceFrameId: "a", targetFrameId: "z" }),
      edge({ sourceFrameId: "b", targetFrameId: "y" }),
      edge({ sourceFrameId: "c", targetFrameId: "x" }),
      edge({ sourceFrameId: "b", targetFrameId: "y", parentFrameId: "p2" }),
    ];
    for (const x of edges) {
      for (const y of edges) {
        for (const z of edges) {
          const xy = compareCompoundTopologyFrameEdges(x, y);
          const yz = compareCompoundTopologyFrameEdges(y, z);
          const xz = compareCompoundTopologyFrameEdges(x, z);
          if (xy <= 0 && yz <= 0) {
            expect(xz).toBeLessThanOrEqual(0);
          }
        }
      }
    }
  });
});
