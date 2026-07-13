import graphlibDot from "@dagrejs/graphlib-dot";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getTerraformImportPresetSourcesFromDb } from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

import {
  STAGING_DB_LOAD_TEST_TIMEOUT_MS,
  STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS,
} from "../test-fixtures/terraformPresetFixtures";

import { resolveSourcesWithTfdComposition } from "./terraformImportCompositionResolve";
import {
  buildTerraformImportPrepCache,
  clearTerraformImportPrepCache,
} from "./terraformImportPrepCache";
import {
  stagingMultiStateLayoutSources,
  stagingMultiStatePipelineLayoutSources,
} from "./terraformLayoutSnapshotFixtures";
import { TERRAFORM_MODULE_TREE_KEY } from "./terraformPlanMeta";

import * as terraformPlanParsingModule from "./terraformPlanParsing";

import {
  collectKnownStackIdsFromNodes,
  parseStackAddress,
  preferTopologyNodeKeyAmongAliases,
  prefixStackAddress,
  topologyBareAddressKey,
} from "./terraformStackAddress";

import type { TerraformImportPresetSources } from "./terraformImportPresetsTypes";
import type {
  TerraformPlanGraphNode,
  TerraformPlanNodesMap,
} from "./terraformPlanParsing";

/**
 * T4 - equivalence test for the scoped TerraformPlanNodeKeyIndex fast path added to
 * resolveTerraformPlanNodeKey. Three independent guarantees:
 *
 * 1. A naive, from-scratch reference resolver (below) checked against the indexed path
 *    (resolveTerraformPlanNodeKey called inside withTerraformPlanNodeKeyIndex) across every fixture used
 *    by terraformLayoutSnapshot.test.ts, on a corpus of addresses harvested from real call sites during an
 *    actual fixture build (not just structural node-key/edge addresses).
 * 2. A synthetic construction-time regression test proving buildTerraformLocalImportNodesMap's
 *    depends_on resolution (which runs entirely outside any withTerraformPlanNodeKeyIndex scope) is
 *    unaffected by the new indexed path.
 * 3. A nested-scope test proving withTerraformPlanNodeKeyIndex's "previous"-restoration semantics.
 */

// ---------------------------------------------------------------------------
// 1. Independent, deliberately brute-force reference resolver.
//
// This is NOT a copy of resolveTerraformPlanNodeKey's control flow - it re-derives the same semantics from
// the doc comment ("Map a Terraform address (plan / prior_state / depends_on) to a key in nodes") and from
// reading the production function, but is written from scratch using the most obvious brute-force
// approach: scan every key in nodes, bucket candidates, and apply the same disambiguation rules
// (qualified-stack match preferred, ambiguity -> null). It reuses only small pure string utilities the
// plan explicitly allows reusing (topologyBareAddressKey, and an inline reimplementation of the private
// stripTerraformAddressIndexes helper) plus the stack-address helpers from terraformStackAddress.ts
// (parseStackAddress / prefixStackAddress / collectKnownStackIdsFromNodes /
// preferTopologyNodeKeyAmongAliases) - none of these are the multi-stage scan control flow being tested.
// ---------------------------------------------------------------------------

const MODULE_TREE_KEY = "__module_tree__";

/** stripTerraformAddressIndexes is private to terraformPlanParsing.tsx; same trivial regex, reimplemented. */
function naiveStripInstanceIndexes(address: string): string {
  return address.replace(/\[[^\]]+\]/g, "");
}

function naiveRealKeys(nodes: Record<string, unknown>): string[] {
  return Object.keys(nodes).filter(
    (k) => k !== MODULE_TREE_KEY && !k.startsWith("__"),
  );
}

/**
 * Brute-force resolver: for the given address, walk every real key in nodes and decide the match using the
 * same high-level rules resolveTerraformPlanNodeKey documents: prefer an exact stack-qualified match, fall
 * back to bare-address aliasing, then to known-stack-id qualification, then to instance-index-stripped
 * graph-id matching; ambiguity (more than one candidate at any decisive stage) resolves to null.
 */
