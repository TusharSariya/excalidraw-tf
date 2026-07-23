import { describe, expect, it } from "vitest";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import {
  getDotAdjacencyFastPathStats,
  mergeDotAdjacency,
  resetDotAdjacencyFastPathStats,
  setDotAdjacencyFastPathDisabledForTest,
} from "./terraformImportMerge";

/**
 * E11: the fast line-scan edge extractor in `mergeDotAdjacency` must produce a
 * BYTE-IDENTICAL adjacency map (same keys, same order, same array contents/order)
 * to the original `graphlibDot.read()` path — proven by running both through the
 * public function with the fast path on, then kill-switched off, and comparing
 * `JSON.stringify` output. It must also actually ENGAGE on real preset DOT (hits
 * > 0, bails === 0), and must correctly BAIL (falling back to graphlib, still
 * identical) on DOT shapes it does not recognise.
 */

function dotTextsOf(preset: string): string[] {
  const s = getTerraformImportPresetSourcesFromDb(preset);
  if (!s) {
    throw new Error(`preset missing: ${preset}`);
  }
  return s.planDotBundles.map((b: { dotText: string }) => b.dotText);
}

function fastVsGraphlib(
  dotTexts: string[],
  stackIds?: (string | undefined)[],
): {
  fast: Record<string, string[]>;
  orig: Record<string, string[]>;
  hits: number;
  bails: number;
} {
  resetDotAdjacencyFastPathStats();
  setDotAdjacencyFastPathDisabledForTest(false);
  const fast = mergeDotAdjacency(dotTexts, stackIds);
  const { hits, bails } = getDotAdjacencyFastPathStats();

  setDotAdjacencyFastPathDisabledForTest(true);
  const orig = mergeDotAdjacency(dotTexts, stackIds);
  setDotAdjacencyFastPathDisabledForTest(false);

  return { fast, orig, hits, bails };
}

describe("mergeDotAdjacency fast path", () => {
  for (const preset of [
    "staging-extended-localstack-v2",
    "staging-multi-state-expanded",
  ]) {
    it(`is byte-identical to graphlib and engages on ${preset}`, () => {
      const dotTexts = dotTextsOf(preset);
      const { fast, orig, hits, bails } = fastVsGraphlib(dotTexts);

      // Byte-identical (keys, key order, array order all captured by stringify).
      expect(JSON.stringify(fast)).toBe(JSON.stringify(orig));

      // The optimization is ENGAGED: one fast-path hit per DOT text, no bails.
      expect(bails).toBe(0);
      expect(hits).toBe(dotTexts.length);

      // Sanity: the preset actually has edges (not a vacuous pass).
      const edgeCount = Object.values(fast).reduce(
        (acc, arr) => acc + arr.length,
        0,
      );
      expect(edgeCount).toBeGreaterThan(0);
    });

    it(`is byte-identical under stack namespacing on ${preset}`, () => {
      const dotTexts = dotTextsOf(preset);
      const stackIds = dotTexts.map((_, i) => `stack${i}`);
      const { fast, orig, hits, bails } = fastVsGraphlib(dotTexts, stackIds);
      expect(JSON.stringify(fast)).toBe(JSON.stringify(orig));
      expect(bails).toBe(0);
      expect(hits).toBe(dotTexts.length);
    });
  }

  it("bails to graphlib on DOT shapes outside the strict edge form", () => {
    // Each of these has an edge statement that is NOT the strict single
    // `"v" -> "w"` per-line shape the fast path recognises. The fast path must
    // bail (fall back to graphlib) AND still return the identical adjacency.
    const cases = [
      // edge attributes
      'digraph { "a" -> "b" [color="red"] }',
      // two edges on one line
      'digraph { "a" -> "b" "c" -> "d" }',
      // unquoted node ids
      "digraph { a -> b }",
      // label containing "->" on a node statement line
      'digraph { "a" [label="x -> y"]\n"a" -> "b" }',
    ];
    for (const dot of cases) {
      resetDotAdjacencyFastPathStats();
      setDotAdjacencyFastPathDisabledForTest(false);
      const fast = mergeDotAdjacency([dot]);
      const { bails } = getDotAdjacencyFastPathStats();
      expect(bails).toBe(1);

      setDotAdjacencyFastPathDisabledForTest(true);
      const orig = mergeDotAdjacency([dot]);
      setDotAdjacencyFastPathDisabledForTest(false);
      expect(JSON.stringify(fast)).toBe(JSON.stringify(orig));
    }
  });

  it("fast path handles a clean multi-edge digraph identically", () => {
    const dot =
      'digraph {\n\t"a" -> "b"\n\t"a" -> "c"\n\t"b" -> "c"\n\t"a" -> "b"\n}';
    resetDotAdjacencyFastPathStats();
    setDotAdjacencyFastPathDisabledForTest(false);
    const fast = mergeDotAdjacency([dot]);
    const { hits, bails } = getDotAdjacencyFastPathStats();
    expect(bails).toBe(0);
    expect(hits).toBe(1);

    setDotAdjacencyFastPathDisabledForTest(true);
    const orig = mergeDotAdjacency([dot]);
    setDotAdjacencyFastPathDisabledForTest(false);
    expect(JSON.stringify(fast)).toBe(JSON.stringify(orig));
  });

  // Adversarial-review regression (2026-07-22): an edge-shaped line inside a
  // /* ... */ block comment must not be extracted as a phantom edge. The mere
  // presence of "/*" bails the whole DOT to graphlib, which parses the comment
  // away — so the commented edge must be absent from the merged adjacency.
  it("bails on block comments so commented-out edges never become phantom edges", () => {
    const dot = 'digraph {\n/*\n"ghost" -> "target"\n*/\n"real" -> "sink"\n}';
    resetDotAdjacencyFastPathStats();
    setDotAdjacencyFastPathDisabledForTest(false);
    const fast = mergeDotAdjacency([dot]);
    const { hits, bails } = getDotAdjacencyFastPathStats();
    expect(bails).toBe(1);
    expect(hits).toBe(0);
    expect(fast.ghost).toBeUndefined();
    expect(fast.real).toEqual(["sink"]);

    setDotAdjacencyFastPathDisabledForTest(true);
    const orig = mergeDotAdjacency([dot]);
    setDotAdjacencyFastPathDisabledForTest(false);
    expect(JSON.stringify(fast)).toBe(JSON.stringify(orig));
  });
});
