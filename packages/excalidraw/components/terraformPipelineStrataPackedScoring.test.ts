/* eslint-disable max-lines */
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
  resolveStrataPackedEpsilonDelta,
  scoreStrataPlacementGeometry,
  segmentIntersectsStrataBoxInterior,
  strataPackedScoreAdoptable,
  strataPackedScoreLess,
  type StrataPackedScore,
  type StrataPackedTrialRecord,
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
  return {
    id,
    primaryAddress,
    firstSequence: 0,
    depth: 0,
    placement: p,
    build,
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
      lifted.some(
        (e) =>
          e.from === "L:sqs" &&
          e.to ===
            `H:${
              region.children.find(
                (c) =>
                  c.leafClusterIds.includes("rds") || c.children.length > 0,
              )?.id
            }`,
      ) || lifted.some((e) => e.from === "L:sqs"),
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

// ── W8b ε-constraint selector ────────────────────────────────────────────────

describe("W8b epsilon selector — resolveStrataPackedEpsilonDelta", () => {
  it("epsilon <= 0 (or non-finite) resolves to 0 (strict rule)", () => {
    expect(resolveStrataPackedEpsilonDelta(0, 123)).toBe(0);
    expect(resolveStrataPackedEpsilonDelta(-1, 123)).toBe(0);
    expect(resolveStrataPackedEpsilonDelta(Number.NaN, 123)).toBe(0);
  });

  it("epsilon >= 1 is an absolute integer crossings budget", () => {
    expect(resolveStrataPackedEpsilonDelta(1, 123)).toBe(1);
    expect(resolveStrataPackedEpsilonDelta(2, 0)).toBe(2);
  });

  it("0 < epsilon < 1 is relative: ceil(epsilon * baseline crossings)", () => {
    expect(resolveStrataPackedEpsilonDelta(0.01, 123)).toBe(2); // ceil(1.23)
    expect(resolveStrataPackedEpsilonDelta(0.01, 100)).toBe(1);
    expect(resolveStrataPackedEpsilonDelta(0.5, 4)).toBe(2);
    // Zero-crossing baseline: relative mode yields a 0 budget (strict).
    expect(resolveStrataPackedEpsilonDelta(0.01, 0)).toBe(0);
  });
});

describe("W8b epsilon selector — strataPackedScoreAdoptable", () => {
  const s = (
    crossings: number,
    penetrations: number,
    lengthL1: number,
  ): StrataPackedScore => ({ crossings, penetrations, lengthL1 });

  it("delta 0 is exactly the strict lexicographic rule", () => {
    expect(strataPackedScoreAdoptable(s(4, 9, 9), s(5, 0, 0), 5, 0)).toBe(
      "strict",
    );
    expect(strataPackedScoreAdoptable(s(5, 0, 1), s(5, 0, 0), 5, 0)).toBe(
      false,
    );
    expect(strataPackedScoreAdoptable(s(6, 0, 0), s(5, 9, 9), 5, 0)).toBe(
      false,
    );
  });

  it("epsilon band admits within baseline+delta ONLY with a strict (pen,L1) improvement", () => {
    // baseline 5 crossings, delta 1: 6 crossings + better (pen,L1) ⇒ epsilon.
    expect(strataPackedScoreAdoptable(s(6, 0, 10), s(5, 1, 10), 5, 1)).toBe(
      "epsilon",
    );
    // equal (pen,L1) ⇒ NOT adopted (ties keep the earliest/incumbent).
    expect(strataPackedScoreAdoptable(s(6, 1, 10), s(5, 1, 10), 5, 1)).toBe(
      false,
    );
    // beyond the budget ⇒ NOT adopted regardless of (pen,L1).
    expect(strataPackedScoreAdoptable(s(7, 0, 0), s(5, 1, 10), 5, 1)).toBe(
      false,
    );
  });

  it("anti-ratchet: the budget is vs the LEGACY BASELINE, not the incumbent", () => {
    // Incumbent already sits at baseline+1 (adopted via the band). A trial at
    // baseline+2 is within incumbent+1 but OUTSIDE baseline+1 ⇒ rejected.
    const baselineCrossings = 5;
    const incumbent = s(6, 1, 10); // prior epsilon adoption
    const trial = s(7, 0, 1); // better (pen,L1), crossings = baseline+2
    expect(
      strataPackedScoreAdoptable(trial, incumbent, baselineCrossings, 1),
    ).toBe(false);
    // The same trial IS admissible when the caller granted delta 2.
    expect(
      strataPackedScoreAdoptable(trial, incumbent, baselineCrossings, 2),
    ).toBe("epsilon");
  });
});

describe("W8b epsilon selector — descent integration + frontier collector", () => {
  it("epsilon 0 (and absent) is bit-identical to today on the blind-spot fixture", () => {
    const { model, rank, edges } = blindSpotFixture();
    const strict = placeStrataHullsPackedScored(model, edges, rank, OPTS_K4);
    const epsZero = placeStrataHullsPackedScored(model, edges, rank, {
      ...OPTS_K4,
      packedScoringEpsilon: 0,
    });
    expect(epsZero.effectiveDelta).toBe(0);
    expect(epsZero.epsilon).toBe(0);
    expect([...epsZero.selections.entries()]).toEqual([
      ...strict.selections.entries(),
    ]);
    expect(epsZero.score).toEqual(strict.score);
    expect(epsZero.trialCount).toBe(strict.trialCount);
    expect(placementFingerprint(epsZero.placement)).toBe(
      placementFingerprint(strict.placement),
    );
  });

  it("epsilon > 0 keeps crossings within baseline+delta and never worsens (pen,L1) for band adoptions", () => {
    const { model, rank, edges } = blindSpotFixture();
    const scored = placeStrataHullsPackedScored(model, edges, rank, {
      ...OPTS_K4,
      packedScoringEpsilon: 1,
    });
    expect(scored.epsilon).toBe(1);
    expect(scored.effectiveDelta).toBe(1);
    expect(scored.score.crossings).toBeLessThanOrEqual(
      scored.baselineScore.crossings + 1,
    );
    // Deterministic double-compute.
    const again = placeStrataHullsPackedScored(model, edges, rank, {
      ...OPTS_K4,
      packedScoringEpsilon: 1,
    });
    expect([...again.selections.entries()]).toEqual([
      ...scored.selections.entries(),
    ]);
    expect(placementFingerprint(again.placement)).toBe(
      placementFingerprint(scored.placement),
    );
  });

  it("relative mode resolves the delta from the baseline crossings", () => {
    const { model, rank, edges } = blindSpotFixture();
    const scored = placeStrataHullsPackedScored(model, edges, rank, {
      ...OPTS_K4,
      packedScoringEpsilon: 0.9,
    });
    // Blind-spot baseline has 1 crossing ⇒ ceil(0.9 × 1) = 1.
    expect(scored.baselineScore.crossings).toBe(1);
    expect(scored.effectiveDelta).toBe(1);
  });

  it("frontier collector records baseline + every trial; absence changes nothing", () => {
    const { model, rank, edges } = blindSpotFixture();
    const records: StrataPackedTrialRecord[] = [];
    const collected = placeStrataHullsPackedScored(
      model,
      edges,
      rank,
      OPTS_K4,
      (r) => records.push(r),
    );
    expect(records.length).toBe(collected.trialCount);
    expect(records[0]).toEqual({
      hullId: "__baseline__",
      candidateIndex: -1,
      pass: 0,
      score: collected.baselineScore,
      adopted: true,
    });
    // Every adopted record carries an adoption channel; with epsilon 0 the
    // channel is always "strict".
    for (const r of records.slice(1)) {
      expect(r.adopted).toBe(r.adoptedVia !== undefined);
      if (r.adoptedVia) {
        expect(r.adoptedVia).toBe("strict");
      }
    }
    // The winning selection's hull appears among the adopted records.
    for (const [hullId, candidateIndex] of collected.selections) {
      expect(
        records.some(
          (r) =>
            r.hullId === hullId &&
            r.candidateIndex === candidateIndex &&
            r.adopted,
        ),
      ).toBe(true);
    }
    // No-collector run is selection- and placement-identical.
    const plain = placeStrataHullsPackedScored(model, edges, rank, OPTS_K4);
    expect([...plain.selections.entries()]).toEqual([
      ...collected.selections.entries(),
    ]);
    expect(placementFingerprint(plain.placement)).toBe(
      placementFingerprint(collected.placement),
    );
  });
});

describe("W8b epsilon selector — post-A7 guard delta band", () => {
  it("delta keeps a scored arm within crossings budget when (pen,L1) is not worse", () => {
    const root = leafHull("root", "root", ["a", "b", "c", "d"]);
    const model = syntheticModel(root);
    const edges = primeEdges([
      ["a", "b"],
      ["c", "d"],
    ]);
    // Scored final: 1 crossing but SHORTER edges (L1 800 vs 1200), pen 0=0.
    // Legacy final: 0 crossings, long parallel edges.
    const scoredFinal = syntheticPlacement(
      { a: box(0, 0), b: box(100, 100), c: box(100, 0), d: box(0, 100) },
      {},
    );
    const legacyFinal = syntheticPlacement(
      { a: box(0, 0), b: box(300, 0), c: box(0, 100), d: box(300, 100) },
      {},
    );
    // delta 0: falls back (crossings regressed) — the pre-W8b behavior.
    const strict = chooseStrataRefinedPlacement(
      scoredFinal,
      legacyFinal,
      model,
      edges,
    );
    expect(strict.fellBack).toBe(true);
    // delta 1: within the crossings band, equal pen, strictly lower L1 ⇒ kept.
    const banded = chooseStrataRefinedPlacement(
      scoredFinal,
      legacyFinal,
      model,
      edges,
      1,
    );
    expect(banded.fellBack).toBe(false);
    expect(banded.placement).toBe(scoredFinal);
  });

  it("delta never excuses a (pen,L1) regression or an over-budget crossing", () => {
    const h1 = leafHull("h1", "vpc", ["inside"]);
    const root = leafHull("root", "root", ["a", "b"], [h1]);
    const model = syntheticModel(root);
    const edges = primeEdges([["a", "b"]]);
    // Scored final tunnels h1 (pen 1); legacy does not (pen 0). Crossings 0/0.
    const scoredFinal = syntheticPlacement(
      { a: box(0, 45), b: box(200, 45), inside: box(100, 40) },
      { h1: box(80, 0, 60, 100) },
    );
    const legacyFinal = syntheticPlacement(
      { a: box(0, 145), b: box(200, 145), inside: box(100, 40) },
      { h1: box(80, 0, 60, 100) },
    );
    const chosen = chooseStrataRefinedPlacement(
      scoredFinal,
      legacyFinal,
      model,
      edges,
      2,
    );
    expect(chosen.fellBack).toBe(true);
    expect(chosen.placement).toBe(legacyFinal);
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

describe("segmentIntersectsStrataBoxInterior — exact open-interior test", () => {
  // Box [0,0]-[10,10] (closed corners), open interior (0,0)..(10,10).
  const X0 = 0;
  const Y0 = 0;
  const X1 = 10;
  const Y1 = 10;
  const hit = (ax: number, ay: number, bx: number, by: number): boolean =>
    segmentIntersectsStrataBoxInterior(ax, ay, bx, by, X0, Y0, X1, Y1);

  it("corner-to-corner diagonal pass is a HIT (the R-F1 repro)", () => {
    // Passes exactly through opposite corners (0,0) and (10,10). The old
    // proper-side-crossing test returned false here (collinear at corners),
    // wrongly ACCEPTING a detour through a raw foreign box.
    expect(hit(-5, -5, 15, 15)).toBe(true);
    // The other diagonal, corners (10,0)->(0,10).
    expect(hit(15, -5, -5, 15)).toBe(true);
  });

  it("boundary graze (single corner touch, no interior) is NOT a hit", () => {
    // Passes exactly through corner (10,10) but stays outside otherwise.
    expect(hit(12, 8, 8, 12)).toBe(false);
    // Passes exactly through corner (0,0) but stays outside otherwise.
    expect(hit(-2, 2, 2, -2)).toBe(false);
  });

  it("collinear-along-a-side pass is NOT a hit", () => {
    // Along the top edge y = 0 (a closed side, not the open interior).
    expect(hit(-5, 0, 15, 0)).toBe(false);
    // Along the right edge x = 10.
    expect(hit(10, -5, 10, 15)).toBe(false);
    // Along the bottom edge y = 10.
    expect(hit(15, 10, -5, 10)).toBe(false);
  });

  it("endpoint on boundary but segment crosses through interior is a HIT", () => {
    // Starts on the top edge (5,0) at interior-x, dives into the interior.
    expect(hit(5, 0, 5, 8)).toBe(true);
    // Starts on the left edge (0,5), crosses to the far side.
    expect(hit(0, 5, 15, 5)).toBe(true);
  });

  it("endpoint strictly inside is a HIT; segment fully outside is NOT", () => {
    expect(hit(5, 5, 20, 20)).toBe(true); // one endpoint interior
    expect(hit(2, 2, 8, 8)).toBe(true); // both endpoints interior
    expect(hit(-5, -5, -1, -1)).toBe(false); // wholly outside
    expect(hit(11, 0, 11, 10)).toBe(false); // parallel, right of box
  });

  it("boundary-touching endpoint that does not enter interior is NOT a hit", () => {
    // Endpoint exactly on the edge, segment heads away from the box.
    expect(hit(5, 0, 5, -8)).toBe(false);
  });
});

// ── packedConverge — best-seen snapshot return (G-DESCENT remedy) ────────────
//
// With epsilon 0 adoption is strictly monotone under the comparator, so the
// rolling incumbent IS the best-seen snapshot and converge must be inert. Only
// an ε-band adoption (packedScoringEpsilon > 0) can displace a comparator-
// better incumbent (hold-then-drop) — that is the case converge exists for.

// Shared single-build fixture for the ε-1 test below (both runs must see the
// SAME model/edges/rank objects; blindSpotFixture() builds fresh ones).
const model0 = (() => {
  let cached: {
    model: StrataModel;
    rankR: StrataRankResult;
    edgesE: StrataPrimeEdge[];
  } | null = null;
  return () => {
    if (!cached) {
      const { model, rank, edges } = blindSpotFixture();
      cached = { model, rankR: rank, edgesE: edges };
    }
    return cached;
  };
})();

describe("packedConverge — best-seen snapshot return", () => {
  /** Lexicographic minimum over the ADOPTED frontier records (the best-seen). */
  const bestSeenOf = (
    records: readonly StrataPackedTrialRecord[],
  ): StrataPackedScore => {
    const adopted = records.filter((r) => r.adopted);
    let best = adopted[0]!.score;
    for (const r of adopted) {
      if (strataPackedScoreLess(r.score, best)) {
        best = r.score;
      }
    }
    return best;
  };

  it("default off is byte-identical: flag absent === explicit false (ε 0 and ε 1)", () => {
    const { model, rank, edges } = blindSpotFixture();
    for (const packedScoringEpsilon of [0, 1]) {
      const absent = placeStrataHullsPackedScored(model, edges, rank, {
        ...OPTS_K4,
        packedScoringEpsilon,
      });
      const explicitOff = placeStrataHullsPackedScored(model, edges, rank, {
        ...OPTS_K4,
        packedScoringEpsilon,
        packedConverge: false,
      });
      expect([...explicitOff.selections.entries()]).toEqual([
        ...absent.selections.entries(),
      ]);
      expect(explicitOff.score).toEqual(absent.score);
      expect(explicitOff.trialCount).toBe(absent.trialCount);
      // The report-only field must be ABSENT on both off paths (object-shape
      // byte-identity, not just value equality).
      expect("convergeRecovered" in absent).toBe(false);
      expect("convergeRecovered" in explicitOff).toBe(false);
      expect(placementFingerprint(explicitOff.placement)).toBe(
        placementFingerprint(absent.placement),
      );
    }
  });

  it("ε 0: converge is inert — strict-only adoption is monotone, the incumbent IS the best-seen", () => {
    const { model, rank, edges } = blindSpotFixture();
    const off = placeStrataHullsPackedScored(model, edges, rank, OPTS_K4);
    const on = placeStrataHullsPackedScored(model, edges, rank, {
      ...OPTS_K4,
      packedConverge: true,
    });
    expect([...on.selections.entries()]).toEqual([...off.selections.entries()]);
    expect(on.score).toEqual(off.score);
    expect(on.trialCount).toBe(off.trialCount);
    expect(on.convergeRecovered).toBe(false);
    expect(placementFingerprint(on.placement)).toBe(
      placementFingerprint(off.placement),
    );
  });

  it("ε 1: a transiently-adopted-then-dropped winner is recovered within the 2-pass descent", () => {
    // The hold-then-drop mechanism: an ε-band adoption strictly improves only
    // the (pen, L1) suffix while crossings may rise back within the budget, so
    // a comparator-dominant snapshot adopted earlier can be displaced. Converge
    // must return that best-seen snapshot; the descent itself stays 2-pass
    // bounded — no extra passes are bought.
    const OPTS_EPS: StrataEngineOptions = {
      ...OPTS_K4,
      packedScoringEpsilon: 1,
    };

    // OFF with the frontier collector: detect whether this fixture actually
    // oscillates (a comparator-better snapshot was adopted, then displaced).
    const offRecords: StrataPackedTrialRecord[] = [];
    const off = placeStrataHullsPackedScored(
      model0().model,
      model0().edgesE,
      model0().rankR,
      OPTS_EPS,
      (r) => offRecords.push(r),
    );
    const bestSeenOff = bestSeenOf(offRecords);
    const oscillated = strataPackedScoreLess(bestSeenOff, off.score);

    // ON with the collector: the descent TRAJECTORY must be unchanged — the
    // flag only changes what is returned.
    const onRecords: StrataPackedTrialRecord[] = [];
    const on = placeStrataHullsPackedScored(
      model0().model,
      model0().edgesE,
      model0().rankR,
      { ...OPTS_EPS, packedConverge: true },
      (r) => onRecords.push(r),
    );
    expect(onRecords).toEqual(offRecords);
    expect(on.trialCount).toBe(off.trialCount);
    expect(on.baselineScore).toEqual(off.baselineScore);

    // The return contract: score === the comparator-minimum over adopted
    // trials, and it is never worse than the incumbent OFF returned.
    expect(on.score).toEqual(bestSeenOf(onRecords));
    expect(strataPackedScoreLess(off.score, on.score)).toBe(false);

    if (oscillated) {
      // RECOVERY: the best-seen snapshot strictly beats the rolling incumbent.
      expect(strataPackedScoreLess(on.score, off.score)).toBe(true);
      expect(on.score).toEqual(bestSeenOff);
      expect(on.convergeRecovered).toBe(true);
    } else {
      // NO-CHANGE-tolerant (house rule — reported honestly, never forced):
      // this fixture did not hold-then-drop at ε=1, so converge is inert.
      // eslint-disable-next-line no-console -- probe output IS the deliverable
      console.log(
        "packedConverge fixture: NO hold-then-drop at ε=1 — converge inert on this fixture (real-preset Config 2 covers the recovery path)",
      );
      expect(on.convergeRecovered).toBe(false);
      expect(placementFingerprint(on.placement)).toBe(
        placementFingerprint(off.placement),
      );
    }

    // Replay contract: the returned selections reproduce the returned
    // placement through placeStrataHulls (the per-hull map is the real
    // contract, not a side path) — this is what forces `selections` to be the
    // best-seen SNAPSHOT's map, not the final incumbent's.
    const replay = placeStrataHulls(
      model0().model,
      model0().edgesE,
      model0().rankR,
      OPTS_EPS,
      new Map(on.selections),
    );
    expect(placementFingerprint(replay)).toBe(
      placementFingerprint(on.placement),
    );

    // Deterministic: double-compute is selection- and placement-identical.
    const again = placeStrataHullsPackedScored(
      model0().model,
      model0().edgesE,
      model0().rankR,
      { ...OPTS_EPS, packedConverge: true },
    );
    expect([...again.selections.entries()]).toEqual([
      ...on.selections.entries(),
    ]);
    expect(placementFingerprint(again.placement)).toBe(
      placementFingerprint(on.placement),
    );
  });

  it("canonical fingerprint: two logically-equal selection maps with different insertion order place identically", () => {
    // Best-seen snapshot tracking snapshots the rolling selection map; the
    // observable contract: placeStrataHulls is a pure function of the map's
    // ENTRIES, not its insertion order.
    const { model, rank, edges } = blindSpotFixture();
    const scored = placeStrataHullsPackedScored(model, edges, rank, OPTS_K4);
    expect(scored.selections.size).toBeGreaterThanOrEqual(1);
    const entries = [...scored.selections.entries()];
    const forward = new Map(entries);
    const reversed = new Map([...entries].reverse());
    const a = placeStrataHulls(model, edges, rank, OPTS_K4, forward);
    const b = placeStrataHulls(model, edges, rank, OPTS_K4, reversed);
    expect(placementFingerprint(a)).toBe(placementFingerprint(b));
  });
});
