/**
 * Round-9 packed candidate-set scoring tests (SDEC-57;
 * docs/rcll-v2-shit-test-round9.md).
 *
 * Mandatory fixtures (codex round-9 spec):
 *  - blind-spot: a loose leaf whose only edge targets a later sibling hull,
 *    with an intervening sibling hull it pierces — the OLD lifted local count
 *    cannot see the crossing (the intervening hull's internal edge never
 *    lifts), the legacy path keeps the piercing order, the scorer selects a
 *    non-piercing candidate and final leaf-level crossings strictly fall;
 *  - the scorer still counts a long edge between four distinct units;
 *  - a box penetration without an edge crossing moves ONLY the penetration
 *    term; entry into an endpoint's own/ancestor hull is never penalized;
 *  - lexicographic acceptance: equal crossings + shorter length wins; worse
 *    crossings can never be bought by fewer penetrations / shorter length;
 *  - flag-off parity: at K=0 the scored path is placement-identical to the
 *    legacy path (and the legacy path itself is untouched code).
 *
 * P1 real-preset validation is env-gated (STRATA_R9_VALIDATE=1) — it re-runs
 * the round-9 experiment arm (K=4+A7 + packed scoring) and reports global
 * crossings + the SQS→RDS span; report-only, never a gate (v3.2 §8).
 *
 * Run: yarn vitest run packages/excalidraw/components/terraformPipelineStrataPackedScoring.test.ts
 */
import { describe, expect, it } from "vitest";

import { buildStrataModel } from "./terraformPipelineStrataModel";
import {
  liftStrataEdgesToUnits,
  strataPackedCandidateSequences,
  strataUnitId,
  type StrataOrderParams,
} from "./terraformPipelineStrataOrdering";
import {
  checkStrataStructure,
  placeStrataHulls,
} from "./terraformPipelineStrataPlacement";
import {
  chooseStrataRefinedPlacement,
  placeStrataHullsPackedScored,
  scoreStrataPlacementGeometry,
  strataPackedScoreLess,
  type StrataPackedScore,
} from "./terraformPipelineStrataPackedScoring";

import type {
  CollapsedPipelineEdge,
  PipelineCluster,
  PipelineLayoutPrep,
  PipelinePlacement,
} from "./terraformPipelineLayoutShared";
import type {
  StrataBox,
  StrataEngineOptions,
  StrataHullNode,
  StrataModel,
  StrataPlacementResult,
  StrataPrimeEdge,
  StrataRankResult,
  StrataUnit,
} from "./terraformPipelineStrataTypes";

const OPTS_K4: StrataEngineOptions = {
  compact: true,
  includeAncillary: false,
  networkSimplexRank: false,
  sweeps: 4,
  coordinateRefine: false,
};

const COL_GAP = 600;

function placement(
  providerFamily: string,
  accountId: string,
  region: string,
  vpcId: string | null = null,
): PipelinePlacement {
  return { providerFamily, accountId, region, vpcId };
}

