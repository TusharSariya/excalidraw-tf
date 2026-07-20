import { describe, expect, it } from "vitest";

import { terraformFocusInputsSig } from "./terraformElementActionsSelection";

describe("terraformFocusInputsSig", () => {
  // IRON RULE (W11 WP1 decision 5): the default signature (options omitted /
  // direction "both" / maxHops null) must stay byte-identical to the pre-W11
  // output. Locked with a literal expectation so any drift fails loudly.
  it("is byte-identical at the default direction/hops (golden)", () => {
    const sig = terraformFocusInputsSig(
      "aws_instance.foo",
      { "id-1": true, "id-2": true },
      {
        dependency: true,
        dataFlow: false,
        declaredDataFlow: false,
        networking: true,
        topologyFrameFlow: false,
      },
      "#ffffff",
    );
    expect(sig).toBe(
      'aws_instance.foo|id-1,id-2|{"dependency":true,"dataFlow":false,"declaredDataFlow":false,"networking":true,"topologyFrameFlow":false}|#ffffff',
    );
  });

  it("omits the direction/hops suffix when called with explicit defaults too", () => {
    const withoutOptionalArgs = terraformFocusInputsSig(null, {}, null, "#fff");
    const withExplicitDefaults = terraformFocusInputsSig(
      null,
      {},
      null,
      "#fff",
      "both",
      null,
    );
    expect(withoutOptionalArgs).toBe(withExplicitDefaults);
    expect(withoutOptionalArgs).toBe("|||#fff");
  });

  it("appends a suffix when direction is non-default", () => {
    const base = terraformFocusInputsSig(null, {}, null, "#fff");
    const directed = terraformFocusInputsSig(
      null,
      {},
      null,
      "#fff",
      "dependencies",
      null,
    );
    expect(directed).not.toBe(base);
    expect(directed).toBe(`${base}|dependencies|null`);
  });

  it("appends a suffix when maxHops is overridden (finite)", () => {
    const base = terraformFocusInputsSig(null, {}, null, "#fff");
    const capped = terraformFocusInputsSig(null, {}, null, "#fff", "both", 2);
    expect(capped).not.toBe(base);
    expect(capped).toBe(`${base}|both|2`);
  });

  it("encodes Infinity maxHops as the literal string 'all' — never lets it hit JSON.stringify", () => {
    const base = terraformFocusInputsSig(null, {}, null, "#fff");
    const uncapped = terraformFocusInputsSig(
      null,
      {},
      null,
      "#fff",
      "dependents",
      Infinity,
    );
    expect(uncapped).toBe(`${base}|dependents|all`);
    // Would be "null" if Infinity had leaked through JSON.stringify.
    expect(uncapped).not.toContain("|null");
  });
});
