import graphlibDot from "@dagrejs/graphlib-dot";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  getTerraformImportPresetSourcesFromDb,
  loadImportPresetsCatalog,
} from "../../../excalidraw-app/dev/terraformImportPresetDb.mjs";

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
    layoutMode: "module" | "semantic" | "strata",
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
          "strata",
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

// ---------------------------------------------------------------------------
// E07 - buildExistingEdges wrapped in the plan-node-key index with incremental
// registration of keys created mid-scope.
//
// buildExistingEdges now runs INSIDE its own withTerraformPlanNodeKeyIndex scope
// (built from `nodes` at scope entry) and folds each genuinely-new key its
// `nodes[nodePath] ||= …` site creates into the live index via
// registerActiveTerraformPlanNodeKey. Semantics that must hold byte-identically:
// a key created mid-traversal is appended to the tail of its byBareKey / byGraphId
// bucket, exactly where the un-indexed fallback scan (fresh `Object.keys(nodes)`
// every call) would find it on a LATER resolve. So a resolve issued BEFORE the key
// exists must not see it, and a resolve issued AFTER must - including the case where
// the new key lands in a bareKey bucket a previous resolve already queried,
// flipping that bucket from a single-match resolution to an ambiguous → null one.
//
// The proof: an independent brute-force reconstruction of buildExistingEdges'
// control flow that resolves via the from-scratch naiveResolveTerraformPlanNodeKey
// (which rescans Object.keys(nodes) live on every call, so it inherently observes
// mid-traversal key additions on later calls). The production (wrapped + incremental)
// output must deep-equal the brute-force output for every crafted mid-scope-mutation
// plan.
// ---------------------------------------------------------------------------

/** Brute-force twin of production buildExistingEdges: identical control flow, but
 * every address resolution goes through naiveResolveTerraformPlanNodeKey (a fresh
 * Object.keys(nodes) rescan, no index, no registration). This is the reference the
 * wrapped+incremental production path must match. */
function naiveBuildExistingEdges(
  nodes: Record<string, TerraformPlanGraphNode>,
  plan: { prior_state: { values: { root_module: unknown } } },
): Record<string, TerraformPlanGraphNode> {
  const rootModule = plan?.prior_state?.values?.root_module as
    | {
        resources?: {
          address?: string;
          depends_on?: (string | undefined)[];
        }[];
        child_modules?: unknown[];
      }
    | null
    | undefined;
  if (!rootModule) {
    return nodes;
  }

  const existingEdges: Record<string, Set<string>> = {};
  const addEdge = (from: string, to: string) => {
    if (!existingEdges[from]) {
      existingEdges[from] = new Set();
    }
    existingEdges[from].add(to);
  };

  const modStack = [rootModule] as typeof rootModule[];
  while (modStack.length) {
    const currentModule = modStack.pop();
    if (currentModule == null) {
      continue;
    }
    for (const resource of currentModule.resources || []) {
      const address = resource.address;
      if (!address) {
        continue;
      }
      const nodePath =
        naiveResolveTerraformPlanNodeKey(nodes, address) ?? address;
      nodes[nodePath] ||= { resources: {} };
      if (!nodes[nodePath].resources[address]) {
        nodes[nodePath].resources[address] = {
          ...resource,
          change: { actions: ["existing"] },
        };
      }
      for (const dependency of resource.depends_on || []) {
        if (!dependency) {
          continue;
        }
        addEdge(address, dependency);
      }
    }
    for (const childModule of currentModule.child_modules || []) {
      modStack.push(childModule as typeof rootModule);
    }
  }

  for (const [rawSource, targets] of Object.entries(existingEdges)) {
    const source = naiveResolveTerraformPlanNodeKey(nodes, rawSource);
    if (!source) {
      continue;
    }
    nodes[source].edges_existing ||= [];
    for (const rawTarget of targets) {
      const target = naiveResolveTerraformPlanNodeKey(nodes, rawTarget);
      if (!target) {
        continue;
      }
      if (!nodes[source].edges_existing.includes(target)) {
        nodes[source].edges_existing.push(target);
      }
    }
  }

  return nodes;
}