function naiveResolveTerraformPlanNodeKey(
  nodes: Record<string, TerraformPlanGraphNode>,
  address: string,
): string | null {
  if (!address || typeof address !== "string" || address === MODULE_TREE_KEY) {
    return null;
  }

  const realKeys = naiveRealKeys(nodes);
  const parsedAddress = parseStackAddress(address);
  const bareKey = topologyBareAddressKey(address);

  if (parsedAddress) {
    const stackAliases: string[] = [];
    const exactMatches: string[] = [];
    for (const k of realKeys) {
      if (topologyBareAddressKey(k) !== bareKey) {
        continue;
      }
      const kParsed = parseStackAddress(k);
      if (kParsed?.stackId === parsedAddress.stackId) {
        stackAliases.push(k);
        if (kParsed.address === parsedAddress.address) {
          exactMatches.push(k);
        }
      } else if (!kParsed) {
        stackAliases.push(k);
        if (k === parsedAddress.address) {
          exactMatches.push(k);
        }
      }
    }
    if (exactMatches.length === 1) {
      return exactMatches[0]!;
    }
    if (stackAliases.length > 0) {
      return preferTopologyNodeKeyAmongAliases(stackAliases);
    }
  } else {
    const qualifiedMatches = realKeys.filter(
      (k) => parseStackAddress(k) && topologyBareAddressKey(k) === bareKey,
    );
    if (qualifiedMatches.length === 1) {
      return qualifiedMatches[0]!;
    }
    if (qualifiedMatches.length > 1) {
      return null;
    }
    if (
      Object.prototype.hasOwnProperty.call(nodes, address) &&
      nodes[address]
    ) {
      return address;
    }
  }

  const graphId = naiveStripInstanceIndexes(address);
  const knownStackIds = collectKnownStackIdsFromNodes(nodes);

  if (knownStackIds.length > 0 && !address.includes("::")) {
    const qualifiedCandidates = new Set<string>();
    for (const stackId of knownStackIds) {
      const qualified = prefixStackAddress(stackId, address);
      if (nodes[qualified]) {
        qualifiedCandidates.add(qualified);
      }
      const qualifiedStripped = prefixStackAddress(stackId, graphId);
      if (nodes[qualifiedStripped]) {
        qualifiedCandidates.add(qualifiedStripped);
      }
    }
    if (qualifiedCandidates.size === 1) {
      return [...qualifiedCandidates][0]!;
    }
    if (qualifiedCandidates.size > 1) {
      return null;
    }
  }

  const graphMatches = realKeys.filter(
    (k) => naiveStripInstanceIndexes(k) === graphId,
  );
  if (graphMatches.length === 1) {
    return graphMatches[0]!;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2. Harvested real-call-site corpus.
//
// resolveTerraformPlanNodeKey is imported by name in ~40 production files. We harvest by spying directly
// on the live module namespace object (vi.spyOn) rather than `vi.mock(..., { importActual })`: this module
// has a circular import with terraformDeclaredDataFlow.ts (terraformPlanParsing.tsx statically imports
// applyDeclaredDataFlow from it, which in turn statically imports resolveTerraformPlanNodeKey back from
// terraformPlanParsing.tsx). `importActual()` re-evaluates that whole subgraph as a *separate* module
// instance, so a `vi.mock` wrapper only sees calls that happen to route through the mock registry's
// instance - it silently misses every call made from within that real subgraph (confirmed empirically:
// `vi.mock` + `importActual` harvested 0 calls across a full fixture build, while terraformDeclaredDataFlow
// alone, called directly, clearly does call resolveTerraformPlanNodeKey). `vi.spyOn` mutates the one
// shared module export in place instead of creating a parallel instance, so every caller - regardless of
// which side of the circular import it's on - goes through the spy. This is self-contained to this test
// file's setup (no permanent scaffolding), deterministic (same fixtures every run), and fast (it just
// drives the existing fixture builds the snapshot test already exercises - no extra work).
// ---------------------------------------------------------------------------

type HarvestedCall = {
  nodes: Record<string, TerraformPlanGraphNode>;
  address: string;
};

describe("resolveTerraformPlanNodeKey indexed path equivalence", () => {
  beforeAll(() => {
    if (process.env.VITEST_TERRAFORM_VERBOSE !== "1") {
      vi.spyOn(console, "log").mockImplementation(() => {});
    }
  });

  async function harvestFromFixtureBuild(
    sources: Parameters<
      typeof terraformPlanParsingModule.terraformPlanParsingFromSources
    >[0],
    layoutMode: "module" | "semantic" | "pipeline",
  ) {
    const res =
      await terraformPlanParsingModule.terraformPlanParsingFromSources(
        sources,
        {
          semanticLayout: layoutMode === "semantic",
          layoutMode,
        },
      );
    expect(res.ok).toBe(true);
  }

  it(
    "equivalence: indexed path matches the independent naive resolver across every harvested real call-site address",
    async () => {
      const harvestedCalls: HarvestedCall[] = [];
      const originalResolve =
        terraformPlanParsingModule.resolveTerraformPlanNodeKey;
      const spy = vi
        .spyOn(terraformPlanParsingModule, "resolveTerraformPlanNodeKey")
        .mockImplementation((nodes, address) => {
          harvestedCalls.push({ nodes, address });
          return originalResolve(nodes, address);
        });

      try {
        await harvestFromFixtureBuild(
          stagingMultiStateLayoutSources(),
          "semantic",
        );
        await harvestFromFixtureBuild(
          stagingMultiStateLayoutSources(),
          "module",
        );
        await harvestFromFixtureBuild(
          stagingMultiStatePipelineLayoutSources(),
          "pipeline",
        );
      } finally {
        spy.mockRestore();
      }

      expect(harvestedCalls.length).toBeGreaterThan(0);

      const { withTerraformPlanNodeKeyIndex, resolveTerraformPlanNodeKey } =
        terraformPlanParsingModule;

      // De-duplicate by (nodes ref, address) - repeated calls with the same pair are redundant work for
      // the equivalence check, not new corpus signal. Scope the dedupe key per nodes ref (via a counter)
      // so addresses that happen to repeat across different fixture builds never collide.
      const nodesRefIds = new WeakMap<object, number>();
      const seen = new Set<string>();
      let nextRefId = 0;
      let comparisons = 0;
      let discrepancies = 0;
      const discrepancyDetails: string[] = [];

      for (const { nodes, address } of harvestedCalls) {
        let refId = nodesRefIds.get(nodes);
        if (refId === undefined) {
          refId = nextRefId++;
          nodesRefIds.set(nodes, refId);
        }
        const key = `${refId} ${address}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        const indexedResult = withTerraformPlanNodeKeyIndex(nodes, () =>
          resolveTerraformPlanNodeKey(nodes, address),
        );
        const naiveResult = naiveResolveTerraformPlanNodeKey(nodes, address);

        comparisons++;
        if (indexedResult !== naiveResult) {
          discrepancies++;
          discrepancyDetails.push(
            `address=${JSON.stringify(address)} indexed=${JSON.stringify(
              indexedResult,
            )} naive=${JSON.stringify(naiveResult)}`,
          );
        }
      }

      if (discrepancies > 0) {
        throw new Error(
          `${discrepancies}/${comparisons} discrepancies between indexed path and naive reference resolver:\n${discrepancyDetails
            .slice(0, 25)
            .join("\n")}`,
        );
      }

      // The RCA measured ~12,000 calls per build on a smaller subset; this corpus spans 3 full fixture
      // builds (semantic, module, pipeline) over the full 25-stack staging-multi-state preset, so a
      // healthy corpus should be in the tens of thousands of unique (nodes, address) pairs, not a handful.
      expect(comparisons).toBeGreaterThan(1000);
    },
    STAGING_SEMANTIC_LAYOUT_TEST_TIMEOUT_MS,
  );
});

describe("resolveTerraformPlanNodeKey construction-time path (unaffected by the indexed fast path)", () => {
  it("buildTerraformLocalImportNodesMap resolves a depends_on reference to a resource inserted earlier in the same construction pass", async () => {
    const { buildTerraformLocalImportNodesMap } = await import(
      "./terraformPlanParsing"
    );
    const graph = graphlibDot.read("digraph G {}\n");

    const plan = {
      resource_changes: [
        {
          address: "aws_vpc.main",
          type: "aws_vpc",
          name: "main",
          mode: "managed",
          change: { actions: ["no-op"] },
        },
        {
          address: "aws_subnet.a",
          type: "aws_subnet",
          name: "a",
          mode: "managed",
          change: { actions: ["no-op"] },
        },
      ],
      // buildExistingEdges walks prior_state.values.root_module and, for each resource's depends_on,
      // resolves the dependency address against nodes mid-construction - entirely outside any
      // withTerraformPlanNodeKeyIndex scope (that scope is only ever active inside preparePipelineLayout,
      // which runs later in the pipeline, not during node-map construction).
      prior_state: {
        values: {
          root_module: {
            resources: [
              {
                address: "aws_vpc.main",
                mode: "managed",
                type: "aws_vpc",
                depends_on: [],
              },
              {
                address: "aws_subnet.a",
                mode: "managed",
                type: "aws_subnet",
                // References aws_vpc.main, which was inserted earlier in the same resources array /
                // construction pass.
                depends_on: ["aws_vpc.main"],
              },
            ],
          },
        },
      },
    };

    const nodes = buildTerraformLocalImportNodesMap(plan, graph, []);

    expect(nodes["aws_vpc.main"]).toBeDefined();
    expect(nodes["aws_subnet.a"]).toBeDefined();
    expect(nodes["aws_subnet.a"]?.edges_existing).toContain("aws_vpc.main");
  });
});

describe("withTerraformPlanNodeKeyIndex nested-scope restoration", () => {
  it("restores the outer index after an inner scope with a different nodes ref exits", async () => {
    const { withTerraformPlanNodeKeyIndex, resolveTerraformPlanNodeKey } =
      await import("./terraformPlanParsing");

    const nodesA: Record<string, TerraformPlanGraphNode> = {
      "aws_vpc.main": { resources: {} },
      "stack-a::aws_vpc.main": { resources: {} },
    };
    const nodesB: Record<string, TerraformPlanGraphNode> = {
      "aws_subnet.b": { resources: {} },
      "stack-b::aws_subnet.b": { resources: {} },
    };

    withTerraformPlanNodeKeyIndex(nodesA, () => {
      // Sanity: resolving against nodesA inside the outer scope works as expected before nesting.
      expect(resolveTerraformPlanNodeKey(nodesA, "aws_vpc.main")).toBe(
        "stack-a::aws_vpc.main",
      );

      withTerraformPlanNodeKeyIndex(nodesB, () => {
        // Inner scope: resolution must use nodesB's index, not nodesA's.
        expect(resolveTerraformPlanNodeKey(nodesB, "aws_subnet.b")).toBe(
          "stack-b::aws_subnet.b",
        );
        // A lookup against nodesA's address while the active index is scoped to nodesB falls back to the
        // original (unindexed) scan path via the ref-equality guard, and must still resolve correctly
        // against nodesA itself (the ref-mismatch defends against silent misresolution, not a crash).
        expect(resolveTerraformPlanNodeKey(nodesA, "aws_vpc.main")).toBe(
          "stack-a::aws_vpc.main",
        );
      });

      // After the inner scope exits, resolution against nodesA must use nodesA's index again (proving
      // "previous" restoration, not clearing to null).
      expect(resolveTerraformPlanNodeKey(nodesA, "aws_vpc.main")).toBe(
        "stack-a::aws_vpc.main",
      );
    });

    // Outside any scope at all, the original fallback path still resolves both correctly.
    expect(resolveTerraformPlanNodeKey(nodesA, "aws_vpc.main")).toBe(
      "stack-a::aws_vpc.main",
    );
    expect(resolveTerraformPlanNodeKey(nodesB, "aws_subnet.b")).toBe(
      "stack-b::aws_subnet.b",
    );
  });
});

// ---------------------------------------------------------------------------
// W14 WP1 - preset node-map differential (docs/strata-view-w14-browser-felt-cost.md §3).
//
// The section above harvests real call-site addresses from the staging-multi-state
// fixture builds and checks the indexed path against an INDEPENDENT naive resolver.
// This section adds the W14 §3 obligation directly: over the REAL committed preset
// node maps P1 (staging-extended-localstack-v2) and P2 (staging-localstack) - the
// exact merged, tfd-overlaid maps `preparePipelineLayout` consumes, obtained via the
// public prep-cache parse - the O(1) indexed branch and the pre-existing O(N)
// linear-scan branch of `resolveTerraformPlanNodeKey` (the two production branches the
// WP1 skeleton-materialization scope toggles between) must return identical results
// for every node key plus derived probes. Plus the explicit nested / throw-teardown /
// ref-mismatch unit cases grounded on a real map (not the 2-key synthetic maps above).
// ---------------------------------------------------------------------------

const W14_PRESETS = {
  P1: "staging-extended-localstack-v2",
  P2: "staging-localstack",
} as const;

/** Build the exact merged, tfd-overlaid node map `preparePipelineLayout` consumes,
 * via the public prep-cache path (the same parse the real layout uses). */
function loadPresetNodesForW14(presetId: string): TerraformPlanNodesMap {
  const raw = getTerraformImportPresetSourcesFromDb(presetId) as
    | TerraformImportPresetSources
    | null
    | undefined;
  expect(raw, `preset ${presetId} exists in the preset DB`).toBeTruthy();
  const sources = resolveSourcesWithTfdComposition(
    raw as TerraformImportPresetSources,
  );
  // Fresh parse - never serve a stale cache from a prior preset in this run.
  clearTerraformImportPrepCache();
  const prep = buildTerraformImportPrepCache(
    sources as unknown as Parameters<typeof buildTerraformImportPrepCache>[0],
  );
  return prep.nodes;
}

/** Real node keys (skip the module-tree sentinel and every `__`-prefixed synthetic
 * key - `resolveTerraformPlanNodeKey` ignores those internally). */
function w14RealNodeKeys(nodes: TerraformPlanNodesMap): string[] {
  return Object.keys(nodes).filter(
    (k) => k !== TERRAFORM_MODULE_TREE_KEY && !k.startsWith("__"),
  );
}

/** Every node key + derived probes: index-stripped form, stack-bare form (surfaces
 * ambiguous-prefix collisions when two distinct keys share a bare key), and a few
 * guaranteed-missing addresses. Deduped so each distinct input is asserted once. */
function w14ResolutionProbes(nodes: TerraformPlanNodesMap): string[] {
  const keys = w14RealNodeKeys(nodes);
  const probes = new Set<string>();
  for (const k of keys) {
    probes.add(k);
    probes.add(k.replace(/\[[^\]]*\]/g, "")); // index-stripped form
    probes.add(topologyBareAddressKey(k)); // stack-bare form
  }
  probes.add("aws_nonexistent_resource.zzz_w14_missing_probe");
  probes.add("module.does_not_exist.aws_s3_bucket.nope[0]");
  probes.add("");
  return [...probes];
}

/** Assert the indexed branch (scope active over `nodes`) equals the scan branch (no
 * active scope) for every probe. */
function assertIndexedEqualsScan(nodes: TerraformPlanNodesMap): number {
  const { resolveTerraformPlanNodeKey, withTerraformPlanNodeKeyIndex } =
    terraformPlanParsingModule;
  const probes = w14ResolutionProbes(nodes);

  const scanResults = probes.map((addr) =>
    resolveTerraformPlanNodeKey(nodes, addr),
  );
  const indexedResults = withTerraformPlanNodeKeyIndex(nodes, () =>
    probes.map((addr) => resolveTerraformPlanNodeKey(nodes, addr)),
  );

  expect(indexedResults.length).toBe(scanResults.length);
  for (let i = 0; i < probes.length; i++) {
    expect(
      indexedResults[i],
      `indexed vs scan diverged for probe "${probes[i]}"`,
    ).toBe(scanResults[i]);
  }
  return probes.length;
}

describe("W14 WP1 - preset node-map indexed path ≡ linear scan", () => {
  it(
    "P1 (staging-extended-localstack-v2): every probe resolves identically with and without an active index scope",
    () => {
      const nodes = loadPresetNodesForW14(W14_PRESETS.P1);
      const keys = w14RealNodeKeys(nodes);
      expect(keys.length).toBeGreaterThan(0); // guard a silently-empty parse
      const probeCount = assertIndexedEqualsScan(nodes);
      expect(probeCount).toBeGreaterThan(keys.length);
    },
    STAGING_DB_LOAD_TEST_TIMEOUT_MS,
  );

  it(
    "P2 (staging-localstack): every probe resolves identically with and without an active index scope",
    () => {
      const nodes = loadPresetNodesForW14(W14_PRESETS.P2);
      const keys = w14RealNodeKeys(nodes);
      expect(keys.length).toBeGreaterThan(0);
      const probeCount = assertIndexedEqualsScan(nodes);
      expect(probeCount).toBeGreaterThan(keys.length);
    },
    STAGING_DB_LOAD_TEST_TIMEOUT_MS,
  );

  it(
    "nested scope over the same real (P2) nodes ref resolves identically to unscoped",
    () => {
      const { resolveTerraformPlanNodeKey, withTerraformPlanNodeKeyIndex } =
        terraformPlanParsingModule;
      const nodes = loadPresetNodesForW14(W14_PRESETS.P2);
      const probes = w14ResolutionProbes(nodes).slice(0, 200);

      const unscoped = probes.map((addr) =>
        resolveTerraformPlanNodeKey(nodes, addr),
      );
      const nested = withTerraformPlanNodeKeyIndex(nodes, () =>
        withTerraformPlanNodeKeyIndex(nodes, () =>
          probes.map((addr) => resolveTerraformPlanNodeKey(nodes, addr)),
        ),
      );
      for (let i = 0; i < probes.length; i++) {
        expect(nested[i]).toBe(unscoped[i]);
      }
    },
    STAGING_DB_LOAD_TEST_TIMEOUT_MS,
  );

  it(
    "scope tears down after a throw - later unscoped resolution is unaffected (real P2 map)",
    () => {
      const { resolveTerraformPlanNodeKey, withTerraformPlanNodeKeyIndex } =
        terraformPlanParsingModule;
      const nodes = loadPresetNodesForW14(W14_PRESETS.P2);
      const probe = w14RealNodeKeys(nodes)[0]!;
      const baseline = resolveTerraformPlanNodeKey(nodes, probe);

      expect(() =>
        withTerraformPlanNodeKeyIndex(nodes, () => {
          throw new Error("boom inside scope");
        }),
      ).toThrow("boom inside scope");

      // The `finally` in withTerraformPlanNodeKeyIndex must have restored the
      // previous (null) scope - the resolver falls back to the scan path and still
      // returns the correct key, not a stale/leaked indexed answer.
      expect(resolveTerraformPlanNodeKey(nodes, probe)).toBe(baseline);
      // A fresh scope after the throw still works.
      expect(
        withTerraformPlanNodeKeyIndex(nodes, () =>
          resolveTerraformPlanNodeKey(nodes, probe),
        ),
      ).toBe(baseline);
    },
    STAGING_DB_LOAD_TEST_TIMEOUT_MS,
  );

  it(
    "ref-mismatch: a scope built on a different nodes object falls back to scan and returns the same answer (real P2 map)",
    () => {
      const { resolveTerraformPlanNodeKey, withTerraformPlanNodeKeyIndex } =
        terraformPlanParsingModule;
      const nodes = loadPresetNodesForW14(W14_PRESETS.P2);
      const probes = w14ResolutionProbes(nodes).slice(0, 200);
      // A distinct object reference with the same contents. The resolver's
      // `activePlanNodeKeyIndex.nodes === nodes` guard must fail, forcing the scan
      // path even though a scope is active.
      const otherRef = { ...nodes } as TerraformPlanNodesMap;

      const unscoped = probes.map((addr) =>
        resolveTerraformPlanNodeKey(nodes, addr),
      );
      const mismatched = withTerraformPlanNodeKeyIndex(otherRef, () =>
        // Resolve against the ORIGINAL `nodes`, not `otherRef`.
        probes.map((addr) => resolveTerraformPlanNodeKey(nodes, addr)),
      );
      for (let i = 0; i < probes.length; i++) {
        expect(mismatched[i]).toBe(unscoped[i]);
      }
    },
    STAGING_DB_LOAD_TEST_TIMEOUT_MS,
  );
});
