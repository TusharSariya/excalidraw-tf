import { describe, expect, it } from "vitest";

import {
  isStackQualifiedAddress,
  parseStackAddress,
  parseStackGroupModulePath,
  prefixStackAddress,
  stackGroupModulePath,
  stackIdFromBundleLabel,
  stackQualifiedModulePath,
  stripStackPrefixForModuleParsing,
} from "./terraformStackAddress";

describe("terraformStackAddress", () => {
  it("prefixes and parses stack-qualified addresses", () => {
    const full = prefixStackAddress(
      "40-east-api-1",
      "module.api.aws_lambda_function.this",
    );
    expect(full).toBe("40-east-api-1::module.api.aws_lambda_function.this");
    expect(parseStackAddress(full)).toEqual({
      stackId: "40-east-api-1",
      address: "module.api.aws_lambda_function.this",
    });
    expect(isStackQualifiedAddress(full)).toBe(true);
  });

  it("strips prefix for module parsing", () => {
    expect(
      stripStackPrefixForModuleParsing(
        "44-east-api-5::module.api.aws_ssm_parameter.api_name",
      ),
    ).toBe("module.api.aws_ssm_parameter.api_name");
  });

  it("uses bundle label as stack id with fallback", () => {
    expect(stackIdFromBundleLabel("10-east-ecs-edge", 0)).toBe(
      "10-east-ecs-edge",
    );
    expect(stackIdFromBundleLabel(undefined, 2)).toBe("stack-3");
  });

  it("builds stack-qualified module paths", () => {
    expect(stackQualifiedModulePath("40-east-api-1", "root")).toBe(
      "40-east-api-1::root",
    );
    expect(stackQualifiedModulePath("40-east-api-1", "module.api")).toBe(
      "40-east-api-1::module.api",
    );
    expect(stackQualifiedModulePath(undefined, "module.api")).toBe(
      "module.api",
    );
  });

  it("builds synthetic stack group module paths", () => {
    expect(stackGroupModulePath("40-east-api-1")).toBe(
      "__stack__::40-east-api-1",
    );
    expect(parseStackGroupModulePath("__stack__::40-east-api-1")).toEqual({
      stackId: "40-east-api-1",
    });
  });

  // O4 floor memo (Track B, overnight-20260717): behavioral-identity gate for the
  // module-level `parseStackAddress` cache. Proves the memo is byte-identical to a
  // fresh recompute for a battery of inputs (positive, negative, whitespace,
  // instance-index, root-level), and that a second call returns the SAME reference
  // (i.e. the cache is actually hit — no silent per-call recompute) without any
  // behavioral drift.
  it("memoizes parseStackAddress byte-identically and reuses the reference", () => {
    const recompute = (full: string) => {
      const trimmed = full.trim();
      const sepIndex = trimmed.indexOf("::");
      if (sepIndex <= 0) {
        return null;
      }
      const stackId = trimmed.slice(0, sepIndex);
      const address = trimmed.slice(sepIndex + 2);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(stackId) || !address) {
        return null;
      }
      return { stackId, address };
    };

    const inputs = [
      "40-east-api-1::module.api.aws_lambda_function.this",
      "  stack-2::aws_s3_bucket.logs  ",
      "aws_s3_bucket.no_stack",
      "::leading-sep-invalid",
      "bad stack::addr",
      "",
      "root",
      "s::module.a.module.b.aws_instance.web[0]",
    ];

    for (const input of inputs) {
      const first = parseStackAddress(input);
      const second = parseStackAddress(input);
      // byte-identical to a fresh recompute
      expect(first).toEqual(recompute(input));
      // cache hit: the second call returns the identical reference (or null)
      expect(second).toBe(first);
    }
  });
});