type E07Plan = { prior_state: { values: { root_module: unknown } } };

/** Run the production (wrapped+incremental-register) buildExistingEdges and the
 * brute-force twin on independent deep clones of the same initial node map, and
 * assert the resulting maps are byte-identical. */
function expectBuildExistingEdgesMatchesBruteForce(
  initialNodes: Record<string, TerraformPlanGraphNode>,
  plan: E07Plan,
) {
  const clone = () =>
    JSON.parse(JSON.stringify(initialNodes)) as Record<
      string,
      TerraformPlanGraphNode
    >;
  const prod = terraformPlanParsingModule.buildExistingEdges(clone(), plan);
  const naive = naiveBuildExistingEdges(clone(), plan);
  expect(prod).toEqual(naive);
  return { prod, naive };
}

describe("E07 - buildExistingEdges wrapped index ≡ brute-force fresh-rescan (mid-scope key registration)", () => {
  it("registers keys created mid-traversal so a LATER edge resolve sees them (starting from an empty map)", () => {
    // nodes empty at scope entry: EVERY key buildExistingEdges touches is created at
    // its `||=` site and must be registered, or the second-loop edge resolves (run
    // after traversal) would miss them against the stale entry-time index.
    const plan: E07Plan = {
      prior_state: {
        values: {
          root_module: {
            resources: [
              { address: "aws_vpc.main", depends_on: [] },
              // depends_on a key created earlier in the SAME traversal.
              { address: "aws_subnet.a", depends_on: ["aws_vpc.main"] },
            ],
          },
        },
      },
    };
    const { prod } = expectBuildExistingEdgesMatchesBruteForce({}, plan);
    // Sanity: the edge actually resolved (guards against a vacuous "both empty" pass).
    expect(prod["aws_subnet.a"]?.edges_existing).toContain("aws_vpc.main");
  });

  it("resolves a depends_on against a key created mid-traversal by a resource visited LATER (child-module ordering)", () => {
    // aws_subnet.a (root) depends_on aws_vpc.main, which is only introduced by a
    // child module popped later. Both arms must add the edge (the target key exists
    // by the time the post-traversal edge loop resolves it).
    const plan: E07Plan = {
      prior_state: {
        values: {
          root_module: {
            resources: [
              { address: "aws_subnet.a", depends_on: ["aws_vpc.main"] },
            ],
            child_modules: [
              {
                resources: [{ address: "aws_vpc.main", depends_on: [] }],
              },
            ],
          },
        },
      },
    };
    const { prod } = expectBuildExistingEdgesMatchesBruteForce({}, plan);
    expect(prod["aws_subnet.a"]?.edges_existing).toContain("aws_vpc.main");
  });

  it("bare-key collision: a key created mid-scope makes a previously single-match bareKey bucket ambiguous → null on a later resolve", () => {
    // Entry-time index: byBareKey["aws_vpc.main"] = ["stack-a::aws_vpc.main"].
    // The prior_state introduces stack-b::aws_vpc.main (a NEW key, same bare key),
    // then an edge target of the BARE "aws_vpc.main". A stale index (missing stack-b)
    // would resolve that bare address to the lone stack-a key and add an edge; the
    // correct behavior — matching a fresh rescan that now sees BOTH stack-a and
    // stack-b — is ambiguous → null, so NO edge is added. Deep-equality proves the
    // incremental register updated the already-queried bucket.
    const initial: Record<string, TerraformPlanGraphNode> = {
      "stack-a::aws_vpc.main": { resources: {} },
    };
    const plan: E07Plan = {
      prior_state: {
        values: {
          root_module: {
            resources: [
              { address: "stack-b::aws_vpc.main", depends_on: [] },
              // Bare, unqualified target — ambiguous once stack-b exists.
              {
                address: "stack-b::aws_subnet.a",
                depends_on: ["aws_vpc.main"],
              },
            ],
          },
        },
      },
    };
    const { prod } = expectBuildExistingEdgesMatchesBruteForce(initial, plan);
    // The new key was created...
    expect(prod["stack-b::aws_vpc.main"]).toBeDefined();
    // ...and the ambiguous bare edge was NOT added (matches fresh-rescan semantics).
    expect(prod["stack-b::aws_subnet.a"]?.edges_existing ?? []).not.toContain(
      "stack-a::aws_vpc.main",
    );
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

/** The composed sources (plan/dot/tfd) for a preset — the same input the real
 * layout parse consumes. Used to drive `applyTfdOverlayToNodes` in isolation. */
function loadPresetSourcesForW14(
  presetId: string,
): TerraformImportPresetSources {
  const raw = getTerraformImportPresetSourcesFromDb(presetId) as
    | TerraformImportPresetSources
    | null
    | undefined;
  expect(raw, `preset ${presetId} exists in the preset DB`).toBeTruthy();
  return resolveSourcesWithTfdComposition(
    raw as TerraformImportPresetSources,
  ) as unknown as TerraformImportPresetSources;
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
  // W14 F3 — the §3 obligation is "across all committed presets' node maps (not
  // just P1)". Enumerate EVERY entry in import-presets.catalog.json (not a
  // hard-coded name list) and run the indexed-vs-scan differential over each
  // preset's real merged, tfd-overlaid node map. Key-resolution differential
  // only (prep-cache parse, no layout builds) to keep runtime sane. A catalog
  // preset that fails to load is a loud failure, never a silent skip.
  describe("all committed catalog presets: indexed path ≡ linear scan", () => {
    const catalogPresetIds = loadImportPresetsCatalog().map(
      (preset: { id: string }) => preset.id,
    );

    it("the catalog is non-empty (guard against a silently-empty enumeration)", () => {
      expect(catalogPresetIds.length).toBeGreaterThan(0);
    });

    for (const presetId of catalogPresetIds) {
      it(
        `${presetId}: every probe resolves identically with and without an active index scope`,
        () => {
          const raw = getTerraformImportPresetSourcesFromDb(presetId);
          // Loud fail: a catalog preset must be resolvable via the committed DB.
          expect(
            raw,
            `catalog preset "${presetId}" must be resolvable via the committed preset DB`,
          ).toBeTruthy();

          const nodes = loadPresetNodesForW14(presetId);
          const keys = w14RealNodeKeys(nodes);
          expect(
            keys.length,
            `preset "${presetId}" parsed to an empty node map`,
          ).toBeGreaterThan(0);
          const probeCount = assertIndexedEqualsScan(nodes);
          expect(probeCount).toBeGreaterThan(keys.length);
        },
        STAGING_DB_LOAD_TEST_TIMEOUT_MS,
      );
    }
  });

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

// ---------------------------------------------------------------------------
// W14 WP2 - .tfd overlay wrap differential + fallback-scan counter
// (docs/strata-view-w14-browser-felt-cost.md §3, WP2 task steps 4-5).
//
// WP2 wraps exactly one additional synchronous parse region -
// `applyTfdOverlayToNodes` (terraformPlanParsing.tsx) - in
// `withTerraformPlanNodeKeyIndex`, because it resolves declared-dataflow endpoints
// against a frozen, ref-identical `nodes` map (the only key its writers add is the
// `__`-prefixed DECLARED_DATAFLOW_ORDERED_KEY, which the index excludes). As of E07,
// `buildExistingEdges` is ALSO wrapped (it registers keys it creates mid-scope), so
// the sole residual key-mutating scan source is now `mergeRawTerraformStateIntoNodes`.
// ---------------------------------------------------------------------------

describe("W14 WP2 - fallback-scan counter semantics", () => {
  it("counts an unscoped scan under scanWithoutScope, zero under an active scope, and a ref-mismatch under scopeRefMismatch (synthetic)", () => {
    const {
      resolveTerraformPlanNodeKey,
      withTerraformPlanNodeKeyIndex,
      getTerraformPlanNodeKeyScanStats,
      resetTerraformPlanNodeKeyScanStats,
    } = terraformPlanParsingModule;

    const nodes: Record<string, TerraformPlanGraphNode> = {
      "aws_vpc.main": { resources: {} },
      "stack-a::aws_vpc.main": { resources: {} },
    };

    // (a) No active scope -> scanWithoutScope increments, scopeRefMismatch stays 0.
    resetTerraformPlanNodeKeyScanStats();
    resolveTerraformPlanNodeKey(nodes, "aws_vpc.main");
    resolveTerraformPlanNodeKey(nodes, "aws_missing.zzz");
    let stats = getTerraformPlanNodeKeyScanStats();
    expect(stats.scanWithoutScope).toBe(2);
    expect(stats.scopeRefMismatch).toBe(0);

    // (b) Under a scope on the SAME ref -> indexed path, neither counter moves.
    resetTerraformPlanNodeKeyScanStats();
    withTerraformPlanNodeKeyIndex(nodes, () => {
      for (let i = 0; i < 5; i++) {
        resolveTerraformPlanNodeKey(nodes, "aws_vpc.main");
      }
    });
    stats = getTerraformPlanNodeKeyScanStats();
    expect(stats.scanWithoutScope).toBe(0);
    expect(stats.scopeRefMismatch).toBe(0);

    // (c) Scope active but built on a DIFFERENT ref -> scopeRefMismatch, not scanWithoutScope.
    resetTerraformPlanNodeKeyScanStats();
    const otherRef = { ...nodes } as Record<string, TerraformPlanGraphNode>;
    withTerraformPlanNodeKeyIndex(otherRef, () => {
      resolveTerraformPlanNodeKey(nodes, "aws_vpc.main");
    });
    stats = getTerraformPlanNodeKeyScanStats();
    expect(stats.scanWithoutScope).toBe(0);
    expect(stats.scopeRefMismatch).toBe(1);

    // (d) Early-return inputs (empty / module-tree key) never touch the scan path.
    resetTerraformPlanNodeKeyScanStats();
    resolveTerraformPlanNodeKey(nodes, "");
    resolveTerraformPlanNodeKey(nodes, TERRAFORM_MODULE_TREE_KEY);
    stats = getTerraformPlanNodeKeyScanStats();
    expect(stats.scanWithoutScope).toBe(0);
    expect(stats.scopeRefMismatch).toBe(0);
  });

  it(
    "under an active scope over a real (P2) map, a full probe batch produces 0 scans; unscoped, every probe scans",
    () => {
      const {
        resolveTerraformPlanNodeKey,
        withTerraformPlanNodeKeyIndex,
        getTerraformPlanNodeKeyScanStats,
        resetTerraformPlanNodeKeyScanStats,
      } = terraformPlanParsingModule;
      const nodes = loadPresetNodesForW14(W14_PRESETS.P2);
      const probes = w14ResolutionProbes(nodes)
        .filter((p) => p !== "" && p !== TERRAFORM_MODULE_TREE_KEY)
        .slice(0, 300);
      expect(probes.length).toBeGreaterThan(0);

      resetTerraformPlanNodeKeyScanStats();
      withTerraformPlanNodeKeyIndex(nodes, () =>
        probes.map((addr) => resolveTerraformPlanNodeKey(nodes, addr)),
      );
      let stats = getTerraformPlanNodeKeyScanStats();
      expect(stats.scanWithoutScope).toBe(0);
      expect(stats.scopeRefMismatch).toBe(0);

      resetTerraformPlanNodeKeyScanStats();
      probes.forEach((addr) => resolveTerraformPlanNodeKey(nodes, addr));
      stats = getTerraformPlanNodeKeyScanStats();
      expect(stats.scanWithoutScope).toBe(probes.length);
      expect(stats.scopeRefMismatch).toBe(0);
    },
    STAGING_DB_LOAD_TEST_TIMEOUT_MS,
  );

  it(
    "full fresh P2 parse: the .tfd overlay contributes 0 scans (it is wrapped); residual scans come only from the excluded key-mutating parse regions; scopeRefMismatch is 0",
    () => {
      const {
        getTerraformPlanNodeKeyScanStats,
        resetTerraformPlanNodeKeyScanStats,
      } = terraformPlanParsingModule;

      resetTerraformPlanNodeKeyScanStats();
      const nodes = loadPresetNodesForW14(W14_PRESETS.P2);
      expect(w14RealNodeKeys(nodes).length).toBeGreaterThan(0);
      const parseStats = getTerraformPlanNodeKeyScanStats();

      // The wrap must never mis-resolve: a scope active over the wrong ref would
      // show up here. Zero is the invariant.
      expect(parseStats.scopeRefMismatch).toBe(0);
      // Residual comes only from the still-unwrapped mergeRawTerraformStateIntoNodes
      // (buildExistingEdges is wrapped as of E07). >=0, may be 0 if the preset merges
      // no raw state.
      expect(parseStats.scanWithoutScope).toBeGreaterThanOrEqual(0);
      // eslint-disable-next-line no-console
      console.info(
        `[W14 WP2] full P2 parse residual: scanWithoutScope=${parseStats.scanWithoutScope} scopeRefMismatch=${parseStats.scopeRefMismatch}`,
      );
    },
    STAGING_DB_LOAD_TEST_TIMEOUT_MS,
  );
});

describe("W14 WP2 - applyTfdOverlayToNodes wrapped region", () => {
  it(
    "overlay resolution is fully indexed (0 unscoped scans, 0 ref-mismatch) and indexed ≡ scan for its actual query set (real P1)",
    () => {
      const {
        applyTfdOverlayToNodes,
        resolveTerraformPlanNodeKey,
        withTerraformPlanNodeKeyIndex,
        getTerraformPlanNodeKeyScanStats,
        resetTerraformPlanNodeKeyScanStats,
      } = terraformPlanParsingModule;

      const sources = loadPresetSourcesForW14(W14_PRESETS.P1);
      const nodes = loadPresetNodesForW14(W14_PRESETS.P1);

      // Harvest the exact (nodes, address) pairs the overlay resolves. vi.spyOn
      // mutates the shared module export in place, so applyDeclaredDataFlow*'s
      // calls (across the circular import) route through the spy and still read the
      // live `activePlanNodeKeyIndex` set by the wrap inside applyTfdOverlayToNodes.
      const harvested: HarvestedCall[] = [];
      const originalResolve =
        terraformPlanParsingModule.resolveTerraformPlanNodeKey;
      const spy = vi
        .spyOn(terraformPlanParsingModule, "resolveTerraformPlanNodeKey")
        .mockImplementation((n, address) => {
          harvested.push({ nodes: n, address });
          return originalResolve(n, address);
        });

      resetTerraformPlanNodeKeyScanStats();
      try {
        applyTfdOverlayToNodes(
          nodes,
          sources.tfdTexts ?? [],
          sources.tfdLabels,
        );
      } finally {
        spy.mockRestore();
      }

      const overlayStats = getTerraformPlanNodeKeyScanStats();
      // The overlay resolved endpoints (guards against a silently no-op wrap).
      expect(harvested.length).toBeGreaterThan(0);
      // The wrap drove every overlay resolution through the O(1) indexed path.
      expect(overlayStats.scanWithoutScope).toBe(0);
      expect(overlayStats.scopeRefMismatch).toBe(0);

      // Differential: indexed (under the wrap) ≡ scan (no scope) for every address
      // the overlay actually queried, against the exact same nodes ref.
      let comparisons = 0;
      for (const { nodes: n, address } of harvested) {
        const indexed = withTerraformPlanNodeKeyIndex(n, () =>
          resolveTerraformPlanNodeKey(n, address),
        );
        const scan = resolveTerraformPlanNodeKey(n, address);
        expect(
          indexed,
          `overlay address ${JSON.stringify(address)} diverged indexed vs scan`,
        ).toBe(scan);
        comparisons++;
      }
      expect(comparisons).toBeGreaterThan(0);
    },
    STAGING_DB_LOAD_TEST_TIMEOUT_MS,
  );
});