function frameCluster(
  id: string,
  p: PipelinePlacement,
  primaryAddress: string,
  frameW: number,
  frameH: number,
): PipelineCluster {
  const frameId = `${id}:frame`;
  const build = {
    skeleton: [
      { type: "frame", id: frameId, x: 0, y: 0, width: frameW, height: frameH },
    ],
    width: frameW,
    height: frameH,
    clusterFrameId: frameId,
  } as unknown as PipelineCluster["build"];
  return { id, primaryAddress, firstSequence: 0, depth: 0, placement: p, build };
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

function rankStub(ranks: Record<string, number>): StrataRankResult {
  const maxRank = Math.max(0, ...Object.values(ranks));
  const columnX = Array.from(
    { length: maxRank + 1 },
    (_, i) => 50 + i * COL_GAP,
  );
  return {
    rank: new Map(Object.entries(ranks)),
    columnX,
    networkSimplexApplied: false,
  };
}

function primeEdges(pairs: [string, string][]): StrataPrimeEdge[] {
  return pairs.map(([source, target]) => ({
    edge: {
      key: `${source.length}:${source}→${target.length}:${target}:tfd`,
      source,
      target,
      relKind: "tfd",
      multiplicity: 1,
    },
    reversed: false,
  }));
}

/** Deterministic serialization of a placement for deep-equality checks. */
function placementFingerprint(p: StrataPlacementResult): string {
  const leaves = [...p.leafBoxes.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const hulls = [...p.boxedHulls.entries()]
    .map(([id, bh]) => [id, bh.box] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify({ leaves, hulls });
}

// ── blind-spot fixture (the round-9 SQS case, miniaturized) ──────────────────
//
// Region-level units: loose leaf `sqs` (col 1), hull `vpcA` (internal leaves
// a1/a2 at cols 0 and 2 with an edge a1→a2), hull `vpcB` (leaf `rds`, col 1),
// plus loose leaf `src` (col 0) with an edge into vpcA anchoring it. Content
// keys pin the initial order [src, sqs, vpcA, vpcB]: sqs sits ABOVE vpcA and
// its only edge (sqs→rds) pierces vpcA's box and crosses a1→a2.

const REGION = placement("aws", "acct", "us-west-2");
const IN_VPCA = placement("aws", "acct", "us-west-2", "vpcA");
const IN_VPCB = placement("aws", "acct", "us-west-2", "vpcB");

function blindSpotFixture() {
  const clusters = [
    frameCluster("src", REGION, "a.a_src", 200, 100),
    frameCluster("sqs", REGION, "a.q_sqs", 200, 100),
    frameCluster("a1", IN_VPCA, "m.a1", 200, 100),
    frameCluster("a2", IN_VPCA, "m.a2", 200, 100),
    frameCluster("rds", IN_VPCB, "z.rds", 200, 100),
  ];
  const model = buildStrataModel(prep(clusters), OPTS_K4);
  const rank = rankStub({ src: 0, sqs: 1, a1: 0, a2: 2, rds: 1 });
  const edges = primeEdges([
    ["sqs", "rds"],
    ["a1", "a2"],
    ["src", "a1"],
  ]);
  return { model, rank, edges };
}

function findHull(
  root: StrataHullNode,
  pred: (h: StrataHullNode) => boolean,
): StrataHullNode | undefined {
  if (pred(root)) {
    return root;
  }
  for (const child of root.children) {
    const hit = findHull(child, pred);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

describe("round-9 blind spot — packed scoring vs legacy acceptance", () => {
  it("the OLD lifted local counter cannot see the piercing crossing", () => {
    const { model, edges } = blindSpotFixture();
    const region = findHull(model.hullRoot, (h) => h.role === "region")!;
    expect(region.policy).toBe("packed");
    const unitOfCluster = new Map<string, string>();
    for (const child of region.children) {
      const collect = (h: StrataHullNode): void => {
        for (const leaf of h.leafClusterIds) {
          unitOfCluster.set(leaf, `H:${child.id}`);
        }
        h.children.forEach(collect);
      };
      collect(child);
    }
    for (const leaf of region.leafClusterIds) {
      unitOfCluster.set(leaf, `L:${leaf}`);
    }
    const lifted = liftStrataEdgesToUnits(edges, (cid) =>
      unitOfCluster.get(cid),
    );
    // sqs→rds and src→a1 lift; a1→a2 (vpcA-internal) is DROPPED — the local
    // acceptance can never count a crossing against it (R9-F1 blindness).
    expect(lifted).toHaveLength(2);
    expect(
      lifted.some((e) => e.from === "L:sqs" && e.to === `H:${region.children.find((c) => c.leafClusterIds.includes("rds") || c.children.length > 0)?.id}`) ||
        lifted.some((e) => e.from === "L:sqs"),
    ).toBe(true);
  });

  it("legacy path keeps the piercing order; the scorer strictly improves it", () => {
    const { model, rank, edges } = blindSpotFixture();

    const legacy = placeStrataHulls(model, edges, rank, OPTS_K4);
    const legacyScore = scoreStrataPlacementGeometry(legacy, model, edges);
    const sqsLegacy = legacy.leafBoxes.get("sqs")!;
    const vpcAHull = findHull(
      model.hullRoot,
      (h) => h.role === "vpc" && h.leafClusterIds.includes("a1"),
    )!;
    const vpcALegacy = legacy.boxedHulls.get(vpcAHull.id)!.box;
    // Piercing arrangement: sqs above vpcA, its chord crossing + tunneling.
    expect(sqsLegacy.y).toBeLessThan(vpcALegacy.y);
    expect(legacyScore.crossings).toBe(1);
    expect(legacyScore.penetrations).toBeGreaterThanOrEqual(1);

    const scored = placeStrataHullsPackedScored(model, edges, rank, OPTS_K4);
    // The descent baseline IS the legacy placement/score.
    expect(scored.baselineScore).toEqual(legacyScore);
    // A per-hull snapshot selection wins with strictly fewer leaf-level
    // crossings and no tunneling; the never-worse invariant holds.
    expect(scored.selections.size).toBeGreaterThanOrEqual(1);
    expect(scored.score.crossings).toBe(0);
    expect(scored.score.penetrations).toBe(0);
    expect(scored.score.crossings).toBeLessThan(legacyScore.crossings);
    expect(strataPackedScoreLess(scored.baselineScore, scored.score)).toBe(
      false,
    );
    // Replaying the winning selection through placeStrataHulls reproduces the
    // winner exactly (the per-hull map is the real contract, not a side path).
    const replay = placeStrataHulls(
      model,
      edges,
      rank,
      OPTS_K4,
      scored.selections,
    );
    expect(placementFingerprint(replay)).toBe(
      placementFingerprint(scored.placement),
    );

    // R2 stays zero on the winner.
    const structure = checkStrataStructure(scored.placement, model);
    expect(structure).toEqual({
      nonAncestorOverlaps: 0,
      titleCollisions: 0,
      contiguityViolations: 0,
    });

    // Deterministic: double-compute is selection- and placement-identical.
    const again = placeStrataHullsPackedScored(model, edges, rank, OPTS_K4);
    expect([...again.selections.entries()]).toEqual([
      ...scored.selections.entries(),
    ]);
    expect(placementFingerprint(again.placement)).toBe(
      placementFingerprint(scored.placement),
    );
  });

  it("flag-off parity: scored path at K=0 is placement-identical to legacy", () => {
    const { model, rank, edges } = blindSpotFixture();
    const optsK0: StrataEngineOptions = { ...OPTS_K4, sweeps: 0 };
    const legacy = placeStrataHulls(model, edges, rank, optsK0);
    const scored = placeStrataHullsPackedScored(model, edges, rank, optsK0);
    expect(scored.selections.size).toBe(0);
    expect(scored.trialCount).toBe(1);
    expect(scored.placement).toBe(scored.baselinePlacement);
    expect(placementFingerprint(scored.placement)).toBe(
      placementFingerprint(legacy),
    );
  });

  it("a packed hull absent from the selection map keeps the legacy order", () => {
    const { model, rank, edges } = blindSpotFixture();
    const legacy = placeStrataHulls(model, edges, rank, OPTS_K4);
    const empty = placeStrataHulls(
      model,
      edges,
      rank,
      OPTS_K4,
      new Map<string, number>(),
    );
    expect(placementFingerprint(empty)).toBe(placementFingerprint(legacy));
  });
});

describe("strataPackedCandidateSequences — group sift (satellite moves)", () => {
  const unitL = (clusterId: string): StrataUnit => ({
    kind: "leaf",
    clusterId,
  });
  const unitH = (hullId: string): StrataUnit => ({ kind: "hull", hullId });
  const KEYS: Record<string, string> = {
    "L:q": "a",
    "L:dyn": "b",
    "H:h1": "c",
    "H:h2": "d",
  };
  const params = (
    liftedEdges: { from: string; to: string }[],
  ): StrataOrderParams => ({
    units: [unitL("q"), unitL("dyn"), unitH("h1"), unitH("h2")],
    contentKeyOf: (u) => KEYS[strataUnitId(u)]!,
    liftedEdges: liftedEdges.map((e, i) => ({ ...e, key: `e${i}` })),
    unitHeightOf: () => 100,
    policy: "packed" as const,
    sweeps: 1,
    unitXSpanOf: () => [0, 100] as const,
    unitColSpanOf: () => [0, 0] as const,
  });
  const idsOf = (seqs: readonly (readonly StrataUnit[])[]): string[] =>
    seqs.map((s) => s.map(strataUnitId).join(","));

  it("a satellite pair (only-edges-into-group) moves together", () => {
    // dyn's ONLY lifted edge points at q ⇒ dyn is q's satellite.
    const cands = idsOf(
      strataPackedCandidateSequences(
        params([
          { from: "L:q", to: "H:h2" },
          { from: "L:q", to: "L:dyn" },
        ]),
      ),
    );
    // Group {q, dyn} inserted past both hulls, contiguously, order preserved.
    expect(cands).toContain("H:h1,H:h2,L:q,L:dyn");
    // Single-leaf sift of q alone still exists too.
    expect(cands).toContain("L:dyn,H:h1,H:h2,L:q");
  });

  it("a leaf with an external edge is NOT treated as a satellite", () => {
    // dyn now ALSO has an edge to H:h1 (outside any q-group) ⇒ never joins.
    const cands = idsOf(
      strataPackedCandidateSequences(
        params([
          { from: "L:q", to: "H:h2" },
          { from: "L:q", to: "L:dyn" },
          { from: "L:dyn", to: "H:h1" },
        ]),
      ),
    );
    expect(cands).not.toContain("H:h1,H:h2,L:q,L:dyn");
  });
});

describe("chooseStrataRefinedPlacement — post-A7 never-worse guard", () => {
  it("falls back to legacy when the scored arm is worse on final geometry", () => {
    const root = leafHull("root", "root", ["a", "b", "c", "d"]);
    const model = syntheticModel(root);
    const edges = primeEdges([
      ["a", "b"],
      ["c", "d"],
    ]);
    // Scored final: X arrangement ⇒ 1 crossing. Legacy final: parallel ⇒ 0.
    const scoredFinal = syntheticPlacement(
      { a: box(0, 0), b: box(100, 100), c: box(100, 0), d: box(0, 100) },
      {},
    );
    const legacyFinal = syntheticPlacement(
      { a: box(0, 0), b: box(100, 0), c: box(0, 100), d: box(100, 100) },
      {},
    );
    const chosen = chooseStrataRefinedPlacement(
      scoredFinal,
      legacyFinal,
      model,
      edges,
    );
    expect(chosen.fellBack).toBe(true);
    expect(chosen.placement).toBe(legacyFinal);
  });

  it("keeps the scored arm on wins AND on exact ties (no churn)", () => {
    const root = leafHull("root", "root", ["a", "b"]);
    const model = syntheticModel(root);
    const edges = primeEdges([["a", "b"]]);
    const p1 = syntheticPlacement({ a: box(0, 0), b: box(100, 0) }, {});
    const p2 = syntheticPlacement({ a: box(0, 0), b: box(100, 0) }, {});
    const tie = chooseStrataRefinedPlacement(p1, p2, model, edges);
    expect(tie.fellBack).toBe(false);
    expect(tie.placement).toBe(p1);
    const shorter = syntheticPlacement({ a: box(0, 0), b: box(50, 0) }, {});
    const win = chooseStrataRefinedPlacement(shorter, p2, model, edges);
    expect(win.fellBack).toBe(false);
    expect(win.placement).toBe(shorter);
  });
});

// ── scorer kernel (synthetic placements) ─────────────────────────────────────

/** Hand-built model stub: one root with the given hulls; ancestry per map. */
function syntheticModel(root: StrataHullNode): StrataModel {
  return { hullRoot: root } as unknown as StrataModel;
}

function leafHull(
  id: string,
  role: StrataHullNode["role"],
  leafClusterIds: string[],
  children: StrataHullNode[] = [],
): StrataHullNode {
  return {
    id,
    role,
    policy: "packed",
    path: [id],
    children,
    leafClusterIds,
  } as StrataHullNode;
}

function syntheticPlacement(
  leaves: Record<string, StrataBox>,
  hulls: Record<string, StrataBox>,
): StrataPlacementResult {
  return {
    leafBoxes: new Map(Object.entries(leaves)),
    boxedHulls: new Map(
      Object.entries(hulls).map(([id, box]) => [
        id,
        { hull: leafHull(id, "vpc", []), box, placed: [] },
      ]),
    ),
  } as unknown as StrataPlacementResult;
}

const box = (x: number, y: number, w = 10, h = 10): StrataBox => ({
  x,
  y,
  width: w,
  height: h,
});

describe("scoreStrataPlacementGeometry — kernel", () => {
  it("counts a long edge between four distinct units (X arrangement)", () => {
    const root = leafHull("root", "root", ["a", "b", "c", "d"]);
    const p = syntheticPlacement(
      {
        a: box(0, 0),
        b: box(100, 100),
        c: box(100, 0),
        d: box(0, 100),
      },
      {},
    );
    const score = scoreStrataPlacementGeometry(
      p,
      syntheticModel(root),
      primeEdges([
        ["a", "b"],
        ["c", "d"],
      ]),
    );
    expect(score.crossings).toBe(1);
    expect(score.penetrations).toBe(0);
  });

  it("shared-endpoint pairs are never crossings", () => {
    const root = leafHull("root", "root", ["a", "b", "c"]);
    const p = syntheticPlacement(
      { a: box(0, 0), b: box(100, 100), c: box(100, 0) },
      {},
    );
    const score = scoreStrataPlacementGeometry(
      p,
      syntheticModel(root),
      primeEdges([
        ["a", "b"],
        ["a", "c"],
      ]),
    );
    expect(score.crossings).toBe(0);
  });

  it("a box penetration without an edge crossing moves ONLY the penetration term", () => {
    // Edge a→b passes through hull `h1` which contains neither endpoint.
    const h1 = leafHull("h1", "vpc", ["inside"]);
    const root = leafHull("root", "root", ["a", "b"], [h1]);
    const p = syntheticPlacement(
      { a: box(0, 45), b: box(200, 45), inside: box(100, 40) },
      { h1: box(80, 0, 60, 100) },
    );
    const score = scoreStrataPlacementGeometry(
      p,
      syntheticModel(root),
      primeEdges([["a", "b"]]),
    );
    expect(score.crossings).toBe(0);
    expect(score.penetrations).toBe(1);
    expect(score.lengthL1).toBeGreaterThan(0);
  });

  it("entry into an endpoint's own/ancestor hull is NOT penalized", () => {
    // Edge a→inside terminates inside h1 ⇒ h1 is an ancestor of an endpoint.
    const h1 = leafHull("h1", "vpc", ["inside"]);
    const root = leafHull("root", "root", ["a"], [h1]);
    const p = syntheticPlacement(
      { a: box(0, 45), inside: box(100, 40) },
      { h1: box(80, 0, 60, 100) },
    );
    const score = scoreStrataPlacementGeometry(
      p,
      syntheticModel(root),
      primeEdges([["a", "inside"]]),
    );
    expect(score.penetrations).toBe(0);
  });
});

describe("strataPackedScoreLess — lexicographic acceptance", () => {
  const s = (
    crossings: number,
    penetrations: number,
    lengthL1: number,
  ): StrataPackedScore => ({ crossings, penetrations, lengthL1 });

  it("equal crossings + shorter length wins (plateau unblocked)", () => {
    expect(strataPackedScoreLess(s(5, 0, 100), s(5, 0, 200))).toBe(true);
    expect(strataPackedScoreLess(s(5, 0, 200), s(5, 0, 100))).toBe(false);
  });

  it("worse crossings can never be bought by penetrations or length", () => {
    expect(strataPackedScoreLess(s(6, 0, 1), s(5, 99, 99999))).toBe(false);
    expect(strataPackedScoreLess(s(5, 99, 99999), s(6, 0, 1))).toBe(true);
  });

  it("penetrations break crossing ties before length", () => {
    expect(strataPackedScoreLess(s(5, 1, 1), s(5, 2, 0))).toBe(true);
    expect(strataPackedScoreLess(s(5, 2, 0), s(5, 1, 1))).toBe(false);
  });

  it("exact tie is NOT less (earliest candidate wins upstream)", () => {
    expect(strataPackedScoreLess(s(5, 1, 10), s(5, 1, 10))).toBe(false);
  });
});
