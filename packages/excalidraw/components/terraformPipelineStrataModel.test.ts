/**
 * Unit tests for the Strata P1 model builder (WP-2b; spec rcll-v2-spec-v2 §6 +
 * v3.1 §1.4/§2.2). The model changes no geometry — pure-data tests over synthetic
 * `PipelineLayoutPrep` fixtures:
 *   - buildStrataHullTree: provider→account→region→vpc→subnetZone nesting, roles,
 *     per-role policy (root/provider/account banded; region/vpc/subnetZone packed),
 *     leaf attachment (deepest hull, keyed by cluster id)
 *   - band-row invariant: a direct leaf under a banded hull is a singleton band;
 *     assertStrataBandRowInvariant catches policy mismatch + duplicate leaf
 *   - edges: parallel-edge multiplicity, self-loop split, canonical key shape
 *   - determinism: same prep (any input order) ⇒ deep-equal tree + edges
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataModel.test.ts
 */
import { describe, expect, it } from "vitest";

import {
  assertStrataBandRowInvariant,
  buildStrataModel,
} from "./terraformPipelineStrataModel";
import { topologyRoleAndKeyFromPath } from "./terraformPipelineTopologyFrames";

import type {
  CollapsedPipelineEdge,
  PipelineCluster,
  PipelineLayoutPrep,
  PipelinePlacement,
} from "./terraformPipelineLayoutShared";
import type {
  StrataEngineOptions,
  StrataHullNode,
  StrataHullRole,
} from "./terraformPipelineStrataTypes";

// ── fixtures ──────────────────────────────────────────────────────────────────

const OPTS: StrataEngineOptions = {
  compact: true,
  includeAncillary: false,
  networkSimplexRank: false,
  sweeps: 0,
  coordinateRefine: false,
};

function placement(
  providerFamily: string,
  accountId: string,
  region: string,
  vpcId: string | null = null,
  subnetSignature?: string,
): PipelinePlacement {
  return { providerFamily, accountId, region, vpcId, subnetSignature };
}

function cluster(
  id: string,
  p: PipelinePlacement,
  primaryAddress: string = id,
  ancillaryScopeRole?: PipelineCluster["ancillaryScopeRole"],
): PipelineCluster {
  return {
    id,
    primaryAddress,
    firstSequence: 0,
    depth: 0,
    placement: p,
    build: {} as PipelineCluster["build"],
    ...(ancillaryScopeRole ? { ancillaryScopeRole } : {}),
  };
}

function edge(source: string, target: string): CollapsedPipelineEdge {
  return {
    source,
    target,
    sequence: 0,
    original: { source, target, sequence: 0, origin: "tfd" },
  };
}

function prep(
  clusters: PipelineCluster[],
  collapsedEdges: CollapsedPipelineEdge[] = [],
): PipelineLayoutPrep {
  return {
    clusters,
    collapsedEdges,
    maxDepth: 0,
    columnX: [],
    depthResult: { depths: new Map(), hasCycle: false },
    networkSimplexApplied: false,
    satelliteOwners: new Map(),
    placementByAddress: new Map(),
  };
}

const keyOf = (...path: string[]): string =>
  topologyRoleAndKeyFromPath(path)!.key;

/** Serialize the hull tree structure (ids/roles/policies/leaves) for equality. */
const serializeHull = (h: StrataHullNode): unknown => ({
  id: h.id,
  role: h.role,
  policy: h.policy,
  path: [...h.path],
  leaves: [...h.leafClusterIds],
  children: h.children.map(serializeHull),
});

// ── hull tree shape + policies ───────────────────────────────────────────────

describe("buildStrataModel — hull tree", () => {
  it("nests provider→account→region→vpc→subnetZone with the frozen policy map", () => {
    const a = cluster(
      "res.a",
      placement("aws", "111", "us-east-1", "vpc-1", "private"),
    );
    const model = buildStrataModel(prep([a]), OPTS);

    const root = model.hullRoot;
    expect(root.role).toBe("root");
    expect(root.policy).toBe("banded");

    const provider = root.children[0]!;
    expect([provider.role, provider.policy]).toEqual(["provider", "banded"]);
    const account = provider.children[0]!;
    expect([account.role, account.policy]).toEqual(["account", "banded"]);
    const region = account.children[0]!;
    expect([region.role, region.policy]).toEqual(["region", "packed"]);
    const vpc = region.children[0]!;
    expect([vpc.role, vpc.policy]).toEqual(["vpc", "packed"]);
    const subnet = vpc.children[0]!;
    expect([subnet.role, subnet.policy]).toEqual(["subnetZone", "packed"]);

    // Leaf attaches to its deepest hull, keyed by cluster id.
    expect(subnet.leafClusterIds).toEqual(["res.a"]);
    expect(subnet.id).toBe(
      keyOf("aws", "111", "us-east-1", "vpc-1", "private"),
    );
  });

  it("keeps two same-subnet clusters as two distinct leaves (no path collision)", () => {
    const p = placement("aws", "111", "us-east-1", "vpc-1", "private");
    const model = buildStrataModel(
      prep([cluster("res.a", p), cluster("res.b", p)]),
      OPTS,
    );
    const subnet =
      model.hullRoot.children[0]!.children[0]!.children[0]!.children[0]!
        .children[0]!;
    expect([...subnet.leafClusterIds].sort()).toEqual(["res.a", "res.b"]);
  });

  it("orders children/leaves by canonical address (pinned comparator, not input order)", () => {
    // two accounts; addresses drive order regardless of array order.
    const model = buildStrataModel(
      prep([
        cluster("z", placement("aws", "222", "eu-west-1"), "aws.z"),
        cluster("a", placement("aws", "111", "us-east-1"), "aws.a"),
      ]),
      OPTS,
    );
    const accounts = model.hullRoot.children[0]!.children;
    // account 111 (min addr aws.a) sorts before account 222 (aws.z).
    expect(accounts.map((h) => h.id)).toEqual([
      keyOf("aws", "111"),
      keyOf("aws", "222"),
    ]);
  });
});

// ── band-row invariant ───────────────────────────────────────────────────────

describe("buildStrataModel — band-row invariant", () => {
  it("models a bare leaf directly under a banded hull as a singleton band", () => {
    // ancillaryScopeRole=account ⇒ topology path [provider, account] ⇒ the leaf's
    // deepest hull is the (banded) account hull.
    const a = cluster(
      "acct-strip",
      placement("aws", "111", "us-east-1"),
      "aws.strip",
      "account",
    );
    const model = buildStrataModel(prep([a]), OPTS);
    const account = model.hullRoot.children[0]!.children[0]!;
    expect(account.role).toBe("account");
    expect(account.policy).toBe("banded");
    expect(account.leafClusterIds).toEqual(["acct-strip"]); // its own singleton
    expect(account.children).toEqual([]);
    // build already ran the assert; a direct call is also clean.
    expect(() =>
      assertStrataBandRowInvariant(model.hullRoot, "account"),
    ).not.toThrow();
  });

  it("builds without throwing for every one of the 6 band-depth cuts", () => {
    // A real multi-level fixture (provider→account→region→vpc→subnetZone).
    const clusters = [
      cluster(
        "res.a",
        placement("aws", "111", "us-east-1", "vpc-1", "private"),
        "aws.a",
      ),
      cluster(
        "res.b",
        placement("aws", "222", "eu-west-1", "vpc-2", "public"),
        "aws.b",
      ),
      cluster(
        "res.c",
        placement("gcp", "333", "us-central1", "vpc-3", "svc"),
        "gcp.c",
      ),
    ];
    const CUTS: readonly StrataHullRole[] = [
      "root",
      "provider",
      "account",
      "region",
      "vpc",
      "subnetZone",
    ];
    for (const cut of CUTS) {
      expect(() =>
        buildStrataModel(prep(clusters), { ...OPTS, strataBandDepth: cut }),
      ).not.toThrow();
    }
  });

  it("does NOT throw for a packed hull under a banded ancestor (monotone — packed-below-banded is allowed)", () => {
    // cut "root" ⇒ provider resolves packed under the banded root: legal.
    const bandedRoot: StrataHullNode = {
      id: "__strata_root__",
      role: "root",
      policy: "banded",
      path: [],
      children: [
        {
          id: "aws",
          role: "provider",
          policy: "packed", // packed under banded root — the allowed direction
          path: ["aws"],
          children: [],
          leafClusterIds: ["x"],
        },
      ],
      leafClusterIds: [],
    };
    expect(() =>
      assertStrataBandRowInvariant(bandedRoot, "root"),
    ).not.toThrow();
  });

  it("assertStrataBandRowInvariant throws when a BANDED hull nests under a PACKED ancestor (monotonicity)", () => {
    const bad: StrataHullNode = {
      id: "__strata_root__",
      role: "root",
      policy: "banded",
      path: [],
      children: [
        {
          id: "aws",
          role: "provider",
          policy: "packed",
          path: ["aws"],
          children: [
            {
              id: "aws/111",
              role: "account",
              policy: "banded", // banded under a packed ancestor — illegal
              path: ["aws", "111"],
              children: [],
              leafClusterIds: ["y"],
            },
          ],
          leafClusterIds: [],
        },
      ],
      leafClusterIds: [],
    };
    expect(() => assertStrataBandRowInvariant(bad, "root")).toThrow(
      /monotonicity/,
    );
  });

  it("assertStrataBandRowInvariant throws when the root resolves packed (root is pinned banded)", () => {
    const packedRoot: StrataHullNode = {
      id: "__strata_root__",
      role: "root",
      policy: "packed", // impossible for any legal cut
      path: [],
      children: [],
      leafClusterIds: [],
    };
    expect(() => assertStrataBandRowInvariant(packedRoot, "account")).toThrow(
      /root/,
    );
  });

  it("assertStrataBandRowInvariant throws on a duplicate leaf under a banded hull", () => {
    const dup: StrataHullNode = {
      id: "aws",
      role: "provider",
      policy: "banded",
      path: ["aws"],
      children: [],
      leafClusterIds: ["x", "x"],
    };
    expect(() => assertStrataBandRowInvariant(dup, "account")).toThrow(
      /duplicate/,
    );
  });
});

// ── edges ─────────────────────────────────────────────────────────────────────

describe("buildStrataModel — edges", () => {
  it("dedupes parallel edges into multiplicity and uses the canonical key shape", () => {
    const p = placement("aws", "111", "us-east-1");
    const model = buildStrataModel(
      prep(
        [cluster("a", p), cluster("b", p), cluster("c", p)],
        [edge("a", "b"), edge("a", "b"), edge("a", "c")],
      ),
      OPTS,
    );
    expect(model.edges).toHaveLength(2);
    const ab = model.edges.find((e) => e.source === "a" && e.target === "b")!;
    expect(ab.multiplicity).toBe(2);
    expect(ab.key).toBe("1:a→1:b:tfd"); // len(src):src→len(tgt):tgt:relKind
    expect(ab.relKind).toBe("tfd");
    const ac = model.edges.find((e) => e.target === "c")!;
    expect(ac.multiplicity).toBe(1);
  });

  it("splits self-loops out of the ranking edge set (kept for A6 render)", () => {
    const p = placement("aws", "111", "us-east-1");
    const model = buildStrataModel(
      prep(
        [cluster("a", p), cluster("b", p)],
        [edge("a", "b"), edge("b", "b"), edge("b", "b")],
      ),
      OPTS,
    );
    expect(model.edges.map((e) => e.key)).toEqual(["1:a→1:b:tfd"]);
    expect(model.selfLoops).toHaveLength(1);
    expect(model.selfLoops[0]!.source).toBe("b");
    expect(model.selfLoops[0]!.multiplicity).toBe(2);
  });
});

// ── determinism ──────────────────────────────────────────────────────────────

describe("buildStrataModel — determinism", () => {
  it("produces a deep-equal tree + edges regardless of input order", () => {
    const clusters = [
      cluster(
        "res.b",
        placement("aws", "111", "us-east-1", "vpc-1", "a"),
        "aws.b",
      ),
      cluster(
        "res.a",
        placement("aws", "111", "us-east-1", "vpc-1", "a"),
        "aws.a",
      ),
      cluster(
        "res.c",
        placement("gcp", "222", "eu-west-1", "vpc-2", "z"),
        "gcp.c",
      ),
    ];
    const edges = [edge("res.a", "res.b"), edge("res.b", "res.c")];

    const m1 = buildStrataModel(prep([...clusters], [...edges]), OPTS);
    const m2 = buildStrataModel(
      prep([...clusters].reverse(), [...edges].reverse()),
      OPTS,
    );

    expect(serializeHull(m1.hullRoot)).toEqual(serializeHull(m2.hullRoot));
    expect(m1.edges).toEqual(m2.edges);
    expect(m1.selfLoops).toEqual(m2.selfLoops);
  });
});
